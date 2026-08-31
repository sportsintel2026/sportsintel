"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { fitOffenseDefense, observationsFromGames } = require("../services/cfbOffenseDefense");
const datasetModule = require("./cfbHistoricalDatasetPhase3");
const calibration = require("./cfbHistoricalCalibrationPhase3");
const phase2 = require("./cfbHistoricalCalibrationPhase2");

const dataset = datasetModule.buildHistoricalDatasetPhase3();
assert.deepStrictEqual(dataset.targetSeasons, [2021, 2022, 2023, 2024, 2025]);
assert.ok(dataset.outcomeSeasons.every((season) => season < 2026));
assert.strictEqual(dataset.providerBudget.phase3NewCfbdCalls, 0);
assert.ok(dataset.seasons.every((row) => row.priorSeason === row.season - 1));
assert.ok(dataset.seasons.every((row) => row.coverage.finalEvaluatedGames > 600));
assert.ok(dataset.seasons.every((row) => row.coverage.teamsWithDefenseReturningProduction === 0));
assert.strictEqual(dataset.sourceNotes.qb.includes("No exact historical"), true);
assert.strictEqual(dataset.sourceNotes.transfers.includes("No cached"), true);

const synthetic = [0, 1, 2, 3].map((index) => ({
  gameId: `g${index}`,
  homeId: index % 2 ? "B" : "A",
  awayId: index % 2 ? "A" : "B",
  homePoints: index % 2 ? 10 : 30,
  awayPoints: index % 2 ? 30 : 10,
  neutralSite: true,
}));
const fitted = fitOffenseDefense(synthetic, {
  priorPseudoGames: 1, minimumGames: 4, iterations: 30, homeFieldPoints: 3,
});
assert.ok(fitted.teams.get("A").offenseRating > fitted.teams.get("B").offenseRating);
assert.ok(fitted.teams.get("A").defenseRating > fitted.teams.get("B").defenseRating);
const neutralObs = observationsFromGames(synthetic, 3);
assert.ok([...neutralObs.observations.values()].flat().every((row) => row.scoringVenueAdjustment === 0));

for (const season of dataset.seasons) {
  for (const game of season.games) {
    assert.ok(Date.parse(game.startDate) > 0);
    assert.strictEqual(game.season, season.season);
  }
  for (const team of season.teams.values()) {
    if (team.priorSourceSeason != null) assert.strictEqual(team.priorSourceSeason, season.season - 1);
    assert.strictEqual(team.defenseReturningProduction, null);
  }
}

const result = calibration.runHistoricalCalibrationPhase3(dataset);
assert.strictEqual(result.decision, "C — In-season-updating parallel v3 justified.");
assert.strictEqual(result.protocol.outcomesFrom2026Used, false);
assert.strictEqual(result.models.v1.params.returningProductionCoefficient, phase2.HISTORICAL_V1_PARAMS.returningProductionCoefficient);
assert.strictEqual(result.models.v2.params.returningProductionCoefficient, 1.25);
assert.strictEqual(result.models.v2.params.talentCoefficient, 2.5);
assert.strictEqual(result.models.phase3Updater.validation.metrics.n, 2210);
for (const metric of ["mae", "rmse", "brier", "logLoss"]) {
  assert.ok(result.models.phase3Updater.validation.metrics[metric]
    < result.models.v2.validation.metrics[metric], `${metric} must improve versus v2`);
}
assert.deepStrictEqual(Object.keys(result.models.phase3Updater.breakdowns.byMinimumPriorGames), ["0", "1", "2", "3", "4+"]);
assert.ok(result.models.phase3Updater.breakdowns.byMinimumPriorGames["1"].n > 0);
assert.ok(result.models.phase3Updater.breakdowns.byMinimumPriorGames["2"].n > 0);
assert.ok(result.models.phase3Updater.breakdowns.byMinimumPriorGames["3"].n > 0);
assert.ok(result.models.phase3Updater.breakdowns.byMinimumPriorGames["4+"].n > 0);
assert.ok(result.walkForward.every((fold) => fold.train.every((season) => season < fold.validate)));
assert.ok(result.walkForward.every((fold) => fold.updaterPriorGames >= 4));
assert.ok(["absoluteMarginError", "squaredMarginError", "brier", "logLoss"].every(
  (name) => result.bootstrap.vsV1[name].bootstrap95[1] < 0
    && result.bootstrap.vsV2[name].bootstrap95[1] < 0,
));
const bootstrapAgain = calibration.pairedBootstrap(
  result._predictionRows.updater,
  result._predictionRows.v2,
  200,
);
assert.deepStrictEqual(bootstrapAgain, result.bootstrap.vsV2);
assert.deepStrictEqual(result.prospectiveRefit.preseasonParams, {
  offenseReturningWeight: 1.5, talentWeight: 4, homeFieldAdvantage: 3, baseSigma: 17,
});
assert.strictEqual(result.prospectiveRefit.updaterPriorGames, 4);

const sameKickoffDataset = {
  seasons: [{
    season: 2025,
    games: [
      ...synthetic.map((game, index) => ({
        ...game,
        season: 2025,
        week: index + 1,
        startDate: `2025-09-0${index + 1}T12:00:00.000Z`,
        homeName: game.homeId,
        awayName: game.awayId,
        actualHomeMargin: game.homePoints - game.awayPoints,
      })),
      {
        gameId: "g4", season: 2025, week: 5, startDate: "2025-10-01T12:00:00.000Z",
        neutralSite: true, homeId: "A", awayId: "B", homeName: "A", awayName: "B",
        homePoints: 20, awayPoints: 17, actualHomeMargin: 3,
      },
    ],
  }],
};
const snapshots = calibration._internal.buildCurrentSeasonSnapshots(sameKickoffDataset);
const beforeFifth = snapshots.get(2025).get("2025-10-01T12:00:00.000Z");
assert.strictEqual(beforeFifth.gamesByTeam.get("A"), 4);
assert.strictEqual(beforeFifth.fit.teams.get("A").games, 4);
const shrunk = calibration._internal.posteriorTeam(
  { offense: 2, defense: 1 }, { offenseRating: 10, defenseRating: 5 }, 4, 4,
);
assert.deepStrictEqual(shrunk, { offense: 6, defense: 3, updated: true });
assert.deepStrictEqual(calibration._internal.posteriorTeam(
  { offense: 2, defense: 1 }, { offenseRating: 10, defenseRating: 5 }, 1, 4,
), { offense: 2, defense: 1, updated: false });

const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
assert.ok(!serverSource.includes("cfbHistoricalCalibrationPhase3"));
assert.ok(!serverSource.includes("cfbHistoricalDatasetPhase3"));
assert.ok(!serverSource.includes("cfb-historical-phase3-input"));

console.log("cfbHistoricalPhase3 self-test: PASS");
