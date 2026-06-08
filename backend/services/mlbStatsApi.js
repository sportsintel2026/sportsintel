// MLB Stats API client (statsapi.mlb.com) — free, official, no key required
// Docs: https://github.com/toddrob99/MLB-StatsAPI/wiki
const axios = require("axios");
const MLB_BASE = "https://statsapi.mlb.com/api/v1";

// ── Static lookup tables ──────────────────────────────────────────────────────
const PARK_HR_FACTOR = {
  "Coors Field": 1.31, "Great American Ball Park": 1.22, "Yankee Stadium": 1.18,
  "Citizens Bank Park": 1.14, "Globe Life Field": 1.11, "Truist Park": 1.08,
  "Wrigley Field": 1.07, "Minute Maid Park": 1.06, "Target Field": 1.05,
  "Rogers Centre": 1.05, "American Family Field": 1.04, "Citi Field": 1.03,
  "Dodger Stadium": 1.02, "Chase Field": 1.02, "Angel Stadium": 1.01,
  "PNC Park": 1.00, "Progressive Field": 0.99, "Comerica Park": 0.99,
  "Kauffman Stadium": 0.97, "Petco Park": 0.95, "Busch Stadium": 0.94,
  "Fenway Park": 0.94, "Camden Yards": 0.93, "Tropicana Field": 0.92,
  "Nationals Park": 0.91, "T-Mobile Park": 0.90, "loanDepot park": 0.88,
  "Oracle Park": 0.85, "Oakland Coliseum": 0.84, "Sutter Health Park": 1.05,
  "Rate Field": 1.09,
};
const PARK_RUN_FACTOR = {
  "Coors Field": 1.18, "Great American Ball Park": 1.08, "Globe Life Field": 1.07,
  "Yankee Stadium": 1.05, "Citizens Bank Park": 1.04, "Fenway Park": 1.04,
  "Truist Park": 1.03, "Wrigley Field": 1.02, "Minute Maid Park": 1.02,
  "Rogers Centre": 1.01, "American Family Field": 1.01, "Citi Field": 1.00,
  "Dodger Stadium": 0.99, "Target Field": 0.99, "PNC Park": 0.99,
  "Angel Stadium": 0.98, "Comerica Park": 0.98, "Progressive Field": 0.97,
  "Chase Field": 0.97, "Busch Stadium": 0.96, "Kauffman Stadium": 0.96,
  "Camden Yards": 0.95, "Nationals Park": 0.94, "Petco Park": 0.93,
  "Tropicana Field": 0.92, "loanDepot park": 0.91, "T-Mobile Park": 0.90,
  "Oracle Park": 0.89, "Oakland Coliseum": 0.88, "Sutter Health Park": 1.02,
  "Rate Field": 1.02,
};
// Some stadiums get sponsor renames; the schedule feed returns the CURRENT name
// while the tables above are keyed by canonical names. Without this, a renamed
// park silently falls back to a neutral 1.0 factor (no park adjustment at all).
// Map current feed strings -> the canonical table key so the factor still applies.
// To handle a future rename, just add one line here.
const VENUE_ALIASES = {
  "Daikin Park": "Minute Maid Park",                  // HOU (renamed from Minute Maid Park)
  "UNIQLO Field at Dodger Stadium": "Dodger Stadium", // LAD sponsor name
  "Oriole Park at Camden Yards": "Camden Yards",      // BAL official full name
};
function canonicalVenue(venueName) { return VENUE_ALIASES[venueName] || venueName; }
function getParkHRFactor(venueName) { return PARK_HR_FACTOR[canonicalVenue(venueName)] ?? 1.0; }
function getParkRunFactor(venueName) { return PARK_RUN_FACTOR[canonicalVenue(venueName)] ?? 1.0; }

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function mlbGet(path, params = {}) {
  const res = await axios.get(`${MLB_BASE}${path}`, { params, timeout: 10000 });
  return res.data;
}

