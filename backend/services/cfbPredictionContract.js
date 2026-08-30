// CFB prediction-time contract shared by the customer board and prediction ledger.
// It is deliberately pure: it projects already-fetched model/market inputs and never
// calls a provider or database. Probabilities are frozen to the ledger's 3-decimal
// precision before edge is derived, so `edge = model_prob - market_fair_prob` is exact.

const CFB_EXPERIMENT_VERSION = "cfb-side-edge-provenance-v1-2026-08-30";
const CFB_MODEL_VERSIONS = Object.freeze({
  moneyline: "cfb-moneyline-v1-2026-08-30",
  spread: "cfb-spread-v1-2026-08-30",
  total: "cfb-total-v1-2026-08-30",
});

const RATING_SOURCES = new Set(["prior-only", "blended", "current-only", "unavailable"]);

function round3(n) {
  return n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 1000) / 1000;
}

function pctToFraction(n) {
  return n == null ? null : round3(Number(n) / 100);
}

function validProb(n) {
  return n != null && Number.isFinite(Number(n)) && Number(n) > 0 && Number(n) < 1;
}

function complement(n) {
  return n == null ? null : round3(1 - Number(n));
}

function sideEdge(publishedProb, marketFairProb, isModelEdge) {
  if (!isModelEdge || !validProb(publishedProb) || !validProb(marketFairProb)) return null;
  return round3(Number(publishedProb) - Number(marketFairProb));
}

function ratingFields(snapshot = {}) {
  return {
    ratingPriorSeason: snapshot.priorSeason ?? null,
    ratingCurrentSeason: snapshot.currentSeason ?? null,
    homeRatingSource: snapshot.home?.source || "unavailable",
    awayRatingSource: snapshot.away?.source || "unavailable",
    homeCurrentSeasonWeight: snapshot.home?.weight ?? null,
    awayCurrentSeasonWeight: snapshot.away?.weight ?? null,
    ratingSosApplied: snapshot.sosApplied ?? null,
    neutralSiteStatus: snapshot.neutralSiteStatus || "unknown",
  };
}

function provenanceIsComplete(side) {
  if (!side || !validProb(side.publishedProb) || !validProb(side.marketFairProb)) return false;
  if (side.odds == null || side.opposingOdds == null || !side.book || !side.opposingBook) return false;
  if (!side.modelVersion || !side.experimentVersion) return false;
  if (!RATING_SOURCES.has(side.homeRatingSource) || !RATING_SOURCES.has(side.awayRatingSource)) return false;
  if (!new Set(["neutral", "non-neutral", "unknown"]).has(side.neutralSiteStatus)) return false;

  const bothUnavailable = side.homeRatingSource === "unavailable" && side.awayRatingSource === "unavailable";
  const anyUnavailable = side.homeRatingSource === "unavailable" || side.awayRatingSource === "unavailable";
  const sourceNeedsPrior = [side.homeRatingSource, side.awayRatingSource]
    .some((s) => s === "prior-only" || s === "blended");

  for (const [source, weight] of [
    [side.homeRatingSource, side.homeCurrentSeasonWeight],
    [side.awayRatingSource, side.awayCurrentSeasonWeight],
  ]) {
    if (source === "unavailable") {
      if (weight != null) return false;
    } else if (source === "prior-only") {
      if (Number(weight) !== 0) return false;
    } else if (source === "current-only") {
      if (Number(weight) !== 1) return false;
    } else if (!(Number(weight) > 0 && Number(weight) < 1)) {
      return false;
    }
  }

  if (bothUnavailable) {
    if (side.ratingPriorSeason != null || side.ratingCurrentSeason != null || side.ratingSosApplied != null) return false;
  } else {
    if (!Number.isInteger(side.ratingCurrentSeason) || side.ratingSosApplied == null) return false;
    if (sourceNeedsPrior && !Number.isInteger(side.ratingPriorSeason)) return false;
    if (side.ratingPriorSeason != null && side.ratingCurrentSeason !== side.ratingPriorSeason + 1) return false;
  }

  if (side.dataQuality === "rated" || side.dataQuality === "suspect") {
    return !anyUnavailable && validProb(side.rawProb) && side.edge != null
      && side.edge === round3(side.publishedProb - side.marketFairProb);
  }
  if (side.dataQuality === "market-only") {
    return anyUnavailable && side.rawProb == null && side.edge == null
      && side.publishedProb === side.marketFairProb;
  }
  return false;
}

