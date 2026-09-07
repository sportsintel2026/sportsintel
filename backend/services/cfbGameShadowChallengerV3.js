"use strict";

// Pure parallel v3 game transform. Market prices remain comparison context only.
const { spreadCover } = require("./footballMargin");
const {
  MODEL_VERSION: TEAM_MODEL_VERSION,
  UPDATER_VERSION,
} = require("./cfbPreseasonChallengerV3");
const { _internal: sharedMath } = require("./cfbGameShadowChallenger");

const MODEL_VERSION = "cfb-game-od-shadow-v3-2026";
const EXPERIMENT_VERSION = "cfb-game-od-inseason-v3-parallel-2026";
const HOME_FIELD_POINTS = 3;
const BASE_GAME_SIGMA = 17;
const ML_METHOD = "normal-margin-cdf-v1";
const SPREAD_METHOD = "cfb-discrete-margin-pmf-v1";
const SPREAD_KEY_STRENGTH = 1;

function assertTeam(team, side, useUpdater) {
  if (!team || team.modelVersion !== TEAM_MODEL_VERSION) throw new Error(`${side} team is not an approved v3 team output`);
  const offense = sharedMath.finite(useUpdater
    ? team.offenseRating : team.features?.preseasonOffenseRating);
  const defense = sharedMath.finite(useUpdater
    ? team.defenseRating : team.features?.preseasonDefenseRating);
  const uncertainty = sharedMath.finite(team.uncertainty?.sd);
  if (offense == null || defense == null || uncertainty == null || uncertainty <= 0) {
    throw new Error(`${side} team v3 offense/defense/uncertainty is unavailable`);
  }
  return Object.freeze({ offense, defense, composite: offense + defense, uncertainty });
}

function buildCfbGameShadowPredictionV3({ game = {}, homeTeam, awayTeam, neutralSiteStatus, market = {} } = {}) {
  if (!game.gameId || !game.kickoffAt || !game.predictionAt) throw new Error("canonical game id and timestamps are required");
  const predictionMs = Date.parse(game.predictionAt);
  const kickoffMs = Date.parse(game.kickoffAt);
  if (!Number.isFinite(predictionMs) || !Number.isFinite(kickoffMs) || predictionMs >= kickoffMs) {
    throw new Error("shadow prediction must be captured strictly before kickoff");
  }
  if (!new Set(["neutral", "non-neutral"]).has(neutralSiteStatus)) throw new Error("trusted neutral-site status is required");
  const targetSeasonOutcomesUsed = homeTeam?.updaterActive === true && awayTeam?.updaterActive === true;
  const home = assertTeam(homeTeam, "home", targetSeasonOutcomesUsed);
  const away = assertTeam(awayTeam, "away", targetSeasonOutcomesUsed);
  const hfa = neutralSiteStatus === "neutral" ? 0 : HOME_FIELD_POINTS;
  const projectedHomeMargin = home.offense - away.defense - away.offense + home.defense + hfa;
  const homeWinProbability = sharedMath.normalCDF(projectedHomeMargin / BASE_GAME_SIGMA);
  const quote = sharedMath.normalizedMarket(market);
  const mlPair = sharedMath.probabilityPair(homeWinProbability, 1 - homeWinProbability);
  let cover = null;
  if (quote.spread.homeLine != null) {
    cover = spreadCover(projectedHomeMargin, BASE_GAME_SIGMA, quote.spread.homeLine, "cfb", SPREAD_KEY_STRENGTH);
  }
  const coverPair = sharedMath.probabilityPair(cover?.homeCoverProb, cover == null ? null : 1 - cover.homeCoverProb);
  return Object.freeze({
    modelVersion: MODEL_VERSION,
    teamModelVersion: TEAM_MODEL_VERSION,
    updaterVersion: UPDATER_VERSION,
    experimentVersion: EXPERIMENT_VERSION,
    mlProbabilityMethod: ML_METHOD,
    spreadProbabilityMethod: SPREAD_METHOD,
    game: Object.freeze({ ...game }),
    neutralSiteStatus,
    homeFieldAdjustment: hfa,
    homeTeamRating: sharedMath.round(home.composite),
    awayTeamRating: sharedMath.round(away.composite),
    homeTeamUncertainty: sharedMath.round(home.uncertainty),
    awayTeamUncertainty: sharedMath.round(away.uncertainty),
    combinedRatingUncertainty: sharedMath.round(Math.sqrt(home.uncertainty ** 2 + away.uncertainty ** 2)),
    baseGameSigma: BASE_GAME_SIGMA,
    predictiveSigma: BASE_GAME_SIGMA,
    projectedHomeMargin: sharedMath.round(projectedHomeMargin),
    homeWinProbability: mlPair.first,
    awayWinProbability: mlPair.second,
    market: quote,
    homeMlDisagreement: quote.h2h.homeFair == null ? null : sharedMath.round(mlPair.first - quote.h2h.homeFair),
    awayMlDisagreement: quote.h2h.awayFair == null ? null : sharedMath.round(mlPair.second - quote.h2h.awayFair),
    homeCoverProbability: coverPair.first,
    awayCoverProbability: coverPair.second,
    pushProbability: sharedMath.round(cover?.push),
    pointDisagreement: quote.spread.homeLine == null ? null : sharedMath.round(projectedHomeMargin + quote.spread.homeLine),
    homeSpreadDisagreement: quote.spread.homeFair == null || coverPair.first == null
      ? null : sharedMath.round(coverPair.first - quote.spread.homeFair),
    awaySpreadDisagreement: quote.spread.awayFair == null || coverPair.second == null
      ? null : sharedMath.round(coverPair.second - quote.spread.awayFair),
    provenance: Object.freeze({
      updaterVersion: UPDATER_VERSION,
      updateAsOf: homeTeam.updateAsOf,
      targetSeasonOutcomesUsed,
      homeGamesUsed: homeTeam.gamesUsed,
      awayGamesUsed: awayTeam.gamesUsed,
      homeCurrentSeasonWeight: targetSeasonOutcomesUsed ? homeTeam.currentSeasonWeight : 0,
      awayCurrentSeasonWeight: targetSeasonOutcomesUsed ? awayTeam.currentSeasonWeight : 0,
      homeOffenseRating: sharedMath.round(home.offense),
      homeDefenseRating: sharedMath.round(home.defense),
      awayOffenseRating: sharedMath.round(away.offense),
      awayDefenseRating: sharedMath.round(away.defense),
    }),
  });
}

module.exports = {
  MODEL_VERSION,
  EXPERIMENT_VERSION,
  TEAM_MODEL_VERSION,
  UPDATER_VERSION,
  HOME_FIELD_POINTS,
  BASE_GAME_SIGMA,
  ML_METHOD,
  SPREAD_METHOD,
  buildCfbGameShadowPredictionV3,
  _internal: { assertTeam },
};
