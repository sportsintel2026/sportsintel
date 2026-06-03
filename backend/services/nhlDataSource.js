/**
 * nhlDataSource.js  —  WizePicks NHL data layer (ESPN hidden API)
 *
 * Mirrors nflDataSource.js. Offseason-safe scoreboard core; model-facing
 * team-context layer deferred (see nflDataSource header notes).
 *
 *   fetchScoreboard(dateStr) -> [{ gameId, date, name, shortName, state,
 *     seasonType, competitionType, neutralSite, venue, home, away }]
 *   getUpcomingGames(dateStr) -> pre-game, non-TBD
 *   getFinalScore(gameId, dateStr) -> { state, home, away } | null
 *
 * DEFERRED (needs a live feed + offseason to verify): team-efficiency context,
 * standings, injuries, getUpcomingGamesWithContext(). NHL-specific model notes
 * for whoever builds edges later:
 *   - Low-scoring, high-variance: win probs sit in a tight band; favorites lose
 *     often. Main markets are puck line (±1.5 — behaves like MLB run line, which
 *     we de-emphasized for variance), moneyline, and totals (over/under goals).
 *   - GOALIE confirmation is the single biggest input and a last-minute scratch
 *     risk (like MLB starting pitchers) — gate predictions on confirmed starter.
 *
 * CommonJS. Requires Node 18+ (global fetch).
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const LEAGUE_AVG_GPG = 3.1; // NHL goals/team/game fallback
const REQUEST_TIMEOUT_MS = 8000;

/* ---- tiny TTL cache ---- */
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

/* ---- ESPN [{name, displayValue}] stat arrays -> {name: number} ---- */
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

/* ---- SCOREBOARD: game identity, state, final scores ---- */
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

  cacheSet(key, games, 60 * 1000);
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
  LEAGUE_AVG_GPG,
};
