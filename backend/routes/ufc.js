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
const { getNextPPVEvent, getEventBouts, getFighter, getFighterFights } = require("../services/citoApi"); // WZ-UFC-FORM-2026-07-09
const { scoreBout, methodLean } = require("../services/mmaModel"); // WZ-UFC-MODEL-2026-07-09 / WZ-UFC-METHOD-2026-07-09
const { createClient } = require("@supabase/supabase-js"); // WZ-UFC-REC-2026-07-09

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
  const pickMkt = pickRed ? pMktRed : 1 - pMktRed;
  const pickModel = pickRed ? modelRed : 1 - modelRed;
  out.marketWinPct = Math.round(pickMkt * 100);
  out.edgePct = Math.round((pickModel - pickMkt) * 100); // model - market on our pick
  out.value = out.edgePct >= 4; // meaningful positive edge -> VALUE
  return out;
}

async function buildCitoCard() {
  const event = await getNextPPVEvent();
  if (!event || !event.slug) return null;
  const rawBouts = await getEventBouts(event.slug);
  if (!Array.isArray(rawBouts) || !rawBouts.length) return null;

  const oddsMap = await getOddsMap();
  const parsedAll = await Promise.all(rawBouts.map((b) => parseBout(b, oddsMap)));
  const parsed = parsedAll.filter(Boolean);
  if (!parsed.length) return null;

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
async function recordUFCPicks(card) {
  try {
    const c = sb();
    if (!c || !card || card.source !== "cito") return;
    const bouts = [...(card.mainCard || []), ...(card.prelims || [])];
    const rows = bouts
      .filter((b) => b.pick && b.winPct != null && b.id != null)
      .map((b) => ({
        bout_id: String(b.id),
        event_slug: card.eventSlug || null,
        event_name: card.event ? card.event.name : null,
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
    if (!rows.length) return;
    await c.from("ufc_picks").upsert(rows, { onConflict: "bout_id" });
  } catch (e) {
    console.error("[UFC] recordUFCPicks failed:", e.message);
  }
}

async function loadCard() {
  const now = Date.now();
  if (cardCache.data && now - cardCache.at < CARD_TTL_MS) return cardCache.data;
  if (cardInflight) return cardInflight;
  cardInflight = (async () => {
    try {
      const cito = await buildCitoCard();
      if (cito) { cardCache = { at: Date.now(), data: cito }; recordUFCPicks(cito).catch(() => {}); return cito; }
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

module.exports = router;
