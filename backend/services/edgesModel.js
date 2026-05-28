// Edges model v0.4 — research-grade MLB betting projections
// + Weather, Batter vs Pitcher, Pitcher recent form
// + NEW v0.4: lineup handedness splits vs opposing starter, reliever-only bullpen quality
const {
  getPitcherSeasonStats,
  getBatterSeasonStats,
  getTeamSeasonStats,
  getTeamPitchingStats,
  getTeamRoster,
  getBatterVsPitcherHistory,
  getPitcherRecentStarts,
  getBatterRecentStats,
  getBatterStatcast,
  getTeamHandednessSplits,
  getTeamBullpenStats,
  getPitcherHand,
} = require("./mlbStatsApi");
const { americanToImpliedProb } = require("./oddsApi");
const { getWeatherForVenue } = require("./weatherApi");

const LEAGUE_AVG = {
  era: 4.30,
  runsPerGame: 4.40,
  hrPerPA: 0.032,
  homeRunsPer9: 1.20,
  iso: 0.155,
  ops: 0.720,
  bullpenEra: 4.10,
};

// ── HANDEDNESS HELPER ─────────────────────────────────────────────────────────
// Given a team's vsLHP/vsRHP splits and the opposing starter's hand,
// return a multiplier (~0.92–1.08) reflecting how well they hit that hand
// relative to their own overall level. Falls back to 1.0 when data is missing.
function handednessMultiplier(splits, opposingHand, teamOverallOps) {
  if (!splits || !opposingHand || !teamOverallOps) return 1.0;
  const facing = opposingHand === "L" ? splits.vsLHP : splits.vsRHP;
  if (!facing || !facing.ops || facing.atBats < 50) return 1.0; // too small a sample
  // How much better/worse they hit this hand vs their season OPS
  let mult = facing.ops / teamOverallOps;
  // Dampen so it nudges rather than dominates, and clamp to a sane band
  mult = 1 + (mult - 1) * 0.6;
  return Math.max(0.90, Math.min(1.10, mult));
}

// ── MONEYLINE MODEL ───────────────────────────────────────────────────────────
function calculateMoneylineProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, awayBullpen, homeBullpen, awayHandMult, homeHandMult) {
  const awayPitcherFactor = awayPitcher?.era ? LEAGUE_AVG.era / Math.max(awayPitcher.era, 1.5) : 1.0;
  const homePitcherFactor = homePitcher?.era ? LEAGUE_AVG.era / Math.max(homePitcher.era, 1.5) : 1.0;

  // Offense factor now adjusted by handedness vs the opposing starter
  const awayOffenseFactor = (awayTeamHit?.ops ? awayTeamHit.ops / LEAGUE_AVG.ops : 1.0) * (awayHandMult || 1.0);
  const homeOffenseFactor = (homeTeamHit?.ops ? homeTeamHit.ops / LEAGUE_AVG.ops : 1.0) * (homeHandMult || 1.0);

  // Bullpen factor now uses reliever-only ERA when available (more accurate than full-staff)
  const awayPenEra = awayBullpen?.era ?? null;
  const homePenEra = homeBullpen?.era ?? null;
  const awayBullpenFactor = awayPenEra ? LEAGUE_AVG.era / Math.max(awayPenEra, 2.5) : 1.0;
  const homeBullpenFactor = homePenEra ? LEAGUE_AVG.era / Math.max(homePenEra, 2.5) : 1.0;

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

// ── TOTALS MODEL ──────────────────────────────────────────────────────────────
function calculateTotalProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, weather, awayBullpen, homeBullpen, awayHandMult, homeHandMult) {
  // Offense scaled by handedness vs the opposing starter
  const awayRPG = (awayTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame) * (awayHandMult || 1.0);
  const homeRPG = (homeTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame) * (homeHandMult || 1.0);
  const baseTotal = awayRPG + homeRPG;

  const awayPitcherERA = awayPitcher?.era ?? LEAGUE_AVG.era;
  const homePitcherERA = homePitcher?.era ?? LEAGUE_AVG.era;
  const pitcherAdj = ((awayPitcherERA + homePitcherERA) / 2 - LEAGUE_AVG.era) * 0.40;

  const parkAdj = (game.parkRunFactor - 1.0) * baseTotal;

  let weatherAdj = 0;
  if (weather && !weather.indoor) {
    if (weather.windEffect === "out") weatherAdj += 0.4;
    if (weather.windEffect === "in") weatherAdj -= 0.4;
    if (weather.tempEffect === "hot") weatherAdj += 0.3;
    if (weather.tempEffect === "cold") weatherAdj -= 0.3;
  }

  // Bullpen adjustment: both pens pitch ~3 innings/game. A good pen suppresses
  // late runs; a bad pen inflates them. Compare each pen to league avg.
  let bullpenAdj = 0;
  const awayPenEra = awayBullpen?.era;
  const homePenEra = homeBullpen?.era;
  if (awayPenEra) bullpenAdj += ((awayPenEra - LEAGUE_AVG.bullpenEra) / 9) * 3.0;
  if (homePenEra) bullpenAdj += ((homePenEra - LEAGUE_AVG.bullpenEra) / 9) * 3.0;

  const projected = baseTotal + pitcherAdj + parkAdj + weatherAdj + bullpenAdj;
  return {
    projectedTotal: round2(projected),
    breakdown: {
      base: round2(baseTotal),
      pitcherAdj: round2(pitcherAdj),
      parkAdj: round2(parkAdj),
      weatherAdj: round2(weatherAdj),
      bullpenAdj: round2(bullpenAdj),
    },
  };
}

