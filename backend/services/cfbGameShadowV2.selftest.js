"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MODEL_VERSION: V1_TEAM_VERSION } = require("./cfbPreseasonChallenger");
const {
  MODEL_VERSION: V2_TEAM_VERSION,
  MEAN_ARCHITECTURE,
} = require("./cfbPreseasonChallengerV2");
const {
  MODEL_VERSION: V1_GAME_VERSION,
  BASE_GAME_SIGMA: V1_SIGMA,
} = require("./cfbGameShadowChallenger");
const {
  MODEL_VERSION: V2_GAME_VERSION,
  EXPERIMENT_VERSION: V2_EXPERIMENT_VERSION,
  BASE_GAME_SIGMA: V2_SIGMA,
  UNCERTAINTY_SCALE,
} = require("./cfbGameShadowChallengerV2");
const {
  INPUT_TABLE,
  OUTPUT_TABLE,
  _internal,
} = require("./cfbGameShadowCollector");

const capturedAt = "2026-08-30T20:00:00.000Z";
const kickoffAt = "2026-08-30T23:00:00.000Z";

function snapshot(id, name, char, returning, talent) {
  return {
    id,
    season: 2026,
    contract_version: "cfb-preseason-input-v1-2026-08-30",
    snapshot_at: "2026-08-30T19:00:00.000Z",
    input_hash: char.repeat(64),
    team_name: name,
    espn_team_id: String(id),
    cfbd_team_id: id,
    quarterback: { category: "unknown-unverified" },
    roster: { playerCount: 110, durableIdCount: 110, missingIdCount: 0, duplicateIdCount: 0 },
    returning_production: { recordFound: true, values: { percentPPA: returning } },
    transfers: { arrivals: [], departures: [], ambiguousIdentityCount: 0, unmatchedIdentityCount: 0, safelyJoinedCount: 1 },
    talent: { teamTalent: { year: 2026, talent }, recruitingTeams: [] },
    coaching: { identityStatus: "exact", tenureYears: 2, continuity: true },
    quality: { completeness: 0.75 },
  };
}

const snapshots = [
  snapshot(1, "Alpha", "a", 0.2, 500), snapshot(2, "Bravo", "b", 0.3, 600),
  snapshot(3, "Charlie", "c", 0.4, 700), snapshot(4, "Delta", "d", 0.5, 800),
  snapshot(5, "Echo", "e", 0.6, 900), snapshot(6, "Foxtrot", "f", 0.7, 1000),
];
const controls = Object.fromEntries(snapshots.map((row, index) => [String(row.espn_team_id), {
  espnTeamId: String(row.espn_team_id),
  teamName: `${row.team_name} University`,
  priorRating: (index - 2.5) * 2,
  priorSeason: 2025,
  currentSeason: 2026,
  controlRating: (index - 2.5) * 2,
  currentGames: 0,
  ratingSource: "prior-only",
  sosApplied: true,
}]));
const event = {
  eventId: "v2-shadow-game",
  commenceTime: kickoffAt,
  awayTeam: "Bravo University",
  homeTeam: "Alpha University",
  h2h: { away: 130, home: -140, awayBook: "Away Book", homeBook: "Home Book" },
  spreads: { awayLine: 3, homeLine: -3, away: -110, home: -110, awayBook: "Away Spread", homeBook: "Home Spread" },
};

const plan = _internal.prepareCandidates({
  snapshots,
  usEvents: [event],
  ledgerRows: [{ game_id: event.eventId, neutral_site_status: "non-neutral" }],
  capturedAt,
  controls,
});
assert.strictEqual(plan.candidates.length, 1);
assert.strictEqual(plan.v2Candidates.length, 1);
assert.strictEqual(plan.v2SetupAvailable, true);
const v1 = plan.candidates[0];
const v2 = plan.v2Candidates[0];
assert.strictEqual(v1.prediction.modelVersion, V1_GAME_VERSION);
assert.strictEqual(v1.prediction.teamModelVersion, V1_TEAM_VERSION);
assert.strictEqual(v1.prediction.baseGameSigma, V1_SIGMA);
assert.strictEqual(v1.input.input_hash, "b199a2514f39bb171494bf7f26ff1f18144fb8cf078c9b445fbfb7627af8f19e");
assert.deepStrictEqual({
  margin: v1.prediction.projectedHomeMargin,
  sigma: v1.prediction.predictiveSigma,
  home: v1.prediction.homeWinProbability,
  cover: v1.prediction.homeCoverProbability,
}, { margin: 2.8093, sigma: 16.20956426, home: 0.56879661, cover: 0.49152644 });
assert.strictEqual(v2.prediction.modelVersion, V2_GAME_VERSION);
assert.strictEqual(v2.prediction.teamModelVersion, V2_TEAM_VERSION);
assert.strictEqual(v2.prediction.experimentVersion, V2_EXPERIMENT_VERSION);
assert.strictEqual(v2.prediction.baseGameSigma, V2_SIGMA);
assert.strictEqual(v2.prediction.predictiveSigma, V2_SIGMA);
assert.strictEqual(UNCERTAINTY_SCALE, 0);
assert.deepStrictEqual(MEAN_ARCHITECTURE, {
  returningResidualPointsPerSd: 1.25,
  talentResidualPointsPerSd: 2.5,
  residualClipSd: 2,
});

