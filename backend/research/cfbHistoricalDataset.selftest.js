"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  INPUT_PATH,
  TARGET_SEASONS,
  SRS_CONFIG,
  loadInputSnapshot,
  buildHistoricalSrs,
  buildHistoricalDataset,
  _internal,
} = require("./cfbHistoricalDataset");

const input = loadInputSnapshot();
assert.deepStrictEqual(input.targetSeasons, [...TARGET_SEASONS]);
assert.strictEqual(input.providerBudget.cfbdApiCalls, 0);
assert.strictEqual(input.providerBudget.oddsApiCalls, 0);
assert.strictEqual(input.providerBudget.pinnacleCalls, 0);
assert.strictEqual(input.providerBudget.espnApiCalls, 0);
assert.ok(input.providerBudget.cfbdApiCalls <= 40);
assert.ok(input.schedules.every((row) => row.season <= 2025));
assert.ok(input.returningProduction.every((row) => row.season <= 2025));
assert.ok(input.talent.every((row) => row.season <= 2025));

const dataset = buildHistoricalDataset(input);
assert.deepStrictEqual(dataset.outcomeSeasons, [2021, 2022, 2023, 2024, 2025]);
assert.ok(dataset.seasons.every((row) => row.priorSeason === row.season - 1));
assert.ok(dataset.seasons.every((row) => row.games.length >= 650));
assert.ok(dataset.seasons.every((row) => row.coverage.identityFailures === 0));
assert.ok(dataset.seasons.every((row) => row.coverage.finalEvaluatedGames
  + row.coverage.gamesExcluded === row.coverage.gamesEligibleBeforePriorGate));

// Target-season scores can alter outcomes, but never preseason ratings/features.
const changedTarget = JSON.parse(JSON.stringify(input));
changedTarget.schedules = changedTarget.schedules.map((row) => row.season === 2025
  ? { ...row, home: { ...row.home, points: row.home.points + 70 } } : row);
const changedTargetDataset = buildHistoricalDataset(changedTarget);
const original2025 = dataset.seasons.find((row) => row.season === 2025);
const changed2025 = changedTargetDataset.seasons.find((row) => row.season === 2025);
assert.deepStrictEqual(
  [...original2025.teams.values()].map((row) => [row.teamId, row.priorRating, row.returningResidualZ, row.talentResidualZ]),
  [...changed2025.teams.values()].map((row) => [row.teamId, row.priorRating, row.returningResidualZ, row.talentResidualZ]),
);
assert.notStrictEqual(original2025.games[0].actualHomeMargin, changed2025.games[0].actualHomeMargin);

// The prior does respond to prior-season scores, proving the year link is Y-1.
const changedPrior = JSON.parse(JSON.stringify(input));
changedPrior.schedules = changedPrior.schedules.map((row) => row.season === 2024
  ? { ...row, home: { ...row.home, points: row.home.points + 7 } } : row);
const changedPrior2025 = buildHistoricalDataset(changedPrior).seasons.find((row) => row.season === 2025);
assert.notDeepStrictEqual(
  [...original2025.teams.values()].map((row) => [row.teamId, row.priorRating]),
  [...changedPrior2025.teams.values()].map((row) => [row.teamId, row.priorRating]),
);

// Neutral, home, and away representations are explicit and outcome-independent.
assert.ok(dataset.seasons.flatMap((row) => row.games).some((game) => game.neutralSite));
assert.ok(dataset.seasons.flatMap((row) => row.games).some((game) => !game.neutralSite));
assert.ok(dataset.seasons.flatMap((row) => row.games).every((game) => game.homeId !== game.awayId));

// Exact durable team IDs are mandatory. Missing or duplicate identities are not
// fuzzy-matched or silently collapsed.
const duplicate = JSON.parse(JSON.stringify(input));
duplicate.returningProduction.push({ ...duplicate.returningProduction[0] });
assert.throws(() => buildHistoricalDataset(duplicate), /duplicate team identities/);