// ── Today's slate ─────────────────────────────────────────────────────────────
function getEasternDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
async function getScheduleForDate(date) {
  const data = await mlbGet(`/schedule`, {
    sportId: 1, date,
    hydrate: "probablePitcher,team,venue,linescore,gameInfo,weather",
  });
  const games = [];
  for (const dateBlock of data.dates || []) {
    for (const g of dateBlock.games || []) games.push(parseGame(g, date));
  }
  return games;
}
function parseGame(g, date) {
  const away = g.teams?.away;
  const home = g.teams?.home;
  const venue = g.venue?.name || "";
  const status = mapStatus(g.status?.abstractGameState, g.status?.detailedState);
  return {
    id: String(g.gamePk), league: "mlb", date,
    away: away?.team?.name || "Away", home: home?.team?.name || "Home",
    awayAbbr: away?.team?.abbreviation || "", homeAbbr: home?.team?.abbreviation || "",
    awayId: away?.team?.id, homeId: home?.team?.id,
    awayScore: away?.score ?? null, homeScore: home?.score ?? null,
    awayRecord: away?.leagueRecord ? `${away.leagueRecord.wins}-${away.leagueRecord.losses}` : null,
    homeRecord: home?.leagueRecord ? `${home.leagueRecord.wins}-${home.leagueRecord.losses}` : null,
    status,
    inning: g.linescore?.currentInning ? `${g.linescore.inningState || ""} ${g.linescore.currentInning}`.trim() : null,
    time: new Date(g.gameDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET",
    startTimeUTC: g.gameDate || null, // raw ISO start; used to capture the pre-game closing line

    venue, city: g.venue?.location?.city || "",
    awayProbable: away?.probablePitcher ? { id: away.probablePitcher.id, name: away.probablePitcher.fullName } : null,
    homeProbable: home?.probablePitcher ? { id: home.probablePitcher.id, name: home.probablePitcher.fullName } : null,
    parkHRFactor: getParkHRFactor(venue), parkRunFactor: getParkRunFactor(venue),
  };
}
function mapStatus(abstractState, detailedState) {
  // No-action / not-completed states take precedence: MLB can carry
  // abstractState "Final" on a Postponed game, so these MUST be checked first or
  // a postponed game gets mislabeled "final" and graded against an empty box.
  if (detailedState === "Postponed") return "postponed";
  if (detailedState === "Cancelled") return "cancelled";
  if (detailedState === "Suspended") return "suspended";
  if (abstractState === "Live") return "live";
  if (abstractState === "Final") return "final";
  return "scheduled";
}

// ── Pitcher stats ─────────────────────────────────────────────────────────────
async function getPitcherSeasonStats(playerId, season) {
  if (!playerId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/people/${playerId}/stats`, { stats: "season", group: "pitching", season: yr });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    return {
      gamesStarted: parseIntSafe(s.gamesStarted), inningsPitched: parseFloat(s.inningsPitched) || 0,
      era: parseFloat(s.era) || null, whip: parseFloat(s.whip) || null,
      strikeoutsPer9: parseFloat(s.strikeoutsPer9Inn) || null, walksPer9: parseFloat(s.walksPer9Inn) || null,
      homeRunsPer9: parseFloat(s.homeRunsPer9) || null, strikeoutWalkRatio: parseFloat(s.strikeoutWalkRatio) || null,
      battingAvgAgainst: parseFloat(s.avg) || null,
      wins: parseIntSafe(s.wins), losses: parseIntSafe(s.losses), hits: parseIntSafe(s.hits),
      earnedRuns: parseIntSafe(s.earnedRuns), homeRuns: parseIntSafe(s.homeRuns),
      strikeouts: parseIntSafe(s.strikeOuts), walks: parseIntSafe(s.baseOnBalls),
    };
  } catch (e) { return null; }
}

// ── Batter stats ──────────────────────────────────────────────────────────────
async function getBatterSeasonStats(playerId, season) {
  if (!playerId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/people/${playerId}/stats`, { stats: "season", group: "hitting", season: yr });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    return {
      atBats: parseIntSafe(s.atBats), plateAppearances: parseIntSafe(s.plateAppearances),
      hits: parseIntSafe(s.hits), homeRuns: parseIntSafe(s.homeRuns),
      doubles: parseIntSafe(s.doubles), triples: parseIntSafe(s.triples), rbi: parseIntSafe(s.rbi),
      walks: parseIntSafe(s.baseOnBalls), strikeouts: parseIntSafe(s.strikeOuts),
      avg: parseFloat(s.avg) || null, obp: parseFloat(s.obp) || null,
      slg: parseFloat(s.slg) || null, ops: parseFloat(s.ops) || null,
      iso: s.slg && s.avg ? parseFloat(s.slg) - parseFloat(s.avg) : null,
      hrPerPA: s.plateAppearances ? parseIntSafe(s.homeRuns) / parseIntSafe(s.plateAppearances) : null,
    };
  } catch (e) { return null; }
}

