"use strict";

// Deterministic, offline-only Phase 3 calibration. All predictions are chronological:
// target-year preseason features come from Y-1 plus preseason snapshots, and an
// in-season result is revealed only after the game's frozen prediction.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildHistoricalDatasetPhase3 } = require("./cfbHistoricalDatasetPhase3");
const { buildHistoricalDatasetPhase2 } = require("./cfbHistoricalDatasetPhase2");
const { fitOffenseDefense } = require("../services/cfbOffenseDefense");
const phase1 = require("./cfbHistoricalCalibration");
const phase2 = require("./cfbHistoricalCalibrationPhase2");

const CALIBRATION_VERSION = "cfb-historical-calibration-phase3-v1-2026-08-31";
const VALIDATION_SEASONS = Object.freeze([2023, 2024, 2025]);
const FOLDS = Object.freeze([
  Object.freeze({ id: "fold-2023", train: Object.freeze([2021, 2022]), validate: 2023 }),
  Object.freeze({ id: "fold-2024", train: Object.freeze([2021, 2022, 2023]), validate: 2024 }),
  Object.freeze({ id: "fold-2025", train: Object.freeze([2021, 2022, 2023, 2024]), validate: 2025 }),
]);
const V2_PARAMS = Object.freeze({
  returningProductionCoefficient: 1.25,
  talentCoefficient: 2.5,
  homeFieldAdvantage: 3,
  baseSigma: 15.5,
  uncertaintyScale: 0,
});
const PRESEASON_SEARCH_SPACE = Object.freeze({
  offenseReturningWeight: Object.freeze([0, 0.5, 1, 1.5, 2]),
  talentWeight: Object.freeze([0, 1, 2, 3, 4]),
  homeFieldAdvantage: Object.freeze([2.5, 3, 3.5]),
  baseSigma: Object.freeze([14, 15.5, 17]),
});
// The frozen safety rule requires at least four prior pseudo-games. Searching an
// inadmissible value and rejecting the winning fold afterward is internally
// inconsistent, so the tuning grid contains only deployable candidates.
const UPDATER_PRIOR_GAMES = Object.freeze([4, 6, 8, 12]);
// The active ESPN ratings crawl already fetches opponent schedules once a team has
// four results. Earlier activation would require incremental live provider calls,
// which Phase 3 explicitly forbids. The historical simulator therefore freezes the
// same live-compatible activation rule.
const UPDATER_MINIMUM_GAMES = 4;
const CURRENT_OD_CONFIG = Object.freeze({
  // One zero-centered pseudo-game prevents the alternating offense/defense
  // fixpoint from oscillating on sparse early-season schedule graphs. The outer
  // updater prior remains separately calibrated below.
  priorPseudoGames: 1,
  minimumGames: UPDATER_MINIMUM_GAMES,
  iterations: 30,
  homeFieldPoints: 3,
});
const BOOTSTRAP_REPLICATES = 1000;
const BOOTSTRAP_SEED = 0x43464233;

const { normalCDF, logLoss, bootstrapMean } = phase1._internal;

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function predictionRow(game, projectedHomeMargin, sigma, extra = {}) {
  const homeWinProbability = normalCDF(projectedHomeMargin / sigma);
  const outcome = game.actualHomeMargin > 0 ? 1 : game.actualHomeMargin < 0 ? 0 : null;
  const marginError = projectedHomeMargin - game.actualHomeMargin;
  return Object.freeze({
    gameId: game.gameId,
    season: game.season,
    week: game.week,
    startDate: game.startDate,
    neutralSite: game.neutralSite,
    homeId: game.homeId,
    awayId: game.awayId,
    actualHomeMargin: game.actualHomeMargin,
    projectedHomeMargin,
    marginError,
    absoluteMarginError: Math.abs(marginError),
    squaredMarginError: marginError ** 2,
    combinedTeamUncertainty: 0,
    predictiveSigma: sigma,
    homeWinProbability,
    outcome,
    brier: outcome == null ? null : (homeWinProbability - outcome) ** 2,
    logLoss: outcome == null ? null : logLoss(homeWinProbability, outcome),
    ...extra,
  });
}

function preseasonTeamRating(team, params) {
  const rp = team.offenseReturningResidualZ ?? 0;
  const talent = team.talentResidualZ ?? 0;
  return Object.freeze({
    offense: team.priorOffenseRating + params.offenseReturningWeight * rp
      + 0.5 * params.talentWeight * talent,
    defense: team.priorDefenseRating + 0.5 * params.talentWeight * talent,
  });
}

