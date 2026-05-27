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
  hrPerPA: 0.032,
  homeRunsPer9: 1.20,
  iso: 0.155,
};

function calculateMoneylineProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, awayTeamPit, homeTeamPit) {
  const awayPitcherFactor = awayPitcher?.era ? LEAGUE_AVG.era / Math.max(awayPitcher.era, 1.5) : 1.0;
  const homePitcherFactor = homePitcher?.era ? LEAGUE_AVG.era / Math.max(homePitcher.era, 1.5) : 1.0;
  const awayOffenseFactor = awayTeamHit?.ops ? awayTeamHit.ops / 0.720 : 1.0;
  const homeOffenseFactor = homeTeamHit?.ops ? homeTeamHit.ops / 0.720 : 1.0;
  const awayBullpenFactor = awayTeamPit?.era ? LEAGUE_AVG.era / Math.max(awayTeamPit.era, 2.5) : 1.0;
  const homeBullpenFactor = homeTeamPit?.era ? LEAGUE_AVG.era / Math.max(homeTeamPit.era, 2.5) : 1.0;

  const awayStrength =
    Math.pow(awayPitcherFactor, 0.40) *
    Math.pow(awayOffenseFactor, 0.40) *
    Math.pow(awayBullpenFactor, 0.20);

  const homeStrength =
    Math.pow(homePitcherFactor, 0.40) *
    Math.pow(homeOffenseFactor, 0.40) *
    Math.pow(homeBullpenFactor, 0.20);

  const HOME_BOOST = 1.04;
  const adjHomeStrength = homeStrength * HOME_BOOST;

  const homeWinProb = adjHomeStrength / (adjHomeStrength + awayStrength);
  const awayWinProb = 1 - homeWinProb;

  return { awayWinProb: round3(awayWinProb), homeWinProb: round3(homeWinProb) };
}

function calculateTotalProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit) {
  const awayRPG = awayTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame;
  const homeRPG = homeTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame;
  const baseTotal = awayRPG + homeRPG;

  const awayPitcherERA = awayPitcher?.era ?? LEAGUE_AVG.era;
  const homePitcherERA = homePitcher?.era ?? LEAGUE_AVG.era;
  const pitcherAdj = ((awayPitcherERA + homePitcherERA) / 2 - LEAGUE_AVG.era) * 0.40;
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

function calculateHRProbability(batterStats, opposingPitcherStats, game) {
  if (!batterStats) return null;

  const baseHRRate = batterStats.hrPerPA ?? LEAGUE_AVG.hrPerPA;
  if (baseHRRate === 0) return null;

  const expectedPA = 4.1;
  const pitcherHR9 = opposingPitcherStats?.homeRunsPer9 ?? LEAGUE_AVG.homeRunsPer9;
  const pitcherFactor = pitcherHR9 / LEAGUE_AVG.homeRunsPer9;
  const parkFactor = game.parkHRFactor || 1.0;
  const isoFactor = batterStats.iso ? (batterStats.iso / LEAGUE_AVG.iso) ** 0.5 : 1.0;

  const perPAProb = Math.min(0.15, baseHRRate * pitcherFactor * parkFactor * isoFactor);
  const noHRProb = Math.pow(1 - perPAProb, expectedPA);
  const hrProb = 1 - noHRProb;

  return round3(hrProb);
}

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

const MAX_HR_GAMES = 5;

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

  const odds = oddsForGame || { h2h: {}, totals: {} };
  const awayML = odds.h2h?.away;
  const homeML = odds.h2h?.home;
  const totalLine = odds.totals?.line;
  const overOdds = odds.totals?.over;
  const underOdds = odds.totals?.under;

  const awayEdge = calculateEdge(ml.awayWinProb, awayML);
  const homeEdge = calculateEdge(ml.homeWinProb, homeML);

  let overProb = null;
  let underProb = null;
  if (totalLine != null) {
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
  const targetGames = games.slice(0, MAX_HR_GAMES);
  const allHRProps = [];

  console.log(`[HRProps] Processing ${targetGames.length} games for HR props`);
  console.log(`[HRProps] hrOddsByEvent keys: ${JSON.stringify(Object.keys(hrOddsByEvent || {}))}`);

  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, hrOddsByEvent);
    const hrOdds = eventId ? hrOddsByEvent[eventId] : null;

    console.log(`[HRProps] Game ${game.awayAbbr}@${game.homeAbbr}: eventId=${eventId}, oddsCount=${hrOdds?.length ?? 0}`);

    if (!hrOdds || hrOdds.length === 0) continue;

    let matchedCount = 0;
    let unmatchedNames = [];

    for (const propOdds of hrOdds) {
      const batter = await findPlayerByName(propOdds.player, [game.awayId, game.homeId]);
      if (!batter) {
        unmatchedNames.push(propOdds.player);
        continue;
      }
      matchedCount++;

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

    console.log(`[HRProps] Game ${game.awayAbbr}@${game.homeAbbr}: matched ${matchedCount}/${hrOdds.length} players`);
    if (unmatchedNames.length > 0) {
      console.log(`[HRProps] Unmatched: ${unmatchedNames.slice(0, 5).join(", ")}${unmatchedNames.length > 5 ? "..." : ""}`);
    }
  }

  console.log(`[HRProps] Final result: ${allHRProps.length} HR prop edges`);

  return allHRProps
    .filter(p => p.edge != null && p.edge > -0.05)
    .sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
}

function findEventIdForGame(game, hrOddsByEvent) {
  return game._oddsEventId || null;
}

const rosterCache = new Map();

function normalizePlayerName(name) {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,'`]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function extractLastName(normalizedName) {
  if (!normalizedName) return "";
  const parts = normalizedName.split(" ");
  return parts[parts.length - 1];
}

async function findPlayerByName(playerName, teamIds) {
  if (!playerName) return null;
  const normalized = normalizePlayerName(playerName);
  const targetLastName = extractLastName(normalized);

  for (const teamId of teamIds) {
    if (!teamId) continue;
    if (!rosterCache.has(teamId)) {
      rosterCache.set(teamId, await getTeamRoster(teamId));
    }
    const roster = rosterCache.get(teamId);

    let match = roster.find(p => normalizePlayerName(p.name) === normalized);
    if (match) return { ...match, teamId };

    match = roster.find(p => extractLastName(normalizePlayerName(p.name)) === targetLastName);
    if (match) return { ...match, teamId };

    match = roster.find(p => {
      const rn = normalizePlayerName(p.name);
      return rn.includes(normalized) || normalized.includes(rn);
    });
    if (match) return { ...match, teamId };
  }
  return null;
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

module.exports = {
  calculateGameEdges,
  calculateHRPropEdges,
  rateConfidence,
  calculateEdge,
  LEAGUE_AVG,
};
