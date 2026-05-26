// Edges model v0.1 — research-grade MLB betting projections
//
// PHILOSOPHY: simple, transparent, defensible math on real public data.
// Not a market-beating model — just an honest one. Inputs are season-to-date
// stats from MLB Stats API combined with public park factors.
//
// MARKETS:
//   1. Moneyline — who wins?
//   2. Totals — over/under runs?
//   3. Home Run props — does player hit a HR?

const {
  getPitcherSeasonStats,
  getBatterSeasonStats,
  getTeamSeasonStats,
  getTeamPitchingStats,
  getTeamRoster,
} = require("./mlbStatsApi");

const { americanToImpliedProb } = require("./oddsApi");

// League averages (2025 MLB) — used as fallbacks when stats are missing
const LEAGUE_AVG = {
  era: 4.30,
  runsPerGame: 4.40,
  hrPerPA: 0.032,  // ~3.2% of plate appearances result in HR
  homeRunsPer9: 1.20,
  iso: 0.155,
};

// ── 1. MONEYLINE MODEL ────────────────────────────────────────────────────────
//
// team_strength = team_offense_factor * pitcher_factor * bullpen_factor
// win_prob_home = home_strength / (home_strength + away_strength) * home_field_bonus

function calculateMoneylineProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, awayTeamPit, homeTeamPit) {
  // Pitcher quality: lower ERA = better. Normalize around league avg.
  const awayPitcherFactor = awayPitcher?.era
    ? LEAGUE_AVG.era / Math.max(awayPitcher.era, 1.5)
    : 1.0;
  const homePitcherFactor = homePitcher?.era
    ? LEAGUE_AVG.era / Math.max(homePitcher.era, 1.5)
    : 1.0;

  // Team offense quality: OPS relative to ~.720 league avg
  const awayOffenseFactor = awayTeamHit?.ops ? awayTeamHit.ops / 0.720 : 1.0;
  const homeOffenseFactor = homeTeamHit?.ops ? homeTeamHit.ops / 0.720 : 1.0;

  // Bullpen: team ERA - starter ERA approximated by team ERA
  const awayBullpenFactor = awayTeamPit?.era
    ? LEAGUE_AVG.era / Math.max(awayTeamPit.era, 2.5)
    : 1.0;
  const homeBullpenFactor = homeTeamPit?.era
    ? LEAGUE_AVG.era / Math.max(homeTeamPit.era, 2.5)
    : 1.0;

  // Combined strength
  // Weights: starting pitcher 40%, offense 40%, bullpen 20%
  const awayStrength =
    Math.pow(awayPitcherFactor, 0.40) *
    Math.pow(awayOffenseFactor, 0.40) *
    Math.pow(awayBullpenFactor, 0.20);

  const homeStrength =
    Math.pow(homePitcherFactor, 0.40) *
    Math.pow(homeOffenseFactor, 0.40) *
    Math.pow(homeBullpenFactor, 0.20);

  // Home field advantage: ~54% historical for home team in MLB
  const HOME_BOOST = 1.04;
  const adjHomeStrength = homeStrength * HOME_BOOST;

  const homeWinProb = adjHomeStrength / (adjHomeStrength + awayStrength);
  const awayWinProb = 1 - homeWinProb;

  return {
    awayWinProb: round3(awayWinProb),
    homeWinProb: round3(homeWinProb),
  };
}

// ── 2. TOTALS MODEL ───────────────────────────────────────────────────────────
//
// projected_total = (away_runs_per_game + home_runs_per_game) / 2
//                 + pitcher_adjustment
//                 + park_run_factor

function calculateTotalProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit) {
  // Base: average of both teams' season runs-per-game
  const awayRPG = awayTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame;
  const homeRPG = homeTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame;
  const baseTotal = awayRPG + homeRPG;

  // Pitcher adjustment: avg of both starters' ERA vs league avg
  // Each 1.0 ERA delta worth ~0.5 runs in projection
  const awayPitcherERA = awayPitcher?.era ?? LEAGUE_AVG.era;
  const homePitcherERA = homePitcher?.era ?? LEAGUE_AVG.era;
  const pitcherAdj = ((awayPitcherERA + homePitcherERA) / 2 - LEAGUE_AVG.era) * 0.40;

  // Park factor
  const parkAdj = (game.parkRunFactor - 1.0) * baseTotal;

  const projected = baseTotal + pitcherAdj + parkAdj;

  return {
    projectedTotal: round2(projected),
    breakdown: {
      base: round2(baseTotal),
      pitcherAdj: round2(pitcherAdj),
      parkAdj: round2(parkAdj),
    },
  };
}