function projectedMargin(home, away, neutralSite, params) {
  return home.offense - away.defense - away.offense + home.defense
    + (neutralSite ? 0 : params.homeFieldAdvantage);
}

function preseasonPredictions(dataset, seasons, params) {
  const selected = new Set(seasons);
  const rows = [];
  for (const seasonRow of dataset.seasons) {
    if (!selected.has(seasonRow.season)) continue;
    const ratings = new Map([...seasonRow.teams].map(([teamId, team]) => [
      teamId, preseasonTeamRating(team, params),
    ]));
    for (const game of seasonRow.games) {
      const home = ratings.get(game.homeId);
      const away = ratings.get(game.awayId);
      rows.push(predictionRow(
        game,
        projectedMargin(home, away, game.neutralSite, params),
        params.baseSigma,
        { homeGamesUsed: 0, awayGamesUsed: 0, updaterPriorGames: null },
      ));
    }
  }
  return Object.freeze(rows);
}

function groupByKickoff(games) {
  const groups = [];
  for (const game of games) {
    const key = game.startDate;
    const prior = groups[groups.length - 1];
    if (prior?.key === key) prior.games.push(game);
    else groups.push({ key, games: [game] });
  }
  return groups;
}

const CURRENT_OD_CACHE = new WeakMap();

function buildCurrentSeasonSnapshots(dataset) {
  if (CURRENT_OD_CACHE.has(dataset)) return CURRENT_OD_CACHE.get(dataset);
  const bySeason = new Map();
  for (const seasonRow of dataset.seasons) {
    const completed = [];
    const counts = new Map();
    const snapshots = new Map();
    for (const group of groupByKickoff(seasonRow.games)) {
      snapshots.set(group.key, Object.freeze({
        asOf: group.key,
        fit: fitOffenseDefense(completed, CURRENT_OD_CONFIG),
        gamesByTeam: new Map(counts),
      }));
      for (const game of group.games) {
        completed.push(Object.freeze({
          gameId: game.gameId,
          homeId: game.homeId,
          awayId: game.awayId,
          homeName: game.homeName,
          awayName: game.awayName,
          homePoints: game.homePoints,
          awayPoints: game.awayPoints,
          neutralSite: game.neutralSite,
        }));
        counts.set(game.homeId, (counts.get(game.homeId) || 0) + 1);
        counts.set(game.awayId, (counts.get(game.awayId) || 0) + 1);
      }
    }
    bySeason.set(seasonRow.season, snapshots);
  }
  CURRENT_OD_CACHE.set(dataset, bySeason);
  return bySeason;
}

function posteriorTeam(preseason, current, games, updaterPriorGames) {
  if (!current || games < UPDATER_MINIMUM_GAMES) {
    return Object.freeze({ offense: preseason.offense, defense: preseason.defense, updated: false });
  }
  const denominator = updaterPriorGames + games;
  return Object.freeze({
    offense: (updaterPriorGames * preseason.offense + games * current.offenseRating) / denominator,
    defense: (updaterPriorGames * preseason.defense + games * current.defenseRating) / denominator,
    updated: true,
  });
}

function inSeasonPredictions(dataset, seasons, params, updaterPriorGames) {
  const selected = new Set(seasons);
  const rows = [];
  const snapshotsBySeason = buildCurrentSeasonSnapshots(dataset);
  for (const seasonRow of dataset.seasons) {
    if (!selected.has(seasonRow.season)) continue;
    const preseason = new Map([...seasonRow.teams].map(([teamId, team]) => [
      teamId, preseasonTeamRating(team, params),
    ]));
    for (const group of groupByKickoff(seasonRow.games)) {
      const snapshot = snapshotsBySeason.get(seasonRow.season).get(group.key);
      for (const game of group.games) {
        const homeGames = snapshot.gamesByTeam.get(game.homeId) || 0;
        const awayGames = snapshot.gamesByTeam.get(game.awayId) || 0;
        const home = posteriorTeam(
          preseason.get(game.homeId), snapshot.fit.teams.get(game.homeId), homeGames, updaterPriorGames,
        );
        const away = posteriorTeam(
          preseason.get(game.awayId), snapshot.fit.teams.get(game.awayId), awayGames, updaterPriorGames,
        );
        rows.push(predictionRow(
          game,
          projectedMargin(home, away, game.neutralSite, params),
          params.baseSigma,
          {
            homeGamesUsed: homeGames,
            awayGamesUsed: awayGames,
            minGamesUsed: Math.min(homeGames, awayGames),
            homeUpdaterActive: home.updated,
            awayUpdaterActive: away.updated,
            updaterPriorGames,
            updaterMinimumGames: UPDATER_MINIMUM_GAMES,
            evidenceAsOf: snapshot.asOf,
          },
        ));
      }
    }
  }
  return Object.freeze(rows);
}

