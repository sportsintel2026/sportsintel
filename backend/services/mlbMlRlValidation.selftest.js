"use strict";

// Dependency-free prospective ML/RL validation regression test.
// Runs with: node backend/services/mlbMlRlValidation.selftest.js

const {
  EXPERIMENT_VERSION,
  MONEYLINE_MODEL_VERSION,
  RUN_LINE_MODEL_VERSION,
  buildSelectionProvenance,
  analyzeMlbMlRlValidation,
} = require("./mlbMlRlValidation");

function completeRow(overrides = {}) {
  const market = overrides.market || "moneyline";
  return {
    game_id: overrides.game_id || "game-1",
    game_date: overrides.game_date || "2026-08-29",
    market,
    selection: overrides.selection || "home",
    line: market === "run_line" ? -1.5 : null,
    result: "win",
    model_prob: 0.55,
    raw_win_prob: 0.57,
    edge: market === "run_line" ? 0.01 : 0.025,
    odds: -120,
    opp_odds: 110,
    entry_book: market === "moneyline" ? "Selected Book" : "Matched RL Book",
    opposing_book: market === "moneyline" ? "Other Book" : "Matched RL Book",
    model_version: market === "moneyline" ? MONEYLINE_MODEL_VERSION : RUN_LINE_MODEL_VERSION,
    experiment_version: EXPERIMENT_VERSION,
    clv: 0.01,
    pinnacle_clv: 0.005,
    ...overrides,
  };
}

function allNull(provenance) {
  return ["entry_book", "opposing_book", "model_version", "experiment_version"]
    .every((field) => provenance[field] == null);
}

function main() {
  const recording = {
    "game-1": {
      moneyline: {
        awayBook: "Away Best Book",
        homeBook: "Home Best Book",
        modelVersion: MONEYLINE_MODEL_VERSION,
        experimentVersion: EXPERIMENT_VERSION,
      },
      runLine: {
        awayBook: "Matched Spread Book",
        homeBook: "Matched Spread Book",
        modelVersion: RUN_LINE_MODEL_VERSION,
        experimentVersion: EXPERIMENT_VERSION,
      },
    },
  };
  const facts = {
    rawProbability: 0.57,
    publishedProbability: 0.55,
    edge: 0.01,
    entryOdds: -120,
    opposingOdds: 110,
  };
  const ml = buildSelectionProvenance(recording, "game-1", "moneyline", "home", facts);
  const rl = buildSelectionProvenance(recording, "game-1", "run_line", "away", facts);
  const missingBook = JSON.parse(JSON.stringify(recording));
  missingBook["game-1"].moneyline.homeBook = null;
  const missingFacts = { ...facts, rawProbability: null };

  const rows = [
    completeRow({ game_id: "ml-525", model_prob: 0.525, result: "win" }),
    completeRow({ game_id: "ml-524", model_prob: 0.524, result: "loss" }),
    completeRow({ game_id: "ml-pending", model_prob: 0.60, result: "pending" }),
    completeRow({ game_id: "rl-005", market: "run_line", edge: 0.005, selection: "away", line: 1.5, result: "win" }),
    completeRow({ game_id: "rl-019", market: "run_line", edge: 0.0199, result: "loss" }),
    completeRow({ game_id: "rl-020", market: "run_line", edge: 0.020, result: "win" }),
    completeRow({ game_id: "incomplete", entry_book: null, opposing_book: null, model_version: null, experiment_version: null }),
  ];
  const report = analyzeMlbMlRlValidation(rows);

  const checks = [
    ["moneyline exact selected and opposing books survive independently", ml.entry_book === "Home Best Book" && ml.opposing_book === "Away Best Book"],
    ["run-line matched books are stored truthfully", rl.entry_book === "Matched Spread Book" && rl.opposing_book === "Matched Spread Book"],
    ["missing book makes all four provenance fields null", allNull(buildSelectionProvenance(missingBook, "game-1", "moneyline", "home", facts))],
    ["missing core prediction input makes all four provenance fields null", allNull(buildSelectionProvenance(recording, "game-1", "moneyline", "home", missingFacts))],
    ["unsupported markets receive no provenance", allNull(buildSelectionProvenance(recording, "game-1", "total", "over", facts))],
    ["moneyline control uses all complete production-selected rows", report.moneyline.control.overall.decisions === 3],
    ["moneyline challenger includes 52.5% boundary and higher only", report.moneyline.challenger.overall.decisions === 2],
    ["run-line control uses all complete production-selected rows", report.runLine.control.overall.decisions === 3],
    ["run-line challenger includes 0.5% and excludes 2.0% boundary", report.runLine.challenger.overall.decisions === 2],
    ["run-line favorite and underdog sides remain separate", report.runLine.control.byRunLineSide["favorite_-1.5"]?.decisions === 2 && report.runLine.control.byRunLineSide["underdog_+1.5"]?.decisions === 1],
    ["incomplete provenance is counted and excluded", report.provenance.moneyline.allFourNull === 1 && report.moneyline.control.overall.decisions === 3],
    ["real prices drive monetary metrics", report.moneyline.control.overall.roiEligible === 2 && report.moneyline.control.overall.units !== null],
    ["probability metrics are present", report.moneyline.control.overall.brier !== null && report.moneyline.control.overall.logLoss !== null && report.moneyline.control.overall.ece !== null],
    ["50/100/150 checkpoints remain diagnostic until reached", ["50", "100", "150"].every((n) => report.moneyline.challenger.checkpoints[n].reached === false)],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  console.log(JSON.stringify({ passed: checks.length - failed.length, failed, checks }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main();