// ── Team stats ────────────────────────────────────────────────────────────────
async function getTeamSeasonStats(teamId, season) {
  if (!teamId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/teams/${teamId}/stats`, { stats: "season", group: "hitting", season: yr });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    const games = parseIntSafe(s.gamesPlayed) || 1;
    return {
      games, runs: parseIntSafe(s.runs), runsPerGame: parseIntSafe(s.runs) / games,
      avg: parseFloat(s.avg) || null, obp: parseFloat(s.obp) || null,
      slg: parseFloat(s.slg) || null, ops: parseFloat(s.ops) || null,
      homeRuns: parseIntSafe(s.homeRuns), strikeouts: parseIntSafe(s.strikeOuts),
    };
  } catch (e) { return null; }
}
// POINT-IN-TIME team hitting — season-to-date stats as they stood THROUGH endDate
// (YYYY-MM-DD). Used for honest backtesting: predicting a past game must use only
// stats available BEFORE it, never full-season totals (which would be lookahead).
async function getTeamHittingAsOf(teamId, endDate, season) {
  if (!teamId || !endDate) return null;
  const yr = season || parseInt(String(endDate).slice(0, 4), 10) || new Date().getFullYear();
  try {
    const data = await mlbGet(`/teams/${teamId}/stats`, {
      stats: "byDateRange", group: "hitting", season: yr,
      startDate: `${yr}-03-01`, endDate,
    });
    const s = data.stats?.[0]?.splits?.[0]?.stat || {};
    if (s.ops == null && s.avg == null) return null;
    return {
      ops: parseFloat(s.ops) || null,
      avg: parseFloat(s.avg) || null,
      obp: parseFloat(s.obp) || null,
      slg: parseFloat(s.slg) || null,
      atBats: parseIntSafe(s.atBats),
      games: parseIntSafe(s.gamesPlayed),
      asOf: endDate,
    };
  } catch (e) { return null; }
}
// POINT-IN-TIME starter ERA — season-to-date through endDate (no lookahead).
async function getPitcherEraAsOf(pitcherId, endDate, season) {
  if (!pitcherId || !endDate) return null;
  const yr = season || parseInt(String(endDate).slice(0, 4), 10) || new Date().getFullYear();
  try {
    const data = await mlbGet(`/people/${pitcherId}/stats`, {
      stats: "byDateRange", group: "pitching", season: yr, startDate: `${yr}-03-01`, endDate,
    });
    const s = data.stats?.[0]?.splits?.[0]?.stat || {};
    const era = parseFloat(s.era);
    if (!isFinite(era)) return null;
    return { era, inningsPitched: parseFloat(s.inningsPitched) || 0, asOf: endDate };
  } catch (e) { return null; }
}
// POINT-IN-TIME team pitching ERA (whole-staff) through endDate — backtest proxy
// for bullpen strength. Held identical across A/B arms, so it can't bias the test.
async function getTeamPitchingAsOf(teamId, endDate, season) {
  if (!teamId || !endDate) return null;
  const yr = season || parseInt(String(endDate).slice(0, 4), 10) || new Date().getFullYear();
  try {
    const data = await mlbGet(`/teams/${teamId}/stats`, {
      stats: "byDateRange", group: "pitching", season: yr, startDate: `${yr}-03-01`, endDate,
    });
    const s = data.stats?.[0]?.splits?.[0]?.stat || {};
    const era = parseFloat(s.era);
    if (!isFinite(era)) return null;
    return { era, asOf: endDate };
  } catch (e) { return null; }
}
async function getTeamPitchingStats(teamId, season) {
  if (!teamId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/teams/${teamId}/stats`, { stats: "season", group: "pitching", season: yr });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    const games = parseIntSafe(s.gamesPlayed) || 1;
    return {
      games, era: parseFloat(s.era) || null, whip: parseFloat(s.whip) || null,
      runsAllowed: parseIntSafe(s.runs), runsAllowedPerGame: parseIntSafe(s.runs) / games,
      homeRunsAllowed: parseIntSafe(s.homeRuns), homeRunsPer9: parseFloat(s.homeRunsPer9) || null,
    };
  } catch (e) { return null; }
}

// ── Team roster ───────────────────────────────────────────────────────────────
async function getTeamRoster(teamId) {
  if (!teamId) return [];
  try {
    const data = await mlbGet(`/teams/${teamId}/roster`, { rosterType: "active" });
    return (data.roster || [])
      .filter(p => p.position?.type === "Hitter" || p.position?.code !== "1")
      .map(p => ({ id: p.person?.id, name: p.person?.fullName, position: p.position?.abbreviation }));
  } catch (e) { return []; }
}

// ── Linescore ─────────────────────────────────────────────────────────────────
async function getLinescore(gamePk) {
  try { return await mlbGet(`/game/${gamePk}/linescore`); } catch (e) { return null; }
}