function metrics(rows) {
  return phase1.summarizePredictions(rows);
}

function evaluateRows(rows, seasons = null) {
  const selected = seasons ? new Set(seasons) : null;
  const filtered = selected ? rows.filter((row) => selected.has(row.season)) : [...rows];
  return Object.freeze({
    metrics: metrics(filtered),
    bySeason: Object.freeze(Object.fromEntries([...new Set(filtered.map((row) => row.season))]
      .sort().map((season) => [season, metrics(filtered.filter((row) => row.season === season))]))),
    predictions: Object.freeze(filtered),
  });
}

function parameterGrid() {
  const rows = [];
  for (const offenseReturningWeight of PRESEASON_SEARCH_SPACE.offenseReturningWeight) {
    for (const talentWeight of PRESEASON_SEARCH_SPACE.talentWeight) {
      for (const homeFieldAdvantage of PRESEASON_SEARCH_SPACE.homeFieldAdvantage) {
        for (const baseSigma of PRESEASON_SEARCH_SPACE.baseSigma) {
          rows.push(Object.freeze({ offenseReturningWeight, talentWeight, homeFieldAdvantage, baseSigma }));
        }
      }
    }
  }
  return Object.freeze(rows);
}

function paramKey(params) {
  return [params.offenseReturningWeight, params.talentWeight, params.homeFieldAdvantage, params.baseSigma]
    .map((value) => Number(value).toFixed(2)).join("|");
}

function balancedScore(candidate, baseline) {
  return mean(["mae", "rmse", "brier", "logLoss"].map((name) => (
    candidate[name] / baseline[name]
  )));
}

function scalarBaseline(datasetPhase2, seasons, params) {
  return phase1.evaluate(datasetPhase2, seasons, params, true);
}

function searchPreseason(dataset, datasetPhase2, seasons) {
  const baseline = scalarBaseline(datasetPhase2, seasons, V2_PARAMS).metrics;
  let best = null;
  for (const params of parameterGrid()) {
    const evaluation = evaluateRows(preseasonPredictions(dataset, seasons, params));
    const row = { params, metrics: evaluation.metrics, score: balancedScore(evaluation.metrics, baseline) };
    if (!best || row.score < best.score - 1e-12
        || (Math.abs(row.score - best.score) <= 1e-12 && paramKey(params) < paramKey(best.params))) best = row;
  }
  return Object.freeze({ seasons: Object.freeze([...seasons]), candidates: parameterGrid().length, ...best });
}

function searchUpdater(dataset, datasetPhase2, seasons, preseasonParams) {
  const baseline = scalarBaseline(datasetPhase2, seasons, V2_PARAMS).metrics;
  const rows = UPDATER_PRIOR_GAMES.map((priorGames) => {
    const evaluation = evaluateRows(inSeasonPredictions(dataset, seasons, preseasonParams, priorGames));
    return Object.freeze({ priorGames, metrics: evaluation.metrics, score: balancedScore(evaluation.metrics, baseline) });
  }).sort((left, right) => left.score - right.score || right.priorGames - left.priorGames);
  return Object.freeze({ seasons: Object.freeze([...seasons]), candidates: rows.length, best: rows[0], rows: Object.freeze(rows) });
}

function weekBand(row) {
  const week = Number(row.week);
  if (week <= 3) return "weeks1To3";
  if (week <= 6) return "weeks4To6";
  return "week7Plus";
}

function breakdowns(rows) {
  const byBand = {};
  for (const band of ["weeks1To3", "weeks4To6", "week7Plus"]) {
    byBand[band] = metrics(rows.filter((row) => weekBand(row) === band));
  }
  const byPriorGames = {};
  for (const label of ["0", "1", "2", "3", "4+"]) {
    byPriorGames[label] = metrics(rows.filter((row) => {
      const count = row.minGamesUsed ?? 0;
      return label === "4+" ? count >= 4 : count === Number(label);
    }));
  }
  return Object.freeze({ byWeekBand: Object.freeze(byBand), byMinimumPriorGames: Object.freeze(byPriorGames) });
}

