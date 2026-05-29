// nbaProjectionService.js — Stage 2 orchestrator
// Ties Stage 1 prop lines (by name) -> ESPN athlete ids (from the game box score)
// -> parsed gamelogs -> projections + edges. Caches ids and gamelogs.
//
// Exposed via GET /api/nba/props/:gameId/projections (see routes/nba.js).
// Node 18+ global fetch. CommonJS. Degrades gracefully: any player we can't
// resolve is simply skipped (never silently mismatched).

const { fetchGamelog } = require('./nbaGamelog');
const { buildPropProjections } = require('./nbaProjections');
const { getNbaProps } = require('./nbaProps');

const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

const idCache = new Map();   // gameId   -> { t, map }
const logCache = new Map();  // athleteId-> { t, games }
const ID_TTL = 6 * 60 * 60 * 1000; // rosters stable through the day
const LOG_TTL = 30 * 60 * 1000;    // refresh gamelogs ~every 30 min

const norm = s => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const lastName = s => { const p = (s || '').trim().split(/\s+/); return norm(p[p.length - 1]); };

// PURE: ESPN summary JSON -> { full:{normName->id}, lastUnique:{normLast->id} }.
// Reads player ids from whichever section exists:
//   - boxscore.players[].statistics[].athletes[].athlete   (played games)
//   - rosters[].roster[].athlete                           (upcoming games)
// lastUnique only keeps last names that map to exactly one player (avoids collisions).
function collectAthletes(json) {
  const found = [];
  const teams = (json && json.boxscore && json.boxscore.players) || [];
  for (const teamBlock of teams)
    for (const statBlock of teamBlock.statistics || [])
      for (const a of statBlock.athletes || [])
        if (a && a.athlete) found.push(a.athlete);

  const rosters = (json && json.rosters) || [];
  for (const r of rosters)
    for (const item of r.roster || [])
      if (item && item.athlete) found.push(item.athlete);

  return found;
}

function parseBoxscoreIds(json) {
  const full = {};
  const lastCount = {};
  const lastMap = {};
  for (const ath of collectAthletes(json)) {
    if (!ath.id || !ath.displayName) continue;
    full[norm(ath.displayName)] = String(ath.id);
    const ln = lastName(ath.displayName);
    lastCount[ln] = (lastCount[ln] || 0) + 1;
    lastMap[ln] = String(ath.id);
  }
  const lastUnique = {};
  for (const ln in lastCount) if (lastCount[ln] === 1) lastUnique[ln] = lastMap[ln];
  return { full, lastUnique };
}

// Compact diagnostic: where does ESPN keep players for THIS game? Small to paste back.
async function getIdDebug(gameId) {
  const res = await fetch(`${SUMMARY}?event=${gameId}`);
  if (!res.ok) return { gameId: String(gameId), error: 'espn summary ' + res.status };
  const json = await res.json();
  const map = parseBoxscoreIds(json);
  const bs = json.boxscore || {};
  const comp = (json.header && json.header.competitions && json.header.competitions[0]) || {};
  return {
    gameId: String(gameId),
    topKeys: Object.keys(json),
    hasBoxscore: !!json.boxscore,
    boxscoreKeys: json.boxscore ? Object.keys(bs) : null,
    boxscorePlayersLen: Array.isArray(bs.players) ? bs.players.length : null,
    hasRosters: !!json.rosters,
    rostersLen: Array.isArray(json.rosters) ? json.rosters.length : null,
    firstRosterKeys: json.rosters && json.rosters[0] ? Object.keys(json.rosters[0]) : null,
    competitors: (comp.competitors || []).map(c => ({
      teamId: c.team && c.team.id, homeAway: c.homeAway, abbrev: c.team && c.team.abbreviation,
    })),
    athletesFound: Object.keys(map.full).length,
    sample: Object.entries(map.full).slice(0, 5).map(([n, id]) => ({ norm: n, id })),
  };
}

// PURE: build a name->id resolver from a parsed id map.
function makeResolver(map) {
  return name => map.full[norm(name)] || map.lastUnique[lastName(name)] || null;
}

async function buildIdMap(gameId) {
  const c = idCache.get(gameId);
  if (c && Date.now() - c.t < ID_TTL) return c.map;
  const res = await fetch(`${SUMMARY}?event=${gameId}`);
  if (!res.ok) throw new Error('espn summary ' + res.status);
  const map = parseBoxscoreIds(await res.json());
  idCache.set(gameId, { t: Date.now(), map });
  return map;
}

async function getGamelogCached(athleteId) {
  const c = logCache.get(athleteId);
  if (c && Date.now() - c.t < LOG_TTL) return c.games;
  const games = await fetchGamelog(athleteId);
  logCache.set(athleteId, { t: Date.now(), games });
  return games;
}

async function getNbaPropProjections(gameId) {
  const props = await getNbaProps(gameId);
  if (!props.available) {
    return {
      gameId: String(gameId), available: false,
      note: props.note || 'No player props posted for this game yet.',
      experimental: true, players: [], edges: [],
    };
  }

  let resolver;
  try {
    resolver = makeResolver(await buildIdMap(gameId));
  } catch (e) {
    return {
      gameId: String(gameId), available: false,
      note: 'Could not load player IDs from ESPN box score for this game.',
      experimental: true, players: [], edges: [],
    };
  }

  const proj = await buildPropProjections(
    props.players,
    async name => resolver(name),
    getGamelogCached
  );

  return {
    gameId: String(gameId),
    eventId: props.eventId,
    available: true,
    bookmaker: props.bookmaker || null,
    home: props.home,
    away: props.away,
    note: 'Experimental projections. Prop markets are sharp — flagged edges are rare and informational, not betting advice.',
    ...proj, // experimental, generatedAt, players, edges
  };
}

module.exports = { getNbaPropProjections, parseBoxscoreIds, makeResolver, getIdDebug };
