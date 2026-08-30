#!/usr/bin/env node
const assert = require("assert");
const Module = require("module");

// The probability code lives in the active edges model, whose provider clients
// are not needed for this pure test. Stub only those imports so the harness stays
// dependency-free and cannot make a network call.
const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient: () => ({}) };
  if (["./mlbStatsApi", "./umpireStore", "./savantApi", "./weatherApi"].includes(request)) return {};
  if (request === "./winProbCalibration") return {
    winProbHaircut: () => 0,
    calibrateWinProb: (p) => p,
    calibrateCoverProb: (p) => p,
    calibrateHitsProb: (p) => p,
  };
  if (request === "./oddsApi") return {
    americanToImpliedProb: (odds) => odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100),
  };
  return originalLoad.call(this, request, parent, isMain);
};
const {
  mlbTotalsLogisticProbability,
  mlbTotalsDiscreteProbability,
  runLineCoverModel,
} = require("./edgesModel");
const {
  FATIGUE_BETAS,
  buildMlbTotalsCalibrationRows,
  analyzeMlbTotalsCalibration,
} = require("./mlbTotalsCalibration");
Module._load = originalLoad;

const near = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

const control = mlbTotalsLogisticProbability(9.2, 8.5, -110, -110);
for (const projected of [6.8, 8.1, 9.2, 11.7]) {
  for (const line of [7, 7.5, 8, 8.5, 9.5, 10]) {
    const current = mlbTotalsLogisticProbability(projected, line, -115, -105);
    const legacyRaw = 1 / (1 + Math.exp(-((projected - 0.50 - line) / 6.0)));
    const overImplied = 115 / 215;
    const underImplied = 105 / 205;
    const legacyFair = overImplied / (overImplied + underImplied);
    const legacyPublished = Math.round((0.55 * legacyRaw + 0.45 * legacyFair) * 1000) / 1000;
    near(current.rawOver, legacyRaw);
    near(current.publishedOver, legacyPublished);
  }
}
const result = {
  date: "2026-08-29",
  computedAt: "2026-08-29T16:00:00.000Z",
  recordingByGame: {
    "game-1": {
      totals: {
        overRawModelProb: control.rawOver,
        underRawModelProb: control.rawUnder,
        marketFairOverProb: control.fairOver,
        marketFairUnderProb: control.fairUnder,
        formulaVersion: "selftest-formula",
        totalSd: 6,
        meanToMedian: 0.5,
        marketBlendEnabled: true,
        marketBlendWeight: 0.55,
      },
    },
  },
  games: [{
    id: "game-1",
    status: "scheduled",
    awayAbbr: "AWY",
    homeAbbr: "HOM",
    moneyline: { homeWinProb: 0.54 },
    totals: {
      projected: 9.2,
      line: 8.5,
      overOdds: -110,
      underOdds: -110,
      overBook: "Book A",
      underBook: "Book B",
      overProb: control.publishedOver,
      underProb: control.publishedUnder,
      breakdown: {
        base: 9.4,
        pitcherAdj: -0.4,
        aceAdj: -0.1,
        parkAdj: 0.1,
        weatherAdj: 0.2,
        bullpenAdj: 0.05,
        fatigueAdj: 0.2,
        ouAdj: -0.05,
        umpAdj: 0,
        defAdj: -0.1,
      },
    },
  }],
};

const inputBefore = JSON.stringify(result);
const runLineBefore = runLineCoverModel(9.2, 0.54, -1.5);
const rows = buildMlbTotalsCalibrationRows(result);
const runLineAfter = runLineCoverModel(9.2, 0.54, -1.5);
assert.strictEqual(JSON.stringify(result), inputBefore);
near(runLineAfter, runLineBefore);
assert.strictEqual(rows.length, 6);
assert.deepStrictEqual(
  rows.filter((row) => row.model_family === "logistic").map((row) => row.beta),
  FATIGUE_BETAS
);

const beta0 = rows.find((row) => row.variant_key === "logistic_beta_0.00");
const beta1 = rows.find((row) => row.variant_key === "logistic_beta_1.00");
const discrete = rows.find((row) => row.model_family === "discrete_negbin");
near(beta0.candidate_projected_total, 9.0);
near(beta1.candidate_projected_total, 9.2);
near(beta1.published_over_prob, control.publishedOver);
assert.strictEqual(beta1.formula_version, "selftest-formula");
assert.strictEqual(beta1.logistic_sd, 6);
assert.strictEqual(beta1.mean_to_median, 0.5);
assert.strictEqual(beta1.market_blend_weight, 0.55);
assert.strictEqual(beta1.over_book, "Book A");
assert.strictEqual(beta1.under_book, "Book B");
assert.strictEqual(beta1.base_runs, 9.4);

near(discrete.raw_over_prob + discrete.raw_under_prob + discrete.push_prob, 1, 1e-9);
near(discrete.decisive_raw_over_prob + discrete.decisive_raw_under_prob, 1, 1e-9);
assert.strictEqual(discrete.push_prob, 0); // half line cannot push

const integer = mlbTotalsDiscreteProbability(9.2, 0.54, 9, -110, -110);
assert.ok(integer.pushProb > 0);
near(integer.rawOver + integer.rawUnder + integer.pushProb, 1, 1e-9);
near(integer.decisiveRawOver + integer.decisiveRawUnder, 1, 1e-9);

const settled = rows.map((row, index) => ({
  ...row,
  result_status: index % 3 === 0 ? "over" : index % 3 === 1 ? "under" : "push",
  actual_total_runs: index % 3 === 0 ? 10 : index % 3 === 1 ? 7 : 8.5,
  pinnacle_closing_total: 8.5,
  pinnacle_fair_over_prob: 0.51,
}));
const analysis = analyzeMlbTotalsCalibration(settled);
assert.strictEqual(Object.keys(analysis.formulaEras).length, 1);
assert.strictEqual(Object.keys(analysis.formulaEras["selftest-formula"].variants).length, 6);
assert.ok(analysis.formulaEras["selftest-formula"].variants["logistic_beta_1.00"].overall.settledN === 1);

console.log("mlbTotalsCalibration self-test: all checks passed");