function metricDelta(candidate, baseline) {
  return Object.freeze({
    marginBias: round(candidate.marginBias - baseline.marginBias),
    mae: round(candidate.mae - baseline.mae),
    rmse: round(candidate.rmse - baseline.rmse),
    brier: round(candidate.brier - baseline.brier),
    logLoss: round(candidate.logLoss - baseline.logLoss),
    ece: round(candidate.reliability.ece - baseline.reliability.ece),
  });
}

function evaluationSummary(evaluation) {
  return Object.freeze({ metrics: evaluation.metrics, bySeason: evaluation.bySeason });
}

function pairedBootstrap(candidate, baseline, seedOffset) {
  const byKey = new Map(baseline.map((row) => [`${row.season}:${row.gameId}`, row]));
  const pairs = candidate.map((row) => [row, byKey.get(`${row.season}:${row.gameId}`)]).filter(([, base]) => base);
  return Object.freeze({
    absoluteMarginError: bootstrapMean(pairs.map(([a, b]) => a.absoluteMarginError - b.absoluteMarginError), BOOTSTRAP_SEED + seedOffset, BOOTSTRAP_REPLICATES),
    squaredMarginError: bootstrapMean(pairs.map(([a, b]) => a.squaredMarginError - b.squaredMarginError), BOOTSTRAP_SEED + seedOffset + 1, BOOTSTRAP_REPLICATES),
    brier: bootstrapMean(pairs.map(([a, b]) => a.brier - b.brier), BOOTSTRAP_SEED + seedOffset + 2, BOOTSTRAP_REPLICATES),
    logLoss: bootstrapMean(pairs.map(([a, b]) => a.logLoss - b.logLoss), BOOTSTRAP_SEED + seedOffset + 3, BOOTSTRAP_REPLICATES),
  });
}

function ablation(dataset, rowsByFold, modifier) {
  return Object.freeze(rowsByFold.flatMap((fold) => {
    if (modifier === "updater") return preseasonPredictions(dataset, [fold.validate], fold.preseasonParams);
    const params = { ...fold.preseasonParams };
    if (modifier === "offenseReturning") params.offenseReturningWeight = 0;
    if (modifier === "talent") params.talentWeight = 0;
    return inSeasonPredictions(dataset, [fold.validate], params, fold.updaterPriorGames);
  }));
}

