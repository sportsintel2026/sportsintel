"use strict";

// Pure, shadow-only game transform. It has no provider/database/customer-model
// dependency. Market prices describe comparison wagers only and never enter the
// projected margin or independent moneyline probability.
const { spreadCover } = require("./footballMargin");
const { _internal: closingMath } = require("./cfbClosing");
const { MODEL_VERSION: TEAM_MODEL_VERSION } = require("./cfbPreseasonChallenger");

const MODEL_VERSION = "cfb-game-preseason-shadow-v1-2026";
const EXPERIMENT_VERSION = "cfb-game-preseason-shadow-collection-v1-2026";
const HOME_FIELD_POINTS = 3.0;
const BASE_GAME_SIGMA = 15.5;
const SPREAD_KEY_STRENGTH = 1.0;
const ML_METHOD = "normal-margin-cdf-v1";
const SPREAD_METHOD = "cfb-discrete-margin-pmf-v1";

function finite(value) {
  const n = Number(value);
  return value !== null && value !== "" && Number.isFinite(n) ? n : null;
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return sign * y;
}

function normalCDF(value) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function probabilityPair(first, second) {
  return Number.isFinite(first) && Number.isFinite(second)
    ? Object.freeze({ first: round(first), second: round(second) })
    : Object.freeze({ first: null, second: null });
}

function bookValue(value) {
  const text = value == null ? null : String(value).trim();
  return text || null;
}

function normalizedMarket(market = {}) {
  const h2h = market.h2h || {};
  const spreads = market.spreads || {};
  const homeMl = finite(h2h.home);
  const awayMl = finite(h2h.away);
  const homeMlFair = closingMath.fair(homeMl, awayMl);
  const homeSpread = finite(spreads.homeLine);
  const awaySpread = finite(spreads.awayLine);
  const spreadAligned = homeSpread != null && awaySpread != null
    && Math.abs(homeSpread + awaySpread) < 1e-9;
  const homeSpreadOdds = spreadAligned ? finite(spreads.home) : null;
  const awaySpreadOdds = spreadAligned ? finite(spreads.away) : null;
  const homeSpreadFair = closingMath.fair(homeSpreadOdds, awaySpreadOdds);
  return Object.freeze({
    source: market.source || "the-odds-api-us-best-price",
    quoteAt: market.quoteAt || null,
    h2h: Object.freeze({
      home: homeMl,
      away: awayMl,
      homeBook: homeMl == null ? null : bookValue(h2h.homeBook),
      awayBook: awayMl == null ? null : bookValue(h2h.awayBook),
      homeFair: homeMlFair,
      awayFair: homeMlFair == null ? null : 1 - homeMlFair,
    }),
    spread: Object.freeze({
      homeLine: spreadAligned ? homeSpread : null,
      awayLine: spreadAligned ? awaySpread : null,
      homeOdds: homeSpreadOdds,
      awayOdds: awaySpreadOdds,
      homeBook: homeSpreadOdds == null ? null : bookValue(spreads.homeBook),
      awayBook: awaySpreadOdds == null ? null : bookValue(spreads.awayBook),
      homeFair: homeSpreadFair,
      awayFair: homeSpreadFair == null ? null : 1 - homeSpreadFair,
    }),
  });
}

function assertTeam(team, side) {
  if (!team || team.modelVersion !== TEAM_MODEL_VERSION) {
    throw new Error(`${side} team is not an approved preseason challenger output`);
  }
  const rating = finite(team.challengerRating);
  const uncertainty = finite(team.uncertainty?.sd);
  if (rating == null || uncertainty == null || uncertainty <= 0) {
    throw new Error(`${side} team challenger rating/uncertainty is unavailable`);
  }
  return Object.freeze({ rating, uncertainty });
}

function buildCfbGameShadowPrediction({
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
  const predictiveSigma = Math.sqrt(BASE_GAME_SIGMA ** 2 + combinedRatingUncertainty ** 2);
  const projectedHomeMargin = home.rating - away.rating + homeFieldAdjustment;
  const homeWinProbability = normalCDF(projectedHomeMargin / predictiveSigma);
  const awayWinProbability = 1 - homeWinProbability;
  const quote = normalizedMarket(market);

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

  const mlPair = probabilityPair(homeWinProbability, awayWinProbability);
  const coverPair = probabilityPair(homeCoverProbability, awayCoverProbability);
  return Object.freeze({
    modelVersion: MODEL_VERSION,
    teamModelVersion: TEAM_MODEL_VERSION,
    experimentVersion: EXPERIMENT_VERSION,
    mlProbabilityMethod: ML_METHOD,
    spreadProbabilityMethod: SPREAD_METHOD,
    game: Object.freeze({ ...game }),
    neutralSiteStatus,
    homeFieldAdjustment: round(homeFieldAdjustment),
    homeTeamRating: round(home.rating),
    awayTeamRating: round(away.rating),
    homeTeamUncertainty: round(home.uncertainty),
    awayTeamUncertainty: round(away.uncertainty),
    combinedRatingUncertainty: round(combinedRatingUncertainty),
    baseGameSigma: BASE_GAME_SIGMA,
    predictiveSigma: round(predictiveSigma),
    projectedHomeMargin: round(projectedHomeMargin),
    homeWinProbability: mlPair.first,
    awayWinProbability: mlPair.second,
    market: quote,
    homeMlDisagreement: quote.h2h.homeFair == null
      ? null : round(mlPair.first - quote.h2h.homeFair),
    awayMlDisagreement: quote.h2h.awayFair == null
      ? null : round(mlPair.second - quote.h2h.awayFair),
    homeCoverProbability: coverPair.first,
    awayCoverProbability: coverPair.second,
    pushProbability: round(pushProbability),
    pointDisagreement: round(pointDisagreement),
    homeSpreadDisagreement: quote.spread.homeFair == null || coverPair.first == null
      ? null : round(coverPair.first - quote.spread.homeFair),
    awaySpreadDisagreement: quote.spread.awayFair == null || coverPair.second == null
      ? null : round(coverPair.second - quote.spread.awayFair),
  });
}

module.exports = {
  MODEL_VERSION,
  EXPERIMENT_VERSION,
  TEAM_MODEL_VERSION,
  HOME_FIELD_POINTS,
  BASE_GAME_SIGMA,
  SPREAD_KEY_STRENGTH,
  ML_METHOD,
  SPREAD_METHOD,
  buildCfbGameShadowPrediction,
  _internal: { finite, round, erf, normalCDF, normalizedMarket },
};
