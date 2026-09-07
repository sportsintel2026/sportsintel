"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildCfbPreseasonChallenger } = require("./cfbPreseasonChallenger");
const {
  MODEL_VERSION: TEAM_MODEL_VERSION,
  UPDATER_VERSION,
  ARCHITECTURE,
  buildCfbPreseasonChallengerV3,
} = require("./cfbPreseasonChallengerV3");
const {
  MODEL_VERSION,
  EXPERIMENT_VERSION,
  buildCfbGameShadowPredictionV3,
} = require("./cfbGameShadowChallengerV3");
const { _internal: collector } = require("./cfbGameShadowCollector");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function loadForPureBlendTest(request, parent, isMain) {
  if (request === "./oddsApi") return { getCFBMainOdds: async () => [], getCFBPinnacleClose: async () => [] };
  if (request === "./cfbDataSource") return { buildTeamRatings: async () => ({ teams: {}, rated: 0 }) };
  if (request === "@supabase/supabase-js") return { createClient: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};
const { _internal: cfbEdgesMath } = require("./cfbEdges");
Module._load = originalLoad;

const capturedAt = "2026-09-20T16:00:00.000Z";
const kickoffAt = "2026-09-20T20:00:00.000Z";

function snapshot(id, returning, talent) {
  return {
    id,
    season: 2026,
    contract_version: "cfb-preseason-input-v1-2026-08-30",
    snapshot_at: "2026-08-30T19:00:00.000Z",
    input_hash: String(id).repeat(64).slice(0, 64),
    team_name: `Team ${id}`,
    espn_team_id: String(id),
    cfbd_team_id: id,
    quarterback: { category: "unknown-unverified" },
    roster: { playerCount: 110, durableIdCount: 110, missingIdCount: 0, duplicateIdCount: 0 },
    returning_production: { recordFound: true, values: { percentPPA: returning } },
    transfers: { arrivals: [], departures: [], ambiguousIdentityCount: 0, unmatchedIdentityCount: 0, safelyJoinedCount: 1 },
    talent: { teamTalent: { year: 2026, talent }, recruitingTeams: [] },
    coaching: { identityStatus: "exact", tenureYears: 2, continuity: true },
    quality: { completeness: 1 },
  };
}

const snapshots = [
  snapshot(1, 0.15, 500), snapshot(2, 0.3, 600), snapshot(3, 0.45, 700),
  snapshot(4, 0.6, 800), snapshot(5, 0.75, 900), snapshot(6, 0.9, 1000),
];
const controls = Object.fromEntries(snapshots.map((row, index) => [String(row.espn_team_id), {
  espnTeamId: String(row.espn_team_id),
  teamName: row.team_name,
  priorSeason: 2025,
  currentSeason: 2026,
  priorRating: (index - 2.5) * 2,
  controlRating: (index - 2.5) * 2,
  currentGames: 0,
  ratingSource: "prior-only",
  sosApplied: true,
}]));
const completedGames = [4, 0, 1, 2, 3, 5];
const odTeams = Object.fromEntries(snapshots.map((row, index) => [String(row.espn_team_id), {
  priorOffenseRating: (index - 2.5) * 1.25,
  priorDefenseRating: (index - 2.5) * 0.75,
  priorOdGames: 12,
  currentOffenseRating: index === 0 ? 5 : null,
  currentDefenseRating: index === 0 ? 3 : null,
  currentOdGames: completedGames[index],
}]));
const odContext = {
  asOf: capturedAt,
  priorSeason: 2025,
  currentSeason: 2026,
  providerCallsAdded: 0,
  teams: odTeams,
};
const v1 = buildCfbPreseasonChallenger({
  snapshots: snapshots.map(collector.snapshotForChallenger),
  controlRatings: controls,
  generatedAt: capturedAt,
});
const v3 = buildCfbPreseasonChallengerV3({ v1Challenger: v1, odContext });
assert.strictEqual(v3.modelVersion, TEAM_MODEL_VERSION);
assert.strictEqual(v3.updaterVersion, UPDATER_VERSION);
assert.strictEqual(v3.diagnostics.providerCallsAdded, 0);
assert.strictEqual(v3.diagnostics.targetSeasonResultsUsedForFitting, false);
assert.strictEqual(v3.diagnostics.quarterbackDirectionalFeatureIncluded, false);
assert.strictEqual(v3.diagnostics.transferDirectionalFeatureIncluded, false);
assert.strictEqual(v3.teams[0].updaterActive, true);
assert.strictEqual(v3.teams[0].currentSeasonWeight, 0.5);
assert.strictEqual(v3.teams[1].updaterActive, false);
assert.strictEqual(v3.teams[1].currentSeasonWeight, 0);
assert.deepStrictEqual(v3.teams.map((team) => team.gamesUsed), completedGames);
assert.strictEqual(ARCHITECTURE.updaterMinimumGames, 4);
assert.strictEqual(ARCHITECTURE.updaterPriorGames, 4);
assert.strictEqual(v3.teams[0].features.quarterbackAdjustment, 0);
assert.strictEqual(v3.teams[0].features.transferAdjustment, 0);
assert.strictEqual(v3.teams[0].features.defenseReturningProduction, null);

const homeTeam = v3.teams.find((team) => team.team.espnTeamId === "1");
const awayTeam = v3.teams.find((team) => team.team.espnTeamId === "2");
const game = buildCfbGameShadowPredictionV3({
  game: { gameId: "v3-game", predictionAt: capturedAt, kickoffAt },
  homeTeam,
  awayTeam,
  neutralSiteStatus: "non-neutral",
  market: {
    h2h: { home: -120, away: 110, homeBook: "A", awayBook: "B" },
    spreads: { homeLine: -3, awayLine: 3, home: -110, away: -110, homeBook: "A", awayBook: "B" },
  },
});
assert.strictEqual(game.modelVersion, MODEL_VERSION);
assert.strictEqual(game.experimentVersion, EXPERIMENT_VERSION);
assert.strictEqual(game.provenance.targetSeasonOutcomesUsed, false);
assert.strictEqual(game.provenance.homeCurrentSeasonWeight, 0);
assert.strictEqual(game.provenance.awayCurrentSeasonWeight, 0);
assert.ok(Math.abs(game.projectedHomeMargin
  - (homeTeam.features.preseasonOffenseRating - awayTeam.features.preseasonDefenseRating
    - awayTeam.features.preseasonOffenseRating + homeTeam.features.preseasonDefenseRating + 3)) < 1e-7);
assert.ok(Math.abs(game.homeTeamRating
  - (homeTeam.features.preseasonOffenseRating + homeTeam.features.preseasonDefenseRating)) < 1e-7);
assert.strictEqual(game.provenance.homeGamesUsed, 4);
assert.strictEqual(game.provenance.updateAsOf, capturedAt);

const bothActiveOdContext = {
  ...odContext,
  teams: {
    ...odTeams,
    2: { ...odTeams[2], currentOffenseRating: 2, currentDefenseRating: 1, currentOdGames: 4 },
  },
};
const bothActiveV3 = buildCfbPreseasonChallengerV3({ v1Challenger: v1, odContext: bothActiveOdContext });
const activeGame = buildCfbGameShadowPredictionV3({
  game: { gameId: "v3-active-game", predictionAt: capturedAt, kickoffAt },
  homeTeam: bothActiveV3.teams.find((team) => team.team.espnTeamId === "1"),
  awayTeam: bothActiveV3.teams.find((team) => team.team.espnTeamId === "2"),
  neutralSiteStatus: "non-neutral",
  market: { h2h: {}, spreads: {} },
});
assert.strictEqual(activeGame.provenance.targetSeasonOutcomesUsed, true);
assert.ok(activeGame.provenance.homeCurrentSeasonWeight > 0);
assert.ok(activeGame.provenance.awayCurrentSeasonWeight > 0);

const priorRatings = { teams: Object.fromEntries(snapshots.slice(0, 5).map((row) => [String(row.espn_team_id), {
  rating: 1, offenseRating: 0.5, defenseRating: 0.5, sosApplied: true,
}])) };
const earlyCurrent = { teams: {}, completedGamesByTeam: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 } };
const earlyBlend = cfbEdgesMath.blendRatings(priorRatings, earlyCurrent);
assert.deepStrictEqual(
  Object.keys(earlyBlend.teams).sort().map((id) => earlyBlend.teams[id].currentOdGames),
  [0, 1, 2, 3, 4],
);

