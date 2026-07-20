// WZ-UFC-CARD-2026-07-09 / WZ-UFC-ODDS-2026-07-09 / WZ-UFC-CITO-2026-07-09
// UFC/MMA card endpoint. PRIMARY path builds the real card from Cito (api.citoapi.com):
// the next PPV event only, split into Main Card / Prelims (cardSection), with weight classes,
// title-bout badges, fighter records and headshots. Odds/picks come from The Odds API
// (mma_mixed_martial_arts h2h), matched to Cito's bouts by fighter name and de-vigged into a
// market win probability; pick = the favorite, winPct = de-vig %. edgePct stays null (edge =
// beating the market, which a market-anchored pick can't claim; it turns on with a fighter model).
// Fail-safe ladder: Cito PPV card -> (if Cito unconfigured/empty) the flat odds-only card ->
// (if that's empty too) a clean empty state. The page never breaks.
// Endpoint: GET /api/ufc/card
const express = require("express");
const router = express.Router();
const axios = require("axios");
const { fetchMMASchedule } = require("../services/sportsData");
const adminGuard = require("../middleware/adminGuard"); // WZ-ADMIN-GUARD-2026-07-17 :: gate the 3 UFC debug routes (card/record stay public)
const { getNextPPVEvent, getEventBouts, getFighter, getFighterFights, getUpcomingEvents } = require("../services/citoApi"); // WZ-UFC-FORM-2026-07-09 / WZ-UFC-HOLDEVENT-2026-07-11
const { scoreBout, methodLean } = require("../services/mmaModel"); // WZ-UFC-MODEL-2026-07-09 / WZ-UFC-METHOD-2026-07-09
const { createClient } = require("@supabase/supabase-js"); // WZ-UFC-REC-2026-07-09
const { getEspnUfcResults, espnWinnerCorner, normName: espnNorm } = require("../services/espnMma"); // WZ-UFC-DIAGV2-2026-07-12

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const CARD_TTL_MS = 15 * 60 * 1000; // assembled card cache (Cito + odds are cached deeper)
const ODDS_TTL_MS = 10 * 60 * 1000;

let cardCache = { at: 0, data: null };
let cardInflight = null;
let oddsCache = { at: 0, map: null };