// ── 3. HOME RUN PROP MODEL ────────────────────────────────────────────────────
//
// hr_prob = batter_HR_per_PA * expected_PA * pitcher_factor * park_factor

function calculateHRProbability(batterStats, opposingPitcherStats, game) {
  if (!batterStats) return null;

  // Base rate: batter's HR per PA
  const baseHRRate = batterStats.hrPerPA ?? LEAGUE_AVG.hrPerPA;
  if (baseHRRate === 0) return null;

  // Expected plate appearances in a game (typical starter gets 4)
  const expectedPA = 4.1;

  // Pitcher factor: opposing pitcher's HR/9 vs league avg
  const pitcherHR9 = opposingPitcherStats?.homeRunsPer9 ?? LEAGUE_AVG.homeRunsPer9;
  const pitcherFactor = pitcherHR9 / LEAGUE_AVG.homeRunsPer9;

  // Park factor for HRs
  const parkFactor = game.parkHRFactor || 1.0;

  // ISO adjustment: power hitters get a small bonus on top of HR/PA
  const isoFactor = batterStats.iso
    ? (batterStats.iso / LEAGUE_AVG.iso) ** 0.5  // dampened — already in hrPerPA
    : 1.0;

  // Probability of AT LEAST one HR
  // Per-PA HR probability adjusted by pitcher + park + iso
  const perPAProb = Math.min(0.15, baseHRRate * pitcherFactor * parkFactor * isoFactor);
  // 1 - probability of zero HRs across expectedPA appearances
  const noHRProb = Math.pow(1 - perPAProb, expectedPA);
  const hrProb = 1 - noHRProb;

  return round3(hrProb);
}

// ── EDGE CALCULATION ──────────────────────────────────────────────────────────
//
// edge_pct = model_prob - implied_prob
// e.g. model says 60% win, market says -120 (implied 54.5%), edge = +5.5%

function calculateEdge(modelProb, americanOdds) {
  if (modelProb == null || americanOdds == null) return null;
  const implied = americanToImpliedProb(americanOdds);
  if (implied == null) return null;
  return round3(modelProb - implied);
}

function rateConfidence(edge) {
  if (edge == null) return "NEUTRAL";
  if (edge >= 0.05) return "HIGH";
  if (edge >= 0.025) return "MEDIUM";
  if (edge >= 0.005) return "LOW";
  return "NEUTRAL";
}

// ── ORCHESTRATION: process the full slate ─────────────────────────────────────
//
// For each game:
//   1. Fetch both starting pitchers' stats
//   2. Fetch both teams' season stats
//   3. Compute moneyline + totals projections
//   4. Match to sportsbook odds → edges
//
// For HR props (top N games only, to limit API quota):
//   1. Fetch each team's batters
//   2. Compute HR probability for each
//   3. Match to sportsbook HR prop odds → edges

const MAX_HR_GAMES = 5; // Limit to conserve quota

async function calculateGameEdges(game, oddsForGame) {
  const [awayPitcher, homePitcher, awayTeamHit, homeTeamHit, awayTeamPit, homeTeamPit] = await Promise.all([
    game.awayProbable ? getPitcherSeasonStats(game.awayProbable.id) : null,
    game.homeProbable ? getPitcherSeasonStats(game.homeProbable.id) : null,
    getTeamSeasonStats(game.awayId),
    getTeamSeasonStats(game.homeId),
    getTeamPitchingStats(game.awayId),
    getTeamPitchingStats(game.homeId),
  ]);

  const ml = calculateMoneylineProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, awayTeamPit, homeTeamPit);
  const totals = calculateTotalProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit);

  // Match odds
  const odds = oddsForGame || { h2h: {}, totals: {} };
  const awayML = odds.h2h?.away;
  const homeML = odds.h2h?.home;
  const totalLine = odds.totals?.line;
  const overOdds = odds.totals?.over;
  const underOdds = odds.totals?.under;

  const awayEdge = calculateEdge(ml.awayWinProb, awayML);
  const homeEdge = calculateEdge(ml.homeWinProb, homeML);

  // Totals edge: project over/under prob from projected_total vs line
  let overProb = null;
  let underProb = null;
  if (totalLine != null) {
    // Simple bell-curve approximation: ~3 run standard deviation
    overProb = sigmoid((totals.projectedTotal - totalLine) / 3.0);
    underProb = 1 - overProb;
  }
  const overEdge = calculateEdge(overProb, overOdds);
  const underEdge = calculateEdge(underProb, underOdds);

  return {
    game: {
      id: game.id,
      away: game.away,
      home: game.home,
      awayAbbr: game.awayAbbr,
      homeAbbr: game.homeAbbr,
      time: game.time,
      venue: game.venue,
      parkHRFactor: game.parkHRFactor,
      parkRunFactor: game.parkRunFactor,
    },
    pitchers: {
      away: game.awayProbable ? { ...game.awayProbable, stats: awayPitcher } : null,
      home: game.homeProbable ? { ...game.homeProbable, stats: homePitcher } : null,
    },
    moneyline: {
      awayWinProb: ml.awayWinProb,
      homeWinProb: ml.homeWinProb,
      awayOdds: awayML,
      homeOdds: homeML,
      awayEdge,
      homeEdge,
      awayConfidence: rateConfidence(awayEdge),
      homeConfidence: rateConfidence(homeEdge),
    },
    totals: {
      projected: totals.projectedTotal,
      breakdown: totals.breakdown,
      line: totalLine,
      overOdds,
      underOdds,
      overProb: overProb != null ? round3(overProb) : null,
      underProb: underProb != null ? round3(underProb) : null,
      overEdge,
      underEdge,
      overConfidence: rateConfidence(overEdge),
      underConfidence: rateConfidence(underEdge),
    },
  };
}