// ── HR PROP MODEL ─────────────────────────────────────────────────────────────
function calculateHRProbability(batterStats, opposingPitcherStats, game, weather) {
  if (!batterStats) return null;
  const baseHRRate = batterStats.hrPerPA ?? LEAGUE_AVG.hrPerPA;
  if (baseHRRate === 0) return null;
  const expectedPA = 4.1;
  const pitcherHR9 = opposingPitcherStats?.homeRunsPer9 ?? LEAGUE_AVG.homeRunsPer9;
  const pitcherFactor = pitcherHR9 / LEAGUE_AVG.homeRunsPer9;
  const parkFactor = game.parkHRFactor || 1.0;
  const isoFactor = batterStats.iso ? (batterStats.iso / LEAGUE_AVG.iso) ** 0.5 : 1.0;
  let weatherFactor = 1.0;
  if (weather && !weather.indoor) {
    if (weather.windEffect === "out") weatherFactor *= 1.15;
    if (weather.windEffect === "in") weatherFactor *= 0.85;
    if (weather.tempEffect === "hot") weatherFactor *= 1.08;
    if (weather.tempEffect === "cold") weatherFactor *= 0.92;
  }
  const perPAProb = Math.min(0.15, baseHRRate * pitcherFactor * parkFactor * isoFactor * weatherFactor);
  const noHRProb = Math.pow(1 - perPAProb, expectedPA);
  return round3(1 - noHRProb);
}

// ── EDGE CALCULATION ──────────────────────────────────────────────────────────
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

