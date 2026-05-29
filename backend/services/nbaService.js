/**
 * nbaService.js — SportsIntel NBA orchestration layer
 * --------------------------------------------------------------------------
 * Pulls upcoming games (ESPN, via nbaDataSource) + lines (The Odds API,
 * basketball_nba), matches them, runs nbaModel, returns predictions + edges.
 *
 * v0.1.1: predicts ONLY upcoming games (state === 'pre'). Finished games
 * return single-game box scores from ESPN instead of season averages, which
 * produced bogus projections — so they're excluded here.
 *
 * NO database writes — serving only. Recording into your performance tracker
 * is a separate drop once we match your tracker's schema exactly.
 *
 * Requires Node 18+ (global fetch).
 * -------------------------------------------------------------------------- */

const { getUpcomingGamesWithContext } = require('./nbaDataSource');
const { predictGame } = require('./nbaModel');

const ODDS_BASE = 'https://api.the-odds-api.com/v4/sports/basketball_nba/odds';
const ODDS_KEY = process.env.ODDS_API_KEY; // confirmed: matches your Railway variable

async function fetchNbaOdds() {
  if (!ODDS_KEY) {
    console.warn('[nbaService] No ODDS_API_KEY — serving projections without lines/edges.');
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

function extractLines(event) {
  const bk = (event.bookmakers || [])[0]; // v0.1: first book; consensus is v0.2
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
 * @returns {Promise<Array>} predictions for upcoming games only
 */
async function generateNbaPredictions(opts = {}) {
  const [games, odds] = await Promise.all([
    getUpcomingGamesWithContext(opts),
    fetchNbaOdds(),
  ]);

  // only score upcoming games; finished/in-progress excluded (see header)
  const upcoming = games.filter((g) => g.state === 'pre');
  const skipped = games.length - upcoming.length;
  if (skipped > 0) console.log(`[nbaService] skipped ${skipped} non-upcoming game(s)`);

  return upcoming.map((g) => predictGame(g, matchOdds(g, odds)));
}

module.exports = { generateNbaPredictions, fetchNbaOdds };
