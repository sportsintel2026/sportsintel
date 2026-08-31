"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const phase1 = require("./cfbHistoricalDataset");
const {
  TARGET_SEASONS,
  loadSemanticInput,
  buildHistoricalDatasetPhase2,
} = require("./cfbHistoricalDatasetPhase2");

const semantic = loadSemanticInput();
assert.deepStrictEqual(semantic.targetSeasons, [...TARGET_SEASONS]);
assert.strictEqual(semantic.providerBudget.cfbdDataCalls, 5);
assert.ok(semantic.providerBudget.cfbdApiCallsAttempted <= 40);
assert.ok(semantic.rows.every((row) => row.season < 2026 && Number.isFinite(row.percentPPA)));
assert.strictEqual(new Set(semantic.rows.map((row) => `${row.season}:${row.espnTeamId}`)).size, semantic.rows.length);

const input = phase1.loadInputSnapshot();
const dataset = buildHistoricalDatasetPhase2(input, semantic);
assert.deepStrictEqual(dataset.outcomeSeasons, [2021, 2022, 2023, 2024, 2025]);
assert.ok(dataset.seasons.every((row) => row.priorSeason === row.season - 1));
assert.ok(dataset.seasons.every((row) => row.coverage.identityFailures === 0));
assert.ok(dataset.seasons.every((row) => row.coverage.exactSemanticIdentityMatches >= 128));
assert.strictEqual(dataset.uncertainty.available, false);
assert.strictEqual(dataset.uncertainty.sd, 0);
for (const seasonRow of dataset.seasons) {
  for (const team of seasonRow.teams.values()) {
    if (team.returningProduction != null) {
      assert.strictEqual(team.returningProductionSource, "cfbd-percentPPA");
      assert.strictEqual(team.returningProductionTargetSeason, seasonRow.season);
    }
    if (team.priorRating != null) assert.strictEqual(team.priorSourceSeason, seasonRow.priorSeason);
  }
}

// Target-year score mutation changes outcomes but never prediction-time features.
const changed = JSON.parse(JSON.stringify(input));
changed.schedules = changed.schedules.map((row) => row.season === 2025
  ? { ...row, home: { ...row.home, points: row.home.points + 70 } } : row);
const changedDataset = buildHistoricalDatasetPhase2(changed, semantic);
const original2025 = dataset.seasons.find((row) => row.season === 2025);
const changed2025 = changedDataset.seasons.find((row) => row.season === 2025);
assert.deepStrictEqual(
  [...original2025.teams.values()].map((row) => [row.teamId, row.priorRating, row.returningResidualZ, row.talentResidualZ]),
  [...changed2025.teams.values()].map((row) => [row.teamId, row.priorRating, row.returningResidualZ, row.talentResidualZ]),
);
assert.notStrictEqual(original2025.games[0].actualHomeMargin, changed2025.games[0].actualHomeMargin);

// Exact identity is mandatory; no fuzzy fallback accepts a renamed source row.
const badSemantic = JSON.parse(JSON.stringify(semantic));
badSemantic.rows[0].cfbdTeamName = `${badSemantic.rows[0].cfbdTeamName} mismatch`;
assert.throws(() => buildHistoricalDatasetPhase2(input, badSemantic), /not unique\/exact/);

for (const file of ["cfbHistoricalDatasetPhase2.js", "cfbHistoricalCalibrationPhase2.js"]) {
  const source = fs.readFileSync(path.join(__dirname, file), "utf8");
  assert.ok(!/require\(["']\.\.\/routes\//.test(source));
  assert.ok(!/require\(["']\.\.\/server/.test(source));
  assert.ok(!/require\(["']\.\.\/services\/(?:cfbdApi|cfbEdges|cfbModel|predictionTracker)/.test(source));
  assert.ok(!/\b(?:fetch|axios)\s*\(/.test(source));
  assert.ok(!/\.(?:insert|upsert|delete)\s*\(/.test(source));
  assert.ok(!/model_predictions|cfb_game_shadow_predictions/.test(source));
}

console.log("cfbHistoricalDatasetPhase2 self-test: PASS", {
  semanticRows: semantic.rows.length,
  validationGames: dataset.seasons.filter((row) => row.season >= 2023)
    .reduce((sum, row) => sum + row.games.length, 0),
  cfbdDataCalls: semantic.providerBudget.cfbdDataCalls,
});
