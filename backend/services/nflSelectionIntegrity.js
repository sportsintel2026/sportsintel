"use strict";

// One selected-side contract for the active NFL customer board and ledger.
// It consumes the already-computed slate only: no provider calls and no model math.

const { EDGE_ML, EDGE_SPREAD, EDGE_TOTAL } = require("./nflModel");

const NFL_SELECTION_EXPERIMENT_VERSION = "nfl-blend-30-40-50-v1-2026-09-11";
const NFL_SELECTION_MODEL_VERSIONS = Object.freeze({
  moneyline: "nfl-moneyline-w040-v1-2026-09-11",
  spread: "nfl-spread-w040-v1-2026-09-11",
  total: "nfl-total-w040-v1-2026-09-11",
});
const NFL_SELECTION_THRESHOLDS = Object.freeze({
  moneyline: EDGE_ML,
  spread: EDGE_SPREAD,
  total: EDGE_TOTAL,
});

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, places = 3) {
  const number = finite(value);
  if (number == null) return null;
  const scale = 10 ** places;
  return Math.round(number * scale) / scale;
}

function pctToFraction(value) {
  const number = finite(value);
  return number == null ? null : round(number / 100);
}

function complement(value) {
  return value == null ? null : round(1 - Number(value));
}

function validBook(value) {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 128
    && !/\p{Cc}/u.test(value);
}

function orientedBlendSnapshot(game, market, side) {
  const snapshot = game?._nflBlendSnapshot?.[market];
  if (!snapshot) return {};
  const referenceSide = market === "total" ? "over" : "home";
  const sameSide = side === referenceSide;
  const orient = (value) => sameSide ? round(value) : complement(round(value));
  return {
    rawModelProb: orient(snapshot.rawModelProb),
    blend30Prob: orient(snapshot.blend30Prob),
    blend40Prob: orient(snapshot.blend40Prob),
    blend50Prob: orient(snapshot.blend50Prob),
  };
}

function makeSide({ game, market, side, modelProb, marketFairProb, odds, opposingOdds, book, opposingBook, line }) {
  const selectedModelProb = round(modelProb);
  const selectedMarketProb = round(marketFairProb);
  const blend = orientedBlendSnapshot(game, market, side);
  const edge = selectedModelProb == null || selectedMarketProb == null
    ? null
    : round(selectedModelProb - selectedMarketProb);
  const selection = side;
  const team = side === "home" ? game.homeTeam : side === "away" ? game.awayTeam : null;
  const threshold = NFL_SELECTION_THRESHOLDS[market];
  const qualifiedShadow = game.dataQuality === "rated" && edge != null && edge >= threshold;
  return Object.freeze({
    market,
    side,
    selection,
    team,
    modelProb: selectedModelProb,
    marketFairProb: selectedMarketProb,
    edge,
    edgePct: edge == null ? null : round(edge * 100, 1),
    odds: finite(odds),
    opposingOdds: finite(opposingOdds),
    book: validBook(book) ? book : null,
    opposingBook: validBook(opposingBook) ? opposingBook : null,
    line: finite(line),
    dataQuality: game.dataQuality || null,
    qualifiedShadow,
    rawModelProb: blend.rawModelProb ?? null,
    blend30Prob: blend.blend30Prob ?? null,
    blend40Prob: blend.blend40Prob ?? null,
    blend50Prob: blend.blend50Prob ?? null,
    modelVersion: NFL_SELECTION_MODEL_VERSIONS[market],
    experimentVersion: NFL_SELECTION_EXPERIMENT_VERSION,
  });
}

