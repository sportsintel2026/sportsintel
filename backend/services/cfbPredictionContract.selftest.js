const assert = require("assert");
const {
  CFB_EXPERIMENT_VERSION,
  CFB_CUSTOMER_SELECTION_VERSION,
  CFB_CUSTOMER_MARKETS,
  CFB_MODEL_VERSIONS,
  buildCfbPredictionContract,
  applyCfbContractToPrediction,
  toCfbBoardEdge,
  toCfbQualifiedBoardEdge,
  isCfbQualifiedCustomerSelection,
  toCfbLedgerRow,
  toCfbCustomerLedgerRow,
  isRatedCfbGuardRow,
} = require("./cfbPredictionContract");
const { predictGame, CFB_W_MODEL, CFB_SIGMA, CFB_TOTAL_SIGMA, CFB_HFA_POINTS } = require("./cfbModel");

const ratedSnapshot = {
  priorSeason: 2025,
  currentSeason: 2026,
  home: { source: "prior-only", weight: 0 },
  away: { source: "prior-only", weight: 0 },
  sosApplied: true,
  neutralSiteStatus: "non-neutral",
};

function event(home = "Stanford Cardinal", away = "California Golden Bears") {
  return {
    eventId: "cfb-test-1", commenceTime: "2026-09-01T00:00:00Z", homeTeam: home, awayTeam: away,
    h2h: { home: -145, away: +135, homeBook: "Home Book", awayBook: "Away Book" },
    spreads: { home: -105, away: -115, homeLine: -3.5, awayLine: 3.5, homeBook: "Spread Home", awayBook: "Spread Away" },
    totals: { over: -102, under: -118, line: 48.5, overBook: "Over Book", underBook: "Under Book" },
    fairMarket: {
      moneyline: { home: 0.57, away: 0.43 },
      spread: { home: 0.49, away: 0.51, line: -3.5 },
      total: { over: 0.48, under: 0.52, line: 48.5 },
    },
  };
}

function prediction(home = "Stanford Cardinal", away = "California Golden Bears") {
  return {
    eventId: "cfb-test-1", commenceTime: "2026-09-01T00:00:00Z", homeTeam: home, awayTeam: away,
    matchup: `${away} @ ${home}`, dataQuality: "rated",
    moneyline: {
      homeWinProb: 56, awayWinProb: 44, modelHomeWinProb: 58, modelMargin: 4,
      fair: { home: 59, away: 41 }, book: { home: -145, away: +135 }, edge: 3, value: true,
    },
    spread: {
      line: -3.5, homeCoverProb: 54, modelHomeCoverProb: 57,
      fair: { home: 56, away: 44 }, book: { home: -105, away: -115 }, edge: 2, value: true,
    },
    total: {
      line: 48.5, overProb: 52, modelOverProb: 55, projTotal: 50,
      fair: { over: 54, under: 46 }, book: { over: -102, under: -118 }, edge: 2, value: true,
    },
  };
}

function attach(game, ev, snapshot = ratedSnapshot) {
  const contract = buildCfbPredictionContract({ prediction: game, event: ev, ratingSnapshot: snapshot });
  applyCfbContractToPrediction(game, contract, { moneyline: 0.03, spread: 0.03, total: 0.03 });
  Object.defineProperty(game, "cfbPredictionContract", { value: contract, enumerable: false });
  return contract;
}

