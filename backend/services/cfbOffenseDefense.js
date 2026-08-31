"use strict";

// Pure opponent-adjusted CFB offense/defense decomposition. The live data source
// supplies already-fetched completed schedules; research supplies frozen historical
// games. This module performs no provider, database, route, or customer work.

const DEFAULT_CONFIG = Object.freeze({
  priorPseudoGames: 4,
  minimumGames: 4,
  iterations: 30,
  homeFieldPoints: 3,
});

function finite(value) {
  const number = Number(value);
  return value !== null && value !== "" && Number.isFinite(number) ? number : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function observationsFromGames(games = [], homeFieldPoints = DEFAULT_CONFIG.homeFieldPoints) {
  const observations = new Map();
  const names = new Map();
  const add = (teamId, row) => {
    if (!observations.has(teamId)) observations.set(teamId, []);
    observations.get(teamId).push(Object.freeze(row));
  };
  for (const game of games) {
    const homeId = String(game.homeId || "");
    const awayId = String(game.awayId || "");
    const homePoints = finite(game.homePoints);
    const awayPoints = finite(game.awayPoints);
    if (!homeId || !awayId || homeId === awayId || homePoints == null || awayPoints == null) continue;
    const homeAdj = game.neutralSite === true ? 0 : homeFieldPoints / 2;
    if (game.homeName) names.set(homeId, game.homeName);
    if (game.awayName) names.set(awayId, game.awayName);
    add(homeId, {
      gameId: String(game.gameId || ""), opponentId: awayId, pointsFor: homePoints,
      pointsAgainst: awayPoints, scoringVenueAdjustment: homeAdj,
    });
    add(awayId, {
      gameId: String(game.gameId || ""), opponentId: homeId, pointsFor: awayPoints,
      pointsAgainst: homePoints, scoringVenueAdjustment: -homeAdj,
    });
  }
  return Object.freeze({ observations, names });
}

function fitOffenseDefenseFromObservations(observations, names = new Map(), config = DEFAULT_CONFIG) {
  config = Object.freeze({ ...DEFAULT_CONFIG, ...(config || {}) });
  const candidateIds = new Set([...observations.keys()]);
  const eligibleIds = [...candidateIds]
    .filter((teamId) => observations.get(teamId).filter((game) => candidateIds.has(game.opponentId)).length >= config.minimumGames)
    .sort((left, right) => Number(left) - Number(right));
  const eligible = new Set(eligibleIds);
  const filtered = new Map(eligibleIds.map((teamId) => [teamId,
    observations.get(teamId).filter((game) => eligible.has(game.opponentId))]));
  // Removing a low-sample opponent can lower another team below the gate. Close
  // that set deterministically before fitting so every included observation has
  // two modeled FBS sides.
  let changed = true;
  while (changed) {
    changed = false;
    for (const teamId of [...eligible]) {
      const games = (observations.get(teamId) || []).filter((game) => eligible.has(game.opponentId));
      if (games.length < config.minimumGames) {
        eligible.delete(teamId);
        changed = true;
      }
    }
  }
  const ids = [...eligible].sort((left, right) => Number(left) - Number(right));
  for (const teamId of ids) {
    filtered.set(teamId, observations.get(teamId).filter((game) => eligible.has(game.opponentId)));
  }
  const pointRows = ids.flatMap((teamId) => filtered.get(teamId).map((game) => game.pointsFor));
  const leagueMeanPoints = mean(pointRows);
  if (!ids.length || leagueMeanPoints == null) {
    return Object.freeze({ leagueMeanPoints: null, ratedTeams: 0, teams: new Map(), config });
  }
  let offense = new Map(ids.map((teamId) => [teamId, 0]));
  let defense = new Map(ids.map((teamId) => [teamId, 0]));
  for (let iteration = 0; iteration < config.iterations; iteration++) {
    const nextOffense = new Map();
    const nextDefense = new Map();
    for (const teamId of ids) {
      const games = filtered.get(teamId);
      let offenseEvidence = 0;
      let defenseEvidence = 0;
      for (const game of games) {
        offenseEvidence += game.pointsFor - leagueMeanPoints
          + defense.get(game.opponentId) - game.scoringVenueAdjustment;
        defenseEvidence += leagueMeanPoints + offense.get(game.opponentId)
          - game.scoringVenueAdjustment - game.pointsAgainst;
      }
      const denominator = games.length + config.priorPseudoGames;
      nextOffense.set(teamId, offenseEvidence / denominator);
      nextDefense.set(teamId, defenseEvidence / denominator);
    }
    const offenseCenter = mean([...nextOffense.values()]);
    const defenseCenter = mean([...nextDefense.values()]);
    offense = new Map([...nextOffense].map(([teamId, value]) => [teamId, value - offenseCenter]));
    defense = new Map([...nextDefense].map(([teamId, value]) => [teamId, value - defenseCenter]));
  }
  const teams = new Map(ids.map((teamId) => [teamId, Object.freeze({
    teamId,
    teamName: names.get(teamId) || null,
    games: filtered.get(teamId).length,
    offenseRating: round(offense.get(teamId)),
    defenseRating: round(defense.get(teamId)),
    compositeRating: round(offense.get(teamId) + defense.get(teamId)),
  })]));
  return Object.freeze({ leagueMeanPoints: round(leagueMeanPoints), ratedTeams: teams.size, teams, config });
}

function fitOffenseDefense(games = [], config = DEFAULT_CONFIG) {
  const built = observationsFromGames(games, config.homeFieldPoints);
  return fitOffenseDefenseFromObservations(built.observations, built.names, config);
}

module.exports = {
  DEFAULT_CONFIG,
  observationsFromGames,
  fitOffenseDefenseFromObservations,
  fitOffenseDefense,
  _internal: { finite, mean, round },
};
