/**
 * nbaService.js — SportsIntel NBA orchestration layer
 * --------------------------------------------------------------------------
 * Pulls upcoming games (ESPN, via nbaDataSource) and lines (The Odds API,
 * basketball_nba), matches them, runs nbaModel, returns predictions + edges.
 *
 * NO database writes here — serving only. Recording into your performance
 * tracker is intentionally left out until we match your exact table schema,
 * so this can't pollute your real data. That's the next, separate drop.
 *
 * Requires Node 18+ (global fetch).
 * -------------------------------------------------------------------------- */

const { getUpcomingGamesWithContext } = require('./nbaDataSource');
const { predictGame } = require('./nbaModel');

const ODDS_BASE = 'https://api.the-odds-api.com/v4/sports/basketball_nba/odds';

// ⬇️ ONE THING TO CHECK: your existing Odds API key's env-var name.
// Your README only listed SPORTRADAR_API_KEY, but you said you use The Odds API.
// Set this to whatever the key is stored as in Railway (e.g. ODDS_API_KEY).
const ODDS_KEY = process.env.ODDS_API_KEY;

async function fetchNbaOdds() {
  if (!ODDS_KEY) {
    console.warn('[nbaService] No Odds API key found — serving projections without lines/edges.');
    return [];
  }
  const url =
    `${ODDS_BASE}?regions=us&markets=h2h,spreads,totals&oddsFormat=american&apiKey=${ODDS_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[nbaService] Odds API returned', res.status);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.warn('[nbaService] Odds API fetch failed:', err.message);
    return [];
  }
}

const norm = (s) => (s || '').toLowerCase().trim();

// turn one Odds API event into the { home, away, total } line shape the model wants
function extractLines(event) {
  const bk = (event.bookmakers || [])[0]; // v0.1: first available book; consensus is v0.2
  if (!bk) return null;
  const home = norm(event.home_team);
  const away = norm(event.away_team);
  const out = {
    bookmaker: bk.title,
    home: { ml: null, spread: null },
    away: { ml: null, spread: null },
    total: null,
  };
  for (const m of bk.markets || []) {
    if (m.key === 'h2h') {
      for (const o of m.outcomes || []) {
        if (norm(o.name) === home) out.home.ml = o.price;
        else if (norm(o.name) === away) out.away.ml = o.price;
      }
    } else if (m.key === 'spreads') {
      for (const o of m.outcomes || []) {
        if (norm(o.name) === home) out.home.spread = { point: o.point, price: o.price };
        else if (norm(o.name) === away) out.away.spread = { point: o.point, price: o.price };
      }
    } else if (m.key === 'totals') {
      let over = null;
      let under = null;
      for (const o of m.outcomes || []) {
        if (norm(o.name) === 'over') over = { point: o.point, price: o.price };
        else if (norm(o.name) === 'under') under = { point: o.point, price: o.price };
      }
      if (over) out.total = { point: over.point, overPrice: over.price, underPrice: under ? under.price : null };
    }
  }
  return out;
}

function matchOdds(ctx, oddsEvents) {
  const h = norm(ctx.home && ctx.home.displayName);
  const a = norm(ctx.away && ctx.away.displayName);
  for (const ev of oddsEvents) {
    const eh = norm(ev.home_team);
    const ea = norm(ev.away_team);
    if ((eh === h && ea === a) || (eh === a && ea === h)) return extractLines(ev);
  }
  return null;
}

/**
 * @param {Object} [opts] - { dateStr?: 'YYYY-MM-DD' }
 * @returns {Promise<Array>} model predictions with edges
 */
async function generateNbaPredictions(opts = {}) {
  const [games, odds] = await Promise.all([
    getUpcomingGamesWithContext(opts),
    fetchNbaOdds(),
  ]);
  return games.map((g) => predictGame(g, matchOdds(g, odds)));
}

module.exports = { generateNbaPredictions, fetchNbaOdds };
