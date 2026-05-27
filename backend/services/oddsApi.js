// The Odds API client (the-odds-api.com)
// Free tier: 500 requests/month — we cache aggressively
// Docs: https://the-odds-api.com/liveapi/guides/v4/

const axios = require("axios");

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;

const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

// Sportsbooks we accept odds from
// Main markets (h2h, totals) — major US books
const PREFERRED_BOOKS_MAIN = ["draftkings", "fanduel", "betmgm", "caesars", "pointsbetus"];
// HR props — broader list because major books often don't post HR props
const PREFERRED_BOOKS_HR = [
  "draftkings", "fanduel", "betmgm", "caesars",
  "betrivers", "betonlineag", "bovada", "betus",
  "mybookieag", "lowvig", "williamhill_us", "espnbet",
  "fanatics", "hardrockbet",
];

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
    if (cached) return cached.data;
    return [];
  }
}

function parseMainOddsEvent(ev) {
  const h2h = { away: null, home: null, awayBook: null, homeBook: null };
  const totals = { line: null, over: null, under: null, overBook: null, underBook: null };

  for (const bm of ev.bookmakers || []) {
    if (!PREFERRED_BOOKS_MAIN.includes(bm.key)) continue;
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

async function getMLBHRPropsForEvent(eventId) {
  const cacheKey = `mlb_hr_${eventId}`;
  const cached = cache.get(cacheKey);
  if (isCacheValid(cached)) {
    console.log(`[OddsAPI] HR cached for ${eventId}: ${cached.data.length} props`);
    return cached.data;
  }
  try {
    const data = await oddsGet(`/sports/baseball_mlb/events/${eventId}/odds`, {
      regions: "us",
      markets: "batter_home_runs",
      oddsFormat: "american",
    });

    const bookmakerCount = data?.bookmakers?.length ?? 0;
    const bmKeys = (data?.bookmakers || []).map(b => b.key);
    console.log(`[OddsAPI-HR] Event ${eventId}: ${bookmakerCount} bookmakers: ${JSON.stringify(bmKeys)}`);

    const props = parseHRProps(data);
    console.log(`[OddsAPI-HR] Parsed ${props.length} HR props from event ${eventId}`);

    cache.set(cacheKey, { data: props, fetchedAt: Date.now() });
    return props;
  } catch (e) {
    console.error(`[OddsAPI] HR props error for ${eventId}:`, e.message);
    if (cached) return cached.data;
    return [];
  }
}

function parseHRProps(ev) {
  // Only accept the "to hit a HR" line (point = 0.5 means at least 1 HR)
  // Other lines like 1.5 are "at least 2 HRs" which is a different (much harder) bet
  const playerMap = new Map();

  for (const bm of ev.bookmakers || []) {
    if (!PREFERRED_BOOKS_HR.includes(bm.key)) continue;
    for (const m of bm.markets || []) {
      if (m.key !== "batter_home_runs") continue;
      for (const o of m.outcomes || []) {
        // Only "Over" outcomes (the "Yes, will hit a HR" side)
        if (o.name !== "Over") continue;
        // Only the standard 0.5 line (at least 1 HR)
        // Skip 1.5, 2.5 lines — those are different bets
        const line = o.point ?? 0.5;
        if (line !== 0.5) continue;

        const player = o.description;
        if (!player) continue;

        // Keep best (highest) odds across books
        const current = playerMap.get(player);
        if (!current || o.price > current.price) {
          playerMap.set(player, {
            player,
            price: o.price,
            book: bm.title,
            line,
          });
        }
      }
    }
  }
  return Array.from(playerMap.values());
}

async function getMLBHRPropsForAllEvents(eventIds, maxEvents = 5) {
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
  const size = cache.size;
  cache.clear();
  console.log(`[OddsAPI] Cleared cache (${size} entries)`);
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
