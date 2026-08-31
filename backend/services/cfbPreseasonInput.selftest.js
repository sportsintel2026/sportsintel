#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  CONTRACT_VERSION,
  reconcileTeamIdentities,
  reconcilePlayerIdentity,
  adaptReturningProduction,
  adaptTransfers,
  adaptTalent,
  adaptCoaching,
  classifyQuarterback,
  buildTeamPreseasonSnapshot,
  buildCoverageReport,
  stableStringify,
  inputHash,
  _internal,
} = require("./cfbPreseasonInput");

const originalFetch = global.fetch;
global.fetch = async () => { throw new Error("Gate B pure contract must not call a provider"); };

assert.strictEqual(_internal.nullableNumber(false), null);
assert.strictEqual(_internal.nullableNumber("   "), null);
assert.strictEqual(_internal.nullableNumber(0), 0);

const espnTeams = [
  { id: "333", displayName: "Alabama Crimson Tide", location: "Alabama" },
  { id: "41", displayName: "Connecticut Huskies", location: "Connecticut" },
  { id: "miami-test", displayName: "Miami Test", location: "Miami" },
  { id: "404", displayName: "Unknown State Owls", location: "Unknown State" },
];
const cfbdTeams = [
  { id: 8, school: "Alabama", alternateNames: ["Alabama Crimson Tide"] },
  { id: 2116, school: "UConn", alternateNames: ["Connecticut"] },
  { id: 1001, school: "Miami" },
  { id: 1002, school: "Miami" },
];

const identities = reconcileTeamIdentities({
  espnTeams,
  cfbdTeams,
  explicitMappings: { "41": "2116" },
});
assert.deepStrictEqual(identities.map((row) => row.status), ["exact", "mapped", "ambiguous", "unmatched"]);
assert.strictEqual(identities[0].cfbdTeamId, "8");
assert.strictEqual(identities[1].cfbdTeamId, "2116");
assert.strictEqual(identities[2].cfbdTeamId, null);
assert.strictEqual(identities[3].cfbdTeamId, null);
assert.throws(() => buildTeamPreseasonSnapshot({
  season: 2026,
  snapshotAt: "2026-08-29T22:00:00Z",
  identity: identities[2],
}), /unsafe team identity/);

const duplicateCfbdId = reconcileTeamIdentities({
  espnTeams: [{ id: "dup-espn", displayName: "Duplicate State" }],
  cfbdTeams: [
    { id: 500, school: "Duplicate State" },
    { id: 500, school: "Duplicate State", alternateNames: ["Duplicate State"] },
  ],
});
assert.strictEqual(duplicateCfbdId[0].status, "ambiguous");
assert.match(duplicateCfbdId[0].reason, /duplicate CFBD durable team ID/);

const duplicateEspnId = reconcileTeamIdentities({
  espnTeams: [
    { id: "same-espn", displayName: "Alpha State" },
    { id: "same-espn", displayName: "Beta State" },
  ],
  cfbdTeams: [{ id: 501, school: "Alpha State" }, { id: 502, school: "Beta State" }],
});
assert.deepStrictEqual(duplicateEspnId.map((row) => row.status), ["ambiguous", "ambiguous"]);
assert.ok(duplicateEspnId.every((row) => /duplicate ESPN durable team ID/.test(row.reason)));
assert.strictEqual(reconcileTeamIdentities({
  espnTeams: [{ displayName: "No ID State" }],
  cfbdTeams: [{ id: 503, school: "No ID State" }],
})[0].status, "unmatched");
const convergedTeamIdentity = reconcileTeamIdentities({
  espnTeams: [{ id: "a", displayName: "Alpha" }, { id: "b", displayName: "Beta" }],
  cfbdTeams: [{ id: 504, school: "Canonical" }],
  explicitMappings: { a: "504", b: "504" },
});
assert.deepStrictEqual(convergedTeamIdentity.map((row) => row.status), ["ambiguous", "ambiguous"]);
assert.throws(() => buildTeamPreseasonSnapshot({
  season: 2026,
  snapshotAt: "2026-08-29T22:00:00Z",
  identity: identities[3],
}), /unsafe team identity/);

