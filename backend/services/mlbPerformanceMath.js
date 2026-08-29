// MLB monetary-performance helpers.
//
// A decisive result is valid evidence for win-rate accuracy even when its
// prediction-time price is missing. It is not valid evidence for profit/ROI:
// without a stored entry price, the monetary return is unknowable.

// This module intentionally does not reconstruct entry prices from later
// closing lines or odds snapshots.

function normalizeAmericanOdds(value) {
  if (value == null || value === "") return null;
  const odds = Number(value);
  if (!Number.isFinite(odds) || Math.abs(odds) < 100) return null;
  return odds;
}

function mlbMonetaryProfit(result, oddsValue) {
  const resultKey = String(result || "").toLowerCase();
  if (resultKey !== "win" && resultKey !== "loss") return null;

  const odds = normalizeAmericanOdds(oddsValue);
  if (odds == null) return null;
  if (resultKey === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function summarizeMlbRoi(rows) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  let roiSample = 0;
  let roiUnavailable = 0;

  for (const row of rows || []) {
    const result = String((row && row.result) || "").toLowerCase();
    if (result === "win") wins++;
    else if (result === "loss") losses++;
    else if (result === "push") { pushes++; continue; }
    else continue;

    const profit = mlbMonetaryProfit(result, row && row.odds);
    if (profit == null) roiUnavailable++;
    else { units += profit; roiSample++; }
  }

  return {
    wins,
    losses,
    pushes,
    accuracySample: wins + losses,
    roiSample,
    roiUnavailable,
    units: Math.round(units * 100) / 100,
    roiPct: roiSample ? Math.round((units / roiSample) * 1000) / 10 : null,
  };
}

module.exports = {
  normalizeAmericanOdds,
  mlbMonetaryProfit,
  summarizeMlbRoi,
};
