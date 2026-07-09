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
const { getNextPPVEvent, getEventBouts } = require("../services/citoApi");

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
    name: f.fighterName || p.name || "TBD",
    record: p.recordText || (p.record ? `${p.record.wins}-${p.record.losses}-${p.record.draws}` : ""),
    headshot: p.headshotUrl || f.imageUrl || null,
    country: p.country || f.country || "",
    nickname: p.nickname || "",
  };
}

function parseBout(bout, oddsMap) {
  const red = fighterByCorner(bout, "red");
  const blue = fighterByCorner(bout, "blue");
  if (!red || !blue) return null;

  let implRed = impliedFromAny(bout.odds && bout.odds.red);
  let implBlue = impliedFromAny(bout.odds && bout.odds.blue);
  let amRed = Number.isFinite(Number(bout.odds && bout.odds.red)) ? Number(bout.odds.red) : null;
  let amBlue = Number.isFinite(Number(bout.odds && bout.odds.blue)) ? Number(bout.odds.blue) : null;
  if (implRed == null || implBlue == null) {
    const oR = oddsMap.get(normName(red.name));
    const oB = oddsMap.get(normName(blue.name));
    if (oR && oB) { implRed = oR.impl; implBlue = oB.impl; amRed = oR.american; amBlue = oB.american; }
  }

  let pick = null, winPct = null, pickCorner = null, odds = null;
  if (implRed != null && implBlue != null && implRed + implBlue > 0) {
    const dvR = implRed / (implRed + implBlue);
    const dvB = implBlue / (implRed + implBlue);
    if (dvR >= dvB) { pick = red.name; winPct = Math.round(dvR * 100); pickCorner = "red"; odds = amRed; }
    else { pick = blue.name; winPct = Math.round(dvB * 100); pickCorner = "blue"; odds = amBlue; }
  }

  return {
    id: bout.id,
    cardSection: bout.cardSection || "Prelims",
    cardPosition: bout.cardPosition || "",
    boutOrder: Number(bout.boutOrder) || 0,
    weightClass: (bout.weightClass || "").replace(/ Bout$/i, ""),
    titleBout: !!bout.titleBout,
    red, blue,
    pick, winPct, pickCorner, odds,
    edgePct: null,
  };
}

async function buildCitoCard() {
  const event = await getNextPPVEvent();
  if (!event || !event.slug) return null;
  const rawBouts = await getEventBouts(event.slug);
  if (!Array.isArray(rawBouts) || !rawBouts.length) return null;

  const oddsMap = await getOddsMap();
  const parsed = rawBouts.map((b) => parseBout(b, oddsMap)).filter(Boolean);
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
    event: {
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

async function loadCard() {
  const now = Date.now();
  if (cardCache.data && now - cardCache.at < CARD_TTL_MS) return cardCache.data;
  if (cardInflight) return cardInflight;
  cardInflight = (async () => {
    try {
      const cito = await buildCitoCard();
      if (cito) { cardCache = { at: Date.now(), data: cito }; return cito; }
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

module.exports = router;