const roster = [
  { id: "player-1", firstName: "Pat", lastName: "Quarterback" },
  { id: "player-2", firstName: "Alex", lastName: "Transfer" },
];
assert.deepStrictEqual(
  reconcilePlayerIdentity({ playerId: "player-1" }, roster).status,
  "exact"
);
const unsafeName = reconcilePlayerIdentity({ firstName: "Alex", lastName: "Transfer" }, roster);
assert.strictEqual(unsafeName.status, "ambiguous");
assert.strictEqual(unsafeName.playerId, null);
assert.deepStrictEqual(unsafeName.candidatePlayerIds, ["player-2"]);
const duplicatePlayerId = reconcilePlayerIdentity(
  { playerId: "duplicate-player" },
  [{ id: "duplicate-player", name: "One" }, { id: "duplicate-player", name: "Two" }]
);
assert.strictEqual(duplicatePlayerId.status, "ambiguous");
assert.strictEqual(duplicatePlayerId.playerId, null);
assert.deepStrictEqual(
  reconcilePlayerIdentity({ sourceKey: "portal:alex" }, roster, { "portal:alex": "player-2" }),
  { status: "mapped", playerId: "player-2", reason: "explicit durable player mapping" }
);

const transferRows = [
  { firstName: "Alex", lastName: "Transfer", position: "WR", origin: "Other", destination: "Alabama" },
  { playerId: "player-1", firstName: "Pat", lastName: "Quarterback", position: "QB", origin: "Alabama", destination: "Next" },
];
const transfers = adaptTransfers(transferRows, "Alabama", roster, {}, { available: true });
assert.strictEqual(transfers.arrivals.length, 1);
assert.strictEqual(transfers.arrivals[0].direction, "arrival");
assert.strictEqual(transfers.arrivals[0].identity.status, "ambiguous");
assert.strictEqual(transfers.departures.length, 1);
assert.strictEqual(transfers.departures[0].direction, "departure");
assert.strictEqual(transfers.departures[0].identity.status, "exact");

assert.strictEqual(classifyQuarterback({
  category: "confirmed-transfer-starter",
  evidenceStatus: "confirmed",
  playerName: "Name Without ID",
}).category, "unknown-unverified");
assert.strictEqual(classifyQuarterback({}).category, "unknown-unverified");
const openCompetition = classifyQuarterback({
  category: "open-competition",
  evidenceStatus: "confirmed",
  confidence: "medium",
  source: "published-depth-chart",
  retrievedAt: "2026-08-20T13:00:00Z",
  effectiveAt: "2026-08-20T12:00:00Z",
});
assert.strictEqual(openCompetition.category, "open-competition");
assert.strictEqual(openCompetition.confidence, "medium");
assert.strictEqual(classifyQuarterback({
  category: "returning-established-starter",
  evidenceStatus: "confirmed",
  identityStatus: "exact",
  playerId: "player-1",
  playerName: "Pat Quarterback",
  confidence: "high",
  source: "depth-chart-confirmation",
  retrievedAt: "2026-08-20T13:00:00-04:00",
  effectiveAt: "2026-08-20T12:00:00-04:00",
}).category, "returning-established-starter");

const source = (endpoint, overrides = {}) => ({
  provider: "CFBD",
  endpoint,
  version: "2026-v1",
  retrievedAt: "2026-08-29T18:00:00-04:00",
  effectiveAt: "2026-08-29T00:00:00-04:00",
  season: 2026,
  available: true,
  historicallyAsOfSafe: false,
  ...overrides,
});
const sources = {
  teams: source("/teams/fbs?year=2026", { historicallyAsOfSafe: true }),
  roster: source("/roster?year=2026&classification=fbs"),
  returningProduction: source("/player/returning?year=2026"),
  transfers: source("/player/portal?year=2026"),
  talent: source("/talent?year=2026"),
  recruitingTeams: source("/recruiting/teams?year=2026"),
  recruitingPlayers: source("/recruiting/players?year=2026"),
  coaching: source("/coaches?year=2026"),
  externalRatings: source("/ratings/sp?year=2026"),
};
const returning = {
  season: 2026,
  team: "Alabama",
  conference: "SEC",
  totalPPA: 180,
  totalPassingPPA: 90,
  totalReceivingPPA: 50,
  totalRushingPPA: 40,
  percentPPA: 0.68,
  percentPassingPPA: 0.61,
  percentReceivingPPA: 0.70,
  percentRushingPPA: 0.74,
  usage: 0.72,
  passingUsage: 0.63,
  receivingUsage: 0.75,
  rushingUsage: 0.76,
};

