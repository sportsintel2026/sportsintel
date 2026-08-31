"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  SEASON,
  EXECUTION_CONFIRMATION,
  TEAM_TABLE,
  REQUEST_PLAN,
  PLANNED_CFBD_REQUESTS,
  PLANNED_ESPN_REQUESTS,
  collectCfbPreseason,
  persistTeamSnapshots,
  runControlledCollection,
  snapshotRow,
  _internal,
} = require("./cfbPreseasonCollector");

function sourcePayloads() {
  return {
    "/teams/fbs?year=2026": [
      { id: 1, school: "Exact State", alternateNames: ["Exact State University"] },
      { id: 2, school: "Mapped State" },
      { id: 3, school: "Ambiguous State" },
      { id: 4, school: "Provider Only" },
    ],
    "/roster?year=2026&classification=fbs": [
      { id: "p1", firstName: "Alex", lastName: "Quarterback", team: "Exact State", position: "QB", year: 3, recruitIds: ["r1"] },
      { id: "p2", firstName: "Taylor", lastName: "Transfer", team: "Exact State", position: "WR", year: 2, recruitIds: ["r2"] },
      { id: "p3", firstName: "Morgan", lastName: "Runner", team: "Mapped State", position: "RB", year: 4, recruitIds: [] },
    ],
    "/player/returning?year=2026": [
      { season: 2026, team: "Exact State", conference: "A", totalPPA: 10, totalPassingPPA: 4, totalReceivingPPA: 3, totalRushingPPA: 3, percentPPA: 0.7, percentPassingPPA: 0.6, percentReceivingPPA: 0.7, percentRushingPPA: 0.8, usage: 0.7, passingUsage: 0.6, receivingUsage: 0.7, rushingUsage: 0.8 },
      { season: 2026, team: "Mapped State", conference: "A", totalPPA: 8, totalPassingPPA: 3, totalReceivingPPA: 2, totalRushingPPA: 3, percentPPA: 0.5, percentPassingPPA: 0.4, percentReceivingPPA: 0.5, percentRushingPPA: 0.6, usage: 0.5, passingUsage: 0.4, receivingUsage: 0.5, rushingUsage: 0.6 },
    ],
    "/player/portal?year=2026": [
      { season: 2026, firstName: "Taylor", lastName: "Transfer", position: "WR", origin: "Other", destination: "Exact State", transferDate: "2026-05-01T00:00:00Z", rating: 0.9, stars: 4, eligibility: "Immediate" },
      { season: 2026, firstName: "No", lastName: "DurableId", position: "DB", origin: "Mapped State", destination: "Other", transferDate: "2026-04-01T00:00:00Z", rating: 0.8, stars: 3, eligibility: "Immediate" },
    ],
    "/talent?year=2026": [
      { year: 2026, team: "Exact State", talent: 800 },
      { year: 2026, team: "Mapped State", talent: 700 },
    ],
    "/recruiting/teams?year=2026": [
      { year: 2026, rank: 10, team: "Exact State", points: 250 },
      { year: 2026, rank: 20, team: "Mapped State", points: 220 },
    ],
    "/recruiting/players?year=2026": [
      { id: "r1", athleteId: "p1", year: 2026, position: "QB", stars: 4, rating: 0.95, committedTo: "Exact State" },
      { id: "r3", athleteId: "p3", year: 2026, position: "RB", stars: 3, rating: 0.85, committedTo: "Mapped State" },
    ],
    "/coaches?year=2026": [
      { id: 11, firstName: "Casey", lastName: "Coach", seasons: [{ teamId: 1, school: "Exact State", year: 2026, games: 0, wins: 0, losses: 0 }] },
      { id: 12, firstName: "Riley", lastName: "Coach", seasons: [{ teamId: 2, school: "Mapped State", year: 2026, games: 0, wins: 0, losses: 0 }] },
    ],
    "/ratings/sp?year=2026": [
      { year: 2026, team: "Exact State", conference: "A", rating: 10, ranking: 10, sos: 1 },
      { year: 2026, team: "Mapped State", conference: "A", rating: 5, ranking: 20, sos: 0 },
    ],
  };
}