// Stanford: the displayed likely winner must retain Stanford's own negative edge,
// not the opposing side's equal positive disagreement.
{
  const ev = event();
  const game = prediction();
  const contract = attach(game, ev);
  const side = contract.moneyline.selected;
  assert.strictEqual(side.side, "home");
  assert.strictEqual(side.selection, "home");
  assert.strictEqual(side.publishedProb, 0.56);
  assert.strictEqual(side.marketFairProb, 0.59);
  assert.strictEqual(side.edge, -0.03);
  assert.strictEqual(game.moneyline.edge, -3);
  assert.strictEqual(game.moneyline.value, false);
  const board = toCfbBoardEdge(game, "moneyline");
  const row = toCfbLedgerRow(game, "2026-08-31", "moneyline", "moneyline", side);
  assert.deepStrictEqual(
    [board.side, board.modelProb, board.marketFairProb, board.edge, board.odds],
    [row.selection, row.model_prob, row.market_fair_prob, row.edge * 100, row.odds]
  );
  assert.strictEqual(row.entry_book, "Home Book");
  assert.strictEqual(row.opposing_book, "Away Book");
  assert.strictEqual(row.raw_win_prob, 0.58);
  assert.strictEqual(row.model_version, CFB_MODEL_VERSIONS.moneyline);
  assert.strictEqual(row.experiment_version, CFB_EXPERIMENT_VERSION);
  assert.strictEqual(isCfbQualifiedCustomerSelection(game, "moneyline"), false);
  assert.strictEqual(toCfbQualifiedBoardEdge(game, "moneyline"), null);
  assert.strictEqual(toCfbCustomerLedgerRow(game, "2026-08-31", "moneyline"), null);
  assert.strictEqual(JSON.stringify(game).includes("cfbPredictionContract"), false);
}

// Customer publication reuses value:true and also requires a valid selected-side
// fair probability and positive aligned edge. The full control remains available.
{
  const ev = event();
  const game = prediction();
  game.moneyline.homeWinProb = 63;
  game.moneyline.awayWinProb = 37;
  game.moneyline.modelHomeWinProb = 66;
  game.moneyline.fair = { home: 57, away: 43 };
  const contract = attach(game, ev);
  assert.strictEqual(game.moneyline.value, true);
  assert.strictEqual(contract.moneyline.selected.edge, 0.06);
  assert.strictEqual(isCfbQualifiedCustomerSelection(game, "moneyline"), true);
  assert.strictEqual(toCfbQualifiedBoardEdge(game, "moneyline").side, "home");
  const customer = toCfbCustomerLedgerRow(game, "2026-08-31", "moneyline");
  assert.strictEqual(customer.market, CFB_CUSTOMER_MARKETS.moneyline);
  assert.strictEqual(customer.experiment_version, CFB_CUSTOMER_SELECTION_VERSION);
  assert.strictEqual(customer.selection, contract.moneyline.selected.selection);
  assert.strictEqual(customer.edge, contract.moneyline.selected.edge);

  const missingFairGame = { ...game, moneyline: { ...game.moneyline, value: true } };
  Object.defineProperty(missingFairGame, "cfbPredictionContract", { value: Object.freeze({
    ...contract,
    moneyline: Object.freeze({ ...contract.moneyline, selected: Object.freeze({
      ...contract.moneyline.selected, marketFairProb: null,
    }) }),
  }) });
  assert.strictEqual(isCfbQualifiedCustomerSelection(missingFairGame, "moneyline"), false);
}

// UNLV regression: UNLV is the shown side and cannot inherit Memphis's +3% edge.
{
  const ev = event("UNLV Rebels", "Memphis Tigers");
  const game = prediction("UNLV Rebels", "Memphis Tigers");
  const contract = attach(game, ev);
  assert.strictEqual(contract.moneyline.selected.selection, "home");
  assert.strictEqual(contract.moneyline.selected.edge, -0.03);
  assert.strictEqual(contract.moneyline.sides.away.edge, 0.03);
  assert.strictEqual(toCfbBoardEdge(game, "moneyline").teamAbbr, "UNLV Rebels");
  assert.strictEqual(toCfbLedgerRow(game, "2026-08-31", "moneyline", "moneyline", contract.moneyline.selected).edge, -0.03);
}

// Selected-side identities for spread, Over, and Under.
{
  const ev = event();
  const game = prediction();
  const contract = attach(game, ev);
  assert.strictEqual(contract.spread.selected.side, "home");
  assert.strictEqual(contract.spread.selected.edge, -0.02);
  assert.strictEqual(contract.total.selected.side, "over");
  assert.strictEqual(contract.total.selected.edge, -0.02);

  const underGame = prediction();
  underGame.total.overProb = 48;
  underGame.total.modelOverProb = 45;
  underGame.total.fair = { over: 46, under: 54 };
  const under = attach(underGame, ev).total.selected;
  assert.strictEqual(under.side, "under");
  assert.strictEqual(under.edge, -0.02);
  assert.strictEqual(toCfbLedgerRow(underGame, "2026-08-31", "total", "total", under).selection, "under");
}

