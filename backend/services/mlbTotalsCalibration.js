// Prospective MLB totals calibration infrastructure.
//
// This module is shadow-only. It consumes the already-computed /api/edges/mlb
// game snapshot, creates fixed-slate challenger rows, and writes them to a
// separate calibration table. It never fetches a sports provider, changes a
// customer response, selects a production pick, or alters model_predictions.

const {
  mlbTotalsLogisticProbability,
  mlbTotalsDiscreteProbability,
  MLB_TOTALS_FORMULA_VERSION,
  RUN_PHI,
} = require("./edgesModel");
const { payout } = require("./priceMath");

const TABLE = "mlb_totals_calibration_shadow";
const FATIGUE_BETAS = Object.freeze([0, 0.25, 0.50, 0.75, 1.00]);
const DISCRETE_VERSION = `independent-team-negbin-phi${RUN_PHI}-v1`;

const finite = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const round = (value, places = 6) => {
  const n = finite(value);
  if (n == null) return null;
  const m = 10 ** places;
  return Math.round(n * m) / m;
};
const clampProbability = (value) => Math.min(1 - 1e-12, Math.max(1e-12, value));

function factorColumns(totals) {
  const b = totals?.breakdown || {};
  return {
    base_runs: finite(b.base),
    pitcher_adj: finite(b.pitcherAdj),
    ace_adj: finite(b.aceAdj),
    park_adj: finite(b.parkAdj),
    weather_adj: finite(b.weatherAdj),
    bullpen_adj: finite(b.bullpenAdj),
    ou_adj: finite(b.ouAdj),
    ump_adj: finite(b.umpAdj),
    defense_adj: finite(b.defAdj),
  };
}

function baseRow(game, gameDate, predictionAt, recording) {
  const totals = game.totals;
  const totalsRecording = recording?.totals;
  return {
    game_id: String(game.id),
    game_date: gameDate,
    prediction_at: predictionAt,
    matchup: `${game.awayAbbr || "?"} @ ${game.homeAbbr || "?"}`,
    formula_version: totalsRecording?.formulaVersion || MLB_TOTALS_FORMULA_VERSION,
    logistic_sd: finite(totalsRecording?.totalSd),
    mean_to_median: finite(totalsRecording?.meanToMedian),
    market_blend_enabled: totalsRecording?.marketBlendEnabled !== false,
    market_blend_weight: finite(totalsRecording?.marketBlendWeight),
    market_total: finite(totals.line),
    over_odds: finite(totals.overOdds),
    under_odds: finite(totals.underOdds),
    over_book: totals.overBook || null,
    under_book: totals.underBook || null,
    market_fair_over_prob: finite(totalsRecording?.marketFairOverProb),
    market_fair_under_prob: finite(totalsRecording?.marketFairUnderProb),
    original_fatigue_adj: finite(totals.breakdown?.fatigueAdj) ?? 0,
    home_win_prob: finite(recording?.runLine?.homeWinProbForSplit) ?? finite(game.moneyline?.homeWinProb),
    ...factorColumns(totals),
    result_status: "pending",
  };
}

