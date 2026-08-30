"use strict";

// Prospective, shadow-only validation for the current MLB moneyline and run-line
// selection rules. This module does not select customer picks, call a sports
// provider, or alter model math. It only (a) builds immutable recording metadata
// from an already-computed odds/model snapshot and (b) analyzes graded ledger rows.

const { payout } = require("./priceMath");

const EXPERIMENT_VERSION = "mlb-mlrl-selection-v1-2026-08-29";
const EXPERIMENT_START_DATE = "2026-08-29";
const MONEYLINE_MODEL_VERSION = "mlb-moneyline-a361304-w055-v1";
const RUN_LINE_MODEL_VERSION = "mlb-run-line-a361304-negbin-phi3-w055-v1";
const NULL_PROVENANCE = Object.freeze({
  entry_book: null,
  opposing_book: null,
  model_version: null,
  experiment_version: null,
});

const finite = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const round = (value, places = 6) => {
  const n = finite(value);
  if (n == null) return null;
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
};

function validText(value, { identifier = false } = {}) {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > 128) return null;
  if (/\p{Cc}/u.test(value)) return null;
  if (identifier && !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value)) return null;
  return value;
}

function expectedModelVersion(market) {
  if (market === "moneyline") return MONEYLINE_MODEL_VERSION;
  if (market === "run_line") return RUN_LINE_MODEL_VERSION;
  return null;
}

function nullProvenance() {
  return { ...NULL_PROVENANCE };
}

// Build all four immutable fields together or return four NULLs. Complete means
// the selected side has its original raw/published/edge/two-sided-price inputs,
// exact book names, and the frozen version identifiers from the same calculation.
function buildSelectionProvenance(recordingByGame, gameId, market, side, facts = {}) {
  if (!["moneyline", "run_line"].includes(market) || !["away", "home"].includes(side)) return nullProvenance();
  const recording = recordingByGame?.[String(gameId)]?.[market === "moneyline" ? "moneyline" : "runLine"];
  if (!recording) return nullProvenance();

  const entryBook = validText(side === "away" ? recording.awayBook : recording.homeBook);
  const opposingBook = validText(side === "away" ? recording.homeBook : recording.awayBook);
  const modelVersion = validText(recording.modelVersion, { identifier: true });
  const experimentVersion = validText(recording.experimentVersion, { identifier: true });
  const expectedVersion = expectedModelVersion(market);
  const completeFacts = [
    facts.rawProbability,
    facts.publishedProbability,
    facts.edge,
    facts.entryOdds,
    facts.opposingOdds,
  ].every((value) => finite(value) != null);

  if (!entryBook || !opposingBook || !modelVersion || !experimentVersion || !completeFacts
      || modelVersion !== expectedVersion || experimentVersion !== EXPERIMENT_VERSION) {
    return nullProvenance();
  }

  return {
    entry_book: entryBook,
    opposing_book: opposingBook,
    model_version: modelVersion,
    experiment_version: experimentVersion,
  };
}

function isCompleteFrozenRow(row) {
  const expectedVersion = expectedModelVersion(row?.market);
  return expectedVersion != null
    && row?.experiment_version === EXPERIMENT_VERSION
    && row?.model_version === expectedVersion
    && validText(row?.entry_book) != null
    && validText(row?.opposing_book) != null
    && finite(row?.model_prob) != null
    && finite(row?.raw_win_prob) != null
    && finite(row?.edge) != null
    && finite(row?.odds) != null
    && finite(row?.opp_odds) != null
    && ["away", "home"].includes(row?.selection);
}