function runHistoricalCalibrationPhase3(
  dataset = buildHistoricalDatasetPhase3(),
  datasetPhase2 = buildHistoricalDatasetPhase2(),
) {
  if (dataset.outcomeSeasons.some((season) => season >= 2026) || dataset.outcomeSeasons.length < 5) {
    throw new Error("Phase 3 requires five pre-2026 seasons and forbids 2026 outcomes");
  }
  const foldResults = [];
  const preseasonValidationRows = [];
  const updaterValidationRows = [];
  for (const fold of FOLDS) {
    if (fold.train.some((season) => season >= fold.validate)) throw new Error(`leaky fold ${fold.id}`);
    const preseasonSearch = searchPreseason(dataset, datasetPhase2, fold.train);
    const updaterSearch = searchUpdater(dataset, datasetPhase2, fold.train, preseasonSearch.params);
    const preseasonRows = preseasonPredictions(dataset, [fold.validate], preseasonSearch.params);
    const updaterRows = inSeasonPredictions(
      dataset, [fold.validate], preseasonSearch.params, updaterSearch.best.priorGames,
    );
    preseasonValidationRows.push(...preseasonRows);
    updaterValidationRows.push(...updaterRows);
    foldResults.push(Object.freeze({
      id: fold.id,
      train: fold.train,
      validate: fold.validate,
      preseasonParams: preseasonSearch.params,
      updaterPriorGames: updaterSearch.best.priorGames,
      preseasonTrainingMetrics: preseasonSearch.metrics,
      updaterTrainingMetrics: updaterSearch.best.metrics,
      preseasonValidationMetrics: metrics(preseasonRows),
      updaterValidationMetrics: metrics(updaterRows),
    }));
  }

  const v1 = scalarBaseline(datasetPhase2, VALIDATION_SEASONS, phase2.HISTORICAL_V1_PARAMS);
  const v2 = scalarBaseline(datasetPhase2, VALIDATION_SEASONS, V2_PARAMS);
  const preseason = evaluateRows(preseasonValidationRows);
  const updater = evaluateRows(updaterValidationRows);
  const ablationRows = {
    noOffenseReturning: ablation(dataset, foldResults, "offenseReturning"),
    noTalent: ablation(dataset, foldResults, "talent"),
    noUpdater: ablation(dataset, foldResults, "updater"),
  };
  const ablations = Object.freeze(Object.fromEntries(Object.entries(ablationRows).map(([name, rows]) => [name, Object.freeze({
    metrics: metrics(rows),
    deltaVsFullUpdater: metricDelta(metrics(rows), updater.metrics),
  })])));
  const bootstrap = Object.freeze({
    vsV1: pairedBootstrap(updater.predictions, v1.predictions, 100),
    vsV2: pairedBootstrap(updater.predictions, v2.predictions, 200),
  });
  const earlyUpdater = breakdowns(updater.predictions);
  const earlyV2 = breakdowns(v2.predictions);
  const primaryStrict = ["mae", "rmse", "brier", "logLoss"].every((name) => updater.metrics[name] < v2.metrics[name]);
  const annualStable = VALIDATION_SEASONS.every((season) => ["mae", "rmse", "brier", "logLoss"]
    .filter((name) => updater.bySeason[season][name] > v2.bySeason[season][name]).length <= 1);
  const oneGameShrinkSafe = foldResults.every((fold) => fold.updaterPriorGames >= 4);
  const bootstrapDirection = ["absoluteMarginError", "squaredMarginError", "brier", "logLoss"]
    .every((name) => bootstrap.vsV2[name].mean < 0);
  const updaterJustified = primaryStrict && annualStable && oneGameShrinkSafe && bootstrapDirection;

  const refitPreseason = searchPreseason(dataset, datasetPhase2, dataset.targetSeasons);
  const refitUpdater = searchUpdater(dataset, datasetPhase2, dataset.targetSeasons, refitPreseason.params);
  const decision = updaterJustified
    ? "C — In-season-updating parallel v3 justified."
    : "A — No parallel v3 justified by the frozen Phase 3 gate.";
  const result = {
    version: CALIBRATION_VERSION,
    datasetVersion: dataset.version,
    phase3InputContentSha256: dataset.phase3InputContentSha256,
    protocol: Object.freeze({
      folds: FOLDS,
      preseasonSearchSpace: PRESEASON_SEARCH_SPACE,
      updaterPriorGames: UPDATER_PRIOR_GAMES,
      updaterMinimumGames: UPDATER_MINIMUM_GAMES,
      currentOffenseDefenseConfig: CURRENT_OD_CONFIG,
      rule: "Each validation season is predicted by parameters fit only on earlier seasons; within a season, each result updates only later kickoff groups.",
      targetSeasonLeakage: false,
      outcomesFrom2026Used: false,
    }),
    data: Object.freeze({
      coverage: Object.freeze(dataset.seasons.map((row) => Object.freeze({ season: row.season, ...row.coverage }))),
      providerBudget: dataset.providerBudget,
      sourceNotes: dataset.sourceNotes,
      qbIncluded: false,
      transferIncluded: false,
      defensiveReturningProductionIncluded: false,
    }),
    models: Object.freeze({
      v1: Object.freeze({ params: phase2.HISTORICAL_V1_PARAMS, validation: evaluationSummary(v1) }),
      v2: Object.freeze({ params: V2_PARAMS, validation: evaluationSummary(v2) }),
      phase3Preseason: Object.freeze({ validation: evaluationSummary(preseason), breakdowns: breakdowns(preseason.predictions) }),
      phase3Updater: Object.freeze({ validation: evaluationSummary(updater), breakdowns: earlyUpdater }),
    }),
    walkForward: Object.freeze(foldResults),
    comparisons: Object.freeze({
      preseasonVsV2: metricDelta(preseason.metrics, v2.metrics),
      updaterVsV1: metricDelta(updater.metrics, v1.metrics),
      updaterVsV2: metricDelta(updater.metrics, v2.metrics),
      updaterVsPreseason: metricDelta(updater.metrics, preseason.metrics),
      v2Breakdowns: earlyV2,
    }),
    ablations,
    bootstrap,
    gate: Object.freeze({
      primaryStrictImprovementVsV2: primaryStrict,
      annualStability: annualStable,
      oneGameShrinkSafe,
      bootstrapMeanDirectionVsV2: bootstrapDirection,
      updaterJustified,
    }),
    prospectiveRefit: Object.freeze({
      preseasonParams: refitPreseason.params,
      updaterPriorGames: refitUpdater.best.priorGames,
      refitSeasons: Object.freeze([...dataset.targetSeasons]),
      inSampleMetrics: refitUpdater.best.metrics,
      caveat: "All-pre-2026 refit is for future shadow collection only; these are not held-out metrics.",
    }),
    decision,
  };
  const resultSha256 = crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex");
  const output = { ...result, resultSha256 };
  Object.defineProperty(output, "_predictionRows", {
    value: Object.freeze({
      v1: v1.predictions,
      v2: v2.predictions,
      preseason: preseason.predictions,
      updater: updater.predictions,
    }),
    enumerable: false,
    writable: false,
  });
  return Object.freeze(output);
}