const event = {
  eventId: "v3-game",
  commenceTime: kickoffAt,
  homeTeam: "Team 1",
  awayTeam: "Team 2",
  neutralSite: false,
  h2h: { home: -120, away: 110, homeBook: "A", awayBook: "B" },
  spreads: { homeLine: -3, awayLine: 3, home: -110, away: -110, homeBook: "A", awayBook: "B" },
};
const plan = collector.prepareCandidates({
  snapshots,
  usEvents: [event],
  ledgerRows: [{ game_id: "v3-game", neutral_site_status: "non-neutral" }],
  capturedAt,
  controls,
  odContext,
});
assert.strictEqual(plan.candidates.length, 1);
assert.strictEqual(plan.v2Candidates.length, 1);
assert.strictEqual(plan.v3Candidates.length, 1);
assert.strictEqual(plan.v3Candidates[0].input.prediction_at, plan.candidates[0].input.prediction_at);
assert.deepStrictEqual(plan.v3Candidates[0].prediction.market, plan.candidates[0].prediction.market);
assert.strictEqual(plan.v3Candidates[0].input.game_context.shadowProvenance.updaterVersion, UPDATER_VERSION);
assert.strictEqual(plan.v3Candidates[0].input.game_context.week, 3);
assert.strictEqual(plan.v3Candidates[0].input.quality.targetSeasonOutcomesUsed, false);
assert.strictEqual(plan.v3Candidates[0].input.home_current_season_weight, 0);
const withoutContext = collector.prepareCandidates({
  snapshots,
  usEvents: [event],
  ledgerRows: [{ game_id: "v3-game", neutral_site_status: "non-neutral" }],
  capturedAt,
  controls,
});
assert.strictEqual(withoutContext.v3Candidates.length, 0);
assert.strictEqual(withoutContext.candidates.length, 1);
assert.strictEqual(withoutContext.v2Candidates.length, 1);

for (const file of ["cfbPreseasonChallengerV3.js", "cfbGameShadowChallengerV3.js", "cfbOffenseDefense.js"]) {
  const source = fs.readFileSync(path.join(__dirname, file), "utf8");
  for (const forbidden of ["fetch(", "getCFBMainOdds", "getCFBPinnacleClose", "createClient(", ".from("]) {
    assert.ok(!source.includes(forbidden), `${file} contains provider/database surface ${forbidden}`);
  }
}
const frontendFiles = fs.readdirSync(path.join(__dirname, "../../frontend/src"), { recursive: true })
  .filter((name) => String(name).endsWith(".jsx") || String(name).endsWith(".js"));
for (const name of frontendFiles) {
  const source = fs.readFileSync(path.join(__dirname, "../../frontend/src", name), "utf8");
  assert.ok(!source.includes(MODEL_VERSION), `frontend imports/exposes v3 in ${name}`);
}

console.log("cfbGameShadowV3 self-test: PASS");
