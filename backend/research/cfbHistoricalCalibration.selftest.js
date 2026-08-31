"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildHistoricalDataset,
} = require("./cfbHistoricalDataset");
const {
  BOOTSTRAP_SEED,
  BOOTSTRAP_REPLICATES,
  VALIDATION_SEASONS,
  FOLDS,
  V1_PARAMS,
  PRIOR_ONLY_PARAMS,
  SEARCH_SPACE,
  parameterGrid,
  predictGame,
  summarizePredictions,
  evaluate,
  runHistoricalCalibration,
  _internal,
} = require("./cfbHistoricalCalibration");
const {
  MODEL_VERSION: TEAM_MODEL_VERSION,
  MEAN_ARCHITECTURE,
} = require("../services/cfbPreseasonChallenger");
const {
  HOME_FIELD_POINTS,
  BASE_GAME_SIGMA,
  buildCfbGameShadowPrediction,
  _internal: liveGameMath,
} = require("../services/cfbGameShadowChallenger");

const RESULT_PATH = path.join(__dirname, "results", "cfb-historical-calibration-phase1-v1.json");
const dataset = buildHistoricalDataset();

// Outcomes and folds are strictly pre-2026 and chronological. A validation year
// never appears in its own training population.
assert.deepStrictEqual(VALIDATION_SEASONS, [2023, 2024, 2025]);
assert.ok(dataset.outcomeSeasons.every((season) => season <= 2025));
for (const fold of FOLDS) {
  assert.ok(fold.train.every((season) => season < fold.validate));
  assert.ok(!fold.train.includes(fold.validate));
}

// The frozen grid is deterministic, finite, and does not fit the unavailable
// historical uncertainty components.
const gridA = parameterGrid();
const gridB = parameterGrid();
assert.deepStrictEqual(gridA, gridB);
assert.strictEqual(gridA.length, 1890);
assert.deepStrictEqual(SEARCH_SPACE.uncertaintyScale, [1]);

const homeTeam = Object.freeze({
  teamId: "1",
  priorRating: 10,
  returningResidualZ: 0,
  talentResidualZ: 0,
  uncertainty: Object.freeze({ sd: 3.5 }),
});
const awayTeam = Object.freeze({
  teamId: "2",
  priorRating: 2,
  returningResidualZ: 0,
  talentResidualZ: 0,
  uncertainty: Object.freeze({ sd: 4 }),
});
const seasonRow = Object.freeze({ teams: new Map([["1", homeTeam], ["2", awayTeam]]) });
const baseGame = Object.freeze({
  gameId: "synthetic",
  season: 2025,
  week: 1,
  homeId: "1",
  awayId: "2",
  actualHomeMargin: 7,
});
const neutral = predictGame(seasonRow, { ...baseGame, neutralSite: true }, V1_PARAMS);
const nonNeutral = predictGame(seasonRow, { ...baseGame, neutralSite: false }, V1_PARAMS);
assert.strictEqual(nonNeutral.projectedHomeMargin - neutral.projectedHomeMargin, HOME_FIELD_POINTS);
assert.strictEqual(neutral.projectedHomeMargin, 8);
const reversed = predictGame(
  seasonRow,
  { ...baseGame, gameId: "reverse", homeId: "2", awayId: "1", neutralSite: true },
  V1_PARAMS,
);
assert.strictEqual(reversed.projectedHomeMargin, -neutral.projectedHomeMargin);
assert.ok(Math.abs(neutral.homeWinProbability + reversed.homeWinProbability - 1) < 1e-12);

// The historical v1 baseline is an exact formula mirror of the current frozen
// 2026 shadow architecture for the components that historical data can recreate.
assert.strictEqual(V1_PARAMS.returningProductionCoefficient, MEAN_ARCHITECTURE.returningResidualPointsPerSd);
assert.strictEqual(V1_PARAMS.talentCoefficient, MEAN_ARCHITECTURE.talentResidualPointsPerSd);
assert.strictEqual(V1_PARAMS.homeFieldAdvantage, HOME_FIELD_POINTS);
assert.strictEqual(V1_PARAMS.baseSigma, BASE_GAME_SIGMA);
assert.strictEqual(V1_PARAMS.uncertaintyScale, 1);
assert.strictEqual(_internal.normalCDF(0.75), liveGameMath.normalCDF(0.75));
const live = buildCfbGameShadowPrediction({
  game: {
    gameId: "formula-identity",
    kickoffAt: "2026-09-01T20:00:00.000Z",
    predictionAt: "2026-09-01T12:00:00.000Z",
  },
  homeTeam: { modelVersion: TEAM_MODEL_VERSION, challengerRating: 10, uncertainty: { sd: 3.5 } },
  awayTeam: { modelVersion: TEAM_MODEL_VERSION, challengerRating: 2, uncertainty: { sd: 4 } },
  neutralSiteStatus: "non-neutral",
});
assert.strictEqual(live.projectedHomeMargin, nonNeutral.projectedHomeMargin);
assert.ok(Math.abs(live.predictiveSigma - nonNeutral.predictiveSigma) < 1e-8);
assert.strictEqual(live.homeWinProbability, Number(nonNeutral.homeWinProbability.toFixed(8)));

