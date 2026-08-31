"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MODEL_VERSION: TEAM_MODEL_VERSION } = require("./cfbPreseasonChallenger");
const FROZEN_CONTROL_2025 = require("./cfbPreseasonControl2025");
const {
  OUTPUT_TABLE,
  _internal,
} = require("./cfbGameShadowCollector");

const capturedAt = "2026-08-30T20:00:00.000Z";
const kickoffAt = "2026-08-30T23:00:00.000Z";
assert.strictEqual(Object.keys(FROZEN_CONTROL_2025).length, 136);
assert.ok(Object.values(FROZEN_CONTROL_2025).every((row) => row.priorSeason === 2025 && row.currentSeason === 2026 && row.sosApplied === true));

function snapshot(id, school, hashChar, returning, talent) {
  return {
    id,
    season: 2026,
    contract_version: "cfb-preseason-input-v1-2026-08-30",
    snapshot_at: "2026-08-30T19:00:00.000Z",
    input_hash: hashChar.repeat(64),
    team_name: school,
    espn_team_id: String(id),
    cfbd_team_id: id,
    quarterback: { category: "unknown-unverified" },
    roster: { playerCount: 110, durableIdCount: 110, missingIdCount: 0, duplicateIdCount: 0 },
    returning_production: { recordFound: true, values: { percentPPA: returning } },
    transfers: { arrivals: [], departures: [], ambiguousIdentityCount: 0, unmatchedIdentityCount: 0, safelyJoinedCount: 1 },
    talent: { teamTalent: { year: 2026, talent }, recruitingTeams: [{ year: 2026, rank: id, points: 200 }] },
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
  eventId: "shadow-game-1",
  commenceTime: kickoffAt,
  awayTeam: "Bravo University",
  homeTeam: "Alpha University",
  h2h: { away: +130, home: -140, awayBook: "Away Book", homeBook: "Home Book" },
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
assert.strictEqual(plan.identityCollisions, 0);
const candidate = plan.candidates[0];
assert.strictEqual(candidate.input.home_team_snapshot_id, 1);
assert.strictEqual(candidate.input.away_team_snapshot_id, 2);
assert.strictEqual(candidate.input.home_current_season_weight, 0);
assert.strictEqual(candidate.input.away_current_season_weight, 0);
assert.strictEqual(candidate.prediction.teamModelVersion, TEAM_MODEL_VERSION);
assert.strictEqual(candidate.prediction.homeFieldAdjustment, 3);
assert.strictEqual(candidate.prediction.market.h2h.homeBook, "Home Book");
assert.strictEqual(candidate.prediction.market.h2h.awayBook, "Away Book");

const again = _internal.prepareCandidates({
  snapshots, usEvents: [event], ledgerRows: [{ game_id: event.eventId, neutral_site_status: "non-neutral" }], capturedAt, controls,
});
assert.strictEqual(again.candidates[0].input.input_hash, candidate.input.input_hash);

// Started games, unknown neutral context, unresolved FCS, and ambiguous exact IDs are skipped.
assert.strictEqual(_internal.prepareCandidates({ snapshots, usEvents: [{ ...event, commenceTime: capturedAt }], ledgerRows: [], capturedAt, controls }).skipped.alreadyStarted, 1);
assert.strictEqual(_internal.prepareCandidates({ snapshots, usEvents: [event], ledgerRows: [], capturedAt, controls }).skipped.neutralUnknown, 1);
assert.strictEqual(_internal.prepareCandidates({ snapshots, usEvents: [{ ...event, awayTeam: "Unrated FCS" }], ledgerRows: [{ game_id: event.eventId, neutral_site_status: "neutral" }], capturedAt, controls }).skipped.unresolvedTeam, 1);
const collidingControls = { ...controls, "2": { ...controls["2"], teamName: "Alpha University" } };
assert.strictEqual(_internal.prepareCandidates({ snapshots, usEvents: [event], ledgerRows: [{ game_id: event.eventId, neutral_site_status: "neutral" }], capturedAt, controls: collidingControls }).skipped.ambiguousIdentity, 1);

// Identical first-snapshot processing is append-only and deduplicated.
function fakeSupabase() {
  const inputs = [];
  const outputs = [];
  return {
    inputs,
    outputs,
    from(table) {
      const state = { table, operation: null, row: null, field: null, value: null };
      return {
        upsert(row) { state.operation = "upsert"; state.row = row; return this; },
        select() { if (!state.operation) state.operation = "select"; return this; },
        eq(field, value) { state.field = field; state.value = value; return this; },
        async maybeSingle() {
          const store = table === OUTPUT_TABLE ? outputs : inputs;
          if (state.operation === "select") {
            return { data: store.find((row) => row[state.field] === state.value) || null, error: null };
          }
          const duplicate = table === OUTPUT_TABLE
            ? store.find((row) => row.input_snapshot_id === state.row.input_snapshot_id && row.model_version === state.row.model_version)
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
  const first = await _internal.persistCandidate(db, candidate);
  const second = await _internal.persistCandidate(db, candidate);
  assert.deepStrictEqual(first, { inputCreated: true, outputCreated: true });
  assert.deepStrictEqual(second, { inputCreated: false, outputCreated: false });
  assert.strictEqual(db.inputs.length, 1);
  assert.strictEqual(db.outputs.length, 1);
  assert.strictEqual(db.outputs[0].home_team_name, "Alpha");
  assert.strictEqual(db.outputs[0].away_team_name, "Bravo");

  // Static no-provider/no-customer-path guardrails.
  const collectorSource = fs.readFileSync(path.join(__dirname, "cfbGameShadowCollector.js"), "utf8");
  for (const forbidden of [
    'require("./oddsApi")', 'require("./cfbdApi")', 'require("./cfbModel")',
    "getCFBMainOdds(", "getCFBPinnacleClose(", "fetch(", "CFB_W_MODEL", "recordCFBPredictions",
  ]) assert.ok(!collectorSource.includes(forbidden), `collector contains forbidden surface ${forbidden}`);
  const edgeSource = fs.readFileSync(path.join(__dirname, "cfbEdges.js"), "utf8");
  const tickHook = edgeSource.indexOf("async function captureCFBOddsTicks");
  const shadowHooks = [...edgeSource.matchAll(/collectCfbGameShadowPredictions/g)].map((match) => match.index);
  assert.deepStrictEqual(shadowHooks.length, 2, "measurement hook should contain one lazy import and one call");
  assert.ok(shadowHooks.every((index) => index > tickHook), "shadow collector must be reachable only inside the tick collector");
  console.log("cfbGameShadowCollector self-test: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
