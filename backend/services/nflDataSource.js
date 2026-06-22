/**
 * nflDataSource.js  —  WizePicks NFL data layer (ESPN hidden API)
 *
 * Mirrors nbaDataSource.js. This v1 ships the parts that are STRUCTURALLY
 * IDENTICAL across ESPN sports and therefore safe to build in the offseason
 * without a live feed to validate against:
 *
 *   fetchScoreboard(dateStr) -> [{
 *     gameId, date, name, shortName,
 *     state ('pre'|'in'|'post'), seasonType, competitionType, neutralSite,
 *     venue: { name, city, state },
 *     home / away: { id, abbr, displayName, location, homeAway, score,
 *                    seasonStats, records: {overall,home,road}, isTBD }
 *   }]
 *   getUpcomingGames(dateStr) -> scoreboard filtered to pre-game, non-TBD
 *   getFinalScore(gameId, dateStr) -> { state, home, away } | null  (grading helper)
 *
 * This is enough to LIST NFL games and to GRADE NFL picks from final scores.
 *
 * DEFERRED TO PRESEASON (needs a live NFL feed to verify field names):
 *   - team-efficiency context for the model (NFL stat keys differ from NBA's
 *     ppg/pace/ortg; building buildTeamContext() now would be guesswork)
 *   - fetchStandings() defensive numbers, fetchInjuries() mapping
 *   - getUpcomingGamesWithContext() (the model-facing version)
 * Build those in August when scoreboard.statistics carries real NFL values.
 *
 * CommonJS. Requires Node 18+ (global fetch).
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const LEAGUE_AVG_PPG = 22.5; // NFL points/team/game fallback (vs NBA's 114)
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

/* ---- SCOREBOARD: game identity, state, final scores (powers listing + grading) ---- */
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

/* ---- upcoming (pre-game, both teams set) — for the games page ---- */
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

/* ---- READ-ONLY PROBE: discover the 2025 season-stats shape for ratings ----
 * The model's power ratings need a real seed: 2025 final team strength (points
 * for/against, offensive/defensive efficiency). ESPN's NFL stat KEYS are
 * unverified (this file deferred team-context for exactly that reason), so before
 * writing any rating math we inspect what ESPN actually returns. This probe tries
 * the standings + a team-statistics endpoint for the given season and reports the
 * raw field names/sample values it finds. Writes nothing; inspection only.
 * Remove once the rating seed is built from the confirmed shape. */
/* ---- READ-ONLY PROBE #2: find a clean points-for / points-against source ----
 * The site standings came back empty and a team's own statistics block has no
 * "points allowed". Points-for AND points-against are the foundation of a real
 * power rating, so this probe targets the two endpoints most likely to carry them
 * directly: (1) the core-API team RECORD (often has pointsFor/pointsAgainst as
 * record stats) and (2) the core-API standings. Reports raw field names so we pick
 * the clean source instead of approximating from yards. Inspection only. */
async function fetchPointsProbe(season = 2025) {
  const out = { season, endpoints: {} };

  // First resolve a real team id from the teams list (Arizona = 22 historically).
  let teamId = "22", teamName = null;
  try {
    const t = await espnGet(`${BASE}/teams`);
    const first = t.sports?.[0]?.leagues?.[0]?.teams?.[0]?.team;
    if (first?.id) { teamId = first.id; teamName = first.displayName; }
  } catch (_) {}

  // 1) Core-API team RECORD — commonly carries pointsFor/pointsAgainst/avgPointsFor.
  const recordUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/teams/${teamId}/record`;
  try {
    const data = await espnGet(recordUrl);
    // shape: { items: [{ type:'total', stats:[{name,value,displayValue}] }, ...] }
    const items = data.items || [];
    out.endpoints.record = {
      url: recordUrl, ok: true, teamId, teamName,
      recordTypes: items.map((it) => ({
        type: it.type || it.name || it.description,
        stats: (it.stats || []).map((s) => ({ name: s.name, abbr: s.abbreviation, value: s.value, display: s.displayValue })),
      })),
    };
  } catch (e) {
    out.endpoints.record = { url: recordUrl, ok: false, error: e.message };
  }

  // 2) Core-API standings — different host/shape than the empty site standings.
  const coreStandingsUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/standings`;
  try {
    const data = await espnGet(coreStandingsUrl);
    // core standings is paginated by $ref; report the top-level shape + first ref.
    out.endpoints.coreStandings = {
      url: coreStandingsUrl, ok: true,
      keys: Object.keys(data || {}),
      count: data.count, pageCount: data.pageCount,
      firstItemRef: (data.items && data.items[0] && data.items[0].$ref) || null,
      note: "If this returns $ref items, standings are a second hop; record endpoint above is the simpler source if it has PF/PA.",
    };
  } catch (e) {
    out.endpoints.coreStandings = { url: coreStandingsUrl, ok: false, error: e.message };
  }

  return out;
}