function markdown(result) {
  const rows = ["v1", "v2", "phase3Preseason", "phase3Updater"].map((name) => {
    const metric = result.models[name].validation.metrics;
    return `| ${name} | ${metric.n} | ${metric.mae} | ${metric.rmse} | ${metric.brier} | ${metric.logLoss} | ${metric.reliability.ece} |`;
  }).join("\n");
  const folds = result.walkForward.map((fold) => `| ${fold.validate} | ${JSON.stringify(fold.preseasonParams)} | ${fold.updaterPriorGames} | ${fold.preseasonValidationMetrics.mae} | ${fold.updaterValidationMetrics.mae} |`).join("\n");
  const updater = result.models.phase3Updater;
  const bands = Object.entries(updater.breakdowns.byWeekBand)
    .map(([name, metric]) => `| ${name} | ${metric.n} | ${metric.mae} | ${metric.rmse} | ${metric.brier} | ${metric.logLoss} | ${metric.reliability.ece} |`).join("\n");
  const priorGames = Object.entries(updater.breakdowns.byMinimumPriorGames)
    .map(([name, metric]) => `| ${name} | ${metric.n} | ${metric.mae} | ${metric.rmse} | ${metric.brier} | ${metric.logLoss} |`).join("\n");
  const ablations = Object.entries(result.ablations)
    .map(([name, row]) => `| ${name} | ${row.deltaVsFullUpdater.mae} | ${row.deltaVsFullUpdater.rmse} | ${row.deltaVsFullUpdater.brier} | ${row.deltaVsFullUpdater.logLoss} |`).join("\n");
  const bootstrap = ["vsV1", "vsV2"].flatMap((baseline) => Object.entries(result.bootstrap[baseline])
    .map(([metric, row]) => `| ${baseline} | ${metric} | ${row.mean} | [${row.bootstrap95.join(", ")}] |`)).join("\n");
  return `# CFB Historical Calibration Phase 3\n\n`
    + `Decision: **${result.decision}**\n\n`
    + `No 2026 outcomes were used. QB, defensive returning production, and transfers were rejected rather than fabricated.\n\n`
    + `## Validation (2023-2025)\n\n| Model | n | MAE | RMSE | Brier | Log loss | ECE |\n|---|---:|---:|---:|---:|---:|---:|\n${rows}\n\n`
    + `## Walk-forward selections\n\n| Validation | preseason parameters | prior games | preseason MAE | updater MAE |\n|---:|---|---:|---:|---:|\n${folds}\n\n`
    + `## Frozen architecture\n\n`
    + `Preseason offense = prior offense + RP_OFF × residualized offensive percentPPA + 0.5 × TALENT × residualized talent.\n\n`
    + `Preseason defense = prior defense + 0.5 × TALENT × residualized talent.\n\n`
    + `Projected margin = home offense − away defense − away offense + home defense + neutral-aware HFA.\n\n`
    + `After both sides have at least four completed games, each offense/defense posterior is (K × preseason + games × current opponent-adjusted estimate) / (K + games). The inner current-season fit uses one zero-centered pseudo-game to prevent sparse-graph oscillation; K is selected walk-forward from the frozen admissible grid.\n\n`
    + `Prospective refit: ${JSON.stringify(result.prospectiveRefit.preseasonParams)}; updater prior games=${result.prospectiveRefit.updaterPriorGames}.\n\n`
    + `## Time bands\n\n| Band | n | MAE | RMSE | Brier | Log loss | ECE |\n|---|---:|---:|---:|---:|---:|---:|\n${bands}\n\n`
    + `## Minimum completed games across the matchup\n\n| Games | n | MAE | RMSE | Brier | Log loss |\n|---|---:|---:|---:|---:|---:|\n${priorGames}\n\n`
    + `## Ablations (positive delta means removing the component is worse)\n\n| Removed | MAE delta | RMSE delta | Brier delta | Log-loss delta |\n|---|---:|---:|---:|---:|\n${ablations}\n\n`
    + `## Deterministic paired bootstrap\n\n| Baseline | Metric | Mean candidate-minus-baseline | 95% interval |\n|---|---|---:|---|\n${bootstrap}\n\n`
    + `## Data limits\n\n`
    + `- Offense/defense priors use only previous-season FBS-vs-FBS final scores.\n`
    + `- CFBD returning production is offensive. No defensive RP field exists in the inspected payload.\n`
    + `- No exact historical starting-QB identity exists; name joins remain forbidden.\n`
    + `- No cached exact 2021-2025 portal aggregate exists; transfer effects are excluded.\n`
    + `- New Phase 3 CFBD calls: ${result.data.providerBudget.phase3NewCfbdCalls} of ${result.data.providerBudget.phase3MaximumAllowed}.\n`;
}

