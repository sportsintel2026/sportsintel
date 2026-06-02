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
 * v0.1.3: serve ONLY games that have their OWN posted odds. Books line just the
 * next game of a series, so in a playoff series the same two teams appear on the
 * schedule several times but only ONE has a real line. Previously the single
 * available line was matched (by team name) onto EVERY future same-matchup game,
 * which (a) duplicated the slate and (b) generated a FAKE value pick whenever the
 * home/away flipped (model compared a flipped projection against the wrong game's
 * odds). Serving only games with their own line fixes both at the source and
 * mirrors reality: we show the next game we actually have a price for.
 *
 * NO database writes — serving only.
 *
 * Requires Node 18+ (global fetch).
 * -------------------------------------------------------------------------- */

const { getUpcomingGamesWithContext } = require('./nbaDataSource');
const { predictGame } = require('./nbaModel');

const ODDS_BASE = 'https://api.the-odds-api.com/v4/sports/basketball_nba/odds';
const ODDS_KEY = process.env.ODDS_API_KEY; // confirmed: matches your Railway variable

// This module currently serves the NBA *playoffs*. Playoff mode tells the model
// to deflate scoring (lower totals) and be stricter about totals edges.
// Flip to false if/when this is ever used for regular-season games.
const PLAYOFF_MODE = true;

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

// Match a game to its OWN odds event. We require BOTH the team match AND that the
// event's commence time is close to this game's tip — so a single series line can't
// attach itself to a later same-matchup game. Returns null when there's no distinct
// line for THIS game (e.g. a future game books haven't posted yet).
function matchOdds(ctx, oddsEvents) {
  const h = norm(ctx.home && ctx.home.displayName);
  const a = norm(ctx.away && ctx.away.displayName);
  const gameTime = ctx.date ? new Date(ctx.date).getTime() : null;
  // Allow up to ~18h between our game time and the book's commence time to count
  // as the same game (covers tip-time/timezone slop) — but NOT days apart, which
  // is what let one series line bleed onto every future game.
  const MAX_SKEW_MS = 18 * 60 * 60 * 1000;
  for (const ev of oddsEvents) {
    const eh = norm(ev.home_team);
    const ea = norm(ev.away_team);
    const teamsMatch = (eh === h && ea === a) || (eh === a && ea === h);
    if (!teamsMatch) continue;
    // If we can compare times, require them to be close. If either time is missing,
    // fall back to a team-only match (best effort) — but only when we have no
    // better signal.
    const evTime = ev.commence_time ? new Date(ev.commence_time).getTime() : null;
    if (gameTime != null && evTime != null) {
      if (Math.abs(evTime - gameTime) <= MAX_SKEW_MS) return extractLines(ev);
    } else {
      return extractLines(ev);
    }
  }
  return null;
}

const LOOKAHEAD_DAYS = 7; // scan up to a week out so we find the next lined game

// list of YYYY-MM-DD strings from `fromStr` (or today) through +days
function datesAhead(fromStr, days) {
  const base = fromStr ? new Date(fromStr + 'T12:00:00Z') : new Date();
  const out = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * @param {Object} [opts] - { dateStr?: 'YYYY-MM-DD' } — if given, scans just that day
 * @returns {Promise<Array>} predictions for upcoming games that have their OWN line
 */
async function generateNbaPredictions(opts = {}) {
  const days = opts.dateStr ? 0 : LOOKAHEAD_DAYS;
  const dates = datesAhead(opts.dateStr, days);

  const odds = await fetchNbaOdds();
  const perDay = await Promise.all(
    dates.map((ds) => getUpcomingGamesWithContext({ dateStr: ds }).catch(() => []))
  );

  // merge across days, keep only upcoming, de-dupe by gameId
  const seen = new Set();
  const upcoming = [];
  for (const dayGames of perDay) {
    for (const g of dayGames) {
      if (g.state !== 'pre' || seen.has(g.gameId)) continue;
      seen.add(g.gameId);
      upcoming.push(g);
    }
  }
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date)); // soonest first

  // Attach each game's OWN odds (time-aware match), then KEEP ONLY games that have
  // a real, distinct line. This is the core v0.1.3 fix: books post just the next
  // game of a series, so only that game should appear — no duplicated future
  // games, and no fake edge from a flipped matchup borrowing the wrong line.
  const predictions = [];
  for (const g of upcoming) {
    const lines = matchOdds(g, odds);
    if (!lines) continue; // no distinct line for this game → don't show it
    predictions.push(predictGame(g, lines, { playoff: PLAYOFF_MODE }));
  }
  return predictions;
}

module.exports = { generateNbaPredictions, fetchNbaOdds };
