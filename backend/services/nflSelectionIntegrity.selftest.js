"use strict";

const assert = require("node:assert/strict");
const {
  NFL_SELECTION_EXPERIMENT_VERSION,
  NFL_SELECTION_MODEL_VERSIONS,
  buildNflSelectionContract,
  toNflBoardEdge,
  toNflLedgerRow,
  analyzeNflSelectionShadow,
} = require("./nflSelectionIntegrity");

const game = {
  eventId: "nfl-side-test",
  matchup: "Arizona Cardinals @ Los Angeles Chargers",
  awayTeam: "Arizona Cardinals",
  homeTeam: "Los Angeles Chargers",
  dataQuality: "rated",
  moneyline: {
    homeWinProb: 78,
    awayWinProb: 22,
    fair: { home: 80.5, away: 19.5 },
    book: { home: -410, away: 340 },
    edge: 2.6,
  },
  spread: {
    homeCoverProb: 56,
    fair: { home: 52, away: 48 },
    book: { home: -110, away: -110 },
    line: -3,
    edge: 4,
  },
  total: {
    overProb: 48,
    fair: { over: 51, under: 49 },
    book: { over: -112, under: -108 },
    line: 45.5,
    edge: 3,
  },
  marketBooks: {
    moneyline: { homeBook: "DraftKings", awayBook: "FanDuel" },
    spread: { homeBook: "BetMGM", awayBook: "Caesars" },
    total: { overBook: "FanDuel", underBook: "DraftKings" },
  },
};

const unchanged = JSON.stringify(game);
const contract = buildNflSelectionContract(game);
assert.equal(JSON.stringify(game), unchanged, "contract must not mutate model output");

assert.equal(contract.moneyline.selected.side, "home", "winner-first side is unchanged");
assert.equal(contract.moneyline.selected.modelProb, 0.78);
assert.equal(contract.moneyline.selected.marketFairProb, 0.805);
assert.equal(contract.moneyline.selected.edge, -0.025, "selected home must not inherit away-side +2.5% edge");
assert.equal(contract.moneyline.selected.qualifiedShadow, false);

assert.equal(contract.spread.selected.side, "home");
assert.equal(contract.spread.selected.edge, 0.04);
assert.equal(contract.spread.selected.qualifiedShadow, true);

assert.equal(contract.total.selected.side, "under");
assert.equal(contract.total.selected.modelProb, 0.52);
assert.equal(contract.total.selected.marketFairProb, 0.49);
assert.equal(contract.total.selected.edge, 0.03);
assert.equal(contract.total.selected.qualifiedShadow, true);

for (const market of ["moneyline", "spread", "total"]) {
  const selected = contract[market].selected;
  const board = toNflBoardEdge(game, market);
  const row = toNflLedgerRow(game, "2026-09-13", market, selected);
  assert.equal(board.side, row.selection);
  assert.equal(board.modelProb, row.model_prob);
  assert.equal(board.marketFairProb, selected.marketFairProb);
  assert.equal(board.edge / 100, row.edge);
  assert.equal(board.odds, row.odds);
  assert.equal(board.oppOdds, row.opp_odds);
  assert.equal(row.entry_book, board.book);
  assert.equal(row.opposing_book, board.opposingBook);
  assert.equal(row.model_version, NFL_SELECTION_MODEL_VERSIONS[market]);
  assert.equal(row.experiment_version, NFL_SELECTION_EXPERIMENT_VERSION);
}

const noBooks = JSON.parse(JSON.stringify(game));
noBooks.marketBooks = {};
const noBookSide = buildNflSelectionContract(noBooks).moneyline.selected;
const noBookRow = toNflLedgerRow(noBooks, "2026-09-13", "moneyline", noBookSide);
assert.deepEqual(
  [noBookRow.entry_book, noBookRow.opposing_book, noBookRow.model_version, noBookRow.experiment_version],
  [null, null, null, null],
  "recording provenance must be all complete or all null",
);

const rows = ["moneyline", "spread", "total"].map((market) => {
  const side = contract[market].selected;
  return {
    market,
    selection: side.selection,
    model_prob: side.modelProb,
    edge: side.edge,
    odds: side.odds,
    opp_odds: side.opposingOdds,
    entry_book: side.book,
    opposing_book: side.opposingBook,
    model_version: NFL_SELECTION_MODEL_VERSIONS[market],
    experiment_version: NFL_SELECTION_EXPERIMENT_VERSION,
    result: "pending",
  };
});
const report = analyzeNflSelectionShadow(rows);
assert.equal(report.control.decisions, 3, "control keeps the unchanged full board");
assert.equal(report.qualifiedShadow.decisions, 2, "shadow applies existing edge evidence only");
assert.equal(report.byMarket.moneyline.qualifiedShadow.decisions, 0);
assert.equal(report.byMarket.spread.qualifiedShadow.decisions, 1);
assert.equal(report.byMarket.total.qualifiedShadow.decisions, 1);

console.log("nflSelectionIntegrity self-test: PASS");