const completeInput = {
  season: 2026,
  snapshotAt: "2026-08-29T22:00:00Z",
  identity: identities[0],
  sources,
  priorWizePicksRating: { season: 2025, rating: 12.4, formulaVersion: "cfb-srs-v1" },
  externalRatingRow: { year: 2026, team: "Alabama", rating: 24.5, ranking: 3, sos: 8.1 },
  qbEvidence: {
    category: "returning-established-starter",
    evidenceStatus: "confirmed",
    identityStatus: "exact",
    playerId: "player-1",
    playerName: "Pat Quarterback",
    confidence: "high",
    source: "depth-chart-confirmation",
    retrievedAt: "2026-08-20T17:00:00Z",
    effectiveAt: "2026-08-20T16:00:00Z",
  },
  returningProductionRow: returning,
  transferRows,
  rosterPlayers: roster,
  talentRow: { year: 2026, team: "Alabama", talent: 982.4 },
  recruitingTeamRows: [{ year: 2026, rank: 2, points: 301.2 }, { year: 2025, rank: 1, points: 310.5 }],
  recruitingPlayerRows: [{ id: "recruit-1", athleteId: "player-1", year: 2025, position: "QB", stars: 5, rating: 0.99, committedTo: "Alabama" }],
  coaches: [{
    id: "coach-1", firstName: "Casey", lastName: "Coach",
    seasons: [
      { teamId: 8, school: "Alabama", year: 2025, games: 13, wins: 11, losses: 2 },
      { teamId: 8, school: "Alabama", year: 2026, games: 0, wins: 0, losses: 0 },
    ],
  }],
};

const complete = buildTeamPreseasonSnapshot(completeInput);
assert.strictEqual(complete.contractVersion, CONTRACT_VERSION);
assert.strictEqual(complete.sources.returningProduction.retrievedAt, "2026-08-29T22:00:00.000Z");
assert.strictEqual(complete.sources.returningProduction.effectiveAt, "2026-08-29T04:00:00.000Z");
assert.strictEqual(complete.sources.returningProduction.historicallyAsOfSafe, false);
assert.strictEqual(complete.priorReferences.externalRating.researchOnly, true);
assert.strictEqual(complete.roster.playerCount, 2);
assert.strictEqual(complete.roster.durableIdCount, 2);
assert.strictEqual(complete.returningProduction.values.totalPPA, 180);
assert.strictEqual(complete.returningProduction.values.nonexistent, undefined);
assert.strictEqual(complete.transfers.arrivals[0].priorUsage, null);
assert.strictEqual(complete.quality.domains.transfers.available, true);
assert.strictEqual(complete.quality.domains.transfers.reliablyUsable, false);
assert.ok(complete.quality.historicalBacktestUnsafeSources.includes("returningProduction"));
assert.deepStrictEqual(complete.quality.missingRetrievalTimes, []);
assert.deepStrictEqual(complete.quality.missingEffectiveTimes, []);
assert.deepStrictEqual(complete.quality.missingSourceSeasons, []);
assert.deepStrictEqual(complete.quality.sourceSeasonMismatches, []);
assert.strictEqual(complete.inputHash.length, 64);
assert.strictEqual(Object.isFrozen(complete), true);
assert.strictEqual(Object.isFrozen(complete.returningProduction.values), true);

const emptyReturning = adaptReturningProduction(null, { available: true });
const missingReturningSource = adaptReturningProduction(null, { available: false });
assert.strictEqual(emptyReturning.available, true);
assert.strictEqual(emptyReturning.recordFound, false);
assert.strictEqual(missingReturningSource.available, false);
const emptyTransfers = adaptTransfers([], "Alabama", roster, {}, { available: true });
const missingTransfers = adaptTransfers([], "Alabama", roster, {}, { available: false });
assert.strictEqual(emptyTransfers.available, true);
assert.deepStrictEqual(emptyTransfers.arrivals, []);
assert.strictEqual(missingTransfers.available, false);
const emptyRecruiting = adaptTalent({
  sources: {
    talent: { available: true },
    recruitingTeams: { available: true },
    recruitingPlayers: { available: true },
  },
});
const missingRecruiting = adaptTalent({
  sources: {
    talent: { available: false },
    recruitingTeams: { available: false },
    recruitingPlayers: { available: false },
  },
});
assert.strictEqual(emptyRecruiting.available, true);
assert.strictEqual(emptyRecruiting.recordCount, 0);
assert.strictEqual(missingRecruiting.available, false);

const duplicateCoachSeason = adaptCoaching([{
  id: "duplicate-coach",
  seasons: [
    { teamId: 8, year: 2026, games: 0 },
    { teamId: 8, year: 2026, games: 1 },
  ],
}], { season: 2026, cfbdTeamId: "8", source: { available: true } });
assert.strictEqual(duplicateCoachSeason.identityStatus, "ambiguous");