// Both lanes use the same immutable source rows, timestamp, kickoff, orientation,
// and market quote. Model-specific input rows differ only where the model does.
for (const field of [
  "game_id", "season", "game_date", "prediction_at", "kickoff_at",
  "contract_version", "home_team_snapshot_id", "away_team_snapshot_id",
  "home_cfbd_team_id", "away_cfbd_team_id", "neutral_site_status",
]) assert.strictEqual(v2.input[field], v1.input[field], field);
assert.deepStrictEqual(v2.prediction.market, v1.prediction.market);
assert.deepStrictEqual(v2.input.game_context.parallelPair, {
  v1ModelVersion: V1_GAME_VERSION,
  v1InputHash: v1.input.input_hash,
  samePredictionAt: capturedAt,
  sameTeamSnapshotIds: true,
  sameMarketContext: true,
});
assert.notStrictEqual(v2.input.input_hash, v1.input.input_hash);
assert.notStrictEqual(v2.prediction.projectedHomeMargin, v1.prediction.projectedHomeMargin);

function fakeSupabase() {
  const stores = { [INPUT_TABLE]: [], [OUTPUT_TABLE]: [] };
  return {
    stores,
    from(table) {
      const state = { operation: null, row: null, field: null, value: null };
      return {
        upsert(row) { state.operation = "upsert"; state.row = row; return this; },
        select() { if (!state.operation) state.operation = "select"; return this; },
        eq(field, value) { state.field = field; state.value = value; return this; },
        async maybeSingle() {
          const store = stores[table];
          if (state.operation === "select") {
            return { data: store.find((row) => row[state.field] === state.value) || null, error: null };
          }
          const duplicate = table === OUTPUT_TABLE
            ? store.find((row) => row.input_snapshot_id === state.row.input_snapshot_id
              && row.model_version === state.row.model_version)
            : store.find((row) => row.input_hash === state.row.input_hash);
          if (duplicate) return { data: null, error: null };
          const created = { ...state.row, id: store.length + 1 };
          store.push(created);
          return { data: created, error: null };
        },
      };
    },
  };
}

(async () => {
  const db = fakeSupabase();
  assert.deepStrictEqual(await _internal.persistCandidate(db, v1), { inputCreated: true, outputCreated: true });
  assert.deepStrictEqual(await _internal.persistCandidate(db, v2), { inputCreated: true, outputCreated: true });
  assert.deepStrictEqual(await _internal.persistCandidate(db, v1), { inputCreated: false, outputCreated: false });
  assert.deepStrictEqual(await _internal.persistCandidate(db, v2), { inputCreated: false, outputCreated: false });
  assert.strictEqual(db.stores[INPUT_TABLE].length, 2);
  assert.strictEqual(db.stores[OUTPUT_TABLE].length, 2);
  assert.deepStrictEqual(new Set(db.stores[OUTPUT_TABLE].map((row) => row.model_version)), new Set([
    V1_GAME_VERSION, V2_GAME_VERSION,
  ]));

  for (const file of [
    "cfbPreseasonChallengerV2.js", "cfbGameShadowChallengerV2.js", "cfbGameShadowCollector.js",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    for (const forbidden of [
      'require("./oddsApi")', 'require("./cfbdApi")', "getCFBMainOdds(",
      "getCFBPinnacleClose(", "fetch(",
    ]) assert.ok(!source.includes(forbidden), `${file} contains provider surface ${forbidden}`);
  }
  const schema = fs.readFileSync(path.join(__dirname, "..", "..", "sql", "cfb_game_shadow_v2_parallel.sql"), "utf8");
  assert.ok(schema.includes(V1_GAME_VERSION));
  assert.ok(schema.includes(V2_GAME_VERSION));
  assert.ok(!/\b(?:insert|update|delete)\s+(?:into|public\.)/i.test(schema));
  const evaluator = fs.readFileSync(path.join(__dirname, "cfbGameShadowEvaluator.js"), "utf8");
  assert.ok(!/\.eq\(["']model_version["']/.test(evaluator));
  console.log("cfbGameShadowV2 self-test: PASS", {
    v1Model: V1_GAME_VERSION,
    v2Model: V2_GAME_VERSION,
    sharedPredictionAt: v1.input.prediction_at,
    providerCallsAdded: 0,
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
