// Edges model v0.4 — research-grade MLB betting projections
// + Weather, Batter vs Pitcher, Pitcher recent form
// + NEW v0.4: lineup handedness splits vs opposing starter, reliever-only bullpen quality
const {
  getPitcherSeasonStats,
  getBatterSeasonStats,
  getTeamSeasonStats,
  getTeamLineup,
  getLineupOffense,
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

// ── PITCHER QUALITY HELPER ────────────────────────────────────────────────────
// ERA is noisy (defense + sequencing + luck) and slow to stabilize. FIP rebuilds
// a pitcher's run-prevention from only what they control — strikeouts, walks, and
// home runs — and predicts FUTURE ERA better than past ERA does. We already fetch
// K/9, BB/9, and HR/9, so we can compute a FIP-style number for free and BLEND it
// with ERA (not fully replace — a thin early-season sample of the components can
// be jumpy). Returns an "effective ERA" the rest of the model can use as before.
//   FIP = ((13*HR) + (3*BB) - (2*K)) / IP + constant.  Using per-9 rates this is
//   equivalent to: (13*HR9 + 3*BB9 - 2*K9)/9 + C, with C chosen so league-avg
//   FIP ~ league-avg ERA.
const FIP_CONSTANT = 3.10; // calibrates FIP onto the ERA scale (league ERA ~4.30)
function effectiveERA(p) {
  if (!p) return null;
  const era = p.era ?? null;
  const k9 = p.strikeoutsPer9 ?? null;
  const bb9 = p.walksPer9 ?? null;
  const hr9 = p.homeRunsPer9 ?? null;
  // Need the three components to compute FIP; otherwise fall back to ERA.
  if (k9 == null || bb9 == null || hr9 == null) return era;
  const fip = (13 * hr9 + 3 * bb9 - 2 * k9) / 9 + FIP_CONSTANT;
  if (era == null) return round2(fip);
  // Blend: 60% FIP (more predictive) + 40% ERA (captures real results/defense).
  return round2(0.6 * fip + 0.4 * era);
}


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
  // Use FIP-blended effective ERA (more predictive than raw ERA) when components exist.
  const awayEff = effectiveERA(awayPitcher);
  const homeEff = effectiveERA(homePitcher);
  const awayPitcherFactor = awayEff ? LEAGUE_AVG.era / Math.max(awayEff, 1.5) : 1.0;
  const homePitcherFactor = homeEff ? LEAGUE_AVG.era / Math.max(homeEff, 1.5) : 1.0;

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

  const awayPitcherERA = effectiveERA(awayPitcher) ?? LEAGUE_AVG.era;
  const homePitcherERA = effectiveERA(homePitcher) ?? LEAGUE_AVG.era;
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
// One-sided edge (model prob minus raw vig-inflated implied). Kept for HR props,
// where we only have the "Over" side and can't cleanly de-vig.
function calculateEdge(modelProb, americanOdds) {
  if (modelProb == null || americanOdds == null) return null;
  const implied = americanToImpliedProb(americanOdds);
  if (implied == null) return null;
  return round3(modelProb - implied);
}

// De-vig a two-way market: the book's two implied probs sum to >1 (their margin).
// Normalizing them to sum to 1 recovers the book's FAIR probability — which is
// what we must compare the model against. Comparing to the raw implied prob
// instead overstates every edge by roughly half the vig (~2-2.5% on a -110 market),
// which is larger than our entire LOW->MEDIUM threshold. This is the single most
// important correctness fix in the model.
function devigTwoWay(thisOdds, otherOdds) {
  if (thisOdds == null || otherOdds == null) return null;
  const a = americanToImpliedProb(thisOdds);
  const b = americanToImpliedProb(otherOdds);
  if (a == null || b == null) return null;
  const sum = a + b;
  if (!(sum > 0)) return null;
  return a / sum; // fair, no-vig probability for THIS side
}

// Edge vs the FAIR (de-vigged) line. Needs both sides' odds.
function calculateEdgeDevig(modelProb, thisOdds, otherOdds) {
  if (modelProb == null) return null;
  const fair = devigTwoWay(thisOdds, otherOdds);
  if (fair == null) return calculateEdge(modelProb, thisOdds); // fallback if a side is missing
  return round3(modelProb - fair);
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

  // Confirmed/projected lineups → lineup-based offense (who's ACTUALLY playing),
  // replacing full-team OPS when we have a trustworthy lineup. Tier:
  // confirmed (today's card) > recent (last game) > team season stats (fallback).
  let awayLineup = { lineup: [], source: "none" };
  let homeLineup = { lineup: [], source: "none" };
  let awayLineupOff = null;
  let homeLineupOff = null;
  try {
    [awayLineup, homeLineup] = await Promise.all([
      getTeamLineup(game.awayId, game.id),
      getTeamLineup(game.homeId, game.id),
    ]);
    [awayLineupOff, homeLineupOff] = await Promise.all([
      getLineupOffense(awayLineup.lineup),
      getLineupOffense(homeLineup.lineup),
    ]);
  } catch (_) { /* fall back to team stats below */ }

  // Overlay: if we have a lineup offense, use ITS ops as the offense input while
  // keeping the team's season ops for the handedness baseline comparison. We do
  // NOT touch runsPerGame (that stays team-level) — lineup ops drives the ML
  // offense factor, which is where who's-playing matters most.
  const awayTeamOps = awayTeamHit?.ops ?? null;
  const homeTeamOps = homeTeamHit?.ops ?? null;
  const awayHit = awayLineupOff
    ? { ...awayTeamHit, ops: awayLineupOff.ops, _lineupSource: awayLineup.source }
    : awayTeamHit;
  const homeHit = homeLineupOff
    ? { ...homeTeamHit, ops: homeLineupOff.ops, _lineupSource: homeLineup.source }
    : homeTeamHit;

  // Away offense faces the HOME starter's hand; home offense faces the AWAY starter's hand.
  // Handedness multiplier compares the team's split vs its TEAM-level ops baseline.
  const awayHandMult = handednessMultiplier(awayHandSplits, homePitcherHand, awayTeamOps);
  const homeHandMult = handednessMultiplier(homeHandSplits, awayPitcherHand, homeTeamOps);

  console.log(`[Edges] ${game.awayAbbr}@${game.homeAbbr} | lineup away=${awayLineup.source}(ops ${awayLineupOff?.ops ?? "n/a"}) home=${homeLineup.source}(ops ${homeLineupOff?.ops ?? "n/a"}) | handMult away=${awayHandMult.toFixed(3)} home=${homeHandMult.toFixed(3)} | pen away ERA=${awayBullpen?.era ?? "n/a"} home ERA=${homeBullpen?.era ?? "n/a"}`);

  const ml = calculateMoneylineProjection(game, awayPitcher, homePitcher, awayHit, homeHit, awayBullpen, homeBullpen, awayHandMult, homeHandMult);
  const totals = calculateTotalProjection(game, awayPitcher, homePitcher, awayHit, homeHit, weather, awayBullpen, homeBullpen, awayHandMult, homeHandMult);

  const odds = oddsForGame || { h2h: {}, totals: {} };
  const awayML = odds.h2h?.away;
  const homeML = odds.h2h?.home;
  const totalLine = odds.totals?.line;
  const overOdds = odds.totals?.over;
  const underOdds = odds.totals?.under;

  const awayEdge = calculateEdgeDevig(ml.awayWinProb, awayML, homeML);
  const homeEdge = calculateEdgeDevig(ml.homeWinProb, homeML, awayML);

  let overProb = null;
  let underProb = null;
  if (totalLine != null) {
    // Convert the projected-vs-line gap into a probability. The divisor is the
    // approximate standard deviation of an MLB game total (~4 runs). The old
    // value of 3.0 was too small, making the sigmoid too steep and OVERSTATING
    // how confident we were on every total (inflated edges). ~4.0 is closer to
    // the real spread of game outcomes.
    const TOTAL_SD = 4.0;
    overProb = sigmoid((totals.projectedTotal - totalLine) / TOTAL_SD);
    underProb = 1 - overProb;
  }
  const overEdge = calculateEdgeDevig(overProb, overOdds, underOdds);
  const underEdge = calculateEdgeDevig(underProb, underOdds, overOdds);

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
    lineups: {
      away: { source: awayLineup.source, ops: awayLineupOff?.ops ?? null, batters: awayLineupOff?.batters ?? 0 },
      home: { source: homeLineup.source, ops: homeLineupOff?.ops ?? null, batters: homeLineupOff?.batters ?? 0 },
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
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, hrOddsByEvent);
    const hrOdds = eventId ? hrOddsByEvent[eventId] : null;
    if (!hrOdds || hrOdds.length === 0) continue;
    const weather = await getWeatherForVenue(game.venue);
    for (const propOdds of hrOdds) {
      const batter = await findPlayerByName(propOdds.player, [game.awayId, game.homeId]);
      if (!batter) continue;
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
  }
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
  calculateEdgeDevig,
  devigTwoWay,
  effectiveERA,
  LEAGUE_AVG,
};
