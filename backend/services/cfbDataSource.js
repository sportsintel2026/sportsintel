/**
 * cfbDataSource.js  —  WizePicks College Football data layer (ESPN hidden API)
 *
 * Mirrors nflDataSource.js. Same offseason-safe scoreboard core; the model-facing
 * team-context layer is deferred to preseason (see header notes in nflDataSource).
 *
 * KEY DIFFERENCE FROM NFL: ESPN's college-football scoreboard returns ALL
 * divisions (130+ FBS teams plus FCS, D-II, etc.) unless filtered. We pass
 * `groups=80` (FBS / Division I-A — the bettable games) and a high `limit`
 * because a big Saturday has 60+ FBS games.
 *
 *   fetchScoreboard(dateStr) -> [{ gameId, date, name, shortName, state,
 *     seasonType, competitionType, neutralSite, venue, home, away }]   (FBS only)
 *   getUpcomingGames(dateStr) -> pre-game, non-TBD
 *   getFinalScore(gameId, dateStr) -> { state, home, away } | null
 *
 * DEFERRED TO PRESEASON (needs a live feed to verify field names):
 *   team-efficiency context, standings, injuries, rankings (AP/CFP poll),
 *   getUpcomingGamesWithContext(). CFB also has 130+ teams with huge talent
 *   gaps — the model will need ratings (e.g. SP+/FPI-style) far more than the
 *   pros do; plain scoreboard stats won't be enough. Build in August.
 *
 * CommonJS. Requires Node 18+ (global fetch).
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const FBS_GROUP = '80';        // ESPN group id for FBS (Division I-A)
const SCOREBOARD_LIMIT = '300'; // big Saturdays have 60+ FBS games
const LEAGUE_AVG_PPG = 28;     // CFB points/team/game fallback (higher than NFL's ~22.5)
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

/* ---- SCOREBOARD: FBS games only (game identity, state, final scores) ---- */
async function fetchScoreboard(dateStr) {
  const key = `scoreboard:${dateStr || 'today'}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // groups=80 restricts to FBS; without it ESPN returns every division.
  const params = [`groups=${FBS_GROUP}`, `limit=${SCOREBOARD_LIMIT}`];
  if (dateStr) params.unshift(`dates=${dateStr.replace(/-/g, '')}`);
  const url = `${BASE}/scoreboard?${params.join('&')}`;
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
        rank: c.curatedRank?.current && c.curatedRank.current <= 25 ? c.curatedRank.current : null,
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

  cacheSet(key, games, 60 * 1000); // 1 min
  return games;
}

/* ---- upcoming (pre-game, both teams set) ---- */
async function getUpcomingGames(dateStr) {
  const games = await fetchScoreboard(dateStr);
  return games.filter(
    (g) => g.state === 'pre' && g.home && g.away && !g.home.isTBD && !g.away.isTBD
  );
}

/* ---- grading convenience: final score for one game ---- */
async function getFinalScore(gameId, dateStr) {
  const games = await fetchScoreboard(dateStr);
  const g = games.find((x) => String(x.gameId) === String(gameId));
  if (!g || g.state !== 'post') return null;
  return { state: g.state, home: g.home, away: g.away };
}

module.exports = {
  fetchScoreboard,
  getUpcomingGames,
  getFinalScore,
  statMap,
  parseRecords,
  LEAGUE_AVG_PPG,
};