// ── ORCHESTRATION ─────────────────────────────────────────────────────────────
const MAX_HR_GAMES = 5;
async function calculateGameEdges(game, oddsForGame) {
  const [
    awayPitcher,
    homePitcher,
    awayTeamHit,
    homeTeamHit,
    awayBullpen,
    homeBullpen,
    weather,
    awayPitcherRecent,
    homePitcherRecent,
    awayHandSplits,
    homeHandSplits,
    awayPitcherHand,
    homePitcherHand,
  ] = await Promise.all([
    game.awayProbable ? getPitcherSeasonStats(game.awayProbable.id) : null,
    game.homeProbable ? getPitcherSeasonStats(game.homeProbable.id) : null,
    getTeamSeasonStats(game.awayId),
    getTeamSeasonStats(game.homeId),
    getTeamBullpenStats(game.awayId),
    getTeamBullpenStats(game.homeId),
    getWeatherForVenue(game.venue),
    game.awayProbable ? getPitcherRecentStarts(game.awayProbable.id, 3) : [],
    game.homeProbable ? getPitcherRecentStarts(game.homeProbable.id, 3) : [],
    getTeamHandednessSplits(game.awayId),
    getTeamHandednessSplits(game.homeId),
    game.awayProbable ? getPitcherHand(game.awayProbable.id) : null,
    game.homeProbable ? getPitcherHand(game.homeProbable.id) : null,
  ]);

  // Away offense faces the HOME starter's hand; home offense faces the AWAY starter's hand
  const awayHandMult = handednessMultiplier(awayHandSplits, homePitcherHand, awayTeamHit?.ops);
  const homeHandMult = handednessMultiplier(homeHandSplits, awayPitcherHand, homeTeamHit?.ops);

  console.log(`[Edges] ${game.awayAbbr}@${game.homeAbbr} | handMult away=${awayHandMult.toFixed(3)}(vs ${homePitcherHand||"?"}) home=${homeHandMult.toFixed(3)}(vs ${awayPitcherHand||"?"}) | pen away ERA=${awayBullpen?.era ?? "n/a"} home ERA=${homeBullpen?.era ?? "n/a"}`);

  const ml = calculateMoneylineProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, awayBullpen, homeBullpen, awayHandMult, homeHandMult);
  const totals = calculateTotalProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, weather, awayBullpen, homeBullpen, awayHandMult, homeHandMult);

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
      away: game.awayProbable ? {
        ...game.awayProbable,
        hand: awayPitcherHand,
        stats: awayPitcher,
        recentStarts: awayPitcherRecent,
      } : null,
      home: game.homeProbable ? {
        ...game.homeProbable,
        hand: homePitcherHand,
        stats: homePitcher,
        recentStarts: homePitcherRecent,
      } : null,
    },
    weather,
    bullpen: {
      away: awayBullpen ? { era: awayBullpen.era, whip: awayBullpen.whip } : null,
      home: homeBullpen ? { era: homeBullpen.era, whip: homeBullpen.whip } : null,
    },
    handedness: {
      awayMult: round3(awayHandMult),
      homeMult: round3(homeHandMult),
      awayVsHand: homePitcherHand,
      homeVsHand: awayPitcherHand,
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
    const weather = await getWeatherForVenue(game.venue);
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
      const [batterStats, recent15, bvp, statcast] = await Promise.all([
        getBatterSeasonStats(batter.id),
        getBatterRecentStats(batter.id, 15),
        opposingPitcherProbable ? getBatterVsPitcherHistory(batter.id, opposingPitcherProbable.id) : null,
        getBatterStatcast(batter.id),
      ]);
      const hrProb = calculateHRProbability(batterStats, opposingPitcherStats, game, weather);
      if (hrProb == null) continue;
      const edge = calculateEdge(hrProb, propOdds.price);
      allHRProps.push({
        gameId: game.id,
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
        recent15: recent15 ? {
          atBats: recent15.atBats,
          hr: recent15.homeRuns,
          avg: recent15.avg,
          ops: recent15.ops,
          hrPerAB: round3(recent15.hrPerAB),
        } : null,
        bvp: bvp ? {
          atBats: bvp.atBats,
          hits: bvp.hits,
          hr: bvp.homeRuns,
          avg: round3(bvp.avg),
          ops: bvp.ops ? round3(bvp.ops) : null,
        } : null,
        statcast: statcast ? {
          avgExitVelo: statcast.avgExitVelocity,
          maxExitVelo: statcast.maxExitVelocity,
          barrelRate: statcast.barrelRate,
          hardHitRate: statcast.hardHitRate,
          xwOBA: statcast.xwOBA,
        } : null,
        parkHRFactor: game.parkHRFactor,
        opposingPitcherHR9: opposingPitcherStats?.homeRunsPer9 ?? null,
        weatherEffect: weather?.windEffect || null,
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

// ── PLAYER NAME MATCHING ──────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
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