// Known synthetic values verify metric math independently of the historical rows.
const metricRows = [
  {
    marginError: 2, absoluteMarginError: 2, squaredMarginError: 4,
    homeWinProbability: 0.8, outcome: 1, brier: 0.04,
    logLoss: -Math.log(0.8), combinedTeamUncertainty: 1,
    neutralSite: true,
  },
  {
    marginError: -4, absoluteMarginError: 4, squaredMarginError: 16,
    homeWinProbability: 0.4, outcome: 0, brier: 0.16,
    logLoss: -Math.log(0.6), combinedTeamUncertainty: 2,
    neutralSite: false,
  },
];
const metricSummary = summarizePredictions(metricRows);
assert.strictEqual(metricSummary.mae, 3);
assert.strictEqual(metricSummary.rmse, Number(Math.sqrt(10).toFixed(8)));
assert.strictEqual(metricSummary.brier, 0.1);
assert.strictEqual(metricSummary.logLoss, Number(((-Math.log(0.8) - Math.log(0.6)) / 2).toFixed(8)));
assert.strictEqual(_internal.logLoss(0.8, 1), -Math.log(0.8));

// Prior-only produces the identical eligible population without inventing absent
// preseason feature values.
const priorOnly = evaluate(dataset, VALIDATION_SEASONS, PRIOR_ONLY_PARAMS);
const v1 = evaluate(dataset, VALIDATION_SEASONS, V1_PARAMS);
assert.strictEqual(priorOnly.metrics.n, v1.metrics.n);
assert.strictEqual(priorOnly.metrics.n, 2210);

// The result is reproduced from the committed input and exact frozen search. Fold
// metrics and deterministic bootstrap output recompute byte-for-byte.
const committed = JSON.parse(fs.readFileSync(RESULT_PATH, "utf8"));
const generated = runHistoricalCalibration(dataset);
assert.deepStrictEqual(generated, committed);
const { resultSha256, ...resultBody } = generated;
assert.strictEqual(_internal.canonicalHash(resultBody), resultSha256);
for (const candidate of committed.candidates) {
  const recomputed = evaluate(dataset, VALIDATION_SEASONS, candidate.params);
  assert.deepStrictEqual(recomputed.metrics, candidate.validationMetrics);
  assert.deepStrictEqual(recomputed.bySeason, candidate.validationBySeason);
}
const bootstrapA = _internal.bootstrapMean([1, -2, 3, -4, 5], BOOTSTRAP_SEED, BOOTSTRAP_REPLICATES);
const bootstrapB = _internal.bootstrapMean([1, -2, 3, -4, 5], BOOTSTRAP_SEED, BOOTSTRAP_REPLICATES);
assert.deepStrictEqual(bootstrapA, bootstrapB);

// Provider budgets and source-level isolation are hard gates, not conventions.
assert.strictEqual(committed.dataQuality.outcomesFrom2026Used, false);
assert.strictEqual(committed.dataQuality.targetOutcomeLeakage, false);
assert.strictEqual(committed.dataQuality.cfbdApiCalls, 0);
assert.ok(committed.dataQuality.cfbdApiCalls <= 40);
assert.strictEqual(committed.dataQuality.oddsApiCalls, 0);
assert.strictEqual(committed.dataQuality.espnApiCalls, 0);
for (const file of ["cfbHistoricalDataset.js", "cfbHistoricalCalibration.js"]) {
  const source = fs.readFileSync(path.join(__dirname, file), "utf8");
  assert.ok(!/require\(["']\.\.\/routes\//.test(source));
  assert.ok(!/require\(["']\.\.\/server/.test(source));
  assert.ok(!/require\(["']\.\.\/services\/(?:cfbdApi|cfbEdges|cfbModel|predictionTracker)/.test(source));
  assert.ok(!/\b(?:fetch|axios)\s*\(/.test(source));
  assert.ok(!/\.(?:insert|upsert|delete)\s*\(/.test(source));
  assert.ok(!/\b(?:supabase|serviceRole)\b/i.test(source));
}
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
assert.ok(!serverSource.includes("cfbHistoricalDataset"));
assert.ok(!serverSource.includes("cfbHistoricalCalibration"));

console.log("cfbHistoricalCalibration self-test: PASS", {
  resultSha256,
  validationGames: v1.metrics.n,
  gridConfigurations: gridA.length,
  cfbdApiCalls: committed.dataQuality.cfbdApiCalls,
});