function isoWeek(dateValue) {
  const date = new Date(`${String(dateValue || '').slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "unknown";
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function priceBand(oddsValue) {
  const odds = finite(oddsValue);
  if (odds == null) return "unpriced";
  if (odds <= -200) return "<=-200";
  if (odds <= -150) return "-199_to_-150";
  if (odds <= -110) return "-149_to_-110";
  if (odds < 100) return "-109_to_+99";
  if (odds < 150) return "+100_to_+149";
  return "+150_plus";
}

function runLineSide(row) {
  const line = finite(row?.line);
  if (line == null) return "unknown";
  if (line < 0) return "favorite_-1.5";
  if (line > 0) return "underdog_+1.5";
  return "pickem";
}

function calibration(rows) {
  const bins = Array.from({ length: 10 }, (_, index) => ({
    lower: index / 10,
    upper: (index + 1) / 10,
    n: 0,
    predicted: 0,
    observed: 0,
  }));
  for (const row of rows) {
    const probability = finite(row.model_prob);
    if (probability == null) continue;
    const bin = bins[Math.min(9, Math.max(0, Math.floor(probability * 10)))];
    bin.n++;
    bin.predicted += probability;
    bin.observed += row.result === "win" ? 1 : 0;
  }
  const n = bins.reduce((sum, bin) => sum + bin.n, 0);
  if (!n) return { ece: null, bias: null, bins: [] };
  let ece = 0;
  let predicted = 0;
  let observed = 0;
  const output = bins.filter((bin) => bin.n).map((bin) => {
    const averagePredicted = bin.predicted / bin.n;
    const averageObserved = bin.observed / bin.n;
    ece += (bin.n / n) * Math.abs(averagePredicted - averageObserved);
    predicted += bin.predicted;
    observed += bin.observed;
    return {
      range: `${Math.round(bin.lower * 100)}-${Math.round(bin.upper * 100)}%`,
      n: bin.n,
      averagePredicted: round(averagePredicted),
      observedWinRate: round(averageObserved),
      gap: round(averagePredicted - averageObserved),
    };
  });
  return { ece: round(ece), bias: round((predicted - observed) / n), bins: output };
}

function clvSummary(rows, field) {
  const values = rows.map((row) => finite(row[field])).filter((value) => value != null);
  if (!values.length) return { sample: 0, average: null, beat: 0, tied: 0, worse: 0 };
  return {
    sample: values.length,
    average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    beat: values.filter((value) => value > 0).length,
    tied: values.filter((value) => value === 0).length,
    worse: values.filter((value) => value < 0).length,
  };
}

function summarize(rows) {
  const decisions = rows || [];
  const settled = decisions.filter((row) => ['win', 'loss', 'push'].includes(row.result));
  const decisive = settled.filter((row) => ['win', 'loss'].includes(row.result));
  const wins = decisive.filter((row) => row.result === "win").length;
  const losses = decisive.length - wins;
  let units = 0;
  let roiEligible = 0;
  let brier = 0;
  let logLoss = 0;
  let publishedSum = 0;
  let rawSum = 0;
  let edgeSum = 0;
  let publishedN = 0;
  let rawN = 0;
  let edgeN = 0;

  for (const row of decisive) {
    const price = finite(row.odds);
    const winProfit = payout(price);
    if (price != null && winProfit != null) {
      units += row.result === "win" ? winProfit : -1;
      roiEligible++;
    }
    const p0 = finite(row.model_prob);
    if (p0 != null) {
      const p = Math.min(1 - 1e-12, Math.max(1e-12, p0));
      const y = row.result === "win" ? 1 : 0;
      brier += (p - y) ** 2;
      logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      publishedSum += p0;
      publishedN++;
    }
    const raw = finite(row.raw_win_prob);
    if (raw != null) { rawSum += raw; rawN++; }
    const edge = finite(row.edge);
    if (edge != null) { edgeSum += edge; edgeN++; }
  }

  const cal = calibration(decisive);
  return {
    decisions: decisions.length,
    settled: settled.length,
    pending: decisions.filter((row) => row.result === "pending" || row.result == null).length,
    pushes: settled.filter((row) => row.result === "push").length,
    decisive: decisive.length,
    wins,
    losses,
    winPct: decisive.length ? round(100 * wins / decisive.length) : null,
    roiEligible,
    units: roiEligible ? round(units) : null,
    roiPct: roiEligible ? round(100 * units / roiEligible) : null,
    averagePublishedProbability: publishedN ? round(publishedSum / publishedN) : null,
    averageRawProbability: rawN ? round(rawSum / rawN) : null,
    averageEdge: edgeN ? round(edgeSum / edgeN) : null,
    brier: publishedN ? round(brier / publishedN) : null,
    logLoss: publishedN ? round(logLoss / publishedN) : null,
    calibrationBias: cal.bias,
    ece: cal.ece,
    calibrationBins: cal.bins,
    usClv: clvSummary(decisive, "clv"),
    pinnacleClv: clvSummary(decisive, "pinnacle_clv"),
  };
}

function grouped(rows, keyFn) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups.entries()].map(([key, group]) => [key, summarize(group)]));
}

function chronological(rows) {
  return [...(rows || [])].sort((a, b) => {
    const timestampOrder = String(a.created_at || "").localeCompare(String(b.created_at || ""));
    if (timestampOrder) return timestampOrder;
    const dateOrder = String(a.game_date || "").localeCompare(String(b.game_date || ""));
    if (dateOrder) return dateOrder;
    return `${a.game_id || ""}|${a.selection || ""}`.localeCompare(`${b.game_id || ""}|${b.selection || ""}`);
  });
}

function timeBlocks(rows, size = 25) {
  const sorted = chronological(rows);
  const output = {};
  for (let start = 0; start < sorted.length; start += size) {
    const end = Math.min(sorted.length, start + size);
    const block = sorted.slice(start, end);
    const label = `${String(start + 1).padStart(3, "0")}-${String(end).padStart(3, "0")}`;
    output[label] = {
      firstDate: block[0]?.game_date || null,
      lastDate: block.at(-1)?.game_date || null,
      firstPredictionAt: block[0]?.created_at || null,
      lastPredictionAt: block.at(-1)?.created_at || null,
      ...summarize(block),
    };
  }
  return output;
}

function checkpoints(rows) {
  const sorted = chronological(rows);
  const output = {};
  for (const n of [50, 100, 150]) {
    output[String(n)] = {
      reached: sorted.length >= n,
      availableDecisions: sorted.length,
      interpretation: n === 50 ? "early diagnostic only" : n === 100 ? "stronger interim evaluation" : "serious promotion review; never ROI-only",
      metrics: sorted.length >= n ? summarize(sorted.slice(0, n)) : null,
    };
  }
  return output;
}

function reportVariant(rows) {
  const sorted = chronological(rows);
  return {
    overall: summarize(sorted),
    byHomeAway: grouped(sorted, (row) => row.selection || "unknown"),
    byPriceBand: grouped(sorted, (row) => priceBand(row.odds)),
    byRunLineSide: grouped(sorted.filter((row) => row.market === "run_line"), runLineSide),
    byWeek: grouped(sorted, (row) => isoWeek(row.game_date)),
    timeBlocks: timeBlocks(sorted),
    checkpoints: checkpoints(sorted),
  };
}

function provenanceCounts(rows) {
  const output = {};
  for (const market of ["moneyline", "run_line"]) {
    const marketRows = (rows || []).filter((row) => row.market === market);
    const allNull = marketRows.filter((row) => [row.entry_book, row.opposing_book, row.model_version, row.experiment_version].every((value) => value == null));
    const partial = marketRows.filter((row) => {
      const fields = [row.entry_book, row.opposing_book, row.model_version, row.experiment_version];
      return fields.some((value) => value == null) && fields.some((value) => value != null);
    });
    const complete = marketRows.filter(isCompleteFrozenRow);
    output[market] = {
      rowsSinceExperimentStart: marketRows.length,
      completeFrozenProvenance: complete.length,
      allFourNull: allNull.length,
      partialFourFieldProvenance: partial.length,
      populatedButWrongVersionOrMissingCoreInput: marketRows.length - allNull.length - partial.length - complete.length,
    };
  }
  return output;
}

function analyzeMlbMlRlValidation(rows) {
  const allRows = rows || [];
  const eligible = allRows.filter(isCompleteFrozenRow);
  const moneylineControl = eligible.filter((row) => row.market === "moneyline");
  const moneylineChallenger = moneylineControl.filter((row) => Number(row.model_prob) >= 0.525);
  const runLineControl = eligible.filter((row) => row.market === "run_line");
  const runLineChallenger = runLineControl.filter((row) => Number(row.edge) >= 0.005 && Number(row.edge) < 0.020);

  return {
    experimentVersion: EXPERIMENT_VERSION,
    experimentStartDate: EXPERIMENT_START_DATE,
    modelVersions: {
      moneyline: MONEYLINE_MODEL_VERSION,
      runLine: RUN_LINE_MODEL_VERSION,
    },
    provenance: provenanceCounts(allRows),
    moneyline: {
      rule: { control: "current production selection", challenger: "model_prob >= 0.525" },
      control: reportVariant(moneylineControl),
      challenger: reportVariant(moneylineChallenger),
      excludedByChallenger: moneylineControl.length - moneylineChallenger.length,
    },
    runLine: {
      rule: { control: "current production selection", challenger: "edge >= 0.005 AND edge < 0.020" },
      control: reportVariant(runLineControl),
      challenger: reportVariant(runLineChallenger),
      excludedByChallenger: runLineControl.length - runLineChallenger.length,
      favoriteMinusOnePointFiveNote: "Reported separately in byRunLineSide; do not promote from a small sample.",
    },
  };
}

async function fetchMlbMlRlValidationRows(supabase, options = {}) {
  const requestedSince = /^\d{4}-\d{2}-\d{2}$/.test(String(options.since || "")) ? String(options.since) : null;
  const since = requestedSince && requestedSince > EXPERIMENT_START_DATE ? requestedSince : EXPERIMENT_START_DATE;
  const until = /^\d{4}-\d{2}-\d{2}$/.test(String(options.until || "")) ? String(options.until) : null;
  const fields = [
    "game_id", "game_date", "created_at", "market", "selection", "line", "result",
    "model_prob", "raw_win_prob", "edge", "odds", "opp_odds",
    "entry_book", "opposing_book", "model_version", "experiment_version",
    "clv", "pinnacle_clv", "benched_at_pick",
  ].join(",");
  const rows = [];
  const pageSize = 1000;
  for (let page = 0; page < 50; page++) {
    let query = supabase.from("model_predictions").select(fields)
      .eq("league", "mlb")
      .in("market", ["moneyline", "run_line"])
      .gte("game_date", since)
      .order("game_date", { ascending: true })
      .order("game_id", { ascending: true });
    if (until) query = query.lte("game_date", until);
    const { data, error } = await query.range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
  throw new Error("MLB ML/RL validation fetch exceeded 50,000 rows");
}

module.exports = {
  EXPERIMENT_VERSION,
  EXPERIMENT_START_DATE,
  MONEYLINE_MODEL_VERSION,
  RUN_LINE_MODEL_VERSION,
  buildSelectionProvenance,
  isCompleteFrozenRow,
  analyzeMlbMlRlValidation,
  fetchMlbMlRlValidationRows,
  summarize,
};
