/**
// CFB-SCHEDULE-PROBE-SOS-DISCOVERY-2026-06-22
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

/* ---- READ-ONLY PROBE: discover the CFB season-stats shape for the ratings seed ----
 * CFB ratings need real per-team points-for / points-against, but college has ~134 FBS
 * teams across ~11 conferences (vs NFL's 32 in 8 divisions), so looping per-team record
 * endpoints the way NFL does would be ~134 ESPN calls. This probe's MAIN job: confirm
 * whether the STANDINGS endpoint returns PF/PA for EVERY FBS team in a SINGLE call (the
 * cheap seed) — by reporting how many conference groups + total entries come back, the
 * real stat field names, and a flag for whether PF/PA are present. Also samples /teams
 * (to confirm the FBS team count ~134) and one team's core-API statistics block as a
 * fallback source. Writes nothing; inspection only. Remove once the seed is built. */
async function fetchSeasonProbe(season = 2025) {
  const out = { season, endpoints: {} };

  // 1) Standings (FBS) — the prize: does ONE call carry W-L + PF/PA for all teams?
  //    CFB standings nest by conference (and sometimes division) under
  //    children[].standings.entries[], so we walk the tree to count + sample.
  const standingsUrl = `${BASE}/standings?season=${season}&group=${FBS_GROUP}`;
  try {
    const data = await espnGet(standingsUrl);
    const groups = data.children || data.groups || [];
    let totalEntries = 0;
    const collect = (node) => {
      totalEntries += (node?.standings?.entries || []).length;
      for (const child of (node?.children || [])) collect(child);
    };
    if (groups.length) for (const g of groups) collect(g);
    else totalEntries = (data.standings?.entries || []).length;

    // First available entry anywhere in the conference tree.
    let firstEntry = null;
    const findFirst = (node) => {
      if (firstEntry) return;
      const entries = node?.standings?.entries || [];
      if (entries[0]) { firstEntry = entries[0]; return; }
      for (const child of (node?.children || [])) findFirst(child);
    };
    if (groups.length) for (const g of groups) findFirst(g);
    else firstEntry = (data.standings?.entries || [])[0] || null;

    const statNames = firstEntry ? (firstEntry.stats || []).map((s) => s.name || s.abbreviation).filter(Boolean) : [];
    const hasPF = statNames.some((n) => /point.*for|avgpointsfor/i.test(n));
    const hasPA = statNames.some((n) => /point.*against|avgpointsagainst/i.test(n));
    out.endpoints.standings = {
      url: standingsUrl, ok: true,
      conferenceGroups: groups.length,
      totalFbsEntries: totalEntries,
      pfPaInStandings: hasPF && hasPA, // ⭐ true → seed all ratings from this ONE call
      statNames,
      sampleEntry: firstEntry ? {
        team: firstEntry.team?.displayName || firstEntry.team?.abbreviation || null,
        stats: (firstEntry.stats || []).map((s) => ({ name: s.name, abbr: s.abbreviation, value: s.value, display: s.displayValue })),
      } : null,
    };
  } catch (e) {
    out.endpoints.standings = { url: standingsUrl, ok: false, error: e.message };
  }

  // 2) Teams list (FBS) — confirm the count we'd rate (~134, not 250+ incl. FCS).
  const teamsUrl = `${BASE}/teams?groups=${FBS_GROUP}&limit=400`;
  try {
    const data = await espnGet(teamsUrl);
    const teams = data.sports?.[0]?.leagues?.[0]?.teams || [];
    out.endpoints.teams = {
      url: teamsUrl, ok: true, teamCount: teams.length,
      sample: teams.slice(0, 3).map((t) => ({ id: t.team?.id, abbr: t.team?.abbreviation, name: t.team?.displayName })),
    };
  } catch (e) {
    out.endpoints.teams = { url: teamsUrl, ok: false, error: e.message };
  }

  // 3) One team's core-API statistics — category/field names for richer offensive/
  //    defensive splits, the fallback if standings lacks clean PF/PA.
  let probeTeamId = null;
  try {
    const t = await espnGet(teamsUrl);
    probeTeamId = t.sports?.[0]?.leagues?.[0]?.teams?.[0]?.team?.id || null;
  } catch (_) {}
  if (probeTeamId) {
    const coreUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/types/2/teams/${probeTeamId}/statistics`;
    try {
      const data = await espnGet(coreUrl);
      const cats = data.splits?.categories || [];
      out.endpoints.teamStatistics = {
        url: coreUrl, ok: true, teamId: probeTeamId,
        categories: cats.map((c) => ({
          name: c.name, displayName: c.displayName,
          statSample: (c.stats || []).slice(0, 8).map((s) => ({ name: s.name, abbr: s.abbreviation, value: s.value, display: s.displayValue })),
        })),
      };
    } catch (e) {
      out.endpoints.teamStatistics = { url: coreUrl, ok: false, error: e.message };
    }
  }

  return out;
}

/* ---- READ-ONLY PROBE #2: FBS team list + clean PF/PA source (read-only) ------
 * Probe #1 showed the site standings come back empty and /teams?groups=80 ignores
 * the FBS filter (returns 400 teams incl. D-II/D-III). So this nails the two pieces
 * the ratings seed actually needs:
 *   1. The real FBS membership (~134 teams) via the CORE-API group-80 teams list.
 *   2. A clean per-team points-for / points-against via the CORE-API record endpoint
 *      (the same source NFL's seed uses), probed on a real FBS id pulled from #1.
 * Confirms the seed strategy (loop ~134 FBS record endpoints) before any rating math.
 * Writes nothing; inspection only. Remove once buildTeamRatings is built. */
async function fetchPointsProbe(season = 2025) {
  const out = { season, endpoints: {} };
  const CORE = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/types/2`;

  // 1) FBS membership — core group-80 teams. Returns { count, items:[{ $ref }] }.
  let fbsIds = [];
  const groupTeamsUrl = `${CORE}/groups/80/teams?limit=200`;
  try {
    const data = await espnGet(groupTeamsUrl);
    const items = data.items || [];
    fbsIds = items.map((it) => {
      const m = String(it.$ref || "").match(/teams\/(\d+)/);
      return m ? m[1] : null;
    }).filter(Boolean);
    out.endpoints.fbsTeams = {
      url: groupTeamsUrl, ok: true,
      reportedCount: data.count ?? null,
      idsParsed: fbsIds.length,
      sampleIds: fbsIds.slice(0, 6),
    };
  } catch (e) {
    out.endpoints.fbsTeams = { url: groupTeamsUrl, ok: false, error: e.message };
  }

  // 2) Clean PF/PA — core RECORD endpoint for one real FBS team from the list above.
  //    record returns { items:[{ type, summary, stats:[{name,value,displayValue}] }] }
  //    where the overall block typically carries pointsFor / pointsAgainst directly.
  const probeId = fbsIds[0] || "333"; // 333 = Alabama, a safe FBS fallback
  const recordUrl = `${CORE}/teams/${probeId}/record`;
  try {
    const data = await espnGet(recordUrl);
    const items = data.items || [];
    const overall = items.find((i) => /overall|total/i.test(`${i.type || ""} ${i.name || ""}`)) || items[0] || {};
    const stats = overall.stats || [];
    const statNames = stats.map((s) => s.name).filter(Boolean);
    const pick = (re) => {
      const s = stats.find((x) => re.test(x.name || ""));
      return s ? { name: s.name, value: s.value, display: s.displayValue } : null;
    };
    out.endpoints.record = {
      url: recordUrl, ok: true, teamId: probeId,
      recordBlocks: items.map((i) => i.type || i.name).filter(Boolean),
      statNames,
      pointsFor: pick(/^pointsfor$/i) || pick(/^avgpointsfor$/i) || pick(/pointsfor/i),
      pointsAgainst: pick(/^pointsagainst$/i) || pick(/^avgpointsagainst$/i) || pick(/pointsagainst/i),
      gamesPlayed: pick(/^gamesplayed$/i) || pick(/games/i),
    };
  } catch (e) {
    out.endpoints.record = { url: recordUrl, ok: false, error: e.message };
  }

  return out;
}

/* ---- POWER RATINGS: per-team strength seeded from real points data (FBS) -------
 * buildTeamRatings(season) loops the ~146 FBS teams' core-API record endpoints and
 * computes a points-differential power rating (SRS base: points/game better or worse
 * than a league-average FBS team):
 *
 *   rawRating = (pointsFor - pointsAgainst) / gamesPlayed
 *
 * Then league-centered (mean = 0) and REGRESSED toward 0 by RATING_REGRESSION. CFB
 * gets slightly MORE regression than NFL because cupcake/FCS scheduling inflates raw
 * differentials (a team can post +35/game beating up tomato cans), so the seed should
 * be humble about the extremes. FBS-only: the membership comes from ESPN's core
 * group-80 list (the /teams?groups=80 site filter is broken — returns D-II/D-III).
 *
 * COST: ~146 core-API record calls per refresh, run in concurrency-capped batches and
 * cached 6h (ratings move weekly at most). Names are a best-effort bulk lookup.
 *
 * HONESTY GATES (same as NFL): a team with gamesPlayed < MIN_GAMES_FOR_RATING is
 * skipped; if NO team has a sample (true offseason), returns {} so the model stays
 * market-only rather than rating on emptiness.
 *
 * NOT YET INCLUDED (clean slots for later layers): strength-of-schedule (huge in CFB
 * given scheduling disparity) and conference strength (vsconf record carried through).*/
const RATING_REGRESSION = 0.72;            // keep 72% of raw differential, shrink 28% to mean
const MIN_GAMES_FOR_RATING = 4;            // need a real sample before rating a team
const RATINGS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — refresh is ~146 calls; ratings move weekly
const RATINGS_BATCH = 14;                  // concurrency cap so we don't hammer ESPN at once

function recStat(statsArr, name) {
  if (!Array.isArray(statsArr)) return null;
  const s = statsArr.find((x) => x.name === name);
  return s && s.value != null ? Number(s.value) : null;
}

async function buildTeamRatings(season = 2025) {
  const key = `cfbRatings:${season}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const CORE = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/types/2`;

  // 1) FBS membership (ids) from the core group-80 list — the real ~146 to rate.
  let fbsIds = [];
  try {
    const data = await espnGet(`${CORE}/groups/80/teams?limit=200`);
    fbsIds = (data.items || []).map((it) => {
      const m = String(it.$ref || "").match(/teams\/(\d+)/);
      return m ? m[1] : null;
    }).filter(Boolean);
  } catch (e) {
    return { season, teams: {}, rated: 0, error: `FBS team list fetch failed: ${e.message}` };
  }
  if (!fbsIds.length) return { season, teams: {}, rated: 0, error: "no FBS teams returned" };

  // 2) id -> {abbr, name} via the bulk site /teams list (one call). The groups=80
  //    filter is ignored here, so we pull a wide list and key by id; names are
  //    best-effort (a missing one falls back to the id, ratings still compute).
  const nameById = {};
  try {
    const t = await espnGet(`${BASE}/teams?limit=900`);
    for (const x of (t.sports?.[0]?.leagues?.[0]?.teams || [])) {
      const tm = x.team;
      if (tm && tm.id) nameById[String(tm.id)] = { abbr: tm.abbreviation || null, name: tm.displayName || tm.name || null };
    }
  } catch (_) { /* names best-effort */ }

  // 3) each FBS team's record → raw points-diff rating, in concurrency-capped batches.
  const recordUrl = (id) => `${CORE}/teams/${id}/record`;
  const raw = {};
  for (let i = 0; i < fbsIds.length; i += RATINGS_BATCH) {
    const batch = fbsIds.slice(i, i + RATINGS_BATCH);
    await Promise.all(batch.map(async (id) => {
      try {
        const data = await espnGet(recordUrl(id));
        const items = data.items || [];
        const total = items.find((it) => (it.type || "").toLowerCase() === "total");
        const conf = items.find((it) => (it.type || "").toLowerCase() === "vsconf");
        if (!total) return;
        const stats = total.stats || [];
        const gp = recStat(stats, "gamesPlayed");
        const pf = recStat(stats, "pointsFor");
        const pa = recStat(stats, "pointsAgainst");
        if (gp == null || pf == null || pa == null || gp < MIN_GAMES_FOR_RATING) return;
        const meta = nameById[String(id)] || {};
        raw[id] = {
          id: String(id), abbr: meta.abbr || String(id), name: meta.name || `Team ${id}`,
          gp, pf, pa, wins: recStat(stats, "wins"), losses: recStat(stats, "losses"),
          diff: pf - pa, rawRating: (pf - pa) / gp,
          confRecord: conf ? { wins: recStat(conf.stats, "wins"), losses: recStat(conf.stats, "losses") } : null,
        };
      } catch (_) { /* skip this team; others still rate */ }
    }));
  }

  const ratedIds = Object.keys(raw);
  if (ratedIds.length === 0) {
    const empty = { season, teams: {}, rated: 0, fbsListed: fbsIds.length, note: "No FBS team has enough games yet — model stays market-only." };
    cacheSet(key, empty, RATINGS_TTL_MS);
    return empty;
  }

  // 4) center on the league mean (kills scoring-era drift), then regress to tame
  //    small-sample + cupcake-inflated extremes.
  const meanRaw = ratedIds.reduce((s, id) => s + raw[id].rawRating, 0) / ratedIds.length;
  const teamsOut = {};
  for (const id of ratedIds) {
    const centered = raw[id].rawRating - meanRaw;
    teamsOut[id] = {
      ...raw[id],
      rating: Math.round(centered * RATING_REGRESSION * 100) / 100,
      regressed: true, sosApplied: false,
    };
  }

  const result = {
    season, rated: ratedIds.length, fbsListed: fbsIds.length,
    meanRawDiffPerGame: Math.round(meanRaw * 100) / 100,
    regression: RATING_REGRESSION, teams: teamsOut,
    note: "CFB power ratings = league-centered, regressed points differential per game (2025 seed). FBS only; SoS/conference layers not yet applied. Cupcake-inflated diffs partly tamed by regression.",
  };
  cacheSet(key, result, RATINGS_TTL_MS);
  return result;
}

/* ---- READ-ONLY PROBE: discover the per-team SCHEDULE/opponent shape for SoS ----
 * buildTeamRatings seeds from each team's season-aggregate PF/PA (the /record
 * endpoint), which has NO opponent breakdown — so a cupcake-padded differential
 * looks identical to a battle-tested one. A strength-of-schedule layer needs each
 * team's opponent list (+ margins). This probe confirms the site schedule endpoint
 *   {BASE}/teams/{id}/schedule?season=YYYY
 * actually carries opponent id + home/away + final score per game, and that a
 * parser can read them, BEFORE any SoS math is wired. Writes nothing.
 * Samples a few human-recognizable teams (G5 phantom-edge offenders + a P5 anchor)
 * so the parsed output is eyeball-verifiable, with a raw first-event dump as a
 * fallback in case any field name differs from the expectation.
 *   /api/edges/cfbscheduleprobe[?season=2025] */
function scoreVal(c) {
  if (c == null) return null;
  const s = c.score;
  if (s == null) return null;
  if (typeof s === "number") return s;
  if (typeof s === "string") { const n = Number(s); return Number.isFinite(n) ? n : null; }
  if (typeof s === "object") { const n = Number(s.value != null ? s.value : s.displayValue); return Number.isFinite(n) ? n : null; }
  return null;
}

function parseScheduleEvents(events, selfId) {
  const out = [];
  for (const ev of (events || [])) {
    const comp = (ev.competitions || [])[0];
    if (!comp) continue;
    const cs = comp.competitors || [];
    const me = cs.find((c) => String(c.id || c.team?.id) === String(selfId));
    const opp = cs.find((c) => String(c.id || c.team?.id) !== String(selfId));
    const completed = !!(comp.status?.type?.completed);
    out.push({
      week: ev.week?.number ?? null,
      opponentId: opp ? String(opp.id || opp.team?.id || "") : null,
      opponentName: opp ? (opp.team?.displayName || opp.team?.name || opp.team?.abbreviation || null) : null,
      homeAway: me ? (me.homeAway || null) : null,
      teamScore: scoreVal(me),
      oppScore: scoreVal(opp),
      completed,
      neutralSite: !!comp.neutralSite,
    });
  }
  return out;
}

async function fetchSchedulesProbe(season = 2025) {
  // 1) FBS membership + names (same two calls buildTeamRatings uses) so we can pick
  //    recognizable teams by name and report opponent names, not bare ids.
  const CORE = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/types/2`;
  let fbsIds = [];
  try {
    const data = await espnGet(`${CORE}/groups/80/teams?limit=200`);
    fbsIds = (data.items || []).map((it) => { const m = String(it.$ref || "").match(/teams\/(\d+)/); return m ? m[1] : null; }).filter(Boolean);
  } catch (e) {
    return { season, error: `FBS team list fetch failed: ${e.message}` };
  }
  const nameById = {};
  try {
    const t = await espnGet(`${BASE}/teams?limit=900`);
    for (const x of (t.sports?.[0]?.leagues?.[0]?.teams || [])) {
      const tm = x.team;
      if (tm && tm.id) nameById[String(tm.id)] = tm.displayName || tm.name || null;
    }
  } catch (_) { /* names best-effort */ }

  // 2) pick recognizable sample teams: the two G5 phantom-edge offenders + a P5
  //    anchor. Fall back to the first FBS ids if name lookup missed.
  const want = ["Toledo", "North Texas", "Ohio State"];
  const idByName = {};
  for (const [id, nm] of Object.entries(nameById)) { if (nm) idByName[nm] = id; }
  let sampleIds = want.map((w) => Object.keys(idByName).find((nm) => nm.includes(w))).filter(Boolean).map((nm) => idByName[nm]);
  sampleIds = sampleIds.filter((id) => fbsIds.includes(id));
  if (sampleIds.length < 3) {
    for (const id of fbsIds) { if (sampleIds.length >= 3) break; if (!sampleIds.includes(id)) sampleIds.push(id); }
  }

  // 3) fetch each sample team's schedule, parse opponent + score per game.
  const teams = [];
  let rawSampleFirstEvent = null;
  for (const id of sampleIds) {
    try {
      const sch = await espnGet(`${BASE}/teams/${id}/schedule?season=${season}`);
      const events = sch.events || [];
      if (rawSampleFirstEvent == null && events.length) {
        const comp = (events[0].competitions || [])[0] || {};
        rawSampleFirstEvent = { week: events[0].week, competitors: (comp.competitors || []).map((c) => ({ id: c.id, homeAway: c.homeAway, score: c.score, winner: c.winner, team: c.team ? { id: c.team.id, displayName: c.team.displayName, abbreviation: c.team.abbreviation } : null })), status: comp.status?.type };
      }
      const parsed = parseScheduleEvents(events, id);
      teams.push({
        id, name: nameById[String(id)] || `Team ${id}`,
        gameCount: events.length,
        completedCount: parsed.filter((p) => p.completed).length,
        parsableOpponents: parsed.filter((p) => p.opponentId).length,
        parsableScores: parsed.filter((p) => p.teamScore != null && p.oppScore != null).length,
        games: parsed,
      });
    } catch (e) {
      teams.push({ id, name: nameById[String(id)] || `Team ${id}`, error: e.message });
    }
  }

  return {
    season,
    endpointTried: `${BASE}/teams/{id}/schedule?season=${season}`,
    sampleTeamIds: sampleIds,
    note: "If parsableOpponents and parsableScores ≈ gameCount for each team, the schedule endpoint feeds SoS cleanly (opponent id + final score per game). Then buildTeamRatings can do one SRS pass: adjusted = ownDiff + W * avg(opponent rating). rawSampleFirstEvent shows the live field names if any parse looks off.",
    rawSampleFirstEvent,
    teams,
  };
}

module.exports = {
  fetchScoreboard,
  getUpcomingGames,
  getFinalScore,
  fetchSeasonProbe,
  fetchPointsProbe,
  buildTeamRatings,
  fetchSchedulesProbe,
  statMap,
  parseRecords,
  LEAGUE_AVG_PPG,
};