// ---- odds helpers ----------------------------------------------------------
function impliedFromAmerican(a) {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? (-n) / (-n + 100) : 100 / (n + 100);
}
function impliedFromAny(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) >= 100) return impliedFromAmerican(n);
  if (n > 1) return 1 / n; // decimal
  return null;
}
function median(nums) {
  const s = nums.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function normName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function getOddsMap() {
  const now = Date.now();
  if (oddsCache.map && now - oddsCache.at < ODDS_TTL_MS) return oddsCache.map;
  const map = new Map();
  if (!ODDS_API_KEY) { oddsCache = { at: now, map }; return map; }
  try {
    const res = await axios.get(`${ODDS_BASE}/sports/mma_mixed_martial_arts/odds`, {
      params: { apiKey: ODDS_API_KEY, regions: "us", markets: "h2h", oddsFormat: "american" },
      timeout: 12000,
    });
    for (const ev of Array.isArray(res.data) ? res.data : []) {
      const priceByName = {};
      for (const bk of ev.bookmakers || []) {
        for (const mk of bk.markets || []) {
          if (mk.key !== "h2h") continue;
          for (const oc of mk.outcomes || []) {
            (priceByName[oc.name] = priceByName[oc.name] || []).push(Number(oc.price));
          }
        }
      }
      for (const nm of Object.keys(priceByName)) {
        const med = median(priceByName[nm]);
        const impl = impliedFromAmerican(med);
        if (impl != null) map.set(normName(nm), { impl, american: med });
      }
    }
  } catch (e) {
    console.error("[UFC] Odds map fetch failed:", e.message);
  }
  oddsCache = { at: now, map };
  return map;
}

// ---- Cito card assembly ----------------------------------------------------
function fighterByCorner(bout, corner) {
  const list = Array.isArray(bout.fighters) ? bout.fighters : [];
  const f = list.find((x) => String(x.corner || "").toLowerCase() === corner) || null;
  if (!f) return null;
  const p = f.profile || {};
  return {
    slug: f.fighterSlug || p.slug || null,
    name: f.fighterName || p.name || "TBD",
    record: p.recordText || (p.record ? `${p.record.wins}-${p.record.losses}-${p.record.draws}` : ""),
    headshot: p.headshotUrl || f.imageUrl || null,
    country: p.country || f.country || "",
    nickname: p.nickname || "",
  };
}

async function parseBout(bout, oddsMap) {
  const red = fighterByCorner(bout, "red");
  const blue = fighterByCorner(bout, "blue");
  if (!red || !blue) return null;

  // market odds: Cito per-bout first, else The Odds API by name
  let implRed = impliedFromAny(bout.odds && bout.odds.red);
  let implBlue = impliedFromAny(bout.odds && bout.odds.blue);
  let amRed = Number.isFinite(Number(bout.odds && bout.odds.red)) ? Number(bout.odds.red) : null;
  let amBlue = Number.isFinite(Number(bout.odds && bout.odds.blue)) ? Number(bout.odds.blue) : null;
  if (implRed == null || implBlue == null) {
    const oR = oddsMap.get(normName(red.name));
    const oB = oddsMap.get(normName(blue.name));
    if (oR && oB) { implRed = oR.impl; implBlue = oB.impl; amRed = oR.american; amBlue = oB.american; }
  }

  const out = {
    id: bout.id,
    cardSection: bout.cardSection || "Prelims",
    cardPosition: bout.cardPosition || "",
    boutOrder: Number(bout.boutOrder) || 0,
    weightClass: (bout.weightClass || "").replace(/ Bout$/i, ""),
    titleBout: !!bout.titleBout,
    red, blue,
    pick: null, winPct: null, pickCorner: null, odds: null,
    marketWinPct: null, edgePct: null, value: false,
    methodLean: null, // WZ-UFC-METHOD-2026-07-09 :: info-only KO/SUB/DEC read (no market to beat)
  };

  // no market -> pending (no pick/edge until sportsbooks post the line)
  if (implRed == null || implBlue == null || implRed + implBlue <= 0) return out;
  const pMktRed = implRed / (implRed + implBlue);

  // fetch fighter profiles + run the factor model. Fail-safe: null profiles => neutral => market.
  let modelRed = pMktRed;
  try {
    const [rp, bp, rf, bf] = await Promise.all([
      getFighter(red.slug), getFighter(blue.slug),
      getFighterFights(red.slug), getFighterFights(blue.slug), // WZ-UFC-FORM-2026-07-09
    ]);
    const scored = scoreBout(rp, bp, pMktRed, { redFights: rf, blueFights: bf, asOf: Date.now() });
    if (scored && Number.isFinite(scored.modelRed)) modelRed = scored.modelRed;
    if (typeof methodLean === "function") out.methodLean = methodLean(rp, bp) || null; // WZ-UFC-METHOD-2026-07-09
  } catch (_) { /* stay at market */ }

  const pickRed = modelRed >= 0.5;
  out.pickCorner = pickRed ? "red" : "blue";
  out.pick = pickRed ? red.name : blue.name;
  out.winPct = Math.round((pickRed ? modelRed : 1 - modelRed) * 100);
  out.odds = pickRed ? amRed : amBlue;
  red.odds = amRed; blue.odds = amBlue; // WZ-UFC-CARDV3-2026-07-09 :: both corners' odds for the head-to-head card
  const pickMkt = pickRed ? pMktRed : 1 - pMktRed;
  const pickModel = pickRed ? modelRed : 1 - modelRed;
  out.marketWinPct = Math.round(pickMkt * 100);
  out.edgePct = Math.round((pickModel - pickMkt) * 100); // model - market on our pick
  out.value = out.edgePct >= 4; // meaningful positive edge -> VALUE
  return out;
}

// WZ-UFC-HOLDEVENT-2026-07-11 :: keep the UFC card on the event that's actually happening.
// getNextPPVEvent() rolls to the NEXT upcoming PPV the moment Cito drops the current event off
// the upcoming list (~main-card start) -- which yanks the live card away mid-event and shows the
// following event instead. Instead: if we still have UNGRADED picks for an event that is NO
// LONGER on the upcoming list (i.e. it has started / just finished), keep showing THAT event
// until its picks all settle, then roll forward. Fully fail-safe: any error / no match returns
// the normal next event, so worst case is exactly today's behavior.
// WZ-UFC-CHRONO-2026-07-20 :: THE CARD ONLY EVER SHOWED THE NEXT PPV, so Fight Nights were invisible.
// getNextPPVEvent() takes the earliest PPV with bouts available, falls back to any PPV, and only
// reaches "earliest event of any kind" when NO PPV exists at all. isPPV() is /^ufc-\d+\b/, which a
// Fight Night slug never matches -- and a PPV is always on the schedule months out. So a Fight Night
// happening THIS Saturday lost to a PPV three weeks away and never became the card. A customer opening
// the app on fight night saw picks for an event nobody could bet yet, and the fights they COULD bet
// were absent. Relevance is imminence: a card is only useful before the bell.
// Now: the next event chronologically that has bouts available, PPV or not. Bouts-available is
// required because an event with no bouts filed yet produces no picks; among those we take the
// soonest. isPPV stays in citoApi for other callers -- it just no longer governs the card.
async function getNextEventChrono() {
  const events = await getUpcomingEvents().catch(() => []);
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return null;
  const byDate = (a, b) => new Date(a.startsAt || 0) - new Date(b.startsAt || 0);
  const withBouts = list
    .filter((e) => e && e.slug && e.dataAvailability && e.dataAvailability.bouts === "available")
    .sort(byDate);
  if (withBouts.length) return withBouts[0];
  return list.filter((e) => e && e.slug).sort(byDate)[0] || null;
}

async function pickCardEvent() {
  const next = await getNextEventChrono();
  try {
    const c = sb();
    if (!c) return next;
    const upcoming = await getUpcomingEvents().catch(() => []);
    const upcomingSlugs = new Set((upcoming || []).map((e) => e && e.slug).filter(Boolean));
    const { data: pend } = await c
      .from("ufc_picks")
      .select("event_slug,event_name")
      .eq("result", "pending")
      .limit(200);
    // a live / just-finished event = has ungraded picks but is no longer on the upcoming list
    const live = (pend || []).find((r) => r.event_slug && !upcomingSlugs.has(r.event_slug));
    if (live && (!next || live.event_slug !== next.slug)) {
      return { slug: live.event_slug, title: live.event_name || "UFC", _live: true };
    }
  } catch (_) { /* fall through to the normal next event */ }
  return next;
}

async function buildCitoCard() {
  let event = await pickCardEvent();
  if (!event || !event.slug) return null;
  let rawBouts = await getEventBouts(event.slug);
  // if the held live event returns no bouts, fall back to the normal next event (never go empty)
  if ((!Array.isArray(rawBouts) || !rawBouts.length) && event._live) {
    event = await getNextEventChrono(); // WZ-UFC-CHRONO-2026-07-20 :: was getNextPPVEvent()
    if (!event || !event.slug) return null;
    rawBouts = await getEventBouts(event.slug);
  }
  if (!Array.isArray(rawBouts) || !rawBouts.length) return null;

  const oddsMap = await getOddsMap();
  const parsedAll = await Promise.all(rawBouts.map((b) => parseBout(b, oddsMap)));
  const parsed = parsedAll.filter(Boolean);
  if (!parsed.length) return null;

  // WZ-UFC-CLOSEDLINE-2026-07-11 :: books pull the MMA moneyline once a fight starts, so parseBout
  // returns a null pick for in-progress/finished bouts even though we captured the pick pre-fight.
  // Fill those from the pick we already banked in ufc_picks so the card keeps showing our pick +
  // odds instead of flipping to "ODDS PENDING". Read-only; never overrides a still-live pick.
  try {
    if (parsed.some((b) => b.winPct == null)) {
      const c = sb();
      if (c) {
        const { data: saved } = await c
          .from("ufc_picks")
          .select("bout_id,pick,pick_corner,win_pct,market_win_pct,edge_pct,is_value,odds,result")
          .eq("event_slug", event.slug);
        const byId = new Map((saved || []).map((r) => [String(r.bout_id), r]));
        for (const b of parsed) {
          if (b.winPct != null) continue;              // a still-live pick always wins
          const s = byId.get(String(b.id));
          if (!s || s.pick == null || s.win_pct == null) continue;
          b.pick = s.pick;
          b.pickCorner = s.pick_corner || null;
          b.winPct = s.win_pct;
          b.marketWinPct = s.market_win_pct != null ? s.market_win_pct : null;
          b.edgePct = s.edge_pct != null ? s.edge_pct : null;
          b.value = !!s.is_value;
          b.odds = s.odds != null ? s.odds : null;
          if (b.red && s.pick_corner === "red") b.red.odds = s.odds;
          if (b.blue && s.pick_corner === "blue") b.blue.odds = s.odds;
          b.lineClosed = true;                          // pick locked pre-fight; live line has since closed
          b.result = s.result != null ? s.result : null; // win/loss/push once the grader settles it (else "pending")
        }
      }
    }
  } catch (e) { /* fail-safe: leave bouts exactly as parsed */ }

  const mainCard = parsed
    .filter((b) => String(b.cardSection).toLowerCase() === "main card")
    .sort((a, b) => a.boutOrder - b.boutOrder);
  const prelims = parsed
    .filter((b) => String(b.cardSection).toLowerCase() !== "main card")
    .sort((a, b) => a.boutOrder - b.boutOrder);

  return {
    ok: true,
    source: "cito",
    picksLive: parsed.some((b) => b.winPct != null),
    edgePending: true,
    eventSlug: event.slug || null,
    event: {
      slug: event.slug || null,
      name: event.title || event.shortTitle || "UFC",
      dateLabel: event.eventDateLabel || "",
      venue: event.venue || "",
      city: event.city || event.locationText || "",
      imageUrl: event.imageUrl || null,
      live: !!event._live, // WZ-UFC-HOLDEVENT-2026-07-11 :: true when we're holding the in-progress event
    },
    mainCard,
    prelims,
  };
}

// ---- flat odds-only fallback ----------------------------------------------
async function fetchOddsFallbackCard() {
  const oddsMap = await getOddsMap();
  if (!ODDS_API_KEY) return [];
  try {
    const res = await axios.get(`${ODDS_BASE}/sports/mma_mixed_martial_arts/odds`, {
      params: { apiKey: ODDS_API_KEY, regions: "us", markets: "h2h", oddsFormat: "american" },
      timeout: 12000,
    });
    return (Array.isArray(res.data) ? res.data : []).map((ev) => {
      const A = ev.away_team, B = ev.home_team;
      const oA = oddsMap.get(normName(A)), oB = oddsMap.get(normName(B));
      let pick = null, winPct = null, pickCorner = null, odds = null;
      if (oA && oB && oA.impl + oB.impl > 0) {
        const dvA = oA.impl / (oA.impl + oB.impl), dvB = oB.impl / (oA.impl + oB.impl);
        if (dvA >= dvB) { pick = A; winPct = Math.round(dvA * 100); pickCorner = "red"; odds = oA.american; }
        else { pick = B; winPct = Math.round(dvB * 100); pickCorner = "blue"; odds = oB.american; }
      }
      return {
        id: ev.id,
        red: { name: A || "Fighter 1", record: "", headshot: null },
        blue: { name: B || "Fighter 2", record: "", headshot: null },
        weightClass: "", titleBout: false, cardSection: "Prelims", boutOrder: 0,
        pick, winPct, pickCorner, odds, edgePct: null, time: ev.commence_time || "",
      };
    });
  } catch (_) {
    return [];
  }
}

// WZ-UFC-REC-2026-07-09 :: snapshot each Cito card's picks into Supabase so we can grade
// them after the event (Cito fills in winnerFighterSlug post-fight) and build a UFC record.
// Fire-and-forget + fail-safe; upsert on bout_id so repeated loads just refresh the row.
let _sbClient = null;
function sb() {
  if (_sbClient) return _sbClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  _sbClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sbClient;
}
// WZ-UFC-RECORD-CRON-2026-07-20 :: signature changed from (card) to (bouts, event). It used to take a
// whole card object and bail on `card.source !== "cito"` -- a SILENT return that banked nothing whenever
// Cito was down and loadCard fell back to the odds feed. Taking the bouts directly means the cron and
// the page load share ONE banking function instead of two that can drift, and "nothing bankable" is
// now logged rather than swallowed.
async function recordUFCPicks(bouts, event) {
  try {
    const c = sb();
    if (!c || !Array.isArray(bouts) || !bouts.length) return 0;
    const rows = bouts
      .filter((b) => b.pick && b.winPct != null && b.id != null)
      .map((b) => ({
        bout_id: String(b.id),
        event_slug: (event && event.slug) || null,
        event_name: (event && event.name) || null,
        card_section: b.cardSection || null,
        weight_class: b.weightClass || null,
        red_name: b.red ? b.red.name : null,
        blue_name: b.blue ? b.blue.name : null,
        pick: b.pick,
        pick_corner: b.pickCorner || null,
        win_pct: b.winPct,                                  // model win% (the pick's)
        market_win_pct: b.marketWinPct != null ? b.marketWinPct : null,
        edge_pct: b.edgePct != null ? b.edgePct : null,     // model - market
        is_value: !!b.value,
        odds: b.odds != null ? b.odds : null,
      }));
    if (!rows.length) {
      console.warn(`[UFC] recordUFCPicks: ${bouts.length} bout(s) for ${(event && event.slug) || "unknown event"} produced no bankable pick (no odds yet, or all fights already started).`);
      return 0;
    }
    const { error } = await c.from("ufc_picks").upsert(rows, { onConflict: "bout_id" });
    if (error) { console.error("[UFC] recordUFCPicks upsert failed:", error.message); return 0; }
    return rows.length;
  } catch (e) {
    console.error("[UFC] recordUFCPicks failed:", e.message);
    return 0;
  }
}

// WZ-UFC-RECORD-CRON-2026-07-20 :: RECORDING USED TO BE A SIDE EFFECT OF DISPLAY.
// recordUFCPicks had exactly one caller -- inside loadCard(), which runs only when someone hits
// GET /api/ufc/card. There was no recording cron (server.js scheduled a UFC *grade* pass and nothing
// that banks picks), so if nobody opened the UFC tab before the fights started, nothing was ever
// written down and the grader had nothing to grade. Combined with the PPV-only card selection above,
// a Fight Night could not be recorded even in principle.
// This walks EVERY upcoming event with bouts available inside the window and banks each one, on a
// schedule, whether or not a human opens the page. Display selection and recording are now separate
// concerns: the card headlines one event, the recorder captures them all.
const RECORD_WINDOW_DAYS = 14;
async function recordUpcomingUFC() {
  const out = { events: 0, banked: 0, skipped: 0 };
  try {
    const events = await getUpcomingEvents().catch(() => []);
    const list = Array.isArray(events) ? events : [];
    const now = Date.now();
    const inWindow = list.filter((e) => {
      if (!e || !e.slug) return false;
      if (!e.dataAvailability || e.dataAvailability.bouts !== "available") return false;
      const t = Date.parse(e.startsAt || "");
      if (isNaN(t)) return true;                        // undated but bouts filed -> still bank it
      return t >= now - 864e5 && t <= now + RECORD_WINDOW_DAYS * 864e5;
    });
    const oddsMap = await getOddsMap();
    for (const ev of inWindow) {
      const rawBouts = await getEventBouts(ev.slug);
      if (!Array.isArray(rawBouts) || !rawBouts.length) { out.skipped++; continue; }
      const parsed = (await Promise.all(rawBouts.map((b) => parseBout(b, oddsMap)))).filter(Boolean);
      if (!parsed.length) { out.skipped++; continue; }
      out.events++;
      out.banked += await recordUFCPicks(parsed, { slug: ev.slug, name: ev.title || ev.shortTitle || "UFC" });
    }
    if (out.events || out.skipped) {
      console.log(`[UFC] recordUpcomingUFC: banked ${out.banked} pick(s) across ${out.events} event(s), ${out.skipped} skipped.`);
    }
  } catch (e) {
    console.error("[UFC] recordUpcomingUFC failed:", e.message);
  }
  return out;
}

async function loadCard() {
  const now = Date.now();
  if (cardCache.data && now - cardCache.at < CARD_TTL_MS) return cardCache.data;
  if (cardInflight) return cardInflight;
  cardInflight = (async () => {
    try {
      const cito = await buildCitoCard();
      if (cito) {
        cardCache = { at: Date.now(), data: cito };
        // WZ-UFC-RECORD-CRON-2026-07-20 :: same banking function the cron uses, called with this card's bouts.
        recordUFCPicks([...(cito.mainCard || []), ...(cito.prelims || [])],
          { slug: cito.eventSlug, name: cito.event ? cito.event.name : null }).catch(() => {});
        return cito;
      }
      let fights = await fetchOddsFallbackCard();
      if (!fights.length) {
        const sched = await fetchMMASchedule().catch(() => []);
        fights = (Array.isArray(sched) ? sched : []).map((f) => ({
          id: f.id,
          red: { name: f.away || "Fighter 1", record: "", headshot: null },
          blue: { name: f.home || "Fighter 2", record: "", headshot: null },
          weightClass: "", titleBout: false, cardSection: "Prelims", boutOrder: 0,
          pick: null, winPct: null, pickCorner: null, odds: null, edgePct: null,
          time: f.time || "", venue: f.venue || "",
        }));
      }
      const flat = {
        ok: true, source: "odds", picksLive: fights.some((f) => f.winPct != null),
        edgePending: true, event: null, mainCard: [], prelims: fights,
      };
      cardCache = { at: Date.now(), data: flat };
      return flat;
    } catch (_) {
      return cardCache.data || { ok: true, source: "none", picksLive: false, edgePending: true, event: null, mainCard: [], prelims: [] };
    } finally {
      cardInflight = null;
    }
  })();
  return cardInflight;
}

router.get("/card", async (_req, res) => {
  try {
    const card = await loadCard();
    res.json(card);
  } catch (_) {
    res.json({ ok: true, source: "none", picksLive: false, edgePending: true, event: null, mainCard: [], prelims: [] });
  }
});

// WZ-UFC-GRADERDIAG-2026-07-11 :: TEMPORARY, read-only. Fresh Cito read of the current event's
// bouts, surfacing ONLY the two fields the grader settles on -- winnerFighterSlug (win/loss path)
// and status (the TERMINAL_RE draw/no-contest path) -- so a real settled fight can be verified
// against the grader before the main card grades. Bypasses the card cache. Safe to delete after
// the event. Exposes nothing sensitive (public fight results/status).
// WZ-UFC-DIAGV2-2026-07-12 :: fallback verifier. Resolves the SAME event the live card is holding
// (pickCardEvent, not getNextPPVEvent -- otherwise during an event-hold this points at the NEXT
// event and reports the wrong card). For each bout it runs the grader's REAL matcher paths so we
// can watch the ESPN fallback settle fights: Cito winnerFighterSlug (-> corner), and ESPN via the
// exact espnWinnerCorner() the grader uses. verdict = what the grader would do THIS tick:
//   CITO   Cito already has a winner (grades off Cito)
//   ESPN   Cito null but ESPN fallback settles it (grades off ESPN)
//   PUSH?  concluded status, no winner (draw / NC / cancel path)
//   PENDING nothing yet (fight not done, or a name-match MISS)
// When a fight is finished on ESPN but does NOT settle, `miss` shows the normalized candidate
// name-sets from both sides + the matched ESPN fight, so a nickname miss is visible at a glance.
router.get("/diag", adminGuard, async (_req, res) => {
  try {
    const event = await pickCardEvent();
    if (!event || !event.slug) return res.json({ ok: false, reason: "no-event" });
    const [bouts, espnResults] = await Promise.all([
      getEventBouts(event.slug, { fresh: true }),
      getEspnUfcResults().catch(() => []),
    ]);
    const list = Array.isArray(bouts) ? bouts : [];
    const TERMINAL_RE = /(final|complete|decision|ended|closed|result|draw|no.?contest|cancel|void)/i;

    // mirror espnMma.espnWinnerCorner's per-fighter candidate set (name / profile name / slug)
    const candSet = (f) => {
      const s = new Set();
      if (f && f.fighterName) s.add(espnNorm(f.fighterName));
      if (f && f.profile && f.profile.name) s.add(espnNorm(f.profile.name));
      if (f && f.fighterSlug) s.add(espnNorm(String(f.fighterSlug).replace(/-/g, " ")));
      s.delete("");
      return [...s];
    };
    const cornerOf = (b, corner) => {
      const fs = Array.isArray(b.fighters) ? b.fighters : [];
      return fs.find((x) => String(x.corner || "").toLowerCase() === corner) || null;
    };
    const nameOf = (f) => (f ? (f.fighterName || (f.profile && f.profile.name) || f.fighterSlug || "") : "");
    // Cito's own settle path: winnerFighterSlug -> corner
    const citoCornerOf = (b) => {
      const slug = b && b.winnerFighterSlug;
      if (!slug) return null;
      const fs = Array.isArray(b.fighters) ? b.fighters : [];
      const w = fs.find((f) => String(f.fighterSlug || (f.profile && f.profile.slug) || "") === String(slug));
      return w ? String(w.corner || "").toLowerCase() : null;
    };

    const rows = list.map((b) => {
      const red = cornerOf(b, "red"), blue = cornerOf(b, "blue");
      const citoCorner = citoCornerOf(b);
      const espn = espnWinnerCorner(b, espnResults); // { corner, name } | null -- grader's real matcher
      const status = b.status != null ? b.status : null;

      let verdict = "PENDING";
      if (citoCorner) verdict = "CITO";
      else if (espn && espn.corner) verdict = "ESPN";
      else if (TERMINAL_RE.test(String(status || ""))) verdict = "PUSH?";

      const row = {
        id: b.id,
        cardPosition: b.cardPosition || "",
        bout: `${nameOf(red)} vs ${nameOf(blue)}`,
        status,
        winnerFighterSlug: b.winnerFighterSlug != null ? b.winnerFighterSlug : null,
        citoWinnerCorner: citoCorner,
        espnSettles: !!(espn && espn.corner),
        espnWinner: espn ? espn.name : null,
        verdict,
      };

      // Diagnose a potential name-match MISS: ESPN knows this fight is done, but we don't settle.
      if (!citoCorner && verdict === "PENDING") {
        const rc = candSet(red), bc = candSet(blue);
        const rset = new Set(rc), bset = new Set(bc);
        const matched = espnResults.find(
          (f) => f && f.completed && [f.a, f.b].some((n) => rset.has(n)) && [f.a, f.b].some((n) => bset.has(n))
        );
        const espnHasFinished = espnResults.some(
          (f) => f && f.completed && f.winner && ([f.a, f.b].some((n) => rset.has(n)) || [f.a, f.b].some((n) => bset.has(n)))
        );
        if (espnHasFinished) {
          row.miss = {
            redCand: rc,
            blueCand: bc,
            espnMatch: matched ? { a: matched.a, b: matched.b, winner: matched.winner, completed: matched.completed } : null,
            note: matched ? "both corners matched an ESPN fight but winner did not resolve" : "no ESPN fight matched BOTH corners -> name normalization gap",
          };
        }
      }
      return row;
    });

    const espnFinished = espnResults.filter((f) => f && f.completed).length;
    // WZ-UFC-DIAGV21-2026-07-12 :: expose ESPN's own normalized names so a miss's spelling gap is
    // readable directly (our candidate sets are already on each row; this is the other side).
    const espnFights = espnResults.map((f) => ({ a: f.a, b: f.b, winner: f.winner, completed: f.completed }));
    res.json({
      ok: true,
      event: event.slug,
      held: !!event._live,
      count: rows.length,
      espnFinishedFights: espnFinished,
      espnFights,
      bouts: rows,
    });
  } catch (e) {
    res.json({ ok: false, error: String((e && e.message) || e) });
  }
});

// WZ-UFC-GRADENOW-2026-07-12 :: manual, self-contained settle. Unlike the cron grader it applies
// NO event-gating (no upcoming-list filter) and defers to nothing -- it reads every pending
// ufc_picks row, fetches that event's bouts fresh + ESPN once, resolves each winner (Cito slug
// first, then the ESPN fallback matcher), settles win/loss/push, busts the card cache so the next
// /card rebuild rolls forward, and returns a per-fight report (including any DB update error) so a
// single hit is fully self-diagnosing. Idempotent + fail-safe. Temporary; delete with /diag.
router.get("/grade-now", adminGuard, async (_req, res) => {
  const report = { ok: true, ran: true };
  try {
    const c = sb();
    if (!c) return res.json({ ok: false, error: "no-supabase" });

    const { data: pending, error } = await c
      .from("ufc_picks")
      .select("bout_id,event_slug,pick,pick_corner")
      .eq("result", "pending");
    if (error) return res.json({ ok: false, error: error.message });
    report.pendingBefore = (pending || []).map((r) => ({
      bout_id: r.bout_id, event_slug: r.event_slug, pick: r.pick, pick_corner: r.pick_corner,
    }));
    if (!pending || !pending.length) {
      cardCache = { at: 0, data: null };
      report.graded = 0; report.note = "no pending picks";
      try { const ev = await pickCardEvent(); report.cardEventNow = ev && ev.slug ? ev.slug : null; } catch (_) {}
      return res.json(report);
    }

    let espnResults = [];
    try { espnResults = await getEspnUfcResults(); } catch (_) { espnResults = []; }

    const TERMINAL_RE = /(final|complete|decision|ended|closed|result|draw|no.?contest|cancel|void)/i;
    const citoWinner = (bout) => {
      const slug = bout && bout.winnerFighterSlug;
      if (!slug) return null;
      const fs = Array.isArray(bout.fighters) ? bout.fighters : [];
      const w = fs.find((f) => String(f.fighterSlug || (f.profile && f.profile.slug) || "") === String(slug));
      return w ? { corner: String(w.corner || "").toLowerCase(), name: w.fighterName || (w.profile && w.profile.name) || null } : null;
    };

    const slugs = [...new Set(pending.map((r) => r.event_slug).filter(Boolean))];
    const pendingByBout = new Map(pending.map((r) => [String(r.bout_id), r]));
    const nowIso = new Date().toISOString();
    let graded = 0, pushed = 0, still = 0;
    const detail = [];

    for (const slug of slugs) {
      let bouts = [];
      try { bouts = await getEventBouts(slug, { fresh: true }); } catch (e) { detail.push({ event: slug, fetchError: String(e && e.message || e) }); }
      for (const bout of (Array.isArray(bouts) ? bouts : [])) {
        const row = pendingByBout.get(String(bout.id));
        if (!row) continue;
        let win = citoWinner(bout); let via = win ? "cito" : null;
        if (!win) { const ew = espnWinnerCorner(bout, espnResults); if (ew) { win = ew; via = "espn"; } }
        if (win && win.corner) {
          const result = win.corner === String(row.pick_corner || "").toLowerCase() ? "win" : "loss";
          const { error: uerr } = await c.from("ufc_picks")
            .update({ result, winner_name: win.name || null, graded_at: nowIso, updated_at: nowIso })
            .eq("bout_id", String(bout.id));
          detail.push({ bout: String(bout.id), pick: row.pick, settled: result, via, updateError: uerr ? uerr.message : null });
          if (!uerr) graded++;
        } else if (TERMINAL_RE.test(String(bout.status || ""))) {
          const { error: uerr } = await c.from("ufc_picks")
            .update({ result: "push", winner_name: null, graded_at: nowIso, updated_at: nowIso })
            .eq("bout_id", String(bout.id));
          detail.push({ bout: String(bout.id), pick: row.pick, settled: "push", via: "status", updateError: uerr ? uerr.message : null });
          if (!uerr) pushed++;
        } else {
          still++;
          detail.push({ bout: String(bout.id), pick: row.pick, settled: null, reason: "no winner from Cito or ESPN yet" });
        }
      }
    }

    cardCache = { at: 0, data: null }; // fresh rebuild -> rolls forward once nothing is pending
    report.graded = graded; report.pushed = pushed; report.stillPending = still; report.detail = detail;
    try { const ev = await pickCardEvent(); report.cardEventNow = ev && ev.slug ? ev.slug : null; } catch (_) {}
    return res.json(report);
  } catch (e) {
    return res.json({ ok: false, error: String((e && e.message) || e) });
  }
});

// WZ-UFC-RECORD-2026-07-09 :: served record for the UFC Record tab. Reads graded ufc_picks
// (result in win/loss/push) and computes two honest splits: MODEL OVERALL (every graded pick)
// and +VALUE ONLY (is_value picks -- the real test of the edge). Flat 1 unit/pick; ROI = net
// units / units risked (pushes return the stake, so they aren't counted as risked). Also returns
// the most recent graded fights for the "recent" list. Read-only; fail-safe empty on any error.
function unitsForWin(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return 1; // even-money fallback if odds are missing
  return n > 0 ? n / 100 : 100 / Math.abs(n);
}
function tallyUFC(rows) {
  let w = 0, l = 0, p = 0, net = 0;
  for (const r of rows) {
    if (r.result === "win") { w++; net += unitsForWin(r.odds); }
    else if (r.result === "loss") { l++; net -= 1; }
    else if (r.result === "push") { p++; }
  }
  const decided = w + l;
  return {
    w, l, p, decided,
    winPct: decided ? Math.round((w / decided) * 1000) / 10 : null,
    netUnits: Math.round(net * 100) / 100,
    roiPct: decided ? Math.round((net / decided) * 1000) / 10 : null,
  };
}

router.get("/record", async (_req, res) => {
  try {
    const c = sb();
    if (!c) return res.json({ ok: true, hasData: false, sinceLabel: null, overall: null, value: null, recent: [] });
    const { data, error } = await c
      .from("ufc_picks")
      .select("event_name,event_slug,red_name,blue_name,pick,pick_corner,edge_pct,is_value,odds,result,winner_name,graded_at")
      .in("result", ["win", "loss", "push"])
      .order("graded_at", { ascending: false });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const overall = tallyUFC(rows);
    const value = tallyUFC(rows.filter((r) => r.is_value));
    const recent = rows.slice(0, 8).map((r) => ({
      pick: r.pick || null,
      opponent: (r.pick_corner === "red" ? r.blue_name : r.red_name) || null,
      result: r.result,
      odds: r.odds != null ? r.odds : null,
      event: r.event_name || null,
      isValue: !!r.is_value,
      winnerName: r.winner_name || null,
    }));
    // "since ___" label = the earliest graded event we have (oldest row by graded_at desc order)
    const oldest = rows.length ? rows[rows.length - 1] : null;
    const sinceLabel = oldest && oldest.event_name ? oldest.event_name : null;
    res.json({
      ok: true,
      hasData: overall.decided > 0 || overall.p > 0,
      sinceLabel,
      overall,
      value,
      recent,
    });
  } catch (e) {
    console.error("[UFC] record endpoint failed:", e.message);
    res.json({ ok: true, hasData: false, sinceLabel: null, overall: null, value: null, recent: [] });
  }
});

// WZ-UFC-PROBE-2026-07-10 :: read-only Cito diagnostic. Additive; touches no existing logic.
// Never echoes the key -- returns only keyPresent (boolean), HTTP status, and shape/counts so we
// can see exactly why buildCitoCard() went empty. GET /api/ufc/probe . Remove after we diagnose.
router.get("/probe", adminGuard, async (_req, res) => {
  const out = { token: "WZ-UFC-PROBE-2026-07-10", ts: new Date().toISOString(), keyPresent: !!process.env.CITO_API_KEY };
  const KEY = process.env.CITO_API_KEY || "";
  const BASE = "https://api.citoapi.com/api/v1";
  // 1) raw upcoming-events read, cache-bypassed, never throws (captures 401/403/429/etc.)
  try {
    const r = await axios.get(`${BASE}/ufc/events/upcoming`, {
      headers: { "x-api-key": KEY }, timeout: 12000, validateStatus: () => true,
    });
    out.eventsHttpStatus = r.status;
    const body = r.data;
    out.eventsBodyType = Array.isArray(body && body.data)
      ? "data[]"
      : (body && typeof body === "object" ? "object{" + Object.keys(body).slice(0, 6).join(",") + "}" : typeof body);
    // WZ-UFC-PROBE-MSG-2026-07-10 :: surface Cito's actual error text (the real reason)
    out.citoSuccess = body && body.success;
    out.citoError = body && body.error != null ? JSON.stringify(body.error).slice(0, 400) : null;
    out.citoHelp = body && body.developer_help != null ? JSON.stringify(body.developer_help).slice(0, 500) : null;
    const list = body && Array.isArray(body.data) ? body.data : [];
    out.eventCount = list.length;
    out.firstEvents = list.slice(0, 5).map((e) => ({
      slug: e && e.slug, startsAt: e && e.startsAt,
      bouts: e && e.dataAvailability && e.dataAvailability.bouts,
    }));
  } catch (e) {
    out.eventsError = String((e.response && e.response.status) || e.code || e.message);
  }
  // 2) what the real card-builder resolves + a fresh bouts read on that event
  // WZ-UFC-CHRONO-2026-07-20 :: the card no longer resolves via getNextPPVEvent, so this probe reported
  // an event the builder would not choose. Now reports BOTH: nextEvent* is what the card actually uses
  // (chronological), nextPPV* is kept alongside it so the two can be compared at a glance.
  try {
    const chrono = await getNextEventChrono();
    out.nextEventSlug = chrono ? (chrono.slug || null) : null;
    out.nextEventName = chrono ? (chrono.title || chrono.shortTitle || null) : null;
    const ev = await getNextPPVEvent();
    out.nextPPVSlug = ev ? (ev.slug || null) : null;
    out.nextPPVName = ev ? (ev.title || ev.shortTitle || null) : null;
    if (ev && ev.slug) {
      const b = await getEventBouts(ev.slug, { fresh: true });
      out.boutCount = Array.isArray(b) ? b.length : 0;
    } else {
      out.boutCount = null;
    }
  } catch (e) {
    out.nextPPVError = String(e.message || e);
  }
  res.json(out);
});

module.exports = router;
// WZ-UFC-RECORD-CRON-2026-07-20 :: exposed for server.js's scheduled recorder, mirroring how
// matchupsRoutes exports warmMatchupIntel. Attached to the router export so the route module stays
// the single owner of card-building; server.js only schedules it.
module.exports.recordUpcomingUFC = recordUpcomingUFC;