function espnPayload(url) {
  if (url.includes("groups/80/teams")) {
    return { items: [
      { $ref: "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/teams/101" },
      { $ref: "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/teams/102" },
      { $ref: "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/teams/103" },
      { $ref: "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/teams/104" },
    ] };
  }
  return { sports: [{ leagues: [{ teams: [
    { team: { id: "101", location: "Exact State", displayName: "Exact State Eagles", abbreviation: "EXA" } },
    { team: { id: "102", location: "Different Mapping Name", displayName: "Different Mapping Name Bears", abbreviation: "MAP" } },
    { team: { id: "103", location: "Ambiguous State", displayName: "Ambiguous State Cats", abbreviation: "AMB", alternateNames: ["Ambiguous State"] } },
    { team: { id: "104", location: "Ambiguous State", displayName: "Ambiguous State Cats", abbreviation: "AM2", alternateNames: ["Ambiguous State"] } },
  ] }] }] };
}

function testClients({ failDomain = null, delay = 0, safePopulation = false } = {}) {
  const payloads = sourcePayloads();
  if (safePopulation) payloads["/teams/fbs?year=2026"] = payloads["/teams/fbs?year=2026"].slice(0, 2);
  const calls = [];
  return {
    calls,
    async cfbdGet(endpoint) {
      const domain = REQUEST_PLAN.find((row) => row.endpoint === endpoint)?.domain;
      calls.push({ provider: "cfbd", domain, endpoint });
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (domain === failDomain) throw new Error(`fixture failure ${domain}`);
      return structuredClone(payloads[endpoint]);
    },
    async fetchImpl(url) {
      const domain = REQUEST_PLAN.find((row) => row.endpoint === url)?.domain;
      calls.push({ provider: "espn", domain, endpoint: url });
      if (domain === failDomain) throw new Error(`fixture failure ${domain}`);
      return { ok: true, status: 200, async json() {
        const body = structuredClone(espnPayload(url));
        if (!safePopulation) return body;
        if (url.includes("groups/80/teams")) body.items = body.items.slice(0, 2);
        else body.sports[0].leagues[0].teams = body.sports[0].leagues[0].teams.slice(0, 2);
        return body;
      } };
    },
  };
}