// ── Batter vs Pitcher career history ─────────────────────────────────────────
async function getBatterVsPitcherHistory(batterId, pitcherId) {
  if (!batterId || !pitcherId) return null;
  try {
    const data = await mlbGet(`/people/${batterId}/stats`, {
      stats: "vsPlayer", group: "hitting", opposingPlayerId: pitcherId, sportId: 1,
    });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    let totals = { atBats: 0, hits: 0, homeRuns: 0, doubles: 0, triples: 0, rbi: 0, walks: 0, strikeouts: 0 };
    for (const sp of splits) {
      const s = sp.stat || {};
      totals.atBats += parseIntSafe(s.atBats); totals.hits += parseIntSafe(s.hits);
      totals.homeRuns += parseIntSafe(s.homeRuns); totals.doubles += parseIntSafe(s.doubles);
      totals.triples += parseIntSafe(s.triples); totals.rbi += parseIntSafe(s.rbi);
      totals.walks += parseIntSafe(s.baseOnBalls); totals.strikeouts += parseIntSafe(s.strikeOuts);
    }
    if (totals.atBats === 0) return null;
    return {
      atBats: totals.atBats, hits: totals.hits, homeRuns: totals.homeRuns,
      doubles: totals.doubles, triples: totals.triples, rbi: totals.rbi,
      walks: totals.walks, strikeouts: totals.strikeouts,
      avg: totals.hits / totals.atBats,
      ops: totals.atBats > 0
        ? ((totals.hits + totals.walks) / (totals.atBats + totals.walks)) +
          ((totals.hits + totals.doubles + 2 * totals.triples + 3 * totals.homeRuns) / totals.atBats)
        : null,
    };
  } catch (e) { return null; }
}