function buildMlbTotalsCalibrationRows(result, options = {}) {
  if (!result || !Array.isArray(result.games)) return [];
  const gameDate = options.gameDate || result.date;
  const predictionAt = options.predictionAt || result.computedAt;
  if (!gameDate || !predictionAt) return [];
  const recordingByGame = result.recordingByGame || {};
  const rows = [];

  for (const game of result.games) {
    const totals = game?.totals;
    const controlProjected = finite(totals?.projected);
    const line = finite(totals?.line);
    const overOdds = finite(totals?.overOdds);
    const underOdds = finite(totals?.underOdds);
    if (!game?.id || controlProjected == null || line == null || overOdds == null || underOdds == null) continue;

    const gameRecording = recordingByGame[String(game.id)] || null;
    const shared = baseRow(game, gameDate, predictionAt, gameRecording);
    const originalFatigue = shared.original_fatigue_adj;

    for (const beta of FATIGUE_BETAS) {
      const candidateFatigue = beta * originalFatigue;
      const candidateProjected = controlProjected - originalFatigue + candidateFatigue;
      const probability = mlbTotalsLogisticProbability(candidateProjected, line, overOdds, underOdds);
      if (!probability) continue;

      if (beta === 1 && totals.overProb != null
          && Math.abs(probability.publishedOver - Number(totals.overProb)) > 1e-12) {
        throw new Error(`MLB totals beta=1 identity failed for game ${game.id}`);
      }

      rows.push({
        ...shared,
        variant_key: `logistic_beta_${beta.toFixed(2)}`,
        model_family: "logistic",
        distribution_version: "production-logistic",
        beta,
        candidate_fatigue_adj: round(candidateFatigue),
        candidate_projected_total: round(candidateProjected),
        raw_over_prob: probability.rawOver,
        raw_under_prob: probability.rawUnder,
        push_prob: 0,
        decisive_raw_over_prob: probability.rawOver,
        decisive_raw_under_prob: probability.rawUnder,
        published_over_prob: probability.publishedOver,
        published_under_prob: probability.publishedUnder,
      });
    }

    const discrete = mlbTotalsDiscreteProbability(
      controlProjected,
      shared.home_win_prob,
      line,
      overOdds,
      underOdds
    );
    if (discrete) {
      rows.push({
        ...shared,
        variant_key: `discrete_negbin_phi_${RUN_PHI.toFixed(2)}_beta_1.00`,
        model_family: "discrete_negbin",
        distribution_version: DISCRETE_VERSION,
        beta: 1,
        candidate_fatigue_adj: round(originalFatigue),
        candidate_projected_total: round(controlProjected),
        raw_over_prob: discrete.rawOver,
        raw_under_prob: discrete.rawUnder,
        push_prob: discrete.pushProb,
        decisive_raw_over_prob: discrete.decisiveRawOver,
        decisive_raw_under_prob: discrete.decisiveRawUnder,
        published_over_prob: discrete.publishedOver,
        published_under_prob: discrete.publishedUnder,
        discrete_mu_home: discrete.muHome,
        discrete_mu_away: discrete.muAway,
        discrete_phi: discrete.phi,
      });
    }
  }
  return rows;
}

