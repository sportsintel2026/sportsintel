"use strict";

const assert = require("assert");
const Module = require("module");
const { coherentFairConsensus } = require("./footballFairMarket");
const { predictGame: predictNfl } = require("./nflModel");
const { predictGame: predictCfb } = require("./cfbModel");

const originalLoad = Module._load;
Module._load = function loadWithoutProviderDependencies(request, parent, isMain) {
  if (request === "axios") return { get: async () => { throw new Error("provider call forbidden in self-test"); } };
  if (request === "./mlbStatsApi" && parent?.filename?.endsWith("oddsApi.js")) {
    return { getScheduleForDate: async () => [], getEasternDate: () => "2026-09-11" };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { _internal: oddsParser } = require("./oddsApi");
Module._load = originalLoad;

function outcome(name, price, point = undefined) {
  return point == null ? { name, price } : { name, price, point };
}

function book(key, title, { awayMl, homeMl, awaySpread, homeSpread, over, under }) {
  return {
    key, title, last_update: "2026-09-11T16:55:00.000Z",
    markets: [
      { key: "h2h", outcomes: [outcome("Away", awayMl), outcome("Home", homeMl)] },
      { key: "spreads", outcomes: [
        outcome("Away", awaySpread.price, awaySpread.line),
        outcome("Home", homeSpread.price, homeSpread.line),
      ] },
      { key: "totals", outcomes: [outcome("Over", over, 47.5), outcome("Under", under, 47.5)] },
    ],
  };
}

function fair(firstOdds, secondOdds) {
  const implied = (odds) => odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
  const first = implied(firstOdds), second = implied(secondOdds);
  return first / (first + second);
}

function median(a, b) { return (a + b) / 2; }

const snapshotAt = "2026-09-11T17:00:00.000Z";
const event = oddsParser.parseFballOddsEvent({
  id: "coherent-1", commence_time: "2026-09-12T00:00:00.000Z",
  away_team: "Away", home_team: "Home",
  bookmakers: [
    book("draftkings", "DraftKings", {
      awayMl: 140, homeMl: -160,
      awaySpread: { line: 3, price: -125 }, homeSpread: { line: -3, price: 105 },
      over: -120, under: 100,
    }),
    book("fanduel", "FanDuel", {
      awayMl: 155, homeMl: -170,
      awaySpread: { line: 3, price: -105 }, homeSpread: { line: -3, price: -115 },
      over: -105, under: -115,
    }),
  ],
}, { snapshotAt });

// Wager shopping remains cross-book: each side keeps its best available price.
assert.strictEqual(event.h2h.awayBook, "FanDuel");
assert.strictEqual(event.h2h.homeBook, "DraftKings");
assert.strictEqual(event.spreads.awayBook, "FanDuel");
assert.strictEqual(event.spreads.homeBook, "DraftKings");
assert.strictEqual(event.totals.overBook, "FanDuel");
assert.strictEqual(event.totals.underBook, "DraftKings");

// Fair probability is the median of separately de-vigged same-book pairs.
assert.ok(Math.abs(event.fairMarket.moneyline.home
  - median(fair(-160, 140), fair(-170, 155))) < 1e-12);
assert.ok(Math.abs(event.fairMarket.spread.home
  - median(fair(105, -125), fair(-115, -105))) < 1e-12);
assert.ok(Math.abs(event.fairMarket.total.over
  - median(fair(-120, 100), fair(-105, -115))) < 1e-12);
for (const market of ["moneyline", "spread", "total"]) {
  assert.strictEqual(event.fairMarket[market].pairCount, 2);
  assert.strictEqual(event.fairMarket[market].snapshotAt, snapshotAt);
  assert.ok(event.fairMarket[market].pairs.every((pair) => pair.book && pair.lastUpdate));
}
assert.strictEqual(event.fairMarket.spread.line, -3);
assert.strictEqual(event.fairMarket.total.line, 47.5);

const rated = { home: { rating: 4, projPoints: 26 }, away: { rating: 1, projPoints: 21 } };
for (const prediction of [predictNfl(event, rated), predictCfb(event, rated)]) {
  assert.ok(Math.abs(prediction.moneyline.fair.home / 100 - event.fairMarket.moneyline.home) < 0.001);
  assert.ok(Math.abs(prediction.spread.fair.home / 100 - event.fairMarket.spread.home) < 0.001);
  assert.ok(Math.abs(prediction.total.fair.over / 100 - event.fairMarket.total.over) < 0.001);
}

// Opposite sides from different books are still displayable, but never de-vigged.
const splitOnly = oddsParser.parseFballOddsEvent({
  id: "split-only", commence_time: "2026-09-12T00:00:00.000Z",
  away_team: "Away", home_team: "Home",
  bookmakers: [
    { key: "draftkings", title: "DraftKings", markets: [{ key: "h2h", outcomes: [outcome("Away", 120)] }] },
    { key: "fanduel", title: "FanDuel", markets: [{ key: "h2h", outcomes: [outcome("Home", -135)] }] },
  ],
}, { snapshotAt });
assert.strictEqual(coherentFairConsensus(
  [{ away: 120, home: -135, awayBook: "DraftKings", homeBook: "FanDuel" }],
  { firstKey: "home", secondKey: "away", firstBookKey: "homeBook", secondBookKey: "awayBook", snapshotAt },
), null);
assert.strictEqual(splitOnly.h2h.away, 120);
assert.strictEqual(splitOnly.h2h.home, -135);
assert.strictEqual(splitOnly.fairMarket.moneyline, null);
for (const prediction of [predictNfl(splitOnly, rated), predictCfb(splitOnly, rated)]) {
  assert.strictEqual(prediction.moneyline.fair, null);
  assert.strictEqual(prediction.moneyline.edge, null);
  assert.strictEqual(prediction.moneyline.value, false);
}

const wrongLine = {
  ...event,
  fairMarket: { ...event.fairMarket, total: { ...event.fairMarket.total, line: 48.5 } },
};
for (const prediction of [predictNfl(wrongLine, rated), predictCfb(wrongLine, rated)]) {
  assert.strictEqual(prediction.total.fair, null);
  assert.strictEqual(prediction.total.edge, null);
  assert.strictEqual(prediction.total.value, false);
}

console.log("football fair-market coherence self-test passed");