function featureAuditArtifact(result) {
  return Object.freeze({
    version: "cfb-phase3-feature-audits-v1-2026-08-31",
    calibrationVersion: result.version,
    phase3InputContentSha256: result.phase3InputContentSha256,
    offenseDefense: Object.freeze({
      included: true,
      source: "previous-season and pre-prediction completed FBS-vs-FBS final scores",
      decomposition: "separate opponent-adjusted offense and defense, neutral-aware, ridge-stabilized",
      currentFitConfig: result.protocol.currentOffenseDefenseConfig,
    }),
    returningProduction: Object.freeze({
      offensivePercentPpaIncluded: true,
      defensiveIncluded: false,
      reason: "Inspected CFBD /player/returning payload contains offensive percentPPA components and no defensive returning-production field.",
    }),
    quarterback: Object.freeze({ included: false, reason: result.data.sourceNotes.qb }),
    transfers: Object.freeze({ included: false, reason: result.data.sourceNotes.transfers }),
    providerBudget: result.data.providerBudget,
  });
}

function writeArtifacts(result = runHistoricalCalibrationPhase3()) {
  const directory = path.join(__dirname, "results");
  const jsonPath = path.join(directory, "cfb-historical-calibration-phase3-v1.json");
  const markdownPath = path.join(directory, "cfb-historical-calibration-phase3-v1.md");
  const auditPath = path.join(directory, "cfb-phase3-feature-audits-v1.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown(result));
  fs.writeFileSync(auditPath, `${JSON.stringify(featureAuditArtifact(result), null, 2)}\n`);
  return Object.freeze({ result, jsonPath, markdownPath, auditPath });
}

if (require.main === module) {
  const written = writeArtifacts();
  console.log(JSON.stringify({
    decision: written.result.decision,
    validation: Object.fromEntries(Object.entries(written.result.models).map(([name, row]) => [name, row.validation.metrics])),
    prospectiveRefit: written.result.prospectiveRefit,
    resultSha256: written.result.resultSha256,
  }, null, 2));
}

module.exports = {
  CALIBRATION_VERSION,
  VALIDATION_SEASONS,
  FOLDS,
  V2_PARAMS,
  PRESEASON_SEARCH_SPACE,
  UPDATER_PRIOR_GAMES,
  UPDATER_MINIMUM_GAMES,
  CURRENT_OD_CONFIG,
  BOOTSTRAP_REPLICATES,
  preseasonTeamRating,
  projectedMargin,
  preseasonPredictions,
  inSeasonPredictions,
  evaluateRows,
  searchPreseason,
  searchUpdater,
  breakdowns,
    metricDelta,
  evaluationSummary,
  pairedBootstrap,
  runHistoricalCalibrationPhase3,
  markdown,
  featureAuditArtifact,
  writeArtifacts,
  _internal: {
    round, mean, predictionRow, groupByKickoff, buildCurrentSeasonSnapshots, posteriorTeam,
    parameterGrid, paramKey, balancedScore, ablation,
  },
};
