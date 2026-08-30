#!/usr/bin/env node
const assert = require("assert");
const {
  normalizeAmericanOdds,
  mlbMonetaryProfit,
  summarizeMlbRoi,
} = require("./mlbPerformanceMath");

const near = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

near(mlbMonetaryProfit("win", -150), 2 / 3);
near(mlbMonetaryProfit("win", 150), 1.5);
assert.strictEqual(mlbMonetaryProfit("loss", -110), -1);
assert.strictEqual(mlbMonetaryProfit("win", null), null);
assert.strictEqual(mlbMonetaryProfit("loss", null), null);
assert.strictEqual(mlbMonetaryProfit("push", -110), null);
assert.strictEqual(normalizeAmericanOdds(0), null);
assert.strictEqual(normalizeAmericanOdds("+120"), 120);

assert.deepStrictEqual(
  summarizeMlbRoi([
    { result: "win", odds: 150 },
    { result: "win", odds: -200 },
    { result: "loss", odds: -110 },
    { result: "win", odds: null },
    { result: "loss", odds: null },
    { result: "push", odds: -110 },
  ]),
  {
    wins: 3,
    losses: 2,
    pushes: 1,
    accuracySample: 5,
    roiSample: 3,
    roiUnavailable: 2,
    units: 1,
    roiPct: 33.3,
  }
);

assert.deepStrictEqual(
  summarizeMlbRoi([
    ...Array.from({ length: 22 }, () => ({ result: "win", odds: null })),
    ...Array.from({ length: 11 }, () => ({ result: "loss", odds: null })),
  ]),
  {
    wins: 22,
    losses: 11,
    pushes: 0,
    accuracySample: 33,
    roiSample: 0,
    roiUnavailable: 33,
    units: 0,
    roiPct: null,
  }
);

console.log("mlbPerformanceMath self-test: 10/10 passed");