const missingReturning = buildTeamPreseasonSnapshot({
  ...completeInput,
  identity: identities[1],
  returningProductionRow: { ...returning, team: "UConn", totalPassingPPA: null },
  transferRows: [],
  rosterPlayers: [],
  talentRow: null,
  recruitingTeamRows: [],
  recruitingPlayerRows: [],
  coaches: [],
  qbEvidence: {},
  sources: {
    ...sources,
    talent: source("/talent?year=2026", { available: false }),
    coaching: source("/coaches?year=2026", { available: false }),
  },
});
assert.strictEqual(missingReturning.returningProduction.values.totalPassingPPA, null);
assert.notStrictEqual(missingReturning.returningProduction.values.totalPassingPPA, 0);
assert.ok(missingReturning.returningProduction.missingFields.includes("totalPassingPPA"));
assert.strictEqual(missingReturning.quarterback.category, "unknown-unverified");
assert.ok(missingReturning.quality.missingSources.includes("talent"));
assert.ok(missingReturning.quality.missingSources.includes("coaching"));
const staleSourceSeason = buildTeamPreseasonSnapshot({
  ...completeInput,
  sources: {
    ...sources,
    roster: source("/roster?year=2025&classification=fbs", { season: 2025 }),
  },
});
assert.deepStrictEqual(staleSourceSeason.quality.sourceSeasonMismatches, ["roster"]);
assert.strictEqual(staleSourceSeason.quality.domains.roster.reliablyUsable, false);

const completeAgain = buildTeamPreseasonSnapshot({
  ...completeInput,
  sources: Object.fromEntries(Object.entries(sources).reverse()),
  transferRows: [...transferRows].reverse(),
  rosterPlayers: [...roster].reverse(),
  recruitingTeamRows: [...completeInput.recruitingTeamRows].reverse(),
  recruitingPlayerRows: [...completeInput.recruitingPlayerRows].reverse(),
});
assert.strictEqual(completeAgain.inputHash, complete.inputHash);
const retryAtDifferentCollectionTime = buildTeamPreseasonSnapshot({
  ...completeInput,
  snapshotAt: "2026-08-29T23:00:00Z",
  qbEvidence: { ...completeInput.qbEvidence, retrievedAt: "2026-08-20T18:00:00Z" },
  sources: Object.fromEntries(Object.entries(sources).map(([name, stamp]) => [name, {
    ...stamp,
    retrievedAt: "2026-08-29T18:30:00-04:00",
  }])),
});
assert.strictEqual(retryAtDifferentCollectionTime.inputHash, complete.inputHash);
const changedEvidence = buildTeamPreseasonSnapshot({
  ...completeInput,
  returningProductionRow: { ...returning, totalPPA: 181 },
});
assert.notStrictEqual(changedEvidence.inputHash, complete.inputHash);
const changedEffectiveTime = buildTeamPreseasonSnapshot({
  ...completeInput,
  sources: {
    ...sources,
    returningProduction: source("/player/returning?year=2026", {
      effectiveAt: "2026-08-29T01:00:00-04:00",
    }),
  },
});
assert.notStrictEqual(changedEffectiveTime.inputHash, complete.inputHash);
assert.throws(() => buildTeamPreseasonSnapshot({
  ...completeInput,
  sources: {
    ...sources,
    roster: source("/roster?year=2026&classification=fbs", {
      retrievedAt: "2026-08-30T00:00:01Z",
    }),
  },
}), /retrieval time cannot be after snapshotAt/);
assert.throws(() => buildTeamPreseasonSnapshot({
  ...completeInput,
  qbEvidence: { ...completeInput.qbEvidence, retrievedAt: "2026-08-30T00:00:01Z" },
}), /quarterback evidence retrieval time cannot be after snapshotAt/);
assert.throws(() => buildTeamPreseasonSnapshot({
  ...completeInput,
  qbEvidence: { ...completeInput.qbEvidence, effectiveAt: "2026-08-30T00:00:01Z" },
}), /quarterback evidence effective time cannot be after snapshotAt/);
assert.strictEqual(stableStringify({ z: 1, a: { y: 2, b: 3 } }), stableStringify({ a: { b: 3, y: 2 }, z: 1 }));
assert.strictEqual(inputHash({ b: 2, a: 1 }), inputHash({ a: 1, b: 2 }));