// Market-only: fair probability remains available, but no raw probability or edge
// can masquerade as a rated WizePicks opinion.
{
  const ev = event("Stanford Cardinal", "UC Davis Aggies");
  const game = prediction("Stanford Cardinal", "UC Davis Aggies");
  game.dataQuality = "market-only";
  game.moneyline.homeWinProb = game.moneyline.fair.home;
  game.moneyline.awayWinProb = game.moneyline.fair.away;
  game.spread.homeCoverProb = game.spread.fair.home;
  game.total.overProb = game.total.fair.over;
  const snapshot = {
    ...ratedSnapshot,
    away: { source: "unavailable", weight: null },
  };
  const contract = attach(game, ev, snapshot);
  const side = contract.moneyline.selected;
  assert.strictEqual(side.isModelEdge, false);
  assert.strictEqual(side.rawProb, null);
  assert.strictEqual(side.edge, null);
  assert.strictEqual(side.publishedProb, side.marketFairProb);
  assert.strictEqual(toCfbBoardEdge(game, "moneyline"), null);
  const row = toCfbLedgerRow(game, "2026-08-31", "moneyline", "moneyline_shadow", contract.moneyline.sides.home, true);
  assert.strictEqual(row.data_quality, "market-only");
  assert.strictEqual(row.raw_win_prob, null);
  assert.strictEqual(row.edge, null);
}

// Incomplete immutable provenance stays all-null as a group, rather than fabricating
// a book or partial rating snapshot.
{
  const ev = event();
  ev.h2h.homeBook = null;
  const game = prediction();
  const side = attach(game, ev).moneyline.selected;
  assert.strictEqual(side.provenanceComplete, false);
  const row = toCfbLedgerRow(game, "2026-08-31", "moneyline", "moneyline", side);
  for (const key of ["entry_book", "opposing_book", "model_version", "experiment_version", "market_fair_prob", "data_quality",
    "rating_prior_season", "rating_current_season", "home_rating_source", "away_rating_source",
    "home_current_season_weight", "away_current_season_weight", "rating_sos_applied", "neutral_site_status"]) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(row, key), false, key);
  }
}

assert.strictEqual(isRatedCfbGuardRow({ league: "cfb", data_quality: "rated" }), true);
assert.strictEqual(isRatedCfbGuardRow({ league: "cfb", data_quality: "suspect" }), false);
assert.strictEqual(isRatedCfbGuardRow({ league: "cfb", data_quality: "market-only" }), false);
assert.strictEqual(isRatedCfbGuardRow({ league: "cfb", data_quality: null }), false);
assert.strictEqual(isRatedCfbGuardRow({ league: "nfl", data_quality: null }), true);

// Formula dials remain pinned; market-only model output is exactly de-vigged market.
assert.strictEqual(CFB_W_MODEL, 0.30);
assert.strictEqual(CFB_SIGMA, 15.5);
assert.strictEqual(CFB_TOTAL_SIGMA, 16);
assert.strictEqual(CFB_HFA_POINTS, 3);
{
  const ev = event();
  const out = predictGame(ev, {});
  assert.strictEqual(out.dataQuality, "market-only");
  assert.strictEqual(out.moneyline.homeWinProb, out.moneyline.fair.home);
  assert.strictEqual(out.spread.homeCoverProb, out.spread.fair.home);
  assert.strictEqual(out.total.overProb, out.total.fair.over);
}

// Ratings alone do not fabricate a totals opinion when scoring inputs are absent.
{
  const ev = event();
  const out = predictGame(ev, { home: { rating: 5 }, away: { rating: 0 } });
  const contract = buildCfbPredictionContract({ prediction: out, event: ev, ratingSnapshot: ratedSnapshot });
  assert.strictEqual(out.dataQuality, "rated");
  assert.strictEqual(contract.total.selected.rawProb, null);
  assert.strictEqual(contract.total.selected.edge, null);
  assert.strictEqual(contract.total.selected.isModelEdge, false);
}

console.log("cfbPredictionContract self-test: PASS");
