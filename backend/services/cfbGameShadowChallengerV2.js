"use strict";

// Pure parallel-shadow game transform. Market prices are comparison context only;
// they never enter the v2 projected margin or independent win probability.
const { spreadCover } = require("./footballMargin");
const { MODEL_VERSION: TEAM_MODEL_VERSION } = require("./cfbPreseasonChallengerV2");
const { _internal: sharedMath } = require("./cfbGameShadowChallenger");

const MODEL_VERSION = "cfb-game-preseason-shadow-v2-2026";
const EXPERIMENT_VERSION = "cfb-game-preseason-shadow-v2-parallel-2026";
const HOME_FIELD_POINTS = 3.0;
const BASE_GAME_SIGMA = 15.5;
const UNCERTAINTY_SCALE = 0;
const SPREAD_KEY_STRENGTH = 1.0;
const ML_METHOD = "normal-margin-cdf-v1";
const SPREAD_METHOD = "cfb-discrete-margin-pmf-v1";

function assertTeam(team, side) {
  if (!team || team.modelVersion !== TEAM_MODEL_VERSION) {
    throw new Error(`${side} team is not an approved v2 preseason challenger output`);
  }
  const rating = sharedMath.finite(team.challengerRating);
  const uncertainty = sharedMath.finite(team.uncertainty?.sd);
  if (rating == null || uncertainty == null || uncertainty <= 0) {
    throw new Error(`${side} team challenger rating/uncertainty is unavailable`);
  }
  return Object.freeze({ rating, uncertainty });
}

function buildCfbGameShadowPredictionV2({
  game = {}, homeTeam, awayTeam, neutralSiteStatus, market = {},
} = {}) {
  if (!game.gameId || !game.kickoffAt || !game.predictionAt) {
    throw new Error("canonical game id, kickoff, and prediction timestamps are required");
  }
  const predictionMs = Date.parse(game.predictionAt);
  const kickoffMs = Date.parse(game.kickoffAt);
  if (!Number.isFinite(predictionMs) || !Number.isFinite(kickoffMs) || predictionMs >= kickoffMs) {
    throw new Error("shadow prediction must be captured strictly before kickoff");
  }
  if (!new Set(["neutral", "non-neutral"]).has(neutralSiteStatus)) {
    throw new Error("trusted neutral-site status is required");
  }

  const home = assertTeam(homeTeam, "home");
  const away = assertTeam(awayTeam, "away");
  const homeFieldAdjustment = neutralSiteStatus === "neutral" ? 0 : HOME_FIELD_POINTS;
  const combinedRatingUncertainty = Math.sqrt(home.uncertainty ** 2 + away.uncertainty ** 2);
  const predictiveSigma = Math.sqrt(
    BASE_GAME_SIGMA ** 2 + (UNCERTAINTY_SCALE * combinedRatingUncertainty) ** 2,
  );
  const projectedHomeMargin = home.rating - away.rating + homeFieldAdjustment;
  const homeWinProbability = sharedMath.normalCDF(projectedHomeMargin / predictiveSigma);
  const awayWinProbability = 1 - homeWinProbability;
  const quote = sharedMath.normalizedMarket(market);

  let homeCoverProbability = null;
  let awayCoverProbability = null;
  let pushProbability = null;
  let pointDisagreement = null;
  if (quote.spread.homeLine != null) {
    const cover = spreadCover(
      projectedHomeMargin,
      predictiveSigma,
      quote.spread.homeLine,
      "cfb",
      SPREAD_KEY_STRENGTH,
    );
    homeCoverProbability = cover.homeCoverProb;
    awayCoverProbability = 1 - cover.homeCoverProb;
    pushProbability = cover.push;
    pointDisagreement = projectedHomeMargin + quote.spread.homeLine;
  }

  const mlPair = sharedMath.probabilityPair(homeWinProbability, awayWinProbability);
  const coverPair = sharedMath.probabilityPair(homeCoverProbability, awayCoverProbability);
  return Object.freeze({
    modelVersion: MODEL_VERSION,
    teamModelVersion: TEAM_MODEL_VERSION,
    experimentVersion: EXPERIMENT_VERSION,
    mlProbabilityMethod: ML_METHOD,
    spreadProbabilityMethod: SPREAD_METHOD,
    game: Object.freeze({ ...game }),
    neutralSiteStatus,
    homeFieldAdjustment: sharedMath.round(homeFieldAdjustment),
    homeTeamRating: sharedMath.round(home.rating),
    awayTeamRating: sharedMath.round(away.rating),
    homeTeamUncertainty: sharedMath.round(home.uncertainty),
    awayTeamUncertainty: sharedMath.round(away.uncertainty),
    combinedRatingUncertainty: sharedMath.round(combinedRatingUncertainty),
    baseGameSigma: BASE_GAME_SIGMA,
    uncertaintyScale: UNCERTAINTY_SCALE,
    predictiveSigma: sharedMath.round(predictiveSigma),
    projectedHomeMargin: sharedMath.round(projectedHomeMargin),
    homeWinProbability: mlPair.first,
    awayWinProbability: mlPair.second,
    market: quote,
    homeMlDisagreement: quote.h2h.homeFair == null
      ? null : sharedMath.round(mlPair.first - quote.h2h.homeFair),
    awayMlDisagreement: quote.h2h.awayFair == null
      ? null : sharedMath.round(mlPair.second - quote.h2h.awayFair),
    homeCoverProbability: coverPair.first,
    awayCoverProbability: coverPair.second,
    pushProbability: sharedMath.round(pushProbability),
    pointDisagreement: sharedMath.round(pointDisagreement),
    homeSpreadDisagreement: quote.spread.homeFair == null || coverPair.first == null
      ? null : sharedMath.round(coverPair.first - quote.spread.homeFair),
    awaySpreadDisagreement: quote.spread.awayFair == null || coverPair.second == null
      ? null : sharedMath.round(coverPair.second - quote.spread.awayFair),
  });
}

module.exports = {
  MODEL_VERSION,
  EXPERIMENT_VERSION,
  TEAM_MODEL_VERSION,
  HOME_FIELD_POINTS,
  BASE_GAME_SIGMA,
  UNCERTAINTY_SCALE,
  SPREAD_KEY_STRENGTH,
  ML_METHOD,
  SPREAD_METHOD,
  buildCfbGameShadowPredictionV2,
  _internal: { assertTeam },
};