const coverage = buildCoverageReport([complete, missingReturning], {
  expectedFbsTeams: 4,
  identityResolutions: identities,
});
assert.deepStrictEqual(coverage.identity, { exact: 1, mapped: 1, ambiguous: 1, unmatched: 1 });
assert.strictEqual(coverage.expectedFbsTeams, 4);
assert.strictEqual(coverage.identityEvaluated, 4);
assert.strictEqual(coverage.rejectedIdentityCount, 2);
assert.strictEqual(coverage.safeSnapshotRate, 0.5);
assert.strictEqual(coverage.expectedTeamMissingnessRate, 0.5);
assert.strictEqual(coverage.coverage.returningProduction.available, 2);
assert.strictEqual(coverage.coverage.returningProduction.reliablyUsable, 1);
assert.strictEqual(coverage.coverage.returningProduction.availableRate, 0.5);
assert.strictEqual(coverage.coverage.returningProduction.reliablyUsableRate, 0.25);
assert.strictEqual(coverage.qbClassificationCoverage.available, 1);
assert.strictEqual(coverage.playerJoinAmbiguity, 1);
assert.ok(coverage.averageCompleteness < 1);
assert.ok(coverage.sourceAvailabilityRate < 1);
assert.ok(coverage.sourceMissingnessRate > 0);
const emptyCoverage = buildCoverageReport([], { expectedFbsTeams: 4, identityResolutions: identities });
assert.strictEqual(emptyCoverage.sourceAvailabilityRate, 0);
assert.strictEqual(emptyCoverage.sourceMissingnessRate, 1);

// Negative integration guard: Gate B must remain absent from every active customer,
// model, recorder, and scheduler path until a later explicitly approved phase.
for (const relative of ["../server.js", "./cfbEdges.js", "./cfbModel.js", "./predictionTracker.js"]) {
  const file = path.resolve(__dirname, relative);
  assert.ok(!fs.readFileSync(file, "utf8").includes("cfbPreseasonInput"), `${relative} consumes Gate B`);
}
const proposedSql = fs.readFileSync(path.resolve(__dirname, "../../sql/cfb_preseason_shadow.sql"), "utf8");
assert.ok(proposedSql.startsWith("-- PROPOSAL ONLY"));
assert.match(proposedSql, /begin;[\s\S]*commit;\s*$/i);
assert.ok(proposedSql.includes("alter table public.cfb_team_preseason_snapshots enable row level security"));
assert.ok(proposedSql.includes("alter table public.cfb_game_input_snapshots enable row level security"));
assert.ok(proposedSql.includes("jsonb_typeof(quality->'completeness') = 'number'"));
assert.ok(proposedSql.includes("coalesce(jsonb_typeof(transfers->'arrivals') = 'array', false)"));
assert.ok(!/if\s+not\s+exists/i.test(proposedSql));
assert.ok(!/grant\s+(?:[^;]*,\s*)?(?:update|delete)/i.test(proposedSql));
assert.ok(!/grant\s+usage\s*,\s*select\s+on\s+sequence/i.test(proposedSql));
assert.ok(!/create\s+policy/i.test(proposedSql));
assert.match(proposedSql, /before update or delete on public\.cfb_team_preseason_snapshots/i);
assert.match(proposedSql, /before update or delete on public\.cfb_game_input_snapshots/i);
assert.ok(proposedSql.includes("model_version text not null"));
assert.ok(proposedSql.includes("experiment_version text not null"));
assert.ok(proposedSql.includes("predicted_margin_mean double precision"));
assert.ok(proposedSql.includes("predicted_margin_sd double precision"));
assert.ok(proposedSql.includes("home_current_season_weight double precision"));
assert.ok(proposedSql.includes("away_current_season_weight double precision"));
assert.ok(proposedSql.includes("constraint cfb_game_input_pre_kickoff_ck check (prediction_at < kickoff_at)"));
assert.match(proposedSql, /foreign key \(cfb_input_snapshot_id\)[\s\S]*not valid;/i);
assert.ok(proposedSql.includes("new.game_id <> input_snapshot.game_id"));
assert.ok(proposedSql.includes("new.game_date <> input_snapshot.game_date"));
assert.ok(proposedSql.includes("new.snapshotted_at is distinct from input_snapshot.prediction_at"));

const adapterSource = fs.readFileSync(path.resolve(__dirname, "./cfbPreseasonInput.js"), "utf8");
assert.ok(!adapterSource.includes("require(\"./cfbModel\")"));
assert.ok(!/\b(edge|probability|customer pick|grade)\s*=/.test(adapterSource));

global.fetch = originalFetch;
console.log("cfbPreseasonInput self-test: PASS");