// ── Pitcher's last N starts ──────────────────────────────────────────────────
async function getPitcherRecentStarts(pitcherId, count = 3) {
  if (!pitcherId) return [];
  const yr = new Date().getFullYear();
  try {
    const data = await mlbGet(`/people/${pitcherId}/stats`, { stats: "gameLog", group: "pitching", season: yr });
    const splits = data.stats?.[0]?.splits || [];
    const starts = splits
      .filter(sp => parseIntSafe(sp.stat?.gamesStarted) > 0)
      .map(sp => {
        const s = sp.stat || {};
        return {
          date: sp.date, opponent: sp.opponent?.name || "—",
          ip: parseFloat(s.inningsPitched) || 0, er: parseIntSafe(s.earnedRuns),
          h: parseIntSafe(s.hits), k: parseIntSafe(s.strikeOuts), bb: parseIntSafe(s.baseOnBalls),
          hr: parseIntSafe(s.homeRuns),
          result: parseIntSafe(s.wins) > 0 ? "W" : parseIntSafe(s.losses) > 0 ? "L" : "ND",
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return starts.slice(0, count);
  } catch (e) { return []; }
}

// ── Batter's recent stats (last N days) ──────────────────────────────────────
async function getBatterRecentStats(batterId, days = 15) {
  if (!batterId) return null;
  const yr = new Date().getFullYear();
  try {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days);
    const formatDate = d => d.toISOString().split("T")[0];
    const data = await mlbGet(`/people/${batterId}/stats`, {
      stats: "byDateRange", group: "hitting", season: yr,
      startDate: formatDate(startDate), endDate: formatDate(today),
    });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    const ab = parseIntSafe(s.atBats);
    if (ab === 0) return null;
    return {
      days, atBats: ab, hits: parseIntSafe(s.hits), homeRuns: parseIntSafe(s.homeRuns),
      rbi: parseIntSafe(s.rbi), walks: parseIntSafe(s.baseOnBalls), strikeouts: parseIntSafe(s.strikeOuts),
      avg: parseFloat(s.avg) || null, obp: parseFloat(s.obp) || null,
      slg: parseFloat(s.slg) || null, ops: parseFloat(s.ops) || null,
      hrPerAB: parseIntSafe(s.homeRuns) / ab,
    };
  } catch (e) { return null; }
}

// ── Statcast batting stats (returns null — endpoint unsupported, kept for compat) ──
async function getBatterStatcast(batterId, season) {
  if (!batterId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/people/${batterId}/stats`, { stats: "statcast", group: "hitting", season: yr });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    return {
      avgExitVelocity: parseFloat(s.avgExitVelocity) || null, maxExitVelocity: parseFloat(s.maxExitVelocity) || null,
      avgLaunchAngle: parseFloat(s.avgLaunchAngle) || null, barrels: parseIntSafe(s.barrels),
      barrelRate: parseFloat(s.barrelRate) || null, hardHitRate: parseFloat(s.hardHitRate) || null,
      sweetSpotRate: parseFloat(s.sweetSpotRate) || null, xwOBA: parseFloat(s.xwOBA) || null,
    };
  } catch (e) { return null; }
}

// ── Team handedness splits (offense vs LHP / vs RHP) ─────────────────────────
async function getTeamHandednessSplits(teamId, season) {
  if (!teamId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/teams/${teamId}/stats`, {
      stats: "statSplits", group: "hitting", season: yr, sitCodes: "vl,vr",
    });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    let vsLHP = null, vsRHP = null;
    for (const sp of splits) {
      const code = sp.split?.code;
      const desc = (sp.split?.description || "").toLowerCase();
      const s = sp.stat || {};
      const parsed = {
        avg: parseFloat(s.avg) || null, obp: parseFloat(s.obp) || null,
        slg: parseFloat(s.slg) || null, ops: parseFloat(s.ops) || null,
        atBats: parseIntSafe(s.atBats), homeRuns: parseIntSafe(s.homeRuns),
      };
      if (code === "vl" || desc.includes("left")) vsLHP = parsed;
      else if (code === "vr" || desc.includes("right")) vsRHP = parsed;
    }
    if (!vsLHP && !vsRHP) return null;
    return { vsLHP, vsRHP };
  } catch (e) { return null; }
}

// ── Team bullpen (reliever-only) stats ───────────────────────────────────────
async function getTeamBullpenStats(teamId, season) {
  if (!teamId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/teams/${teamId}/stats`, {
      stats: "statSplits", group: "pitching", season: yr, sitCodes: "rp",
    });
    const splits = data.stats?.[0]?.splits || [];
    let relief = null;
    for (const sp of splits) {
      const desc = (sp.split?.description || "").toLowerCase();
      const code = sp.split?.code;
      if (code === "rp" || desc.includes("reliev")) {
        const s = sp.stat || {};
        relief = {
          era: parseFloat(s.era) || null, whip: parseFloat(s.whip) || null,
          inningsPitched: parseFloat(s.inningsPitched) || 0,
          homeRunsPer9: parseFloat(s.homeRunsPer9) || null,
          strikeoutsPer9: parseFloat(s.strikeoutsPer9Inn) || null,
        };
      }
    }
    return relief;
  } catch (e) { return null; }
}

// ── Bullpen recent USAGE / fatigue (last N days) ────────────────────────────
// Season bullpen ERA can't tell you the pen is gassed TONIGHT. This reads recent
// workload: for each of the team's FINAL games over the last `days`, relief outs =
// total team pitching outs MINUS the starter's outs (starter = first pitcher used).
// Outs (not float "innings") are summed so 6.1 + 0.2 = 7.0, never 6.3. Flags any
// reliever who appeared on 2+ of the recent dates (a back-to-back / heavy-use tell).
// READ-ONLY and null-safe.
function ipToOuts(ip) {
  if (ip == null) return 0;
  const [w, f] = String(ip).split(".");
  return (parseInt(w, 10) || 0) * 3 + (parseInt(f, 10) || 0);
}
function outsToIp(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}
// Caches: prior-date schedules and final box scores are immutable, so cache them
// for the process lifetime; usage results cache per team per day. This keeps the
// edges hot path cheap — the day's first compute fills the cache, the rest are free.
const _pastScheduleCache = new Map();  // date -> games[]
const _boxscoreCache = new Map();      // gamePk -> boxscore json
const _bullpenUsageCache = new Map();  // `${tid}:${date}:${days}` -> usage
async function _scheduleForPastDate(date) {
  if (_pastScheduleCache.has(date)) return _pastScheduleCache.get(date);
  let games = [];
  try { games = await getScheduleForDate(date); } catch (_) { games = []; }
  _pastScheduleCache.set(date, games);
  return games;
}
async function _boxscoreCached(gamePk) {
  if (_boxscoreCache.has(gamePk)) return _boxscoreCache.get(gamePk);
  let box = null;
  try { box = await mlbGet(`/game/${gamePk}/boxscore`); } catch (_) { box = null; }
  _boxscoreCache.set(gamePk, box);
  return box;
}
async function getTeamBullpenUsage(teamId, days = 3) {
  if (!teamId) return null;
  const tid = Number(teamId);
  const cacheKey = `${tid}:${getEasternDate(0)}:${days}`;
  if (_bullpenUsageCache.has(cacheKey)) return _bullpenUsageCache.get(cacheKey);
  const recent = [];
  for (let d = 1; d <= days; d++) {
    const date = getEasternDate(-d);
    const games = await _scheduleForPastDate(date);
    for (const g of games) {
      if (g.status !== "final") continue;
      const isAway = Number(g.awayId) === tid;
      const isHome = Number(g.homeId) === tid;
      if (!isAway && !isHome) continue;
      recent.push({ date, gamePk: g.id, side: isAway ? "away" : "home", opponent: isAway ? g.home : g.away });
    }
  }
  const gamesOut = [];
  let reliefOutsTotal = 0;
  const relieverDays = new Map();
  for (const r of recent) {
    const box = await _boxscoreCached(r.gamePk);
    const team = box && box.teams && box.teams[r.side];
    const order = team && Array.isArray(team.pitchers) ? team.pitchers : [];
    if (order.length === 0) continue;
    let reliefOuts = 0;
    const relievers = [];
    for (let i = 1; i < order.length; i++) {
      const pl = team.players && team.players[`ID${order[i]}`];
      const name = pl && pl.person && pl.person.fullName;
      reliefOuts += ipToOuts(pl && pl.stats && pl.stats.pitching && pl.stats.pitching.inningsPitched);
      if (name) {
        relievers.push(name);
        if (!relieverDays.has(name)) relieverDays.set(name, new Set());
        relieverDays.get(name).add(r.date);
      }
    }
    reliefOutsTotal += reliefOuts;
    gamesOut.push({ date: r.date, opponent: r.opponent, reliefIP: outsToIp(reliefOuts), reliefOuts, relievers });
  }
  const multiDay = [...relieverDays.entries()].filter(([, set]) => set.size >= 2).map(([n]) => n);
  const result = {
    teamId: tid, days, gamesInWindow: gamesOut.length,
    reliefOutsTotal, reliefIPTotal: outsToIp(reliefOutsTotal),
    distinctRelievers: relieverDays.size, relieversUsedMultipleDays: multiDay,
    games: gamesOut,
  };
  _bullpenUsageCache.set(cacheKey, result);
  return result;
}

// ── Pitcher throwing hand ("L" or "R") ──────────────────────────────────────
async function getPitcherHand(pitcherId) {
  if (!pitcherId) return null;
  try {
    const data = await mlbGet(`/people/${pitcherId}`);
    const person = data.people?.[0] || {};
    return person.pitchHand?.code || null;
  } catch (e) { return null; }
}

// ── Projected starting lineup (kept, unused) ─────────────────────────────────
async function getProjectedLineup(teamId) {
  if (!teamId) return [];
  try {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 7);
    const formatDate = d => d.toISOString().split("T")[0];
    const scheduleData = await mlbGet(`/schedule`, {
      sportId: 1, teamId, startDate: formatDate(startDate), endDate: formatDate(today),
    });
    let lineup = [], mostRecentGameId = null;
    for (const block of (scheduleData.dates || []).reverse()) {
      for (const g of (block.games || []).reverse()) {
        if (g.status?.abstractGameState === "Final") { mostRecentGameId = g.gamePk; break; }
      }
      if (mostRecentGameId) break;
    }
    if (mostRecentGameId) {
      try {
        const boxData = await mlbGet(`/game/${mostRecentGameId}/boxscore`);
        const teams = boxData.teams || {};
        let teamBox = null;
        if (teams.away?.team?.id === teamId) teamBox = teams.away;
        else if (teams.home?.team?.id === teamId) teamBox = teams.home;
        if (teamBox?.battingOrder?.length > 0) {
          lineup = teamBox.battingOrder.slice(0, 9).map(playerId => {
            const player = teamBox.players?.[`ID${playerId}`];
            return { id: playerId, name: player?.person?.fullName || "Unknown", position: player?.position?.abbreviation || "" };
          }).filter(p => p.id);
        }
      } catch (e) {}
    }
    if (lineup.length === 0) {
      const roster = await getTeamRoster(teamId);
      lineup = roster.slice(0, 9);
    }
    return lineup;
  } catch (e) { return []; }
}

// ── Confirmed/projected lineup for a SPECIFIC game ───────────────────────────
// Tier 1: confirmed lineup for THIS game (MLB populates boxscore.battingOrder
//         ~hours before first pitch once the card is posted).
// Tier 2: recent-game lineup (getProjectedLineup) as a proxy.
// Returns { lineup:[{id,name,position}], source:"confirmed"|"recent"|"none" }.
async function getTeamLineup(teamId, gamePk) {
  if (!teamId) return { lineup: [], source: "none" };

  // Tier 1 — confirmed lineup for this game.
  if (gamePk) {
    try {
      const boxData = await mlbGet(`/game/${gamePk}/boxscore`);
      const teams = boxData.teams || {};
      let teamBox = null;
      if (teams.away?.team?.id === teamId) teamBox = teams.away;
      else if (teams.home?.team?.id === teamId) teamBox = teams.home;
      if (teamBox?.battingOrder?.length > 0) {
        const lineup = teamBox.battingOrder.slice(0, 9).map(pid => {
          const player = teamBox.players?.[`ID${pid}`];
          return { id: pid, name: player?.person?.fullName || "Unknown", position: player?.position?.abbreviation || "" };
        }).filter(p => p.id);
        if (lineup.length >= 8) return { lineup, source: "confirmed" }; // full card posted
      }
    } catch (e) { /* fall through to proxy */ }
  }

  // Tier 2 — recent-game lineup proxy.
  try {
    const lineup = await getProjectedLineup(teamId);
    if (lineup && lineup.length >= 8) return { lineup, source: "recent" };
  } catch (e) { /* fall through */ }

  return { lineup: [], source: "none" };
}

// PURE-ish: given a lineup, compute its combined offensive profile from each
// hitter's SEASON stats. Returns { ops, hrPerPA, batters } or null if too few
// resolved. Averages are simple (could be PA-weighted later). Used to replace
// full-team OPS with the OPS of who's ACTUALLY playing.
async function getLineupOffense(lineup) {
  if (!lineup || lineup.length < 8) return null;
  const stats = await Promise.all(lineup.map(p => getBatterSeasonStats(p.id).catch(() => null)));
  // Surface each hitter's season line on the lineup objects (used for the
  // batting-order display). These were already fetched for the OPS calc — we
  // just stop throwing them away. No extra API calls.
  lineup.forEach((p, idx) => {
    const s = stats[idx];
    p.season = s ? { avg: s.avg, homeRuns: s.homeRuns, ops: s.ops } : null;
  });
  const valid = stats.filter(s => s && s.ops != null && s.plateAppearances >= 20);
  if (valid.length < 6) return null; // not enough resolved hitters to trust it
  const avgOps = valid.reduce((sum, s) => sum + s.ops, 0) / valid.length;
  const avgHrPerPA = valid.reduce((sum, s) => sum + (s.hrPerPA || 0), 0) / valid.length;
  return {
    ops: Math.round(avgOps * 1000) / 1000,
    hrPerPA: Math.round(avgHrPerPA * 10000) / 10000,
    batters: valid.length,
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────
function parseIntSafe(v) {
  if (v == null || v === "") return 0;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

// ── Exports ───────────────────────────────────────────────────────────────────
// ── LIVE game feed (for the in-game win-expectancy model) ────────────────────
// Pulls /game/{gamePk}/feed/live and extracts the live state the live model
// needs: inning, half, outs, base runners, score, and the pitcher CURRENTLY on
// the mound for each side (with their season ERA already resolved).
async function getLiveGameState(gamePk) {
  if (!gamePk) return null;
  try {
    // NOTE: the live feed lives on the v1.1 API, not v1. MLB_BASE is v1 (used for
    // schedule/stats), so we build the v1.1 URL explicitly here.
    const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
    const resp = await axios.get(feedUrl, { timeout: 10000 });
    const data = resp.data;
    const ls = data.liveData?.linescore;
    const plays = data.liveData?.plays;
    const boxscore = data.liveData?.boxscore;
    if (!ls || ls.currentInning == null) return null;

    const half = (ls.inningHalf || ls.inningState || "").toLowerCase().startsWith("b") ? "bottom" : "top";
    const outs = ls.outs ?? 0;
    const offense = ls.offense || {};
    let baseState = 0;
    if (offense.first) baseState |= 1;
    if (offense.second) baseState |= 2;
    if (offense.third) baseState |= 4;

    const homeScore = ls.teams?.home?.runs ?? 0;
    const awayScore = ls.teams?.away?.runs ?? 0;

    // Current pitcher: defense.pitcher is whoever is on the mound right now.
    const currentPitcherId = ls.defense?.pitcher?.id ?? null;
    // The pitching team is the side NOT batting.
    const pitchingSide = half === "top" ? "home" : "away";

    // Resolve current pitcher's season ERA (cheap, cached upstream by season call).
    let currentPitcherEra = null;
    if (currentPitcherId) {
      const ps = await getPitcherSeasonStats(currentPitcherId).catch(() => null);
      currentPitcherEra = ps?.era ?? null;
    }

    return {
      gamePk: String(gamePk),
      inning: ls.currentInning,
      half,
      outs,
      baseState,
      homeScore,
      awayScore,
      pitchingSide,
      currentPitcherId,
      currentPitcherEra,
      abstractState: data.gameData?.status?.abstractGameState || null,
    };
  } catch (e) {
    return null;
  }
}

// Authoritative status + final score from the full feed/live feed (v1.1). This
// carries the real detailedState AND the score even when the thin /linescore
// endpoint is hollow. Returns nulls (never 0) when a value is genuinely absent,
// so callers can tell "0-0" apart from "no score posted".
async function getGameStatusAndScore(gamePk) {
  try {
    const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
    const { data } = await axios.get(feedUrl, { timeout: 8000 });
    const st = (data && data.gameData && data.gameData.status) || {};
    const ls = data && data.liveData && data.liveData.linescore;
    const box = data && data.liveData && data.liveData.boxscore;
    let battersWithStats = 0;
    if (box && box.teams) {
      for (const side of ["home", "away"]) {
        const players = (box.teams[side] && box.teams[side].players) || {};
        for (const k of Object.keys(players)) {
          const b = players[k] && players[k].stats && players[k].stats.batting;
          if (b && b.atBats != null) battersWithStats++;
        }
      }
    }
    return {
      ok: true,
      abstractGameState: st.abstractGameState ?? null,
      detailedState: st.detailedState ?? null,
      codedGameState: st.codedGameState ?? null,
      homeRuns: (ls && ls.teams && ls.teams.home && ls.teams.home.runs != null) ? ls.teams.home.runs : null,
      awayRuns: (ls && ls.teams && ls.teams.away && ls.teams.away.runs != null) ? ls.teams.away.runs : null,
      battersWithStats,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Normalize a player name for matching: strip accents, lowercase, drop
// punctuation (Jr., periods), collapse spaces. "José Ramírez Jr." -> "jose ramirez jr".
function normPlayerName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Per-game home runs by player, from the official boxscore.
//   GET /game/{gamePk}/boxscore -> teams.{home,away}.players["ID#"].stats.batting.homeRuns
// Returns { ok, hr } where hr is a Map(normalizedName -> HR count for the game).
// FAILS SAFE: ok:false whenever we can't confidently read batting data, so the
// caller leaves a pick UNGRADED rather than ever recording a false loss.
async function getGameHRHitters(gamePk) {
  try {
    const data = await mlbGet(`/game/${gamePk}/boxscore`);
    const teams = data && data.teams;
    if (!teams || !teams.home || !teams.away) return { ok: false, hr: null };
    const hr = new Map();
    let battingObjectsSeen = 0;
    for (const side of ["home", "away"]) {
      const players = teams[side] && teams[side].players;
      if (!players) continue;
      for (const key of Object.keys(players)) {
        const pl = players[key];
        const name = pl && pl.person && pl.person.fullName;
        const batting = pl && pl.stats && pl.stats.batting;
        if (!name) continue;
        if (batting && typeof batting === "object") {
          battingObjectsSeen++;
          hr.set(normPlayerName(name), parseIntSafe(batting.homeRuns) || 0);
        }
      }
    }
    // If NO player had a batting stats object, the shape is wrong/unavailable —
    // don't grade anything off it (guards against a silent field-path change).
    if (battingObjectsSeen === 0) return { ok: false, hr: null };
    return { ok: true, hr };
  } catch (e) {
    return { ok: false, hr: null };
  }
}

// Per-pitcher strikeouts from a finished game's box score — grades K props.
// Mirrors getGameHRHitters but reads pitching.strikeOuts; keyed by normPlayerName
// so pick selections (by pitcher name) match. Guards against a field-path change.
async function getGamePitcherStrikeouts(gamePk) {
  try {
    const data = await mlbGet(`/game/${gamePk}/boxscore`);
    const teams = data && data.teams;
    if (!teams || !teams.home || !teams.away) return { ok: false, ks: null };
    const ks = new Map();
    let pitchingObjectsSeen = 0;
    for (const side of ["home", "away"]) {
      const players = teams[side] && teams[side].players;
      if (!players) continue;
      for (const key of Object.keys(players)) {
        const pl = players[key];
        const name = pl && pl.person && pl.person.fullName;
        const pitching = pl && pl.stats && pl.stats.pitching;
        if (!name) continue;
        if (pitching && typeof pitching === "object" && pitching.strikeOuts != null) {
          pitchingObjectsSeen++;
          ks.set(normPlayerName(name), parseIntSafe(pitching.strikeOuts) || 0);
        }
      }
    }
    if (pitchingObjectsSeen === 0) return { ok: false, ks: null };
    return { ok: true, ks };
  } catch (e) {
    return { ok: false, ks: null };
  }
}

// Per-batter hits from a finished game's box score — grades hits props.
// Mirrors getGameHRHitters but reads batting.hits.
async function getGameBatterHits(gamePk) {
  try {
    const data = await mlbGet(`/game/${gamePk}/boxscore`);
    const teams = data && data.teams;
    if (!teams || !teams.home || !teams.away) return { ok: false, hits: null };
    const hits = new Map();
    let battingObjectsSeen = 0;
    for (const side of ["home", "away"]) {
      const players = teams[side] && teams[side].players;
      if (!players) continue;
      for (const key of Object.keys(players)) {
        const pl = players[key];
        const name = pl && pl.person && pl.person.fullName;
        const batting = pl && pl.stats && pl.stats.batting;
        if (!name) continue;
        if (batting && typeof batting === "object" && batting.hits != null) {
          battingObjectsSeen++;
          hits.set(normPlayerName(name), parseIntSafe(batting.hits) || 0);
        }
      }
    }
    if (battingObjectsSeen === 0) return { ok: false, hits: null };
    return { ok: true, hits };
  } catch (e) {
    return { ok: false, hits: null };
  }
}

module.exports = {
  getEasternDate, getScheduleForDate,
  getGameHRHitters,
  getGamePitcherStrikeouts,
  getGameBatterHits, normPlayerName,
  getPitcherSeasonStats, getBatterSeasonStats,
  getTeamSeasonStats, getTeamPitchingStats, getTeamRoster, getLinescore,
  getTeamHittingAsOf, getPitcherEraAsOf, getTeamPitchingAsOf,
  getParkHRFactor, getParkRunFactor,
  getBatterVsPitcherHistory, getPitcherRecentStarts, getBatterRecentStats, getBatterStatcast,
  getProjectedLineup,
  getTeamLineup, getLineupOffense,
  getLiveGameState,
  getGameStatusAndScore,
  getTeamHandednessSplits, getTeamBullpenStats, getTeamBullpenUsage, getPitcherHand,
};
