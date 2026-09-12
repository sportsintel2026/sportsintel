"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const {
  predictGame,
  NFL_W_MODEL,
  NFL_BLEND_CONTROL_WEIGHT,
  NFL_BLEND_CHALLENGER_WEIGHT,
  EDGE_ML,
  EDGE_SPREAD,
  EDGE_TOTAL,
} = require("./nflModel");
const { buildNflSelectionContract, toNflLedgerRow } = require("./nflSelectionIntegrity");
const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient: () => ({}) };
  if (request === "axios") return { get: async () => { throw new Error("unexpected provider call"); } };
  return originalLoad(request, parent, isMain);
};
const { buildComparison, MODEL_VERSION } = require("./nflInjuryWeatherShadow");
Module._load = originalLoad;

const event = {
  eventId: "nfl-blend-test",
  commenceTime: "2099-09-13T17:00:00Z",
  awayTeam: "Away Team",
  homeTeam: "Home Team",
  h2h: { home: -135, away: 122, homeBook: "Book A", awayBook: "Book B" },
  spreads: {
    homeLine: -3.5, awayLine: 3.5, home: -108, away: -112,
    homeBook: "Book C", awayBook: "Book D",
  },
  totals: {
    line: 46.5, over: -105, under: -115, overBook: "Book E", underBook: "Book F",
  },
  fairMarket: {
    moneyline: { home: 0.57, away: 0.43 },
    spread: { home: 0.515, away: 0.485, line: -3.5 },
    total: { over: 0.505, under: 0.495, line: 46.5 },
  },
};
const context = {
  home: { rating: 5.5, projPoints: 27.2 },
  away: { rating: -1.5, projPoints: 20.1 },
};

assert.equal(NFL_BLEND_CONTROL_WEIGHT, 0.30);
assert.equal(NFL_W_MODEL, 0.40);
assert.equal(NFL_BLEND_CHALLENGER_WEIGHT, 0.50);
assert.deepEqual([EDGE_ML, EDGE_SPREAD, EDGE_TOTAL], [0.03, 0.03, 0.03], "selection thresholds are unchanged");

const customer = predictGame(event, context);
const control = predictGame(event, context, { blendWeight: 0.30 });
const challenger = predictGame(event, context, { blendWeight: 0.50 });
assert.equal(Object.keys(customer).includes("_nflBlendSnapshot"), false, "shadow metadata is not customer-visible");
assert.equal(JSON.stringify(customer).includes("blend30Prob"), false, "customer JSON does not expose shadow probabilities");

const outputPaths = {
  moneyline: ["homeWinProb", "home"],
  spread: ["homeCoverProb", "home"],
  total: ["overProb", "over"],
};
for (const [market, [field]] of Object.entries(outputPaths)) {
  const snapshot = customer._nflBlendSnapshot[market];
  assert.ok(snapshot, `${market} has a prediction-time blend snapshot`);
  assert.equal(snapshot.blend30Prob, control[market][field] / 100, `${market} 30/70 reproduces frozen control`);
  assert.equal(snapshot.blend40Prob, customer[market][field] / 100, `${market} customer output is 40/60`);
  assert.equal(snapshot.blend50Prob, challenger[market][field] / 100, `${market} 50/50 is recorded from the same inputs`);
}

customer.marketBooks = {
  moneyline: event.h2h,
  spread: event.spreads,
  total: event.totals,
};
const contract = buildNflSelectionContract(customer);
for (const market of ["moneyline", "spread", "total"]) {
  const selected = contract[market].selected;
  const row = toNflLedgerRow(customer, "2099-09-13", market, selected);
  assert.ok(row, `${market} selected row records`);
  assert.equal(row.model_prob, row.nfl_blend_40_prob);
  assert.equal(row.market_fair_prob, selected.marketFairProb);
  assert.ok(Math.abs(row.edge - (row.model_prob - row.market_fair_prob)) <= 1e-12);
  assert.ok(row.raw_win_prob != null);
  assert.ok(row.nfl_blend_30_prob != null);
  assert.ok(row.nfl_blend_50_prob != null);
}

const shadowGame = {};
Object.defineProperty(shadowGame, "_injuryWeatherShadowInput", {
  enumerable: false,
  value: {
    event,
    baseContext: context,
    marketCapturedAt: "2099-09-08T16:00:00Z",
    espnGame: {
      gameId: "espn-blend-test",
      venue: { id: "venue-1", name: "Test Stadium", indoor: true },
      home: { id: "1", displayName: "Home Team" },
      away: { id: "2", displayName: "Away Team" },
    },
  },
});
const injuryWeather = buildComparison({
  game: shadowGame,
  availability: [],
  availabilityMeta: {},
  weather: { available: true, indoor: true },
  predictionAt: "2099-09-08T16:05:00Z",
});
assert.equal(MODEL_VERSION, "nfl-game-control-30-70-v1-2026-09-08");
assert.equal(
  injuryWeather.control.moneyline.homeWinProb,
  control.moneyline.homeWinProb,
  "the existing injury/weather experiment remains frozen at its 30/70 era",
);

const sql = fs.readFileSync(path.join(__dirname, "../../sql/nfl_blend_shadow_provenance.sql"), "utf8").toLowerCase();
for (const column of ["nfl_blend_30_prob", "nfl_blend_40_prob", "nfl_blend_50_prob"]) {
  assert.ok(sql.includes(`add column ${column} double precision`));
}
assert.ok(sql.includes("model_predictions_nfl_blend_snapshot_immutable"));
assert.ok(sql.includes("nfl prediction-time blend snapshot is immutable"));
assert.ok(!sql.includes("create policy"));
assert.ok(!/grant\s+delete/.test(sql));

console.log("nflBlend40 self-test: PASS");
