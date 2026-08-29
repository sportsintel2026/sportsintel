#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "./edgesModel") return {
    MLB_TOTALS_FORMULA_VERSION: "test-formula",
    RUN_PHI: 3,
    mlbTotalsLogisticProbability: (projected, line) => {
      const rawOver = 1 / (1 + Math.exp(-((projected - 0.5 - line) / 6)));
      return { rawOver, rawUnder: 1 - rawOver, fairOver: 0.5, fairUnder: 0.5, publishedOver: 0.51, publishedUnder: 0.49 };
    },
    mlbTotalsDiscreteProbability: () => ({
      rawOver: 0.44, rawUnder: 0.46, pushProb: 0.10,
      decisiveRawOver: 0.44 / 0.90, decisiveRawUnder: 0.46 / 0.90,
      publishedOver: 0.49, publishedUnder: 0.51,
      muHome: 4.4, muAway: 4.1, phi: 3,
    }),
  };
  return originalLoad.call(this, request, parent, isMain);
};
const {
  TABLE,
  recordMlbTotalsCalibration,
  captureMlbTotalsCalibrationClosing,
  gradeMlbTotalsCalibration,
} = require("./mlbTotalsCalibration");
Module._load = originalLoad;

const CLOSING_FIELDS = [
  "closing_total", "closing_over_odds", "closing_under_odds",
  "closing_over_book", "closing_under_book", "closing_captured_at",
];
const PINNACLE_FIELDS = [
  "pinnacle_closing_total", "pinnacle_over_odds", "pinnacle_under_odds",
  "pinnacle_fair_over_prob", "pinnacle_captured_at",
];
const RESULT_FIELDS = [
  "result_status", "result_source", "final_away_runs", "final_home_runs",
  "actual_total_runs", "graded_at",
];
const MUTABLE_FIELDS = new Set([...CLOSING_FIELDS, ...PINNACLE_FIELDS, ...RESULT_FIELDS]);
const differs = (left, right, fields) => fields.some((field) => left[field] !== right[field]);

// This in-memory guard mirrors the proposed SQL's mutation boundary so the
// dependency-free store test can exercise the contract without touching Supabase.
function validateCalibrationUpdate(row, values) {
  const disallowed = Object.keys(values).find((field) => !MUTABLE_FIELDS.has(field));
  if (disallowed) return new Error(`prediction-time field is immutable: ${disallowed}`);

  const next = { ...row, ...values };
  if (differs(row, next, CLOSING_FIELDS)
      && (!next.closing_captured_at
        || (row.closing_captured_at
          && Date.parse(next.closing_captured_at) <= Date.parse(row.closing_captured_at)))) {
    return new Error("closing enrichment cannot move backward");
  }
  if (differs(row, next, PINNACLE_FIELDS)
      && (!next.pinnacle_captured_at
        || (row.pinnacle_captured_at
          && Date.parse(next.pinnacle_captured_at) <= Date.parse(row.pinnacle_captured_at)))) {
    return new Error("Pinnacle enrichment cannot move backward");
  }
  if (row.result_status !== "pending" && differs(row, next, RESULT_FIELDS)) {
    return new Error("settled result is immutable");
  }
  return null;
}

class Query {
  constructor(store, table) {
    this.store = store;
    this.table = table;
    this.filters = [];
    this.operation = "select";
    this.values = null;
  }
  select() { this.operation = "select"; return this; }
  update(values) { this.operation = "update"; this.values = values; return this; }
  upsert(rows, options = {}) {
    this.store[this.table] ||= [];
    const conflict = String(options.onConflict || "").split(",").filter(Boolean);
    for (const row of rows) {
      const existing = conflict.length
        ? this.store[this.table].find((saved) => conflict.every((field) => saved[field] === row[field]))
        : null;
      if (existing && options.ignoreDuplicates) continue;
      if (existing) Object.assign(existing, row);
      else this.store[this.table].push({ ...row });
    }
    return Promise.resolve({ error: null });
  }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  neq(column, value) { this.filters.push((row) => row[column] !== value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(String(row[column])) || values.includes(row[column])); return this; }
  not(column, operator, value) { if (operator === "is" && value == null) this.filters.push((row) => row[column] != null); return this; }
  order() { return this; }
  limit() { return this; }
  then(resolve) {
    const source = this.store[this.table] || [];
    const matching = source.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === "update") {
      for (const row of matching) {
        if (this.table === TABLE) {
          const error = validateCalibrationUpdate(row, this.values);
          if (error) return Promise.resolve({ data: null, error }).then(resolve);
        }
      }
      matching.forEach((row) => Object.assign(row, this.values));
    }
    return Promise.resolve({ data: this.operation === "select" ? matching : null, error: null }).then(resolve);
  }
}