function makeSide({
  market, side, selection, rawProb, publishedProb, marketFairProb, line,
  odds, opposingOdds, book, opposingBook, dataQuality, ratingSnapshot,
}) {
  const isModelEdge = dataQuality !== "market-only" && validProb(rawProb);
  const ratings = ratingFields(ratingSnapshot);
  const out = {
    market,
    side,
    selection,
    rawProb: isModelEdge ? round3(rawProb) : null,
    publishedProb: round3(publishedProb),
    marketFairProb: round3(marketFairProb),
    edge: sideEdge(round3(publishedProb), round3(marketFairProb), isModelEdge),
    line: line ?? null,
    odds: odds ?? null,
    opposingOdds: opposingOdds ?? null,
    book: book || null,
    opposingBook: opposingBook || null,
    dataQuality,
    isModelEdge,
    modelVersion: CFB_MODEL_VERSIONS[market],
    experimentVersion: CFB_EXPERIMENT_VERSION,
    ...ratings,
  };
  out.provenanceComplete = provenanceIsComplete(out);
  return Object.freeze(out);
}

function selectSide(market, sides) {
  if (!sides) return null;
  if (market === "moneyline") return sides.home.publishedProb >= sides.away.publishedProb ? sides.home : sides.away;
  if (market === "spread") return sides.home.publishedProb >= 0.5 ? sides.home : sides.away;
  return sides.over.publishedProb >= 0.5 ? sides.over : sides.under;
}

function buildCfbPredictionContract({ prediction, event, ratingSnapshot }) {
  const p = prediction || {};
  const ev = event || {};
  const quality = p.dataQuality || "market-only";
  const contract = {};

  const ml = p.moneyline;
  if (ml?.fair && ml?.book) {
    const homePublished = pctToFraction(ml.homeWinProb);
    const homeFair = pctToFraction(ml.fair.home);
    const homeRaw = quality === "market-only" ? null : pctToFraction(ml.modelHomeWinProb);
    const sides = {
      home: makeSide({ market: "moneyline", side: "home", selection: "home", rawProb: homeRaw,
        publishedProb: homePublished, marketFairProb: homeFair, line: null,
        odds: ml.book.home, opposingOdds: ml.book.away,
        book: ev.h2h?.homeBook, opposingBook: ev.h2h?.awayBook,
        dataQuality: quality, ratingSnapshot }),
      away: makeSide({ market: "moneyline", side: "away", selection: "away", rawProb: complement(homeRaw),
        publishedProb: complement(homePublished), marketFairProb: complement(homeFair), line: null,
        odds: ml.book.away, opposingOdds: ml.book.home,
        book: ev.h2h?.awayBook, opposingBook: ev.h2h?.homeBook,
        dataQuality: quality, ratingSnapshot }),
    };
    contract.moneyline = Object.freeze({ sides: Object.freeze(sides), selected: selectSide("moneyline", sides) });
  }

  const sp = p.spread;
  if (sp?.fair && sp?.book && sp.line != null) {
    const homePublished = pctToFraction(sp.homeCoverProb);
    const homeFair = pctToFraction(sp.fair.home);
    const homeRaw = quality === "market-only" ? null : pctToFraction(sp.modelHomeCoverProb);
    const sides = {
      home: makeSide({ market: "spread", side: "home", selection: "home", rawProb: homeRaw,
        publishedProb: homePublished, marketFairProb: homeFair, line: sp.line,
        odds: sp.book.home, opposingOdds: sp.book.away,
        book: ev.spreads?.homeBook, opposingBook: ev.spreads?.awayBook,
        dataQuality: quality, ratingSnapshot }),
      away: makeSide({ market: "spread", side: "away", selection: "away", rawProb: complement(homeRaw),
        publishedProb: complement(homePublished), marketFairProb: complement(homeFair), line: -sp.line,
        odds: sp.book.away, opposingOdds: sp.book.home,
        book: ev.spreads?.awayBook, opposingBook: ev.spreads?.homeBook,
        dataQuality: quality, ratingSnapshot }),
    };
    contract.spread = Object.freeze({ sides: Object.freeze(sides), selected: selectSide("spread", sides) });
  }

  const tot = p.total;
  if (tot?.fair && tot?.book && tot.line != null) {
    const overPublished = pctToFraction(tot.overProb);
    const overFair = pctToFraction(tot.fair.over);
    const overRaw = quality === "market-only" ? null : pctToFraction(tot.modelOverProb);
    const sides = {
      over: makeSide({ market: "total", side: "over", selection: "over", rawProb: overRaw,
        publishedProb: overPublished, marketFairProb: overFair, line: tot.line,
        odds: tot.book.over, opposingOdds: tot.book.under,
        book: ev.totals?.overBook, opposingBook: ev.totals?.underBook,
        dataQuality: quality, ratingSnapshot }),
      under: makeSide({ market: "total", side: "under", selection: "under", rawProb: complement(overRaw),
        publishedProb: complement(overPublished), marketFairProb: complement(overFair), line: tot.line,
        odds: tot.book.under, opposingOdds: tot.book.over,
        book: ev.totals?.underBook, opposingBook: ev.totals?.overBook,
        dataQuality: quality, ratingSnapshot }),
    };
    contract.total = Object.freeze({ sides: Object.freeze(sides), selected: selectSide("total", sides) });
  }

  return Object.freeze(contract);
}

