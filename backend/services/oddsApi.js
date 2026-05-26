// The Odds API client (the-odds-api.com)
// Free tier: 500 requests/month — we cache aggressively
// Docs: https://the-odds-api.com/liveapi/guides/v4/

const axios = require("axios");

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// In-memory cache: { mlb_h2h_totals: {data, fetchedAt} }
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — protects free tier quota

function isCacheValid(entry) {
  return entry && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

async function oddsGet(path, params = {}) {
  if (!ODDS_API_KEY) {
    throw new Error("ODDS_API_KEY not configured");
  }
  const res = await axios.get(`${ODDS_BASE}${path}`, {
    params: { apiKey: ODDS_API_KEY, ...params },
    timeout: 10000,
  });
  // Surface quota headers so we can monitor usage
  const remaining = res.headers["x-requests-remaining"];
  const used = res.headers["x-requests-used"];
  if (remaining != null) {
    console.log(`[OddsAPI] Used ${used}, Remaining ${remaining}`);
  }
  return res.data;
}

// ── MLB Moneyline + Totals ────────────────────────────────────────────────────

async function getMLBMainOdds() {
  const cacheKey = "mlb_main";
  const cached = cache.get(cacheKey);
  if (isCacheValid(cached)) {
    console.log("[OddsAPI] Returning cached MLB main odds");
    return cached.data;
  }

  try {
    const data = await oddsGet("/sports/baseball_mlb/odds", {
      regions: "us",
      markets: "h2h,totals",
      oddsFormat: "american",
      dateFormat: "iso",
    });

    const games = (data || []).map(parseMainOddsEvent);
    cache.set(cacheKey, { data: games, fetchedAt: Date.now() });
    return games;
  } catch (e) {
    console.error("[OddsAPI] MLB main odds error:", e.message);
    if (cached) return cached.data; // stale fallback
    return [];
  }
}

function parseMainOddsEvent(ev) {
  // Best (most extreme) line from major books for each market
  const h2h = { away: null, home: null, awayBook: null, homeBook: null };
  const totals = { line: null, over: null, under: null, overBook: null, underBook: null };

  const PREFERRED_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "pointsbetus"];

  for (const bm of ev.bookmakers || []) {
    if (!PREFERRED_BOOKS.includes(bm.key)) continue;

    for (const m of bm.markets || []) {
      if (m.key === "h2h") {
        const awayOutcome = m.outcomes?.find(o => o.name === ev.away_team);
        const homeOutcome = m.outcomes?.find(o => o.name === ev.home_team);
        if (awayOutcome && (h2h.away == null || awayOutcome.price > h2h.away)) {
          h2h.away = awayOutcome.price;
          h2h.awayBook = bm.title;
        }
        if (homeOutcome && (h2h.home == null || homeOutcome.price > h2h.home)) {
          h2h.home = homeOutcome.price;
          h2h.homeBook = bm.title;
        }
      } else if (m.key === "totals") {
        // Use the median line from the first preferred book that has it
        if (totals.line == null && m.outcomes?.length >= 2) {
          totals.line = m.outcomes[0].point;
          const over = m.outcomes.find(o => o.name === "Over");
          const under = m.outcomes.find(o => o.name === "Under");
          if (over) { totals.over = over.price; totals.overBook = bm.title; }
          if (under) { totals.under = under.price; totals.underBook = bm.title; }
        }
      }
    }
  }

  return {
    eventId: ev.id,
    commenceTime: ev.commence_time,
    homeTeam: ev.home_team,
    awayTeam: ev.away_team,
    h2h,
    totals,
  };
}

// ── MLB Player HR Props ───────────────────────────────────────────────────────
// Note: Player props require per-event lookups, which uses MORE quota.
// We cache aggressively and limit to first ~5 games to conserve quota.

async function getMLBHRPropsForEvent(eventId) {
  const cacheKey = `mlb_hr_${eventId}`;
  const cached = cache.get(cacheKey);
  if (isCacheValid(cached)) return cached.data;

  try {
    const data = await oddsGet(`/sports/baseball_mlb/events/${eventId}/odds`, {
      regions: "us",
      markets: "batter_home_runs",
      oddsFormat: "american",
    });
    const props = parseHRProps(data);
    cache.set(cacheKey, { data: props, fetchedAt: Date.now() });
    return props;
  } catch (e) {
    console.error(`[OddsAPI] HR props error for ${eventId}:`, e.message);
    if (cached) return cached.data;
    return [];
  }
}

function parseHRProps(ev) {
  const PREFERRED_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];
  const playerMap = new Map();

  for (const bm of ev.bookmakers || []) {
    if (!PREFERRED_BOOKS.includes(bm.key)) continue;
    for (const m of bm.markets || []) {
      if (m.key !== "batter_home_runs") continue;
      for (const o of m.outcomes || []) {
        // "name" is "Over" or "Under", "description" is the player name
        if (o.name !== "Over") continue;
        const player = o.description;
        if (!player) continue;
        const current = playerMap.get(player);
        if (!current || o.price > current.price) {
          playerMap.set(player, {
            player,
            price: o.price,
            book: bm.title,
            line: o.point ?? 0.5,
          });
        }
      }
    }
  }

  return Array.from(playerMap.values());
}

async function getMLBHRPropsForAllEvents(eventIds, maxEvents = 5) {
  // Limit to maxEvents to protect quota
  const targets = eventIds.slice(0, maxEvents);
  const results = {};
  for (const id of targets) {
    results[id] = await getMLBHRPropsForEvent(id);
  }
  return results;
}

// ── Convert American odds to implied probability ──────────────────────────────

function americanToImpliedProb(american) {
  if (american == null) return null;
  if (american >= 100) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

// ── Cache management ──────────────────────────────────────────────────────────

function clearOddsCache() {
  cache.clear();
}

function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}

module.exports = {
  getMLBMainOdds,
  getMLBHRPropsForEvent,
  getMLBHRPropsForAllEvents,
  americanToImpliedProb,
  clearOddsCache,
  getCacheStats,
};
