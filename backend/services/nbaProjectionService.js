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
const { recordNbaPropPredictions } = require('./predictionTracker');

const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';
const ROSTER = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams'; // /{teamId}/roster

const idCache = new Map();   // gameId   -> { t, map }
const logCache = new Map();  // athleteId-> { t, games }
const ID_TTL = 6 * 60 * 60 * 1000; // rosters stable through the day
const LOG_TTL = 30 * 60 * 1000;    // refresh gamelogs ~every 30 min

const norm = s => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const lastName = s => { const p = (s || '').trim().split(/\s+/); return norm(p[p.length - 1]); };

// PURE: pull athlete objects from any section of an ESPN summary that has them.
//   - boxscore.players[].statistics[].athletes[].athlete   (played games)
//   - rosters[].roster[].athlete                           (some upcoming games)
//   - leaders[].leaders[].leaders[].athlete                (a few stars, pre-game)
function collectAthletes(json) {
  const found = [];
  const teams = (json && json.boxscore && json.boxscore.players) || [];
  for (const teamBlock of teams)
    for (const statBlock of teamBlock.statistics || [])
      for (const a of statBlock.athletes || [])
        if (a && a.athlete) found.push(a.athlete);

  for (const r of (json && json.rosters) || [])
    for (const item of r.roster || [])
      if (item && item.athlete) found.push(item.athlete);

  for (const teamLead of (json && json.leaders) || [])
    for (const cat of teamLead.leaders || [])
      for (const l of cat.leaders || [])
        if (l && l.athlete) found.push(l.athlete);

  return found;
}

// PURE: ESPN team-roster JSON -> array of athlete objects. Handles flat and
// position-grouped shapes ({ athletes:[{items:[...]}] } or { athletes:[...] }).
function parseRoster(json) {
  const out = [];
  for (const entry of (json && json.athletes) || []) {
    if (entry && Array.isArray(entry.items)) out.push(...entry.items);
    else if (entry && (entry.id || entry.displayName)) out.push(entry);
  }
  return out;
}

// PURE: athlete objects -> { full, lastUnique } id map (last names kept only if unique).
function buildMapFromAthletes(athletes) {
  const full = {};
  const lastCount = {};
  const lastMap = {};
  const sideFull = {};        // normName -> "home"|"away"
  const sideLastMap = {};
  for (const ath of athletes || []) {
    const name = ath && (ath.displayName || ath.fullName);
    if (!ath || !ath.id || !name) continue;
    full[norm(name)] = String(ath.id);
    const ln = lastName(name);
    lastCount[ln] = (lastCount[ln] || 0) + 1;
    lastMap[ln] = String(ath.id);
    if (ath._side) { sideFull[norm(name)] = ath._side; sideLastMap[ln] = ath._side; }
  }
  const lastUnique = {};
  const sideLast = {};
  for (const ln in lastCount) if (lastCount[ln] === 1) {
    lastUnique[ln] = lastMap[ln];
    if (sideLastMap[ln]) sideLast[ln] = sideLastMap[ln];
  }
  return { full, lastUnique, sideFull, sideLast };
}

function parseBoxscoreIds(json) {
  return buildMapFromAthletes(collectAthletes(json));
}

// PURE: team ids for the game, from summary header competitors (fallback: boxscore.teams).
function competitorTeamIds(summary) {
  const comp = (summary.header && summary.header.competitions && summary.header.competitions[0]) || {};
  let ids = (comp.competitors || []).map(c => c.team && c.team.id).filter(Boolean);
  if (!ids.length) ids = ((summary.boxscore && summary.boxscore.teams) || []).map(t => t.team && t.team.id).filter(Boolean);
  return ids.map(String);
}

// Compact diagnostic: where does ESPN keep players for THIS game? Small to paste back.
async function getIdDebug(gameId) {
  const res = await fetch(`${SUMMARY}?event=${gameId}`);
  if (!res.ok) return { gameId: String(gameId), error: 'espn summary ' + res.status };
  const summary = await res.json();
  const teamIds = competitorTeamIds(summary);

  // Probe the first team's roster endpoint and report its shape + a sample.
  let roster = { fetched: false };
  if (teamIds[0]) {
    try {
      const rr = await fetch(`${ROSTER}/${teamIds[0]}/roster`);
      roster.status = rr.status;
      if (rr.ok) {
        const rj = await rr.json();
        const players = parseRoster(rj);
        roster = {
          fetched: true, teamId: teamIds[0],
          rosterTopKeys: Object.keys(rj),
          athletesType: Array.isArray(rj.athletes)
            ? (rj.athletes[0] && Array.isArray(rj.athletes[0].items) ? 'grouped' : 'flat') : 'none',
          parsedCount: players.length,
          sample: players.slice(0, 5).map(p => ({ id: p.id, name: p.displayName || p.fullName })),
        };
      }
    } catch (e) { roster.error = String(e.message || e); }
  }

  const map = buildMapFromAthletes(collectAthletes(summary));
  const injuries = parseInjuries(summary);
  return {
    gameId: String(gameId),
    summaryTopKeys: Object.keys(summary),
    summaryAthletes: Object.keys(map.full).length,
    teamIds,
    roster,
    injuryCount: Object.keys(injuries).length,
    injurySample: Object.entries(injuries).slice(0, 6).map(([id, status]) => ({ id, status })),
  };
}

