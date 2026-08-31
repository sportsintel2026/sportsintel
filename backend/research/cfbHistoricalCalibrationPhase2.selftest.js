"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildHistoricalDatasetPhase2 } = require("./cfbHistoricalDatasetPhase2");
const phase1 = require("./cfbHistoricalCalibration");
const phase2 = require("./cfbHistoricalCalibrationPhase2");
const {
  MODEL_VERSION: V2_TEAM_VERSION,
  MEAN_ARCHITECTURE: V2_MEAN,
} = require("../services/cfbPreseasonChallengerV2");
const {
  MODEL_VERSION: V2_GAME_VERSION,
  HOME_FIELD_POINTS,
  BASE_GAME_SIGMA,
  UNCERTAINTY_SCALE,
} = require("../services/cfbGameShadowChallengerV2");

const RESULT_PATH = path.join(__dirname, "results", "cfb-historical-calibration-phase2-v1.json");
const dataset = buildHistoricalDatasetPhase2();
const committed = JSON.parse(fs.readFileSync(RESULT_PATH, "utf8"));
const generated = phase2.runHistoricalCalibrationPhase2(dataset);
assert.deepStrictEqual(generated, committed);
assert.ok(!phase2.markdown(generated).includes("undefined"));
assert.strictEqual(generated.decision, "B — Parallel v2 shadow justified.");
assert.strictEqual(generated.dataQuality.outcomesFrom2026Used, false);
assert.strictEqual(generated.dataQuality.targetOutcomeLeakage, false);
assert.strictEqual(generated.dataQuality.returningProductionField, "CFBD percentPPA");
assert.ok(generated.dataQuality.providerBudget.cfbdApiCallsAttempted <= 40);
assert.ok(phase2.SEARCH_SPACE.coarse.talentCoefficient.includes(2.5));
assert.deepStrictEqual(generated.frozenCandidate.params, {
  returningProductionCoefficient: 1,
  talentCoefficient: 2.5,
  homeFieldAdvantage: 3,
  baseSigma: 17.5,
  uncertaintyScale: 0,
});
assert.deepStrictEqual(generated.prospectiveParallelV2.params, {
  returningProductionCoefficient: 1.25,
  talentCoefficient: 2.5,
  homeFieldAdvantage: 3,
  baseSigma: 15.5,
  uncertaintyScale: 0,
});
assert.strictEqual(V2_TEAM_VERSION, "cfb-preseason-prior-shadow-v2-2026");
assert.strictEqual(V2_GAME_VERSION, "cfb-game-preseason-shadow-v2-2026");
assert.strictEqual(V2_MEAN.returningResidualPointsPerSd, generated.prospectiveParallelV2.params.returningProductionCoefficient);
assert.strictEqual(V2_MEAN.talentResidualPointsPerSd, generated.prospectiveParallelV2.params.talentCoefficient);
assert.strictEqual(HOME_FIELD_POINTS, generated.prospectiveParallelV2.params.homeFieldAdvantage);
assert.strictEqual(BASE_GAME_SIGMA, generated.prospectiveParallelV2.params.baseSigma);
assert.strictEqual(UNCERTAINTY_SCALE, 0);
for (const fold of generated.walkForward) {
  assert.ok(fold.train.every((season) => season < fold.validate));
  for (const metric of ["mae", "rmse", "brier", "logLoss"]) assert.ok(fold.deltaVsV1[metric] < 0);
}
for (const metric of ["absoluteMarginError", "squaredMarginError", "brier", "logLoss"]) {
  assert.strictEqual(generated.frozenCandidate.pairedUncertaintyVsV1[metric].replicates, 1000);
  assert.ok(generated.frozenCandidate.pairedUncertaintyVsV1[metric].bootstrap95[1] < 0);
}

const season = dataset.seasons.find((row) => row.season === 2025);
const game = season.games.find((row) => !row.neutralSite);
const neutral = phase1.predictGame(season, { ...game, neutralSite: true }, generated.frozenCandidate.params);
const home = phase1.predictGame(season, game, generated.frozenCandidate.params);
const reversed = phase1.predictGame(season, {
  ...game, gameId: `${game.gameId}-reverse`, homeId: game.awayId, awayId: game.homeId, neutralSite: true,
}, generated.frozenCandidate.params);
assert.strictEqual(home.projectedHomeMargin - neutral.projectedHomeMargin, 3);
assert.strictEqual(reversed.projectedHomeMargin, -neutral.projectedHomeMargin);
assert.ok(Math.abs(neutral.homeWinProbability + reversed.homeWinProbability - 1) < 1e-12);

const bootstrapA = phase1._internal.bootstrapMean([1, -2, 3, -4, 5], phase1.BOOTSTRAP_SEED, 1000);
const bootstrapB = phase1._internal.bootstrapMean([1, -2, 3, -4, 5], phase1.BOOTSTRAP_SEED, 1000);
assert.deepStrictEqual(bootstrapA, bootstrapB);
const searchA = phase2.search(dataset, [2021, 2022]);
const searchB = phase2.search(dataset, [2021, 2022]);
assert.deepStrictEqual(searchA.best, searchB.best);
assert.strictEqual(generated.parameterFindings.uncertainty.historicallyAvailable, false);
assert.notStrictEqual(dataset.sourceNotes.returningProduction, "SportsDataverse overall_returning");

console.log("cfbHistoricalCalibrationPhase2 self-test: PASS", {
  resultSha256: generated.resultSha256,
  candidate: generated.frozenCandidate.id,
  validationGames: generated.frozenCandidate.validationMetrics.n,
});
