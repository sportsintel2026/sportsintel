/**
 * nbaDataSource.js  —  SportsIntel NBA data layer (ESPN hidden API)
 * --------------------------------------------------------------------------
 * FREE, no key, works from Railway. Covers every NBA team and (with a slug
 * swap) every other league you have tabbed, so this same pattern generalizes.
 *
 * Requires Node 18+ (uses global fetch). If your backend is on older Node or
 * uses axios, tell me and I'll convert. Written as CommonJS (module.exports);
 * if your repo uses ES modules, say so and I'll switch the import/export.
 *
 * OUTPUT CONTRACT — getUpcomingGamesWithContext() resolves to an array of:
 * {
 *   gameId, date, state ('pre'|'in'|'post'), seasonType, competitionType,
 *   neutralSite, venue: { name, city, state },
 *   pending: <true if either side is still TBD, e.g. Finals before G7 decided>,
 *   home / away: {
 *     id, abbr, displayName, score,
 *     ppg,        // points scored per game (offense)
 *     papg,       // points allowed per game (defense)  [null if standings miss]
 *     pace,       // possessions/game estimate (v0.1 approximation, see note)
 *     ortg, drtg, // points per 100 poss (offense / defense), approximate
 *     netRtg,     // ortg - drtg
 *     record: { overall, home, road },
 *     restDays, b2b,   // null in v0.1 (Finals has no B2Bs); v0.2 wires schedule
 *     injuries: [ { athlete, status, detail } ]
 *   }
 * }
 *
 * v0.1 NOTE ON RATINGS/PACE: ESPN's scoreboard exposes a team's own offensive
 * components (FGA/FTA/PTS) but not turnovers or offensive rebounds, so the
 * possession estimate omits those terms. It's directionally solid for
 * totals/spread; v0.2 can sharpen it from the fuller team-statistics endpoint
 * (TOV, OREB, opponent splits). Defense (papg) comes from the standings feed.
 * -------------------------------------------------------------------------- */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
// NOTE: standings lives under /apis/v2/ (NOT /apis/site/v2/) — different from scoreboard
const STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const LEAGUE_AVG_PPG = 114; // fallback when a team's defensive number is missing
const REQUEST_TIMEOUT_MS = 8000;

/* ---- tiny TTL cache so the route + grading cron don't hammer ESPN ---- */
const _cache = new Map();
function cacheGet(key) {
  const hit = _cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  _cache.delete(key);
  return null;
}
function cacheSet(key, value, ttlMs) {
  _cache.set(key, { value, expires: Date.now() + ttlMs });
}

/* ---- low-level GET with timeout + browser-like UA ---- */
async function espnGet(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/* ---- turn ESPN's [{name, displayValue}] stat arrays into {name: number} ---- */
function statMap(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const s of arr) {
    const key = s.name || s.abbreviation;
    const raw = s.value != null ? s.value : s.displayValue;
    const num = parseFloat(raw);
    if (key && Number.isFinite(num)) out[key] = num;
  }
  return out;
}

function parseRecords(records) {
  const out = { overall: null, home: null, road: null };
  if (!Array.isArray(records)) return out;
  for (const r of records) {
    const tag = (r.type || r.name || '').toLowerCase();
    if (tag.includes('home')) out.home = r.summary;
    else if (tag.includes('road') || tag.includes('away')) out.road = r.summary;
    else if (tag.includes('total') || tag.includes('overall')) out.overall = r.summary;
  }
  return out;
}