// PURE: build a name->id resolver from a parsed id map.
function makeResolver(map) {
  return name => map.full[norm(name)] || map.lastUnique[lastName(name)] || null;
}

// PURE: ESPN summary injuries -> { athleteId -> status string }.
function parseInjuries(summary) {
  const out = {};
  for (const teamInj of (summary && summary.injuries) || []) {
    for (const it of teamInj.injuries || []) {
      const ath = (it && it.athlete) || {};
      const status = it.status || (it.type && (it.type.description || it.type.name)) || null;
      if (ath.id && status) out[String(ath.id)] = status;
    }
  }
  return out;
}

// Merge summary athletes with both teams' full rosters (the reliable pre-game source).
// Returns { map, state, date, injuries }: state is "pre"|"in"|"post".
async function buildIdMap(gameId) {
  const c = idCache.get(gameId);
  if (c && Date.now() - c.t < ID_TTL) return { map: c.map, state: c.state, date: c.date, injuries: c.injuries };

  const res = await fetch(`${SUMMARY}?event=${gameId}`);
  if (!res.ok) throw new Error('espn summary ' + res.status);
  const summary = await res.json();

  const comp = (summary.header && summary.header.competitions && summary.header.competitions[0]) || {};
  const state = (comp.status && comp.status.type && comp.status.type.state) || null;
  const date = comp.date || null;
  const injuries = parseInjuries(summary);

  // Each competitor carries home/away — record it so every player can later be
  // grouped by team without any cross-source name/abbreviation matching.
  const sideByTeamId = {};
  for (const c of (comp.competitors || [])) {
    if (c && c.team && c.team.id) sideByTeamId[String(c.team.id)] = c.homeAway || null;
  }

  const athletes = collectAthletes(summary);
  for (const teamId of competitorTeamIds(summary)) {
    try {
      const rr = await fetch(`${ROSTER}/${teamId}/roster`);
      if (rr.ok) {
        const ros = parseRoster(await rr.json());
        const side = sideByTeamId[String(teamId)] || null; // "home" | "away"
        for (const a of ros) if (a) a._side = side;
        athletes.push(...ros);
      }
    } catch (_) { /* skip a failed roster; partial map still useful */ }
  }

  const map = buildMapFromAthletes(athletes);
  // Only cache a map that actually found players — never let an empty/transient
  // result get pinned for the full TTL.
  if (Object.keys(map.full).length) idCache.set(gameId, { t: Date.now(), map, state, date, injuries });
  return { map, state, date, injuries };
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

  let idInfo;
  try {
    idInfo = await buildIdMap(gameId);
  } catch (e) {
    return {
      gameId: String(gameId), available: false,
      note: 'Could not load player IDs from ESPN box score for this game.',
      experimental: true, players: [], edges: [],
    };
  }
  const resolver = makeResolver(idInfo.map);

  const proj = await buildPropProjections(
    props.players,
    async name => resolver(name),
    getGamelogCached,
    undefined,                 // use default CFG
    idInfo.injuries || {}      // injury statuses by athleteId
  );

  const out = {
    gameId: String(gameId),
    eventId: props.eventId,
    available: true,
    bookmaker: props.bookmaker || null,
    home: props.home,
    away: props.away,
    note: 'Experimental projections. Prop markets are sharp — flagged edges are rare and informational, not betting advice.',
    ...proj, // experimental, generatedAt, players, edges, suspects
  };

  // Tag each player with "home"/"away" so the UI can group projections by team.
  const sideFull = (idInfo.map && idInfo.map.sideFull) || {};
  const sideLast = (idInfo.map && idInfo.map.sideLast) || {};
  const sideForName = (nm) => sideFull[norm(nm)] || sideLast[lastName(nm)] || null;
  if (Array.isArray(out.players)) out.players = out.players.map(p => ({ ...p, side: sideForName(p.name) }));
  if (Array.isArray(out.edges))   out.edges   = out.edges.map(e => ({ ...e, side: sideForName(e.name) }));

  // Snapshot picks for the Performance tracker — pre-game only, best-effort.
  if (idInfo.state === 'pre') {
    recordNbaPropPredictions(out, idInfo.date)
      .catch(e => console.error('[nbaProj] record failed:', e && e.message));
  }

  return out;
}

module.exports = { getNbaPropProjections, parseBoxscoreIds, parseRoster, buildMapFromAthletes, makeResolver, getIdDebug };