async function recordMlbTotalsCalibration(supabase, result, gameDate) {
  const rows = buildMlbTotalsCalibrationRows(result, { gameDate });
  if (!rows.length) return 0;
  const { error } = await supabase.from(TABLE).upsert(rows, {
    onConflict: "game_id,game_date,variant_key",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return rows.length;
}

async function captureMlbTotalsCalibrationClosing(supabase, snapshots) {
  let updated = 0;
  for (const snapshot of snapshots || []) {
    const { game_id, game_date, ...values } = snapshot;
    if (!game_id || !game_date || !Object.keys(values).length) continue;
    const { error } = await supabase.from(TABLE)
      .update(values)
      .eq("game_id", String(game_id))
      .eq("game_date", game_date);
    if (error) throw error;
    updated++;
  }
  return updated;
}

// Results are copied from the already-active closing_lines final-score ledger.
// This deliberately performs no schedule, score, odds, or provider fetch.
async function gradeMlbTotalsCalibration(supabase) {
  const { data: pending, error } = await supabase.from(TABLE)
    .select("game_id,game_date,market_total")
    .eq("result_status", "pending")
    .order("game_date", { ascending: true })
    .limit(1000);
  if (error) throw error;
  if (!pending?.length) return 0;

  const games = new Map();
  for (const row of pending) games.set(`${row.game_date}|${String(row.game_id)}`, row);
  const ids = [...new Set(pending.map((row) => String(row.game_id)))];
  const dates = [...new Set(pending.map((row) => row.game_date))];
  const { data: finals, error: finalsError } = await supabase.from("closing_lines")
    .select("game_id,game_date,final_away,final_home,winner")
    .in("game_id", ids)
    .in("game_date", dates)
    .not("winner", "is", null);
  if (finalsError) throw finalsError;

  const { data: shadowResults, error: shadowError } = await supabase.from("model_predictions")
    .select("game_id,game_date,result,actual_value")
    .eq("league", "mlb")
    .eq("market", "total_shadow")
    .in("game_id", ids)
    .in("game_date", dates)
    .neq("result", "pending");
  if (shadowError) throw shadowError;

  const finalsByGame = new Map((finals || []).map((row) => [`${row.game_date}|${String(row.game_id)}`, row]));
  const shadowsByGame = new Map((shadowResults || []).map((row) => [`${row.game_date}|${String(row.game_id)}`, row]));

  let graded = 0;
  const now = new Date().toISOString();
  for (const [key, pendingGame] of games) {
    const final = finalsByGame.get(key);
    const shadow = shadowsByGame.get(key);
    if (!final && !shadow) continue;
    const away = finite(final?.final_away);
    const home = finite(final?.final_home);
    const hasFinalScore = away != null && home != null;
    const line = finite(pendingGame.market_total);
    const shadowActual = finite(shadow?.actual_value);
    const isVoid = final?.winner === "void" || (shadow?.result === "push" && shadowActual == null);
    const actualTotal = isVoid ? null : hasFinalScore ? away + home : shadowActual;
    if (!isVoid && (actualTotal == null || line == null)) continue;
    const outcome = isVoid ? "void" : actualTotal > line ? "over" : actualTotal < line ? "under" : "push";
    const { error: updateError } = await supabase.from(TABLE)
      .update({
        result_status: outcome,
        final_away_runs: hasFinalScore ? away : null,
        final_home_runs: hasFinalScore ? home : null,
        actual_total_runs: actualTotal,
        result_source: final && (isVoid || hasFinalScore)
          ? "closing_lines_final_score"
          : "model_predictions_total_shadow",
        graded_at: now,
      })
      .eq("game_id", String(pendingGame.game_id))
      .eq("game_date", pendingGame.game_date)
      .eq("result_status", "pending");
    if (updateError) throw updateError;
    graded++;
  }
  return graded;
}

function lineBand(line) {
  const n = finite(line);
  if (n == null) return "unknown";
  if (n <= 7.5) return "<=7.5";
  if (n <= 8.5) return "8-8.5";
  if (n <= 9.5) return "9-9.5";
  return "10+";
}

function isoWeek(dateValue) {
  const date = new Date(`${String(dateValue).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "unknown";
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function calibrationError(decisive) {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, predicted: 0, observed: 0 }));
  for (const row of decisive) {
    const p = finite(row.published_over_prob);
    if (p == null) continue;
    const y = row.result_status === "over" ? 1 : 0;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.n++; bin.predicted += p; bin.observed += y;
  }
  const n = bins.reduce((sum, bin) => sum + bin.n, 0);
  if (!n) return { ece: null, bins: [] };
  let ece = 0;
  const out = bins.filter((bin) => bin.n).map((bin) => {
    const avgPredicted = bin.predicted / bin.n;
    const avgObserved = bin.observed / bin.n;
    ece += (bin.n / n) * Math.abs(avgPredicted - avgObserved);
    return { n: bin.n, avgPredicted: round(avgPredicted), avgObserved: round(avgObserved) };
  });
  return { ece: round(ece), bins: out };
}

function summarizeRows(rows) {
  const settled = (rows || []).filter((row) => ["over", "under", "push"].includes(row.result_status));
  const decisive = settled.filter((row) => row.result_status !== "push" && finite(row.published_over_prob) != null);
  let brier = 0, logLoss = 0, projectionBias = 0, squaredError = 0, absoluteError = 0;
  let projectionN = 0, threeWayBrier = 0, threeWayLogLoss = 0, threeWayN = 0;
  let wins = 0, losses = 0, units = 0, roiN = 0, pinnacleClv = 0, pinnacleClvN = 0;

  for (const row of decisive) {
    const p = clampProbability(Number(row.published_over_prob));
    const y = row.result_status === "over" ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));

    const fairOver = finite(row.market_fair_over_prob);
    const leanOver = fairOver == null ? p >= 0.5 : p >= fairOver;
    const won = leanOver ? y === 1 : y === 0;
    if (won) wins++; else losses++;
    const price = leanOver ? finite(row.over_odds) : finite(row.under_odds);
    const winPayout = payout(price);
    if (price != null && winPayout != null) { units += won ? winPayout : -1; roiN++; }

    const pinLine = finite(row.pinnacle_closing_total);
    const entryLine = finite(row.market_total);
    const pinFairOver = finite(row.pinnacle_fair_over_prob);
    if (pinLine != null && entryLine != null && Math.abs(pinLine - entryLine) < 1e-9
        && pinFairOver != null && fairOver != null) {
      pinnacleClv += leanOver ? pinFairOver - fairOver : fairOver - pinFairOver;
      pinnacleClvN++;
    }
  }

  for (const row of settled) {
    const actual = finite(row.actual_total_runs);
    const projected = finite(row.candidate_projected_total);
    if (actual != null && projected != null) {
      const error = projected - actual;
      projectionBias += error; squaredError += error ** 2; absoluteError += Math.abs(error); projectionN++;
    }
    const probs = [finite(row.raw_over_prob), finite(row.raw_under_prob), finite(row.push_prob)];
    if (probs.every((p) => p != null && p >= 0)) {
      const outcome = row.result_status === "over" ? 0 : row.result_status === "under" ? 1 : 2;
      threeWayBrier += probs.reduce((sum, p, index) => sum + (p - (index === outcome ? 1 : 0)) ** 2, 0);
      threeWayLogLoss += -Math.log(clampProbability(probs[outcome]));
      threeWayN++;
    }
  }
  const calibration = calibrationError(decisive);
  return {
    settledN: settled.length,
    decisiveN: decisive.length,
    pushes: settled.filter((row) => row.result_status === "push").length,
    brier: decisive.length ? round(brier / decisive.length) : null,
    logLoss: decisive.length ? round(logLoss / decisive.length) : null,
    calibrationError: calibration.ece,
    calibrationBins: calibration.bins,
    projectionN,
    projectionBias: projectionN ? round(projectionBias / projectionN) : null,
    rmse: projectionN ? round(Math.sqrt(squaredError / projectionN)) : null,
    mae: projectionN ? round(absoluteError / projectionN) : null,
    threeWayN,
    threeWayBrier: threeWayN ? round(threeWayBrier / threeWayN) : null,
    threeWayLogLoss: threeWayN ? round(threeWayLogLoss / threeWayN) : null,
    leanWins: wins,
    leanLosses: losses,
    units: roiN ? round(units) : null,
    roiN,
    roiPct: roiN ? round(100 * units / roiN) : null,
    pinnacleClvN,
    averagePinnacleClv: pinnacleClvN ? round(pinnacleClv / pinnacleClvN) : null,
  };
}

function grouped(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups.entries()].map(([key, group]) => [key, summarizeRows(group)]));
}

function analyzeFormulaEra(rows) {
  const variants = new Map();
  for (const row of rows || []) {
    if (!variants.has(row.variant_key)) variants.set(row.variant_key, []);
    variants.get(row.variant_key).push(row);
  }
  const gameKey = (row) => `${row.game_date}|${String(row.game_id)}`;
  let commonGameKeys = null;
  for (const variantRows of variants.values()) {
    const keys = new Set(variantRows.map(gameKey));
    commonGameKeys = commonGameKeys == null
      ? keys
      : new Set([...commonGameKeys].filter((key) => keys.has(key)));
  }
  commonGameKeys ||= new Set();
  const out = {};
  for (const [variant, variantRows] of variants) {
    const comparable = variantRows.filter((row) => commonGameKeys.has(gameKey(row)));
    const sorted = [...comparable].sort((a, b) => String(a.prediction_at).localeCompare(String(b.prediction_at)));
    out[variant] = {
      availableRows: variantRows.length,
      comparableRows: sorted.length,
      excludedOutsideCommonGames: variantRows.length - sorted.length,
      overall: summarizeRows(sorted),
      byLean: grouped(sorted, (row) => {
        const fair = finite(row.market_fair_over_prob);
        return Number(row.published_over_prob) >= (fair == null ? 0.5 : fair) ? "over" : "under";
      }),
      byLineBand: grouped(sorted, (row) => lineBand(row.market_total)),
      highFatigue: summarizeRows(sorted.filter((row) => Number(row.original_fatigue_adj) >= 0.15)),
      byWeek: grouped(sorted, (row) => isoWeek(row.game_date)),
      checkpoints: Object.fromEntries([50, 100, 200].filter((n) => sorted.length >= n).map((n) => [String(n), summarizeRows(sorted.slice(0, n))])),
    };
  }
  return { commonGameCount: commonGameKeys.size, variants: out };
}

function analyzeMlbTotalsCalibration(rows) {
  const eras = new Map();
  for (const row of rows || []) {
    const formula = row.formula_version || "unknown-formula";
    if (!eras.has(formula)) eras.set(formula, []);
    eras.get(formula).push(row);
  }
  return {
    table: TABLE,
    formulaEras: Object.fromEntries(
      [...eras.entries()].map(([formula, eraRows]) => [formula, analyzeFormulaEra(eraRows)])
    ),
  };
}

async function fetchMlbTotalsCalibrationRows(supabase, options = {}) {
  const pageSize = 1000;
  const rows = [];
  for (let page = 0; page < 50; page++) {
    let query = supabase.from(TABLE).select("*")
      .order("prediction_at", { ascending: true })
      .order("variant_key", { ascending: true });
    if (options.since) query = query.gte("game_date", options.since);
    if (options.until) query = query.lte("game_date", options.until);
    const { data, error } = await query.range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
  throw new Error("MLB totals calibration fetch exceeded 50,000 rows");
}

module.exports = {
  TABLE,
  FATIGUE_BETAS,
  DISCRETE_VERSION,
  buildMlbTotalsCalibrationRows,
  recordMlbTotalsCalibration,
  captureMlbTotalsCalibrationClosing,
  gradeMlbTotalsCalibration,
  analyzeMlbTotalsCalibration,
  fetchMlbTotalsCalibrationRows,
  lineBand,
};
