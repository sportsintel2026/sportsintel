// Resolve the probability inputs used by MLB historical-analysis routes.
//
// `model_prob` is the probability published at prediction time. `raw_win_prob`
// is the pre-market-blend model probability when the recorder captured it.
// `odds` + `opp_odds` are the two pick-time prices needed to recover the market's
// de-vigged probability directly. Older rows may lack the latter two sources; in
// that case the algebraic recovery is retained only as an explicitly labelled
// reconstruction, never represented as an original stored value.

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function impliedProbability(americanOdds) {
  const odds = finiteNumber(americanOdds);
  if (odds == null || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function devigTwoWay(thisOdds, opposingOdds) {
  const a = impliedProbability(thisOdds);
  const b = impliedProbability(opposingOdds);
  if (a == null || b == null || !(a + b > 0)) return null;
  return a / (a + b);
}

function resolveMlbPredictionSources(row, { wModel = 0.55 } = {}) {
  const claimed = finiteNumber(row && row.model_prob);
  const edge = finiteNumber(row && row.edge);
  const storedRaw = finiteNumber(row && row.raw_win_prob);
  const directFair = devigTwoWay(row && row.odds, row && row.opp_odds);
  const reconstructedFair = claimed != null && edge != null ? claimed - edge : null;

  const fair = directFair != null ? directFair : reconstructedFair;
  const fairSource = directFair != null
    ? "stored_pick_time_two_sided_odds"
    : reconstructedFair != null
      ? "reconstructed_from_model_prob_minus_edge"
      : "unavailable";

  const reconstructedRaw = fair != null && edge != null && Number.isFinite(wModel) && wModel > 0
    ? fair + edge / wModel
    : null;
  const raw = storedRaw != null ? storedRaw : reconstructedRaw;
  const rawSource = storedRaw != null
    ? "stored_at_prediction_time"
    : reconstructedRaw != null
      ? "reconstructed_from_published_probability_edge_and_blend_weight"
      : "unavailable";

  return {
    claimed,
    claimedSource: claimed != null ? "stored_at_prediction_time" : "unavailable",
    edge,
    fair,
    fairSource,
    raw,
    rawSource,
    authoritative: storedRaw != null && directFair != null,
  };
}

function summarizeMlbPredictionSources(resolvedRows) {
  const summary = {
    rows: resolvedRows.length,
    claimedStored: 0,
    rawStored: 0,
    rawReconstructed: 0,
    rawUnavailable: 0,
    fairFromStoredPrices: 0,
    fairReconstructed: 0,
    fairUnavailable: 0,
    fullyAuthoritative: 0,
  };
  for (const source of resolvedRows) {
    if (source.claimedSource === "stored_at_prediction_time") summary.claimedStored++;
    if (source.rawSource === "stored_at_prediction_time") summary.rawStored++;
    else if (source.rawSource === "unavailable") summary.rawUnavailable++;
    else summary.rawReconstructed++;
    if (source.fairSource === "stored_pick_time_two_sided_odds") summary.fairFromStoredPrices++;
    else if (source.fairSource === "unavailable") summary.fairUnavailable++;
    else summary.fairReconstructed++;
    if (source.authoritative) summary.fullyAuthoritative++;
  }
  return summary;
}

function rawProbabilityFor(recordingByGame, gameId, market, side) {
  const recording = recordingByGame && recordingByGame[String(gameId)];
  if (!recording) return null;
  if (market === "moneyline") {
    return side === "away"
      ? recording.moneyline?.awayRawModelProb ?? null
      : recording.moneyline?.homeRawModelProb ?? null;
  }
  if (market === "total") {
    return side === "under"
      ? recording.totals?.underRawModelProb ?? null
      : recording.totals?.overRawModelProb ?? null;
  }
  if (market === "run_line") {
    return side === "away"
      ? recording.runLine?.awayRawModelProb ?? null
      : recording.runLine?.homeRawModelProb ?? null;
  }
  return null;
}

function selfTest() {
  const directFair = devigTwoWay(-110, -110);
  const stored = resolveMlbPredictionSources({
    model_prob: 0.61,
    edge: 0.11,
    raw_win_prob: 0.73,
    odds: -110,
    opp_odds: -110,
  });
  const reconstructed = resolveMlbPredictionSources({ model_prob: 0.61, edge: 0.11, odds: -110 });
  const unavailable = resolveMlbPredictionSources({ model_prob: 0.61 });
  const recording = { "123": {
    moneyline: { awayRawModelProb: 0.44, homeRawModelProb: 0.56 },
    totals: { overRawModelProb: 0.58, underRawModelProb: 0.42 },
    runLine: { awayRawModelProb: 0.47, homeRawModelProb: 0.53 },
  } };
  const checks = [
    ["two-way de-vig", Math.abs(directFair - 0.5) < 1e-12],
    ["stored raw wins over algebraic reconstruction", stored.raw === 0.73 && stored.rawSource === "stored_at_prediction_time"],
    ["stored prices win over edge reconstruction", Math.abs(stored.fair - 0.5) < 1e-12 && stored.fairSource === "stored_pick_time_two_sided_odds"],
    ["legacy reconstruction is labelled", reconstructed.rawSource.startsWith("reconstructed_") && reconstructed.fairSource.startsWith("reconstructed_")],
    ["missing inputs remain unavailable", unavailable.raw == null && unavailable.rawSource === "unavailable"],
    ["moneyline side mapping", rawProbabilityFor(recording, 123, "moneyline", "away") === 0.44],
    ["totals side mapping", rawProbabilityFor(recording, 123, "total", "under") === 0.42],
    ["run-line side mapping", rawProbabilityFor(recording, 123, "run_line", "home") === 0.53],
  ];
  return { passed: checks.filter(([, ok]) => ok).length, failed: checks.filter(([, ok]) => !ok).map(([name]) => name), checks };
}

if (require.main === module) {
  const result = selfTest();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failed.length ? 1 : 0);
}

module.exports = {
  devigTwoWay,
  resolveMlbPredictionSources,
  rawProbabilityFor,
  summarizeMlbPredictionSources,
  selfTest,
};