const missingFeature = JSON.parse(JSON.stringify(input));
const matched2025TeamIds = new Set(dataset.seasons.find((row) => row.season === 2025).teams.keys());
const removed = missingFeature.returningProduction.find((row) => (
  row.season === 2025 && matched2025TeamIds.has(String(row.teamId))
));
assert.ok(removed, "expected a matched 2025 returning-production row");
missingFeature.returningProduction = missingFeature.returningProduction.filter((row) => row !== removed);
const missingDataset = buildHistoricalDataset(missingFeature);
const missingTeam = missingDataset.seasons.find((row) => row.season === 2025).teams.get(removed.teamId);
assert.ok(missingTeam, "expected the matched team to remain in the dataset");
assert.strictEqual(missingTeam.returningProduction, null);
assert.strictEqual(missingTeam.returningResidualZ, null);
assert.strictEqual(missingTeam.uncertainty.components.returningProduction, 1.25);

// The pure SRS builder uses the frozen active configuration and rejects teams
// below the production minimum-game gate.
assert.deepStrictEqual(SRS_CONFIG, {
  regression: 0.72,
  minimumGames: 4,
  marginCap: 28,
  iterations: 12,
  fcsLevel: -28,
  sosWeight: 0.8,
});
const syntheticSchedule = [];
for (let game = 0; game < 4; game++) {
  syntheticSchedule.push({
    gameId: String(game), season: 2020, seasonType: "regular", neutralSite: false,
    home: { id: "1", name: "Alpha", division: "fbs", points: 35 },
    away: { id: "2", name: "Beta", division: "fbs", points: 14 },
  });
}
const syntheticSrs = buildHistoricalSrs(syntheticSchedule, 2020);
assert.strictEqual(syntheticSrs.ratedTeams, 2);
assert.ok(syntheticSrs.teams.get("1").priorRating > 0);
assert.ok(syntheticSrs.teams.get("2").priorRating < 0);
assert.strictEqual(
  syntheticSrs.teams.get("1").priorRating,
  -syntheticSrs.teams.get("2").priorRating,
);

// The committed snapshot is self-authenticating and deterministic.
const raw = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
const { contentSha256, ...body } = raw;
assert.strictEqual(_internal.canonicalHash(body), contentSha256);
assert.strictEqual(contentSha256, input.contentSha256);

// Research code remains inert and cannot reach providers, databases, customer
// tables, customer routes, or production scheduling.
for (const file of ["cfbHistoricalDataset.js", "cfbHistoricalCalibration.js"]) {
  const source = fs.readFileSync(path.join(__dirname, file), "utf8");
  assert.ok(!/require\(["']\.\.\/routes\//.test(source));
  assert.ok(!/require\(["']\.\.\/server/.test(source));
  assert.ok(!/require\(["']\.\.\/services\/(?:cfbdApi|cfbEdges|cfbModel|predictionTracker)/.test(source));
  assert.ok(!/\b(?:fetch|axios)\s*\(/.test(source));
  assert.ok(!/\.(?:insert|upsert|delete)\s*\(/.test(source));
  assert.ok(!/\b(?:supabase|serviceRole)\b/i.test(source));
  assert.ok(!/model_predictions|cfb_game_shadow_predictions|cfb_team_preseason_snapshots/.test(source));
}
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
assert.ok(!serverSource.includes("cfbHistoricalDataset"));
assert.ok(!serverSource.includes("cfbHistoricalCalibration"));

console.log("cfbHistoricalDataset self-test: PASS", {
  inputContentSha256: input.contentSha256,
  seasons: dataset.seasons.map((row) => ({
    season: row.season,
    games: row.games.length,
    teams: row.coverage.expectedFbsTeams,
  })),
  cfbdApiCalls: input.providerBudget.cfbdApiCalls,
});