function buildNflSelectionContract(game) {
  if (!game) return Object.freeze({});
  const contract = {};

  const ml = game.moneyline;
  if (ml?.fair && ml?.book) {
    const homeProb = pctToFraction(ml.homeWinProb);
    const awayProb = pctToFraction(ml.awayWinProb);
    const homeFair = pctToFraction(ml.fair.home);
    const awayFair = pctToFraction(ml.fair.away);
    const market = game.marketBooks?.moneyline;
    const sides = {
      home: makeSide({ game, market: "moneyline", side: "home", modelProb: homeProb,
        marketFairProb: homeFair, odds: ml.book.home, opposingOdds: ml.book.away,
        book: market?.homeBook, opposingBook: market?.awayBook, line: null }),
      away: makeSide({ game, market: "moneyline", side: "away", modelProb: awayProb,
        marketFairProb: awayFair, odds: ml.book.away, opposingOdds: ml.book.home,
        book: market?.awayBook, opposingBook: market?.homeBook, line: null }),
    };
    const selected = homeProb != null && homeProb >= (awayProb ?? -Infinity) ? sides.home : sides.away;
    contract.moneyline = Object.freeze({ sides: Object.freeze(sides), selected });
  }

  const spread = game.spread;
  if (spread?.fair && spread?.book && spread.line != null) {
    const homeProb = pctToFraction(spread.homeCoverProb);
    const homeFair = pctToFraction(spread.fair.home);
    const market = game.marketBooks?.spread;
    const sides = {
      home: makeSide({ game, market: "spread", side: "home", modelProb: homeProb,
        marketFairProb: homeFair, odds: spread.book.home, opposingOdds: spread.book.away,
        book: market?.homeBook, opposingBook: market?.awayBook, line: spread.line }),
      away: makeSide({ game, market: "spread", side: "away", modelProb: complement(homeProb),
        marketFairProb: complement(homeFair), odds: spread.book.away, opposingOdds: spread.book.home,
        book: market?.awayBook, opposingBook: market?.homeBook, line: -Number(spread.line) }),
    };
    contract.spread = Object.freeze({
      sides: Object.freeze(sides),
      selected: homeProb != null && homeProb >= 0.5 ? sides.home : sides.away,
    });
  }

  const total = game.total;
  if (total?.fair && total?.book && total.line != null) {
    const overProb = pctToFraction(total.overProb);
    const overFair = pctToFraction(total.fair.over);
    const market = game.marketBooks?.total;
    const sides = {
      over: makeSide({ game, market: "total", side: "over", modelProb: overProb,
        marketFairProb: overFair, odds: total.book.over, opposingOdds: total.book.under,
        book: market?.overBook, opposingBook: market?.underBook, line: total.line }),
      under: makeSide({ game, market: "total", side: "under", modelProb: complement(overProb),
        marketFairProb: complement(overFair), odds: total.book.under, opposingOdds: total.book.over,
        book: market?.underBook, opposingBook: market?.overBook, line: total.line }),
    };
    contract.total = Object.freeze({
      sides: Object.freeze(sides),
      selected: overProb != null && overProb >= 0.5 ? sides.over : sides.under,
    });
  }

  return Object.freeze(contract);
}

function toNflBoardEdge(game, market) {
  const selected = game?.nflSelectionContract?.[market]?.selected
    || buildNflSelectionContract(game)?.[market]?.selected;
  if (!selected || selected.modelProb == null || selected.edge == null) return null;
  return {
    gameId: game.eventId,
    side: selected.side,
    matchup: game.matchup,
    teamAbbr: selected.team,
    edge: selected.edgePct,
    odds: selected.odds,
    oppOdds: selected.opposingOdds,
    book: selected.book,
    opposingBook: selected.opposingBook,
    modelProb: selected.modelProb,
    marketFairProb: selected.marketFairProb,
    line: selected.line,
    dataQuality: selected.dataQuality,
    convictionScore: null,
    conviction: null,
    provisional: true,
  };
}

function provenanceFields(side) {
  const complete = side && side.odds != null && side.opposingOdds != null
    && side.modelProb != null && side.marketFairProb != null && side.edge != null
    && side.rawModelProb != null && side.blend30Prob != null
    && side.blend40Prob != null && side.blend50Prob != null
    && side.book && side.opposingBook && side.modelVersion && side.experimentVersion;
  if (!complete) return {
    entry_book: null,
    opposing_book: null,
    model_version: null,
    experiment_version: null,
  };
  return {
    entry_book: side.book,
    opposing_book: side.opposingBook,
    model_version: side.modelVersion,
    experiment_version: side.experimentVersion,
  };
}

function toNflLedgerRow(game, gameDate, market, side) {
  if (!side || side.modelProb == null || side.odds == null || side.edge == null) return null;
  const team = side.team || side.side;
  const description = market === "moneyline"
    ? `${team} ML`
    : market === "spread"
      ? `${team} ${side.line > 0 ? "+" : ""}${side.line}`
      : `${side.side === "over" ? "Over" : "Under"} ${side.line}`;
  const provenance = provenanceFields(side);
  const completeProvenance = provenance.model_version != null;
  return {
    game_id: String(game.eventId),
    game_date: gameDate,
    league: "nfl",
    matchup: game.matchup,
    market,
    selection: side.selection,
    description,
    model_prob: side.modelProb,
    odds: side.odds,
    opp_odds: side.opposingOdds,
    edge: side.edge,
    confidence: null,
    conviction: null,
    conviction_score: null,
    line: side.line,
    raw_win_prob: completeProvenance ? side.rawModelProb : null,
    market_fair_prob: completeProvenance ? side.marketFairProb : null,
    nfl_blend_30_prob: completeProvenance ? side.blend30Prob : null,
    nfl_blend_40_prob: completeProvenance ? side.blend40Prob : null,
    nfl_blend_50_prob: completeProvenance ? side.blend50Prob : null,
    ...provenance,
  };
}