class Query {
  constructor(store, table, operation = null, payload = null, options = null) {
    this.store = store;
    this.table = table;
    this.operation = operation;
    this.payload = payload;
    this.options = options;
    this.filters = [];
    this.selectFields = null;
  }
  select(fields, options) {
    if (this.operation === "upsert") {
      this.selectFields = fields;
      return this.execute();
    }
    this.operation = "select";
    this.options = options || {};
    return this;
  }
  upsert(payload, options) {
    this.store.operations.push({ table: this.table, method: "upsert", payload: structuredClone(payload), options: { ...options } });
    this.operation = "upsert";
    this.payload = payload;
    this.options = options;
    return this;
  }
  eq(field, value) { this.filters.push(["eq", field, value]); return this; }
  not(field, operator, value) { this.filters.push(["not", field, operator, value]); return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async execute() {
    const rows = this.store.tables[this.table] || [];
    if (this.operation === "select") {
      let filtered = rows;
      for (const filter of this.filters) {
        if (filter[0] === "eq") filtered = filtered.filter((row) => row[filter[1]] === filter[2]);
        if (filter[0] === "not" && filter[2] === "is" && filter[3] === null) filtered = filtered.filter((row) => row[filter[1]] != null);
      }
      return { data: this.options?.head ? null : structuredClone(filtered), count: filtered.length, error: null };
    }
    if (this.operation === "upsert") {
      assert.strictEqual(this.options.ignoreDuplicates, true);
      assert.strictEqual(this.options.onConflict, "season,cfbd_team_id,contract_version,input_hash");
      const inserted = [];
      for (const raw of this.payload) {
        const duplicate = rows.find((row) => row.season === raw.season
          && row.cfbd_team_id === raw.cfbd_team_id
          && row.contract_version === raw.contract_version
          && row.input_hash === raw.input_hash);
        if (duplicate) continue;
        const row = { id: this.store.nextId++, ...structuredClone(raw) };
        rows.push(row);
        inserted.push(row);
      }
      this.store.tables[this.table] = rows;
      return { data: inserted, error: null };
    }
    return { data: null, error: null };
  }
}

function mockSupabase() {
  const store = {
    nextId: 1,
    operations: [],
    tables: {
      [TEAM_TABLE]: [],
      cfb_game_input_snapshots: [],
      model_predictions: [],
    },
  };
  return { store, client: { from(table) { return new Query(store, table); } } };
}

function advancingClock() {
  let current = Date.parse("2026-08-30T12:00:00.000Z");
  return () => new Date(current += 1000);
}

(async () => {
  assert.strictEqual(SEASON, 2026);
  assert.strictEqual(PLANNED_CFBD_REQUESTS, 9);
  assert.strictEqual(PLANNED_ESPN_REQUESTS, 2);

  const blockedBudget = _internal.createRequestBudget();
  await assert.rejects(
    () => blockedBudget.request("cfbd", "notPlanned", async () => []),
    /unplanned provider request blocked/,
  );
  await blockedBudget.request("cfbd", "teams", async () => []);
  await assert.rejects(
    () => blockedBudget.request("cfbd", "teams", async () => []),
    /duplicate provider request blocked/,
  );

  const clients = testClients({ delay: 5 });
  const options = {
    season: 2026,
    cfbdGet: clients.cfbdGet,
    fetchImpl: clients.fetchImpl,
    clock: advancingClock(),
    explicitTeamMappings: { 102: 2 },
    populationBounds: { min: 1, max: 10 },
  };
  const [first, deduped] = await Promise.all([
    collectCfbPreseason(options),
    collectCfbPreseason(options),
  ]);
  assert.strictEqual(first, deduped, "in-flight duplicate must share one collection");
  assert.strictEqual(clients.calls.length, REQUEST_PLAN.length);
  assert.strictEqual(clients.calls.filter((row) => row.provider === "cfbd").length, 9);
  assert.strictEqual(clients.calls.filter((row) => row.provider === "espn").length, 2);
  assert.strictEqual(first.snapshots.length, 2);
  assert.deepStrictEqual(first.coverage.identity, {
    expectedFbsTeams: 4,
    espnFbsTeams: 4,
    exact: 1,
    mapped: 1,
    ambiguous: 1,
    unmatched: 1,
    storedSnapshots: 2,
    espnUnresolved: 2,
    ambiguousTeams: ["Ambiguous State"],
    unmatchedTeams: ["Provider Only"],
  });
  assert.strictEqual(first.snapshots[0].quarterback.category, "unknown-unverified");
  assert.strictEqual(first.coverage.playerJoinQuality.rejectedNameOnly, 1);
  assert.strictEqual(first.coverage.playerJoinQuality.unmatched, 1);
  assert.strictEqual(first.coverage.domains.transfers.sourceAvailable, 2);
  assert.strictEqual(first.snapshots[0].sources.transfers.available, true);
  assert.strictEqual(
    first.snapshots[0].sources.transfers.retrievedAt,
    first.callLog.find((entry) => entry.domain === "transfers").retrievedAt,
  );
  assert.strictEqual(first.snapshots[0].sources.transfers.effectiveAt, null);
  assert.strictEqual(first.snapshots[0].sources.transfers.season, 2026);
  assert.strictEqual(first.snapshots[0].sources.transfers.historicallyAsOfSafe, false);

  const partialClients = testClients({ failDomain: "externalRatings" });
  const partial = await collectCfbPreseason({
    season: 2026,
    cfbdGet: partialClients.cfbdGet,
    fetchImpl: partialClients.fetchImpl,
    clock: advancingClock(),
    explicitTeamMappings: { 102: 2 },
    populationBounds: { min: 1, max: 10 },
  });
  assert.strictEqual(partial.requestBudget.actual.total, REQUEST_PLAN.length);
  assert.strictEqual(partial.coverage.providerDomains.externalRatings.ok, false);
  assert.strictEqual(partial.snapshots[0].sources.externalRatings.available, false);
  assert.strictEqual(partial.snapshots[0].priorReferences.externalRating, null);

  const criticalClients = testClients({ failDomain: "teams" });
  await assert.rejects(
    () => collectCfbPreseason({
      season: 2026,
      cfbdGet: criticalClients.cfbdGet,
      fetchImpl: criticalClients.fetchImpl,
      clock: advancingClock(),
      populationBounds: { min: 1, max: 10 },
    }),
    /critical teams collection failed/,
  );
  assert.strictEqual(criticalClients.calls.length, 1, "critical failure must not fan out");

  const populationClients = testClients();
  await assert.rejects(
    () => collectCfbPreseason({
      season: 2026,
      cfbdGet: populationClients.cfbdGet,
      fetchImpl: populationClients.fetchImpl,
      clock: advancingClock(),
    }),
    /population 4 is outside safe bounds 120-180/,
  );
  assert.strictEqual(populationClients.calls.length, REQUEST_PLAN.length);

  const authClients = testClients();
  authClients.cfbdGet = async (endpoint) => {
    authClients.calls.push({ provider: "cfbd", endpoint });
    if (endpoint === "/roster?year=2026&classification=fbs") throw new Error("CFBD /roster -> 401 Unauthorized");
    return structuredClone(sourcePayloads()[endpoint]);
  };
  await assert.rejects(
    () => collectCfbPreseason({
      season: 2026,
      cfbdGet: authClients.cfbdGet,
      fetchImpl: authClients.fetchImpl,
      clock: advancingClock(),
      populationBounds: { min: 1, max: 10 },
    }),
    /critical roster collection failed/,
  );
  assert.strictEqual(authClients.calls.length, 2, "authentication failure must stop immediately");

  const database = mockSupabase();
  let inserted = await persistTeamSnapshots(database.client, first.snapshots);
  assert.strictEqual(inserted.inserted, 2);
  const original = structuredClone(database.store.tables[TEAM_TABLE]);
  inserted = await persistTeamSnapshots(database.client, first.snapshots);
  assert.strictEqual(inserted.inserted, 0);
  assert.deepStrictEqual(database.store.tables[TEAM_TABLE], original, "duplicate retry must preserve first snapshot");

  const changed = {
    ...first.snapshots[0],
    inputHash: "f".repeat(64),
    returningProduction: {
      ...first.snapshots[0].returningProduction,
      values: { ...first.snapshots[0].returningProduction.values, totalPPA: 999 },
    },
  };
  inserted = await persistTeamSnapshots(database.client, [changed]);
  assert.strictEqual(inserted.inserted, 1, "changed semantic evidence must create a new immutable row");
  assert.strictEqual(database.store.tables[TEAM_TABLE].length, 3);
  assert.strictEqual(database.store.operations.every((row) => row.table === TEAM_TABLE && row.method === "upsert"), true);
  assert.strictEqual(database.store.operations.some((row) => row.table === "cfb_game_input_snapshots"), false);
  assert.strictEqual(database.store.operations.some((row) => row.table === "model_predictions"), false);

  const row = snapshotRow(first.snapshots[0]);
  assert.strictEqual(row.returning_production.values.totalPPA, 10);
  assert.strictEqual(row.quarterback.playerId, null);
  assert.strictEqual(row.sources.externalRatings.available, true);

  const runClients = testClients({ safePopulation: true });
  const runDb = mockSupabase();
  const controlled = await runControlledCollection({
    season: 2026,
    confirmation: EXECUTION_CONFIRMATION,
    persist: true,
    verifyIdempotency: true,
    cfbdGet: runClients.cfbdGet,
    fetchImpl: runClients.fetchImpl,
    clock: advancingClock(),
    explicitTeamMappings: { 102: 2 },
    supabase: runDb.client,
    populationBounds: { min: 1, max: 10 },
  });
  assert.strictEqual(controlled.persistence.before.teamSnapshots, 0);
  assert.strictEqual(controlled.persistence.afterFirst.teamSnapshots, 2);
  assert.strictEqual(controlled.persistence.retry.inserted, 0);
  assert.strictEqual(controlled.persistence.afterRetry.teamSnapshots, 2);
  assert.strictEqual(controlled.persistence.afterRetry.gameSnapshots, 0);
  assert.strictEqual(controlled.persistence.afterRetry.linkedPredictions, 0);

  const identityGateClients = testClients();
  let identityGateError = null;
  try {
    await runControlledCollection({
      season: 2026,
      confirmation: EXECUTION_CONFIRMATION,
      persist: false,
      cfbdGet: identityGateClients.cfbdGet,
      fetchImpl: identityGateClients.fetchImpl,
      clock: advancingClock(),
      explicitTeamMappings: { 102: 2 },
      populationBounds: { min: 1, max: 10 },
    });
  } catch (error) {
    identityGateError = error;
  }
  assert.match(identityGateError?.message || "", /safe team identity coverage 0\.5 is below 0\.9/);
  assert.strictEqual(identityGateError.collection.coverage.identity.storedSnapshots, 2);

  const emptyTransferClients = testClients();
  emptyTransferClients.cfbdGet = async (endpoint) => {
    emptyTransferClients.calls.push({ provider: "cfbd", endpoint });
    if (endpoint === "/player/portal?year=2026") return [];
    return structuredClone(sourcePayloads()[endpoint]);
  };
  const emptyTransfers = await collectCfbPreseason({
    season: 2026,
    cfbdGet: emptyTransferClients.cfbdGet,
    fetchImpl: emptyTransferClients.fetchImpl,
    clock: advancingClock(),
    explicitTeamMappings: { 102: 2 },
    populationBounds: { min: 1, max: 10 },
  });
  assert.strictEqual(emptyTransfers.snapshots[0].sources.transfers.available, true);
  assert.strictEqual(emptyTransfers.snapshots[0].transfers.arrivals.length, 0);

  await assert.rejects(
    () => runControlledCollection({ season: 2026, confirmation: "wrong", persist: false }),
    /controlled collection confirmation is required/,
  );
  assert.throws(() => _internal.assertSeason(2025), /frozen to season 2026/);

  const collectorSource = fs.readFileSync(path.resolve(__dirname, "cfbPreseasonCollector.js"), "utf8");
  assert.ok(!collectorSource.includes('require("./cfbModel")'));
  assert.ok(!collectorSource.includes('require("./cfbEdges")'));
  assert.ok(!collectorSource.includes('require("./predictionTracker")'));
  assert.ok(!collectorSource.includes("cfb_game_input_snapshots).upsert"));
  assert.ok(!collectorSource.includes("model_predictions).upsert"));

  for (const relative of ["../server.js", "../routes/edges.js", "./cfbModel.js", "./cfbEdges.js", "./predictionTracker.js"]) {
    const source = fs.readFileSync(path.resolve(__dirname, relative), "utf8");
    assert.ok(!source.includes("cfbPreseasonCollector"), `${relative} must not consume collector`);
  }

  console.log("cfbPreseasonCollector self-test: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