/* ---- SCOREBOARD: which games to predict + team identity + offense stats ---- */
async function fetchScoreboard(dateStr) {
  const key = `scoreboard:${dateStr || 'today'}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = dateStr
    ? `${BASE}/scoreboard?dates=${dateStr.replace(/-/g, '')}`
    : `${BASE}/scoreboard`;
  const data = await espnGet(url);

  const games = (data.events || []).map((ev) => {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const teams = (comp.competitors || []).map((c) => {
      const t = c.team || {};
      const isTBD = !t.id || (t.abbreviation || '').toUpperCase() === 'TBD';
      return {
        id: t.id || null,
        abbr: t.abbreviation || null,
        displayName: t.displayName || t.name || 'TBD',
        location: t.location || null,
        homeAway: c.homeAway,
        score: c.score != null ? Number(c.score) : null,
        seasonStats: statMap(c.statistics),
        records: parseRecords(c.records),
        isTBD,
      };
    });
    return {
      gameId: ev.id,
      date: ev.date,
      name: ev.name,
      shortName: ev.shortName,
      state: (comp.status || ev.status || {}).type?.state || 'pre',
      seasonType: ev.season?.type ?? comp.season?.type ?? null,
      competitionType: comp.type?.abbreviation || null,
      neutralSite: !!comp.neutralSite,
      venue: {
        name: comp.venue?.fullName || null,
        city: comp.venue?.address?.city || null,
        state: comp.venue?.address?.state || null,
      },
      home: teams.find((x) => x.homeAway === 'home') || null,
      away: teams.find((x) => x.homeAway === 'away') || null,
    };
  });

  cacheSet(key, games, 60 * 1000); // 1 min — game state changes during play
  return games;
}

/* ---- STANDINGS: defensive number (points allowed/game) keyed by team id ---- */
async function fetchStandings() {
  const key = 'standings';
  const cached = cacheGet(key);
  if (cached) return cached;

  let byTeam = {};
  try {
    const data = await espnGet(STANDINGS_URL);
    const children = data.children || (data.standings ? [data] : []);
    for (const child of children) {
      const entries = child.standings?.entries || child.entries || [];
      for (const e of entries) {
        const id = e.team?.id;
        if (!id) continue;
        const m = statMap(e.stats);
        const gp =
          m.wins != null && m.losses != null ? m.wins + m.losses : m.gamesPlayed || null;
        byTeam[id] = {
          gamesPlayed: gp,
          avgPointsFor: m.avgPointsFor ?? null,
          avgPointsAgainst: m.avgPointsAgainst ?? null,
          pointDifferential: m.pointDifferential ?? m.differential ?? null,
        };
      }
    }
  } catch (err) {
    console.warn('[nbaDataSource] standings unavailable, using fallbacks:', err.message);
  }

  cacheSet(key, byTeam, 30 * 60 * 1000); // 30 min — season aggregates move slowly
  return byTeam;
}

/* ---- INJURIES: best-effort, keyed by team id; never fatal ---- */
async function fetchInjuries() {
  const key = 'injuries';
  const cached = cacheGet(key);
  if (cached) return cached;

  let byTeam = {};
  try {
    const data = await espnGet(`${BASE}/injuries`);
    const groups = data.injuries || [];
    for (const g of groups) {
      // ESPN groups by team; team id may live at g.team.id or g.id
      const teamId = g.team?.id || g.id || null;
      const list = (g.injuries || []).map((i) => ({
        athlete: i.athlete?.displayName || i.athlete?.fullName || 'Unknown',
        status: i.status || i.type?.description || 'Unknown',
        detail: i.details?.detail || i.shortComment || null,
      }));
      if (teamId) byTeam[teamId] = list;
    }
  } catch (err) {
    console.warn('[nbaDataSource] injuries unavailable:', err.message);
  }

  cacheSet(key, byTeam, 15 * 60 * 1000); // 15 min
  return byTeam;
}

/* ---- derive per-team model context from the three feeds ---- */
function buildTeamContext(side, standings, injuries) {
  if (!side || side.isTBD) {
    return { isTBD: true, displayName: side?.displayName || 'TBD' };
  }
  const s = side.seasonStats || {};
  const st = standings[side.id] || {};
  const gp = st.gamesPlayed || null;

  // per-game offensive components (scoreboard gives season totals)
  const fgaPg = gp && s.fieldGoalsAttempted ? s.fieldGoalsAttempted / gp : null;
  const ftaPg = gp && s.freeThrowsAttempted ? s.freeThrowsAttempted / gp : null;

  const ppg = s.avgPoints ?? (gp && s.points ? s.points / gp : st.avgPointsFor) ?? null;
  const papg = st.avgPointsAgainst ?? null;

  // v0.1 possession estimate: FGA + 0.44*FTA per game (omits TOV/OREB — see header)
  const pace = fgaPg != null && ftaPg != null ? fgaPg + 0.44 * ftaPg : null;

  const ortg = ppg != null && pace ? (100 * ppg) / pace : null;
  const drtg = papg != null && pace ? (100 * papg) / pace : null;

  return {
    id: side.id,
    abbr: side.abbr,
    displayName: side.displayName,
    score: side.score,
    ppg: ppg != null ? round(ppg, 1) : null,
    papg: papg != null ? round(papg, 1) : null,
    pace: pace != null ? round(pace, 1) : null,
    ortg: ortg != null ? round(ortg, 1) : null,
    drtg: drtg != null ? round(drtg, 1) : null,
    netRtg: ortg != null && drtg != null ? round(ortg - drtg, 1) : null,
    record: side.records,
    restDays: null, // v0.2: derive from team schedule endpoint
    b2b: null,      // v0.2: Finals scheduling means this is effectively false
    injuries: injuries[side.id] || [],
  };
}

function round(n, d) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

/**
 * Main entry point. Returns normalized, model-ready game contexts.
 * @param {Object} opts
 * @param {string} [opts.dateStr] - 'YYYY-MM-DD'; omit for today
 * @param {boolean} [opts.includePending=false] - include games with a TBD side
 */
async function getUpcomingGamesWithContext(opts = {}) {
  const { dateStr, includePending = false } = opts;
  const [games, standings, injuries] = await Promise.all([
    fetchScoreboard(dateStr),
    fetchStandings(),
    fetchInjuries(),
  ]);

  const out = [];
  for (const g of games) {
    const pending = !g.home || !g.away || g.home.isTBD || g.away.isTBD;
    if (pending && !includePending) continue;
    out.push({
      gameId: g.gameId,
      date: g.date,
      state: g.state,
      seasonType: g.seasonType,
      competitionType: g.competitionType,
      neutralSite: g.neutralSite,
      venue: g.venue,
      pending,
      home: buildTeamContext(g.home, standings, injuries),
      away: buildTeamContext(g.away, standings, injuries),
    });
  }
  return out;
}

module.exports = {
  getUpcomingGamesWithContext,
  fetchScoreboard,
  fetchStandings,
  fetchInjuries,
  LEAGUE_AVG_PPG,
};
