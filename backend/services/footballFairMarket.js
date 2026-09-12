"use strict";

function impliedProbability(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

function median(values) {
  const sorted = [...(values || [])].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function coherentFairConsensus(quotes, {
  firstKey,
  secondKey,
  firstBookKey = "book",
  secondBookKey = "book",
  line = null,
  snapshotAt = null,
} = {}) {
  const pairs = [];
  for (const quote of quotes || []) {
    const firstOdds = quote?.[firstKey];
    const secondOdds = quote?.[secondKey];
    const firstBook = quote?.[firstBookKey] || null;
    const secondBook = quote?.[secondBookKey] || null;
    if (!firstBook || firstBook !== secondBook) continue;
    const firstImplied = impliedProbability(firstOdds);
    const secondImplied = impliedProbability(secondOdds);
    const sum = firstImplied + secondImplied;
    if (!Number.isFinite(firstImplied) || !Number.isFinite(secondImplied) || !(sum > 0)) continue;
    pairs.push(Object.freeze({
      book: firstBook,
      firstOdds,
      secondOdds,
      first: firstImplied / sum,
      second: secondImplied / sum,
      lastUpdate: quote?.lastUpdate || null,
    }));
  }
  if (!pairs.length) return null;
  const first = median(pairs.map((pair) => pair.first));
  if (!Number.isFinite(first)) return null;
  return Object.freeze({
    first,
    second: 1 - first,
    line,
    pairCount: pairs.length,
    snapshotAt,
    method: "median-of-same-book-devigged-pairs",
    pairs: Object.freeze(pairs),
  });
}

function buildFootballFairMarket({
  h2hQuotes = [], spreadQuotes = [], totalsQuotes = [],
  consensusAwayLine = null, consensusTotalLine = null, snapshotAt = null,
} = {}) {
  const moneyline = coherentFairConsensus(h2hQuotes, {
    firstKey: "home", secondKey: "away", snapshotAt,
  });
  const spread = coherentFairConsensus(
    spreadQuotes.filter((quote) => quote.awayLine === consensusAwayLine),
    {
      firstKey: "home", secondKey: "away",
      firstBookKey: "homeBook", secondBookKey: "awayBook",
      line: consensusAwayLine == null ? null : -consensusAwayLine,
      snapshotAt,
    },
  );
  const total = coherentFairConsensus(
    totalsQuotes.filter((quote) => quote.line === consensusTotalLine),
    {
      firstKey: "over", secondKey: "under",
      firstBookKey: "overBook", secondBookKey: "underBook",
      line: consensusTotalLine,
      snapshotAt,
    },
  );
  return Object.freeze({
    moneyline: moneyline && Object.freeze({ home: moneyline.first, away: moneyline.second, ...moneyline }),
    spread: spread && Object.freeze({ home: spread.first, away: spread.second, ...spread }),
    total: total && Object.freeze({ over: total.first, under: total.second, ...total }),
  });
}

module.exports = {
  buildFootballFairMarket,
  coherentFairConsensus,
  _internal: { impliedProbability, median },
};
