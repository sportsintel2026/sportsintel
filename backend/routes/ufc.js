// WZ-UFC-CARD-2026-07-09 / WZ-UFC-ODDS-2026-07-09 :: read-only UFC/MMA card endpoint.
// PRIMARY source is The Odds API (mma_mixed_martial_arts, h2h) -- it returns the upcoming
// fights AND the moneyline in one call, so it is both the card and the odds source. We de-vig
// the two-way moneyline into a market-anchored win probability: pick = the market favorite,
// winPct = the de-vigged implied chance. edgePct stays null on purpose -- "edge" means beating
// the market, which a market-anchored model can't claim; it turns on when a real fighter model
// is added. Fail-safe: if the Odds API is unconfigured/errors/empty, fall back to the SportRadar
// schedule (names only, pick pending); if that's empty too, the page shows a clean empty state.
// Endpoint: GET /api/ufc/card
const express = require("express");
const router = express.Router();
const axios = require("axios");
const { fetchMMASchedule } = require("../services/sportsData");

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min -- protects Odds API credits (1 credit/call)
let cache = { at: 0, data: null };
let inflight = null;

function impliedProb(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a < 0 ? (-a) / (-a + 100) : 100 / (a + 100);
}
function median(nums) {
  const s = nums.filter((n) => Number.isFinite(n)).slice().sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Build the card from The Odds API (fights + de-vigged market pick). Returns [] on any miss.
async function fetchOddsCard() {
  if (!ODDS_API_KEY) return [];
  try {
    const res = await axios.get(`${ODDS_BASE}/sports/mma_mixed_martial_arts/odds`, {
      params: { apiKey: ODDS_API_KEY, regions: "us", markets: "h2h", oddsFormat: "american" },
      timeout: 12000,
    });
    const events = Array.isArray(res.data) ? res.data : [];
    return events.map((ev) => {
      const A = ev.away_team; // red corner
      const B = ev.home_team; // blue corner
      const priceA = [], priceB = [];
      for (const bk of ev.bookmakers || []) {
        for (const mk of bk.markets || []) {
          if (mk.key !== "h2h") continue;
          for (const oc of mk.outcomes || []) {
            if (oc.name === A) priceA.push(Number(oc.price));
            else if (oc.name === B) priceB.push(Number(oc.price));
          }
        }
      }
      const ipA = impliedProb(median(priceA));
      const ipB = impliedProb(median(priceB));
      let pick = null, winPct = null, odds = null, pickCorner = null;
      if (ipA != null && ipB != null && ipA + ipB > 0) {
        const dvA = ipA / (ipA + ipB);
        const dvB = ipB / (ipA + ipB);
        if (dvA >= dvB) { pick = A; winPct = Math.round(dvA * 100); odds = median(priceA); pickCorner = "A"; }
        else { pick = B; winPct = Math.round(dvB * 100); odds = median(priceB); pickCorner = "B"; }
      }
      return {
        id: ev.id,
        fighterA: A || "Fighter 1",
        fighterB: B || "Fighter 2",
        time: ev.commence_time || "",
        venue: "", city: "",
        status: "scheduled",
        pick, winPct, odds, pickCorner,
        edgePct: null, // beating the market -- pending until a fighter model exists
        method: null, weightClass: null,
      };
    });
  } catch (e) {
    console.error("[UFC] Odds API fetch failed:", e.message);
    return [];
  }
}

// Schedule-only fallback (names + venue, no pick) if the Odds API gives nothing.
async function fetchScheduleCard() {
  try {
    const raw = await fetchMMASchedule();
    return (Array.isArray(raw) ? raw : []).map((f) => ({
      id: f.id,
      fighterA: f.away || "Fighter 1",
      fighterB: f.home || "Fighter 2",
      time: f.time || "",
      venue: f.venue || "",
      city: f.city || "",
      status: f.status || "scheduled",
      pick: null, winPct: null, odds: null, pickCorner: null,
      edgePct: null, method: null, weightClass: null,
    }));
  } catch (_) {
    return [];
  }
}

async function loadCard() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      let fights = await fetchOddsCard();
      if (!fights.length) fights = await fetchScheduleCard(); // fall back to schedule-only
      cache = { at: Date.now(), data: fights };
      return fights;
    } catch (_) {
      return cache.data || [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

router.get("/card", async (_req, res) => {
  try {
    const fights = await loadCard();
    const picksLive = fights.some((f) => f && f.winPct != null);
    res.json({ ok: true, picksLive, edgePending: true, fights });
  } catch (_) {
    res.json({ ok: true, picksLive: false, edgePending: true, fights: [] });
  }
});

module.exports = router;
