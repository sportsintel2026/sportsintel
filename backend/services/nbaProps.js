/**
 * services/nbaProps.js — SportsIntel NBA player prop LINES (Stage 1)
 * --------------------------------------------------------------------------
 * Pulls real book lines for player props (points / rebounds / assists / threes)
 * for a single game from The Odds API's event-odds endpoint, normalized per
 * player. DATA layer only — projections/edges are Stage 2.
 *
 * v0.2: added threes (player_threes — confirmed the real Odds API market key
 * via diagnostic). Cost: points+rebounds+assists+threes x us = 4 credits per
 * game, charged only when this endpoint is actually called.
 *
 * Note: books usually post props close to tip (day-before / day-of), so this
 * can legitimately come back empty for a game that's still days away.
 *
 * Exposed via GET /api/nba/props/:gameId  (see routes/nba.js)
 * No new npm deps. Node 18+ global fetch. CommonJS.
 * -------------------------------------------------------------------------- */

const { getNbaMatchup } = require('./nbaMatchup');
const { teamKey } = require('./teamKey'); // WZ-TEAMKEY-SSOT-2026-07-17

const SPORT = 'basketball_nba';
const BASE = `https://api.the-odds-api.com/v4/sports/${SPORT}`;
const KEY = process.env.ODDS_API_KEY; // same Railway variable used elsewhere
const MARKETS = 'player_points,player_rebounds,player_assists,player_threes';

const STAT_KEY = {
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_threes: 'threes',
};

// small cache so repeated views don't re-bill credits
const _cache = new Map();
const TTL_MS = 5 * 60 * 1000;
function cacheGet(k) {
  const e = _cache.get(k);
  if (e && Date.now() - e.t < TTL_MS) return e.v;
  return null;
}
function cacheSet(k, v) {
  _cache.set(k, { t: Date.now(), v });
}

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z]/g, '');
}
function nickname(name) {
  const parts = (name || '').trim().split(/\s+/);
  return norm(parts[parts.length - 1]);
}

async function fetchEvents() {
  const res = await fetch(`${BASE}/events?apiKey=${KEY}`);
  if (!res.ok) throw new Error('odds events ' + res.status);
  return res.json(); // [{ id, home_team, away_team, commence_time }]
}

async function fetchEventProps(eventId) {
  const url =
    `${BASE}/events/${eventId}/odds?regions=us&markets=${MARKETS}` +
    `&oddsFormat=american&apiKey=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('odds event-odds ' + res.status);
  return res.json();
}

// match an Odds API event to our game by team names
function matchEvent(events, homeName, awayName) {
  const h = norm(homeName);
  const a = norm(awayName);
  // exact
  let ev = events.find((e) => norm(e.home_team) === h && norm(e.away_team) === a);
  if (ev) return ev;
  // WZ-TEAMKEY-SSOT-2026-07-17 :: canonical, collision-safe match — runs AFTER exact and BEFORE
  // the loose contains/nickname passes below. Both teams must resolve to a canonical NBA abbr and
  // both must agree, so it can only ADD a precise match (never a sloppy substring one). Empty/
  // ambiguous keys fall through to the legacy passes; nothing that matched before stops matching.
  const hK = teamKey(homeName, 'nba');
  const aK = teamKey(awayName, 'nba');
  if (hK && aK) {
    ev = events.find((e) => teamKey(e.home_team, 'nba') === hK && teamKey(e.away_team, 'nba') === aK);
    if (ev) return ev;
  }
  // either-contains
  ev = events.find((e) => {
    const eh = norm(e.home_team);
    const ea = norm(e.away_team);
    return (eh.includes(h) || h.includes(eh)) && (ea.includes(a) || a.includes(ea));
  });
  if (ev) return ev;
  // nickname (last word) — handles "SA" vs "San Antonio Spurs" type gaps
  const hn = nickname(homeName);
  const an = nickname(awayName);
  return events.find((e) => nickname(e.home_team) === hn && nickname(e.away_team) === an) || null;
}

// flatten bookmakers -> per-player {points,rebounds,assists,threes}: {line,over,under}
function normalizeProps(eventOdds) {
  const players = {};
  let bookmaker = null;

  for (const bm of eventOdds.bookmakers || []) {
    const hasPlayerMkt = (bm.markets || []).some((m) => STAT_KEY[m.key]);
    if (!hasPlayerMkt) continue;
    bookmaker = bm.title || bm.key;

    for (const mkt of bm.markets || []) {
      const stat = STAT_KEY[mkt.key];
      if (!stat) continue;
      for (const o of mkt.outcomes || []) {
        const player = o.description; // player name lives here for props
        if (!player) continue;
        players[player] = players[player] || { name: player };
        const cur = players[player][stat] || { line: null, over: null, under: null };
        if (o.point != null) cur.line = o.point;
        if (o.name === 'Over') cur.over = o.price;
        else if (o.name === 'Under') cur.under = o.price;
        players[player][stat] = cur;
      }
    }
    break; // first bookmaker with player markets = consistent single source
  }

  return { bookmaker, players: Object.values(players) };
}

async function getNbaProps(gameId) {
  const cached = cacheGet(gameId);
  if (cached) return cached;

  if (!KEY) {
    return { gameId: String(gameId), available: false, note: 'No odds API key configured.', players: [] };
  }

  // need team names to find the Odds API event
  const m = await getNbaMatchup(gameId);
  const homeName = m.home?.displayName;
  const awayName = m.away?.displayName;

  const events = await fetchEvents();
  const ev = matchEvent(events, homeName, awayName);
  if (!ev) {
    const out = {
      gameId: String(gameId),
      available: false,
      note: 'No matching Odds API event (props may not be posted yet).',
      players: [],
    };
    cacheSet(gameId, out);
    return out;
  }

  const eventOdds = await fetchEventProps(ev.id);
  const { bookmaker, players } = normalizeProps(eventOdds);

  const out = {
    gameId: String(gameId),
    eventId: ev.id,
    available: players.length > 0,
    bookmaker: bookmaker || null,
    note: players.length === 0 ? 'No player props posted for this game yet.' : null,
    home: homeName,
    away: awayName,
    players,
  };
  cacheSet(gameId, out);
  return out;
}

module.exports = { getNbaProps };