async function main() {
  const store = {
    [TABLE]: [],
    closing_lines: [{ game_id: "1", game_date: "2026-08-29", final_away: 5, final_home: 4, winner: "AWY" }],
    model_predictions: [],
  };
  const supabase = { from: (table) => new Query(store, table) };
  const result = {
    date: "2026-08-29",
    computedAt: "2026-08-29T16:00:00Z",
    recordingByGame: {
      "1": {
        totals: {
          marketFairOverProb: 0.5,
          marketFairUnderProb: 0.5,
          formulaVersion: "test-formula",
          totalSd: 6,
          meanToMedian: 0.5,
          marketBlendEnabled: true,
          marketBlendWeight: 0.55,
        },
        runLine: { homeWinProbForSplit: 0.53 },
      },
    },
    games: [{
      id: "1", status: "scheduled", awayAbbr: "AWY", homeAbbr: "HOM",
      moneyline: { homeWinProb: 0.53 },
      totals: {
        projected: 8.5, line: 8, overOdds: -110, underOdds: -110,
        overBook: "Book A", underBook: "Book B", overProb: 0.51,
        breakdown: { fatigueAdj: 0.2 },
      },
    }],
  };

  // A/B: the conflict key preserves the first prediction-time snapshot.
  assert.strictEqual(await recordMlbTotalsCalibration(supabase, result, result.date), 6);
  assert.strictEqual(store[TABLE].length, 6);
  const firstControl = store[TABLE].find((row) => row.variant_key === "logistic_beta_1.00");
  const originalPredictionAt = firstControl.prediction_at;
  const duplicate = JSON.parse(JSON.stringify(result));
  duplicate.computedAt = "2026-08-29T16:30:00Z";
  duplicate.games[0].totals.overBook = "Replacement Book";
  duplicate.games[0].totals.breakdown.base = 99;
  assert.strictEqual(await recordMlbTotalsCalibration(supabase, duplicate, duplicate.date), 6);
  assert.strictEqual(store[TABLE].length, 6);
  assert.strictEqual(firstControl.prediction_at, originalPredictionAt);
  assert.strictEqual(firstControl.over_book, "Book A");
  assert.notStrictEqual(firstControl.base_runs, 99);

  // C/D: only approved close fields move forward; stale US/Pinnacle ticks fail.
  assert.strictEqual(await captureMlbTotalsCalibrationClosing(supabase, [{
    game_id: "1", game_date: "2026-08-29",
    closing_total: 8, closing_over_odds: -115, closing_under_odds: -105,
    closing_over_book: "Book C", closing_under_book: "Book D",
    closing_captured_at: "2026-08-29T17:00:00Z",
    pinnacle_closing_total: 8, pinnacle_over_odds: -112, pinnacle_under_odds: -108,
    pinnacle_fair_over_prob: 0.51, pinnacle_captured_at: "2026-08-29T17:00:00Z",
  }]), 1);
  assert.strictEqual(await captureMlbTotalsCalibrationClosing(supabase, [{
    game_id: "1", game_date: "2026-08-29",
    closing_total: 8.5, closing_over_odds: -110, closing_under_odds: -110,
    closing_over_book: "Book E", closing_under_book: "Book F",
    closing_captured_at: "2026-08-29T17:15:00Z",
    pinnacle_closing_total: 8.5, pinnacle_over_odds: -105, pinnacle_under_odds: -115,
    pinnacle_fair_over_prob: 0.49, pinnacle_captured_at: "2026-08-29T17:15:00Z",
  }]), 1);
  assert.ok(store[TABLE].every((row) => row.closing_over_book === "Book E"));
  await assert.rejects(
    captureMlbTotalsCalibrationClosing(supabase, [{
      game_id: "1", game_date: "2026-08-29",
      closing_total: 8, closing_over_odds: -120, closing_under_odds: 100,
      closing_over_book: "Old Book", closing_under_book: "Old Book",
      closing_captured_at: "2026-08-29T17:05:00Z",
      pinnacle_closing_total: 8, pinnacle_over_odds: -120, pinnacle_under_odds: 100,
      pinnacle_fair_over_prob: 0.52, pinnacle_captured_at: "2026-08-29T17:05:00Z",
    }]),
    /move backward/
  );
  assert.ok(store[TABLE].every((row) => row.closing_captured_at === "2026-08-29T17:15:00Z"));

  // G: even the backend role cannot update a prediction-time column.
  const predictionUpdate = await supabase.from(TABLE)
    .update({ published_over_prob: 0.99 })
    .eq("game_id", "1");
  assert.match(predictionUpdate.error.message, /prediction-time field is immutable/);
  assert.notStrictEqual(firstControl.published_over_prob, 0.99);

  // E/F: grading is one-way from pending to settled.
  assert.strictEqual(await gradeMlbTotalsCalibration(supabase), 1);
  assert.ok(store[TABLE].every((row) => row.result_status === "over"));
  assert.ok(store[TABLE].every((row) => row.actual_total_runs === 9));
  assert.ok(store[TABLE].every((row) => row.final_away_runs === 5 && row.final_home_runs === 4));
  assert.ok(store[TABLE].every((row) => row.result_source === "closing_lines_final_score"));
  const resultRewrite = await supabase.from(TABLE)
    .update({ result_status: "under", actual_total_runs: 7 })
    .eq("game_id", "1");
  assert.match(resultRewrite.error.message, /settled result is immutable/);
  assert.ok(store[TABLE].every((row) => row.result_status === "over"));

  // H/I and index shape: statically verify the unapplied migration's boundary.
  const schema = fs.readFileSync(
    path.join(__dirname, "../../sql/mlb_totals_calibration_shadow.sql"),
    "utf8"
  );
  const normalized = schema.replace(/\s+/g, " ").toLowerCase();
  assert.ok(!normalized.includes("create table if not exists"));
  assert.ok(normalized.includes("unique (game_id, game_date, variant_key)"));
  assert.strictEqual((normalized.match(/create index /g) || []).length, 2);
  assert.ok(!normalized.includes("idx_mlb_totals_calibration_variant_date"));
  assert.ok(!normalized.includes("idx_mlb_totals_calibration_formula_variant_date"));
  assert.ok(normalized.includes("enable row level security"));
  assert.ok(!normalized.includes("create policy"));
  assert.ok(normalized.includes("from public, anon, authenticated, service_role"));
  assert.ok(normalized.includes("grant select, insert"));
  const updateGrant = normalized.match(
    /grant update \((.*?)\) on table public\.mlb_totals_calibration_shadow to service_role;/
  );
  assert.ok(updateGrant);
  for (const field of [...CLOSING_FIELDS, ...PINNACLE_FIELDS, ...RESULT_FIELDS]) {
    assert.ok(updateGrant[1].includes(field), `missing service-role update grant for ${field}`);
  }
  assert.ok(!updateGrant[1].includes("published_over_prob"));
  assert.ok(!updateGrant[1].includes("candidate_projected_total"));
  assert.ok(!/grant\s+(?:all|delete)/i.test(schema));
  assert.ok(normalized.includes("prediction-time fields are immutable after insertion"));
  assert.ok(normalized.includes("settled mlb totals calibration results are immutable"));

  console.log("mlbTotalsCalibrationStore self-test: immutability, enrichment, RLS and privilege checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