async function fetchSeasonProbe(season = 2025) {
  const out = { season, endpoints: {} };

  // 1) Standings — usually carries W-L + points for/against per team cleanly.
  const standingsUrl = `${BASE}/standings?season=${season}`;
  try {
    const data = await espnGet(standingsUrl);
    // ESPN nests standings under children[].standings.entries[] (by conference/division).
    const groups = data.children || data.groups || [];
    let sampleEntry = null, statNames = [];
    const firstGroup = groups[0];
    const entries = firstGroup?.standings?.entries || data.standings?.entries || [];
    if (entries[0]) {
      const e = entries[0];
      statNames = (e.stats || []).map((s) => s.name || s.abbreviation).filter(Boolean);
      sampleEntry = {
        team: e.team?.displayName || e.team?.abbreviation || null,
        stats: (e.stats || []).map((s) => ({
          name: s.name, abbr: s.abbreviation, value: s.value, display: s.displayValue,
        })),
      };
    }
    out.endpoints.standings = {
      url: standingsUrl, ok: true,
      groupCount: groups.length,
      entriesInFirstGroup: entries.length,
      statNames, sampleEntry,
    };
  } catch (e) {
    out.endpoints.standings = { url: standingsUrl, ok: false, error: e.message };
  }

  // 2) Teams list — to confirm team ids we'd loop for per-team statistics.
  const teamsUrl = `${BASE}/teams`;
  try {
    const data = await espnGet(teamsUrl);
    const teams = data.sports?.[0]?.leagues?.[0]?.teams || [];
    out.endpoints.teams = {
      url: teamsUrl, ok: true, teamCount: teams.length,
      sample: teams.slice(0, 3).map((t) => ({
        id: t.team?.id, abbr: t.team?.abbreviation, name: t.team?.displayName,
      })),
    };
  } catch (e) {
    out.endpoints.teams = { url: teamsUrl, ok: false, error: e.message };
  }

  // 3) Per-team season statistics via the core API (richer offensive/defensive
  // splits). Probe ONE team (first from the teams list, else a known id) so we
  // can read the real stat category/field names without 32 calls.
  let probeTeamId = null;
  try {
    const t = await espnGet(`${BASE}/teams`);
    probeTeamId = t.sports?.[0]?.leagues?.[0]?.teams?.[0]?.team?.id || null;
  } catch (_) {}
  if (probeTeamId) {
    const coreUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/teams/${probeTeamId}/statistics`;
    try {
      const data = await espnGet(coreUrl);
      const cats = data.splits?.categories || [];
      out.endpoints.teamStatistics = {
        url: coreUrl, ok: true, teamId: probeTeamId,
        categories: cats.map((c) => ({
          name: c.name, displayName: c.displayName,
          statSample: (c.stats || []).slice(0, 8).map((s) => ({
            name: s.name, abbr: s.abbreviation, value: s.value, display: s.displayValue,
          })),
        })),
      };
    } catch (e) {
      out.endpoints.teamStatistics = { url: coreUrl, ok: false, error: e.message };
    }
  }

  return out;
}

module.exports = {
  fetchScoreboard,
  getUpcomingGames,
  getFinalScore,
  fetchSeasonProbe,
  fetchPointsProbe,
  statMap,
  parseRecords,
  LEAGUE_AVG_PPG,
};