async function calculateHRPropEdges(games, hrOddsByEvent) {
  // Process top MAX_HR_GAMES games for HR props
  const targetGames = games.slice(0, MAX_HR_GAMES);
  const allHRProps = [];

  for (const game of targetGames) {
    // Match game to odds by team names
    const eventId = findEventIdForGame(game, hrOddsByEvent);
    const hrOdds = eventId ? hrOddsByEvent[eventId] : null;
    if (!hrOdds || hrOdds.length === 0) continue;

    // For each player offered a HR prop, find their stats and the opposing pitcher
    for (const propOdds of hrOdds) {
      const batter = await findPlayerByName(propOdds.player, [game.awayId, game.homeId]);
      if (!batter) continue;

      // Which team is the batter on? The opposing pitcher is the other team's starter.
      const onAwayTeam = batter.teamId === game.awayId;
      const opposingPitcherProbable = onAwayTeam ? game.homeProbable : game.awayProbable;
      const opposingPitcherStats = opposingPitcherProbable
        ? await getPitcherSeasonStats(opposingPitcherProbable.id)
        : null;

      const batterStats = await getBatterSeasonStats(batter.id);
      const hrProb = calculateHRProbability(batterStats, opposingPitcherStats, game);
      if (hrProb == null) continue;

      const edge = calculateEdge(hrProb, propOdds.price);
      allHRProps.push({
        player: propOdds.player,
        team: onAwayTeam ? game.awayAbbr : game.homeAbbr,
        opposingPitcher: opposingPitcherProbable?.name,
        game: `${game.awayAbbr} @ ${game.homeAbbr}`,
        venue: game.venue,
        hrProb,
        odds: propOdds.price,
        book: propOdds.book,
        edge,
        confidence: rateConfidence(edge),
        batterStats: batterStats ? {
          hr: batterStats.homeRuns,
          iso: round3(batterStats.iso),
          slg: batterStats.slg,
          hrPerPA: round3(batterStats.hrPerPA),
        } : null,
        parkHRFactor: game.parkHRFactor,
        opposingPitcherHR9: opposingPitcherStats?.homeRunsPer9 ?? null,
      });
    }
  }

  // Sort by edge desc
  return allHRProps
    .filter(p => p.edge != null && p.edge > -0.05) // Drop bad bets
    .sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
}

// Match game to odds event by team names (Odds API uses different team string formats)
function findEventIdForGame(game, hrOddsByEvent) {
  // hrOddsByEvent is keyed by event ID. We need the main odds events list to map.
  // For now, this is wired through the routes layer which passes a normalized lookup.
  return game._oddsEventId || null;
}

// Find player by name in given teams' rosters
const rosterCache = new Map();
async function findPlayerByName(playerName, teamIds) {
  if (!playerName) return null;
  const normalized = playerName.toLowerCase().trim();
  for (const teamId of teamIds) {
    if (!teamId) continue;
    if (!rosterCache.has(teamId)) {
      rosterCache.set(teamId, await getTeamRoster(teamId));
    }
    const roster = rosterCache.get(teamId);
    const match = roster.find(p => p.name?.toLowerCase().trim() === normalized);
    if (match) return { ...match, teamId };
    // Try last-name match as fallback (e.g. "Aaron Judge" vs "Judge")
    const lastName = normalized.split(" ").pop();
    const lnMatch = roster.find(p => p.name?.toLowerCase().endsWith(lastName));
    if (lnMatch) return { ...lnMatch, teamId };
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

module.exports = {
  calculateGameEdges,
  calculateHRPropEdges,
  rateConfidence,
  calculateEdge,
  LEAGUE_AVG,
};
