// MLB Stats API client (statsapi.mlb.com) — free, official, no key required
// Docs: https://github.com/toddrob99/MLB-StatsAPI/wiki

const axios = require("axios");

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

// ── Static lookup tables ──────────────────────────────────────────────────────

// Ballpark HR factor — empirical multiplier, 1.0 = neutral, >1 = HR-friendly
// Sources: Statcast park factors, FanGraphs, public research
const PARK_HR_FACTOR = {
  "Coors Field": 1.31,
  "Great American Ball Park": 1.22,
  "Yankee Stadium": 1.18,
  "Citizens Bank Park": 1.14,
  "Globe Life Field": 1.11,
  "Truist Park": 1.08,
  "Wrigley Field": 1.07,
  "Minute Maid Park": 1.06,
  "Target Field": 1.05,
  "Rogers Centre": 1.05,
  "American Family Field": 1.04,
  "Citi Field": 1.03,
  "Dodger Stadium": 1.02,
  "Chase Field": 1.02,
  "Angel Stadium": 1.01,
  "PNC Park": 1.00,
  "Progressive Field": 0.99,
  "Comerica Park": 0.99,
  "Kauffman Stadium": 0.97,
  "Petco Park": 0.95,
  "Busch Stadium": 0.94,
  "Fenway Park": 0.94,
  "Camden Yards": 0.93,
  "Tropicana Field": 0.92,
  "Nationals Park": 0.91,
  "T-Mobile Park": 0.90,
  "loanDepot park": 0.88,
  "Oracle Park": 0.85,
  "Oakland Coliseum": 0.84,
  "Sutter Health Park": 1.05, // A's temp home 2026
};

// Run factor: park's overall run-scoring environment
const PARK_RUN_FACTOR = {
  "Coors Field": 1.18,
  "Great American Ball Park": 1.08,
  "Globe Life Field": 1.07,
  "Yankee Stadium": 1.05,
  "Citizens Bank Park": 1.04,
  "Fenway Park": 1.04,
  "Truist Park": 1.03,
  "Wrigley Field": 1.02,
  "Minute Maid Park": 1.02,
  "Rogers Centre": 1.01,
  "American Family Field": 1.01,
  "Citi Field": 1.00,
  "Dodger Stadium": 0.99,
  "Target Field": 0.99,
  "PNC Park": 0.99,
  "Angel Stadium": 0.98,
  "Comerica Park": 0.98,
  "Progressive Field": 0.97,
  "Chase Field": 0.97,
  "Busch Stadium": 0.96,
  "Kauffman Stadium": 0.96,
  "Camden Yards": 0.95,
  "Nationals Park": 0.94,
  "Petco Park": 0.93,
  "Tropicana Field": 0.92,
  "loanDepot park": 0.91,
  "T-Mobile Park": 0.90,
  "Oracle Park": 0.89,
  "Oakland Coliseum": 0.88,
  "Sutter Health Park": 1.02,
};

function getParkHRFactor(venueName) {
  return PARK_HR_FACTOR[venueName] ?? 1.0;
}

function getParkRunFactor(venueName) {
  return PARK_RUN_FACTOR[venueName] ?? 1.0;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function mlbGet(path, params = {}) {
  const res = await axios.get(`${MLB_BASE}${path}`, {
    params,
    timeout: 10000,
  });
  return res.data;
}

// ── Today's slate ─────────────────────────────────────────────────────────────

function getEasternDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function getScheduleForDate(date) {
  // sportId=1 is MLB. hydrate probables + team for pitcher data.
  const data = await mlbGet(`/schedule`, {
    sportId: 1,
    date,
    hydrate: "probablePitcher,team,venue,linescore,gameInfo,weather",
  });

  const games = [];
  for (const dateBlock of data.dates || []) {
    for (const g of dateBlock.games || []) {
      games.push(parseGame(g, date));
    }
  }
  return games;
}

function parseGame(g, date) {
  const away = g.teams?.away;
  const home = g.teams?.home;
  const venue = g.venue?.name || "";
  const status = mapStatus(g.status?.abstractGameState, g.status?.detailedState);

  return {
    id: String(g.gamePk),
    league: "mlb",
    date,
    away: away?.team?.name || "Away",
    home: home?.team?.name || "Home",
    awayAbbr: away?.team?.abbreviation || "",
    homeAbbr: home?.team?.abbreviation || "",
    awayId: away?.team?.id,
    homeId: home?.team?.id,
    awayScore: away?.score ?? null,
    homeScore: home?.score ?? null,
    awayRecord: away?.leagueRecord ? `${away.leagueRecord.wins}-${away.leagueRecord.losses}` : null,
    homeRecord: home?.leagueRecord ? `${home.leagueRecord.wins}-${home.leagueRecord.losses}` : null,
    status,
    inning: g.linescore?.currentInning
      ? `${g.linescore.inningState || ""} ${g.linescore.currentInning}`.trim()
      : null,
    time: new Date(g.gameDate).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }) + " ET",
    venue,
    city: g.venue?.location?.city || "",
    awayProbable: away?.probablePitcher ? {
      id: away.probablePitcher.id,
      name: away.probablePitcher.fullName,
    } : null,
    homeProbable: home?.probablePitcher ? {
      id: home.probablePitcher.id,
      name: home.probablePitcher.fullName,
    } : null,
    parkHRFactor: getParkHRFactor(venue),
    parkRunFactor: getParkRunFactor(venue),
  };
}