function applyCfbContractToPrediction(prediction, contract, thresholds) {
  for (const market of ["moneyline", "spread", "total"]) {
    const target = prediction?.[market];
    const selected = contract?.[market]?.selected;
    if (!target || !selected) continue;
    target.edge = selected.edge == null ? null : Math.round(selected.edge * 1000) / 10;
    target.isModelEdge = selected.isModelEdge;
    target.value = selected.dataQuality === "rated" && selected.edge != null
      && selected.edge >= Number(thresholds?.[market] ?? Infinity);
    target.pick = target.value ? selected.side : null;
    if (market !== "total") {
      target.pickTeam = target.value
        ? (selected.side === "home" ? prediction.homeTeam : prediction.awayTeam)
        : null;
    }
  }
  return prediction;
}

function toCfbBoardEdge(game, market) {
  const selected = game?.cfbPredictionContract?.[market]?.selected;
  if (!selected || selected.edge == null) return null;
  const out = {
    gameId: game.eventId,
    side: selected.side,
    matchup: game.matchup,
    edge: Math.round(selected.edge * 1000) / 10,
    odds: selected.odds,
    modelProb: selected.publishedProb,
    marketFairProb: selected.marketFairProb,
    line: selected.line,
    dataQuality: selected.dataQuality,
    isModelEdge: selected.isModelEdge,
    convictionScore: null,
    conviction: null,
    provisional: true,
  };
  if (market !== "total") out.teamAbbr = selected.side === "home" ? game.homeTeam : game.awayTeam;
  return out;
}

function ledgerProvenance(side) {
  if (!side?.provenanceComplete) return {};
  return {
    entry_book: side.book,
    opposing_book: side.opposingBook,
    model_version: side.modelVersion,
    experiment_version: side.experimentVersion,
    market_fair_prob: side.marketFairProb,
    data_quality: side.dataQuality,
    rating_prior_season: side.ratingPriorSeason,
    rating_current_season: side.ratingCurrentSeason,
    home_rating_source: side.homeRatingSource,
    away_rating_source: side.awayRatingSource,
    home_current_season_weight: side.homeCurrentSeasonWeight,
    away_current_season_weight: side.awayCurrentSeasonWeight,
    rating_sos_applied: side.ratingSosApplied,
    neutral_site_status: side.neutralSiteStatus,
  };
}

function toCfbLedgerRow(game, gameDate, market, rowMarket, side, shadow = false) {
  if (!side || side.odds == null || side.publishedProb == null) return null;
  const team = side.side === "home" ? game.homeTeam : game.awayTeam;
  const label = market === "moneyline"
    ? `${team || side.side} ML`
    : market === "spread"
      ? `${team || side.side} ${side.line > 0 ? "+" : ""}${side.line}`
      : `${side.side === "over" ? "Over" : "Under"} ${side.line}`;
  const row = {
    game_id: String(game.eventId), game_date: gameDate, league: "cfb", matchup: game.matchup,
    market: rowMarket, selection: side.selection,
    description: shadow ? `SHADOW ${label} (full slate)` : label,
    model_prob: side.publishedProb,
    raw_win_prob: side.rawProb,
    odds: side.odds,
    opp_odds: side.opposingOdds,
    edge: side.edge,
    confidence: null, conviction: null, conviction_score: null,
    line: side.line,
    ...ledgerProvenance(side),
  };
  if (market === "moneyline" || market === "spread") row.projected_margin = game.moneyline?.modelMargin ?? null;
  if (market === "total") row.projected = game.total?.projTotal ?? null;
  return row;
}

function isRatedCfbGuardRow(row) {
  return String(row?.league || "").toLowerCase() !== "cfb" || row?.data_quality === "rated";
}

module.exports = {
  CFB_EXPERIMENT_VERSION,
  CFB_MODEL_VERSIONS,
  buildCfbPredictionContract,
  applyCfbContractToPrediction,
  toCfbBoardEdge,
  toCfbLedgerRow,
  ledgerProvenance,
  isRatedCfbGuardRow,
  _internal: { round3, pctToFraction, complement, sideEdge, provenanceIsComplete, makeSide, selectSide },
};