function isFrozenControlRow(row) {
  return ["moneyline", "spread", "total"].includes(row?.market)
    && row?.experiment_version === NFL_SELECTION_EXPERIMENT_VERSION
    && row?.model_version === NFL_SELECTION_MODEL_VERSIONS[row.market]
    && validBook(row?.entry_book)
    && validBook(row?.opposing_book)
    && finite(row?.model_prob) != null
    && finite(row?.raw_win_prob) != null
    && finite(row?.market_fair_prob) != null
    && finite(row?.nfl_blend_30_prob) != null
    && finite(row?.nfl_blend_40_prob) != null
    && finite(row?.nfl_blend_50_prob) != null
    && finite(row?.edge) != null
    && finite(row?.odds) != null
    && finite(row?.opp_odds) != null;
}

function summarize(rows) {
  const source = rows || [];
  const settled = source.filter((row) => ["win", "loss", "push"].includes(row.result));
  const wins = settled.filter((row) => row.result === "win").length;
  const losses = settled.filter((row) => row.result === "loss").length;
  return {
    decisions: source.length,
    pending: source.filter((row) => row.result == null || row.result === "pending").length,
    wins,
    losses,
    pushes: settled.length - wins - losses,
  };
}

function analyzeNflSelectionShadow(rows) {
  const control = (rows || []).filter(isFrozenControlRow);
  const qualified = control.filter((row) => Number(row.edge) >= NFL_SELECTION_THRESHOLDS[row.market]);
  const byMarket = {};
  for (const market of ["moneyline", "spread", "total"]) {
    const marketControl = control.filter((row) => row.market === market);
    const marketQualified = qualified.filter((row) => row.market === market);
    byMarket[market] = {
      threshold: NFL_SELECTION_THRESHOLDS[market],
      control: summarize(marketControl),
      qualifiedShadow: summarize(marketQualified),
    };
  }
  return {
    experimentVersion: NFL_SELECTION_EXPERIMENT_VERSION,
    rule: "current full-board selection vs same selected side with aligned edge >= existing market threshold",
    control: summarize(control),
    qualifiedShadow: summarize(qualified),
    byMarket,
  };
}

async function fetchNflSelectionShadowRows(supabase, { since = null, until = null } = {}) {
  const fields = [
    "game_id", "game_date", "created_at", "market", "selection", "line", "result",
    "model_prob", "raw_win_prob", "market_fair_prob", "nfl_blend_30_prob",
    "nfl_blend_40_prob", "nfl_blend_50_prob", "edge", "odds", "opp_odds", "entry_book", "opposing_book",
    "model_version", "experiment_version",
  ].join(",");
  const rows = [];
  const pageSize = 1000;
  for (let page = 0; page < 50; page++) {
    let query = supabase.from("model_predictions").select(fields)
      .eq("league", "nfl")
      .eq("experiment_version", NFL_SELECTION_EXPERIMENT_VERSION)
      .in("market", ["moneyline", "spread", "total"])
      .order("game_date", { ascending: true })
      .order("game_id", { ascending: true });
    if (since) query = query.gte("game_date", since);
    if (until) query = query.lte("game_date", until);
    const { data, error } = await query.range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
  throw new Error("NFL selection shadow fetch exceeded 50,000 rows");
}

module.exports = {
  NFL_SELECTION_EXPERIMENT_VERSION,
  NFL_SELECTION_MODEL_VERSIONS,
  NFL_SELECTION_THRESHOLDS,
  buildNflSelectionContract,
  toNflBoardEdge,
  toNflLedgerRow,
  provenanceFields,
  analyzeNflSelectionShadow,
  fetchNflSelectionShadowRows,
  _internal: { finite, round, pctToFraction, complement, orientedBlendSnapshot, makeSide, isFrozenControlRow },
};
