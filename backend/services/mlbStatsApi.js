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
};
function getParkHRFactor(venueName) { return PARK_HR_FACTOR[venueName] ?? 1.0; }
function getParkRunFactor(venueName) { return PARK_RUN_FACTOR[venueName] ?? 1.0; }

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

module.exports = {
  getEasternDate, getScheduleForDate,
  getGameHRHitters, normPlayerName,
  getPitcherSeasonStats, getBatterSeasonStats,
  getTeamSeasonStats, getTeamPitchingStats, getTeamRoster, getLinescore,
  getParkHRFactor, getParkRunFactor,
  getBatterVsPitcherHistory, getPitcherRecentStarts, getBatterRecentStats, getBatterStatcast,
  getProjectedLineup,
  getTeamLineup, getLineupOffense,
  getLiveGameState,
  getTeamHandednessSplits, getTeamBullpenStats, getPitcherHand,
};