function mapStatus(abstractState, detailedState) {
  if (abstractState === "Live") return "live";
  if (abstractState === "Final") return "final";
  if (detailedState === "Postponed") return "postponed";
  if (detailedState === "Cancelled") return "cancelled";
  return "scheduled";
}

// ── Pitcher stats ─────────────────────────────────────────────────────────────

async function getPitcherSeasonStats(playerId, season) {
  if (!playerId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/people/${playerId}/stats`, {
      stats: "season",
      group: "pitching",
      season: yr,
    });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    return {
      gamesStarted: parseIntSafe(s.gamesStarted),
      inningsPitched: parseFloat(s.inningsPitched) || 0,
      era: parseFloat(s.era) || null,
      whip: parseFloat(s.whip) || null,
      strikeoutsPer9: parseFloat(s.strikeoutsPer9Inn) || null,
      walksPer9: parseFloat(s.walksPer9Inn) || null,
      homeRunsPer9: parseFloat(s.homeRunsPer9) || null,
      strikeoutWalkRatio: parseFloat(s.strikeoutWalkRatio) || null,
      battingAvgAgainst: parseFloat(s.avg) || null,
      wins: parseIntSafe(s.wins),
      losses: parseIntSafe(s.losses),
      hits: parseIntSafe(s.hits),
      earnedRuns: parseIntSafe(s.earnedRuns),
      homeRuns: parseIntSafe(s.homeRuns),
      strikeouts: parseIntSafe(s.strikeOuts),
      walks: parseIntSafe(s.baseOnBalls),
    };
  } catch (e) {
    return null;
  }
}

// ── Batter stats ──────────────────────────────────────────────────────────────

async function getBatterSeasonStats(playerId, season) {
  if (!playerId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/people/${playerId}/stats`, {
      stats: "season",
      group: "hitting",
      season: yr,
    });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    return {
      atBats: parseIntSafe(s.atBats),
      plateAppearances: parseIntSafe(s.plateAppearances),
      hits: parseIntSafe(s.hits),
      homeRuns: parseIntSafe(s.homeRuns),
      doubles: parseIntSafe(s.doubles),
      triples: parseIntSafe(s.triples),
      rbi: parseIntSafe(s.rbi),
      walks: parseIntSafe(s.baseOnBalls),
      strikeouts: parseIntSafe(s.strikeOuts),
      avg: parseFloat(s.avg) || null,
      obp: parseFloat(s.obp) || null,
      slg: parseFloat(s.slg) || null,
      ops: parseFloat(s.ops) || null,
      iso: s.slg && s.avg ? parseFloat(s.slg) - parseFloat(s.avg) : null,
      hrPerPA: s.plateAppearances ? parseIntSafe(s.homeRuns) / parseIntSafe(s.plateAppearances) : null,
    };
  } catch (e) {
    return null;
  }
}

// ── Team stats (run-scoring environment, recent form) ─────────────────────────

async function getTeamSeasonStats(teamId, season) {
  if (!teamId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/teams/${teamId}/stats`, {
      stats: "season",
      group: "hitting",
      season: yr,
    });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    const games = parseIntSafe(s.gamesPlayed) || 1;
    return {
      games,
      runs: parseIntSafe(s.runs),
      runsPerGame: parseIntSafe(s.runs) / games,
      avg: parseFloat(s.avg) || null,
      obp: parseFloat(s.obp) || null,
      slg: parseFloat(s.slg) || null,
      ops: parseFloat(s.ops) || null,
      homeRuns: parseIntSafe(s.homeRuns),
      strikeouts: parseIntSafe(s.strikeOuts),
    };
  } catch (e) {
    return null;
  }
}

// Team pitching stats — for runs allowed
async function getTeamPitchingStats(teamId, season) {
  if (!teamId) return null;
  const yr = season || new Date().getFullYear();
  try {
    const data = await mlbGet(`/teams/${teamId}/stats`, {
      stats: "season",
      group: "pitching",
      season: yr,
    });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;
    const s = splits[0].stat || {};
    const games = parseIntSafe(s.gamesPlayed) || 1;
    return {
      games,
      era: parseFloat(s.era) || null,
      whip: parseFloat(s.whip) || null,
      runsAllowed: parseIntSafe(s.runs),
      runsAllowedPerGame: parseIntSafe(s.runs) / games,
      homeRunsAllowed: parseIntSafe(s.homeRuns),
      homeRunsPer9: parseFloat(s.homeRunsPer9) || null,
    };
  } catch (e) {
    return null;
  }
}

// ── Team roster (for HR props — get the lineup) ──────────────────────────────

async function getTeamRoster(teamId) {
  if (!teamId) return [];
  try {
    const data = await mlbGet(`/teams/${teamId}/roster`, {
      rosterType: "active",
    });
    return (data.roster || [])
      .filter(p => p.position?.type === "Hitter" || p.position?.code !== "1")
      .map(p => ({
        id: p.person?.id,
        name: p.person?.fullName,
        position: p.position?.abbreviation,
      }));
  } catch (e) {
    return [];
  }
}

// ── Linescore (for live game detail later) ────────────────────────────────────

async function getLinescore(gamePk) {
  try {
    const data = await mlbGet(`/game/${gamePk}/linescore`);
    return data;
  } catch (e) {
    return null;
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function parseIntSafe(v) {
  if (v == null || v === "") return 0;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getEasternDate,
  getScheduleForDate,
  getPitcherSeasonStats,
  getBatterSeasonStats,
  getTeamSeasonStats,
  getTeamPitchingStats,
  getTeamRoster,
  getLinescore,
  getParkHRFactor,
  getParkRunFactor,
};
