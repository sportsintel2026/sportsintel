"use strict";

// Deterministic, inert pre-2026 CFB walk-forward calibration lab. This module has
// no provider, database, route, scheduler, customer-model, or live-shadow imports.

const crypto = require("crypto");
const { buildHistoricalDataset, _internal: datasetMath } = require("./cfbHistoricalDataset");

const CALIBRATION_VERSION = "cfb-historical-calibration-phase1-v1-2026-08-31";
const SEARCH_SPACE_VERSION = "cfb-historical-grid-v1-2026-08-31";
const BOOTSTRAP_SEED = 20260831;
const BOOTSTRAP_REPLICATES = 1000;
const VALIDATION_SEASONS = Object.freeze([2023, 2024, 2025]);
const INITIAL_TRAINING_SEASONS = Object.freeze([2021, 2022]);
const FOLDS = Object.freeze([
  Object.freeze({ id: "fold-2023", train: Object.freeze([2021, 2022]), validate: 2023 }),
  Object.freeze({ id: "fold-2024", train: Object.freeze([2021, 2022, 2023]), validate: 2024 }),
  Object.freeze({ id: "fold-2025", train: Object.freeze([2021, 2022, 2023, 2024]), validate: 2025 }),
]);

const V1_PARAMS = Object.freeze({
  returningProductionCoefficient: 0.75,
  talentCoefficient: 0.5,
  homeFieldAdvantage: 3,
  baseSigma: 15.5,
  uncertaintyScale: 1,
});

const PRIOR_ONLY_PARAMS = Object.freeze({
  ...V1_PARAMS,
  returningProductionCoefficient: 0,
  talentCoefficient: 0,
});

const RETURNING_ONLY_PARAMS = Object.freeze({
  ...V1_PARAMS,
  talentCoefficient: 0,
});

const TALENT_ONLY_PARAMS = Object.freeze({
  ...V1_PARAMS,
  returningProductionCoefficient: 0,
});

const SEARCH_SPACE = Object.freeze({
  returningProductionCoefficient: Object.freeze([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]),
  talentCoefficient: Object.freeze([0, 0.25, 0.5, 0.75, 1, 1.25]),
  homeFieldAdvantage: Object.freeze([1.5, 2, 2.5, 3, 3.5]),
  baseSigma: Object.freeze([12, 13, 14, 15, 15.5, 16, 17, 18, 19]),
  uncertaintyScale: Object.freeze([1]),
  uncertaintyScaleSearchDisabledReason:
    "Exact historical transfer/QB/coaching/roster snapshots are unavailable; fitting a scale to a proxy would create false precision.",
});

const RELIABILITY_BINS = Object.freeze([
  Object.freeze({ label: "0.00-0.35", lower: 0, upper: 0.35 }),
  Object.freeze({ label: "0.35-0.45", lower: 0.35, upper: 0.45 }),
  Object.freeze({ label: "0.45-0.55", lower: 0.45, upper: 0.55 }),
  Object.freeze({ label: "0.55-0.65", lower: 0.55, upper: 0.65 }),
  Object.freeze({ label: "0.65-1.00", lower: 0.65, upper: 1.0000001 }),
]);

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleSd(values) {
  if (values.length < 2) return null;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

function correlation(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < left.length; index++) {
    const l = left[index] - leftMean;
    const r = right[index] - rightMean;
    numerator += l * r;
    leftSum += l * l;
    rightSum += r * r;
  }
  const denominator = Math.sqrt(leftSum * rightSum);
  return denominator > 0 ? numerator / denominator : null;
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return sign * y;
}

function normalCDF(value) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function logLoss(probability, outcome) {
  const bounded = Math.max(1e-12, Math.min(1 - 1e-12, probability));
  return -(outcome * Math.log(bounded) + (1 - outcome) * Math.log(1 - bounded));
}

function parameterKey(params) {
  return [
    params.returningProductionCoefficient,
    params.talentCoefficient,
    params.homeFieldAdvantage,
    params.baseSigma,
    params.uncertaintyScale,
  ].map((value) => Number(value).toFixed(4)).join("|");
}

function parameterGrid() {
  const out = [];
  for (const returningProductionCoefficient of SEARCH_SPACE.returningProductionCoefficient) {
    for (const talentCoefficient of SEARCH_SPACE.talentCoefficient) {
      for (const homeFieldAdvantage of SEARCH_SPACE.homeFieldAdvantage) {
        for (const baseSigma of SEARCH_SPACE.baseSigma) {
          for (const uncertaintyScale of SEARCH_SPACE.uncertaintyScale) {
            out.push(Object.freeze({
              returningProductionCoefficient,
              talentCoefficient,
              homeFieldAdvantage,
              baseSigma,
              uncertaintyScale,
            }));
          }
        }
      }
    }
  }
  return Object.freeze(out);
}

function teamRating(team, params) {
  return team.priorRating
    + params.returningProductionCoefficient * (team.returningResidualZ ?? 0)
    + params.talentCoefficient * (team.talentResidualZ ?? 0);
}

function predictGame(seasonRow, game, params) {
  const home = seasonRow.teams.get(game.homeId);
  const away = seasonRow.teams.get(game.awayId);
  if (!home || !away || home.priorRating == null || away.priorRating == null) {
    throw new Error(`game ${game.gameId} is not dataset-eligible`);
  }
  const homeFieldAdjustment = game.neutralSite ? 0 : params.homeFieldAdvantage;
  const projectedHomeMargin = teamRating(home, params) - teamRating(away, params) + homeFieldAdjustment;
  const combinedTeamUncertainty = Math.sqrt(home.uncertainty.sd ** 2 + away.uncertainty.sd ** 2);
  const predictiveSigma = Math.sqrt(
    params.baseSigma ** 2 + (params.uncertaintyScale * combinedTeamUncertainty) ** 2,
  );
  const homeWinProbability = normalCDF(projectedHomeMargin / predictiveSigma);
  const actualHomeMargin = game.actualHomeMargin;
  const outcome = actualHomeMargin > 0 ? 1 : actualHomeMargin < 0 ? 0 : null;
  return Object.freeze({
    gameId: game.gameId,
    season: game.season,
    week: game.week,
    neutralSite: game.neutralSite,
    homeId: game.homeId,
    awayId: game.awayId,
    actualHomeMargin,
    projectedHomeMargin,
    marginError: projectedHomeMargin - actualHomeMargin,
    absoluteMarginError: Math.abs(projectedHomeMargin - actualHomeMargin),
    squaredMarginError: (projectedHomeMargin - actualHomeMargin) ** 2,
    combinedTeamUncertainty,
    predictiveSigma,
    homeWinProbability,
    outcome,
    brier: outcome == null ? null : (homeWinProbability - outcome) ** 2,
    logLoss: outcome == null ? null : logLoss(homeWinProbability, outcome),
  });
}

function calibrationRegression(predictions) {
  const rows = predictions.filter((row) => row.outcome != null
    && row.homeWinProbability > 0 && row.homeWinProbability < 1);
  if (rows.length < 50 || new Set(rows.map((row) => row.outcome)).size < 2) return null;
  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 30; iteration++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const row of rows) {
      const x = Math.log(row.homeWinProbability / (1 - row.homeWinProbability));
      const eta = intercept + slope * x;
      const fitted = 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, eta))));
      const weight = Math.max(1e-12, fitted * (1 - fitted));
      const residual = row.outcome - fitted;
      g0 += residual;
      g1 += residual * x;
      h00 += weight;
      h01 += weight * x;
      h11 += weight * x * x;
    }
    const determinant = h00 * h11 - h01 * h01;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
    const delta0 = (g0 * h11 - g1 * h01) / determinant;
    const delta1 = (g1 * h00 - g0 * h01) / determinant;
    intercept += delta0;
    slope += delta1;
    if (Math.max(Math.abs(delta0), Math.abs(delta1)) < 1e-9) break;
  }
  return Number.isFinite(intercept) && Number.isFinite(slope)
    ? Object.freeze({ intercept: round(intercept), slope: round(slope), n: rows.length }) : null;
}

function reliability(predictions) {
  const rows = predictions.filter((row) => row.outcome != null);
  const bins = RELIABILITY_BINS.map((bin) => {
    const matched = rows.filter((row) => row.homeWinProbability >= bin.lower
      && row.homeWinProbability < bin.upper);
    return Object.freeze({
      label: bin.label,
      n: matched.length,
      meanPredicted: round(mean(matched.map((row) => row.homeWinProbability))),
      observed: round(mean(matched.map((row) => row.outcome))),
      absoluteGap: matched.length
        ? round(Math.abs(mean(matched.map((row) => row.homeWinProbability)) - mean(matched.map((row) => row.outcome)))) : null,
    });
  });
  const ece = rows.length ? bins.reduce((sum, bin) => (
    sum + (bin.n / rows.length) * (bin.absoluteGap ?? 0)
  ), 0) : null;
  return Object.freeze({ bins: Object.freeze(bins), ece: round(ece) });
}

function uncertaintyBins(predictions) {
  const rows = [...predictions].sort((left, right) => (
    left.combinedTeamUncertainty - right.combinedTeamUncertainty
      || String(left.gameId).localeCompare(String(right.gameId))
  ));
  const bins = [];
  for (let index = 0; index < 4; index++) {
    const start = Math.floor((index * rows.length) / 4);
    const end = Math.floor(((index + 1) * rows.length) / 4);
    const chunk = rows.slice(start, end);
    bins.push(Object.freeze({
      quartile: index + 1,
      n: chunk.length,
      meanUncertainty: round(mean(chunk.map((row) => row.combinedTeamUncertainty))),
      meanAbsoluteMarginError: round(mean(chunk.map((row) => row.absoluteMarginError))),
    }));
  }
  return Object.freeze({
    exactHistoricalV1Reconstruction: false,
    correlationWithAbsoluteMarginError: round(correlation(
      rows.map((row) => row.combinedTeamUncertainty),
      rows.map((row) => row.absoluteMarginError),
    )),
    bins: Object.freeze(bins),
  });
}

function summarizePredictions(predictions) {
  const probabilityRows = predictions.filter((row) => row.outcome != null);
  const reliabilityResult = reliability(predictions);
  return Object.freeze({
    n: predictions.length,
    probabilityN: probabilityRows.length,
    marginBias: round(mean(predictions.map((row) => row.marginError))),
    mae: round(mean(predictions.map((row) => row.absoluteMarginError))),
    rmse: round(Math.sqrt(mean(predictions.map((row) => row.squaredMarginError)))),
    brier: round(mean(probabilityRows.map((row) => row.brier))),
    logLoss: round(mean(probabilityRows.map((row) => row.logLoss))),
    calibrationInterceptSlope: calibrationRegression(predictions),
    reliability: reliabilityResult,
    uncertainty: uncertaintyBins(predictions),
    neutral: Object.freeze({
      n: predictions.filter((row) => row.neutralSite).length,
      marginBias: round(mean(predictions.filter((row) => row.neutralSite).map((row) => row.marginError))),
      mae: round(mean(predictions.filter((row) => row.neutralSite).map((row) => row.absoluteMarginError))),
    }),
    nonNeutral: Object.freeze({
      n: predictions.filter((row) => !row.neutralSite).length,
      marginBias: round(mean(predictions.filter((row) => !row.neutralSite).map((row) => row.marginError))),
      mae: round(mean(predictions.filter((row) => !row.neutralSite).map((row) => row.absoluteMarginError))),
    }),
  });
}

function summarizeCore(predictions) {
  const probabilityRows = predictions.filter((row) => row.outcome != null);
  return Object.freeze({
    n: predictions.length,
    probabilityN: probabilityRows.length,
    marginBias: round(mean(predictions.map((row) => row.marginError))),
    mae: round(mean(predictions.map((row) => row.absoluteMarginError))),
    rmse: round(Math.sqrt(mean(predictions.map((row) => row.squaredMarginError)))),
    brier: round(mean(probabilityRows.map((row) => row.brier))),
    logLoss: round(mean(probabilityRows.map((row) => row.logLoss))),
  });
}

function predictionsFor(dataset, seasons, params) {
  const selected = new Set(seasons);
  const out = [];
  for (const seasonRow of dataset.seasons) {
    if (!selected.has(seasonRow.season)) continue;
    for (const game of seasonRow.games) out.push(predictGame(seasonRow, game, params));
  }
  return Object.freeze(out);
}

function evaluate(dataset, seasons, params, includePredictions = false) {
  const predictions = predictionsFor(dataset, seasons, params);
  const metrics = summarizePredictions(predictions);
  const bySeason = Object.fromEntries(seasons.map((season) => {
    const rows = predictions.filter((row) => row.season === season);
    return [season, summarizePredictions(rows)];
  }));
  return Object.freeze({
    params: Object.freeze({ ...params }),
    seasons: Object.freeze([...seasons]),
    metrics,
    bySeason: Object.freeze(bySeason),
    ...(includePredictions ? { predictions } : {}),
  });
}

function evaluateCore(dataset, seasons, params) {
  const predictions = predictionsFor(dataset, seasons, params);
  return Object.freeze({
    params: Object.freeze({ ...params }),
    seasons: Object.freeze([...seasons]),
    metrics: summarizeCore(predictions),
    bySeason: Object.freeze(Object.fromEntries(seasons.map((season) => [
      season,
      summarizeCore(predictions.filter((row) => row.season === season)),
    ]))),
  });
}

function relative(value, baseline) {
  return Number.isFinite(value) && Number.isFinite(baseline) && baseline !== 0 ? value / baseline : Infinity;
}

function objectiveScores(candidate, baseline) {
  const margin = mean([
    relative(candidate.metrics.mae, baseline.metrics.mae),
    relative(candidate.metrics.rmse, baseline.metrics.rmse),
  ]);
  const probability = mean([
    relative(candidate.metrics.brier, baseline.metrics.brier),
    relative(candidate.metrics.logLoss, baseline.metrics.logLoss),
  ]);
  const annual = Object.keys(candidate.bySeason).map((season) => mean([
    relative(candidate.bySeason[season].mae, baseline.bySeason[season].mae),
    relative(candidate.bySeason[season].rmse, baseline.bySeason[season].rmse),
    relative(candidate.bySeason[season].brier, baseline.bySeason[season].brier),
    relative(candidate.bySeason[season].logLoss, baseline.bySeason[season].logLoss),
  ]));
  const stabilityPenalty = Math.max(0, Math.max(...annual) - 1) * 0.1;
  return Object.freeze({
    margin: round(margin + stabilityPenalty),
    probability: round(probability + stabilityPenalty),
    balanced: round(mean([margin, probability]) + stabilityPenalty),
    stabilityPenalty: round(stabilityPenalty),
    worstAnnualRelativeComposite: round(Math.max(...annual)),
  });
}

function isBetter(left, right, objective) {
  if (!right) return true;
  if (left.scores[objective] !== right.scores[objective]) {
    return left.scores[objective] < right.scores[objective];
  }
  return parameterKey(left.params) < parameterKey(right.params);
}

function search(dataset, trainingSeasons) {
  const baseline = evaluateCore(dataset, trainingSeasons, V1_PARAMS);
  const best = { balanced: null, margin: null, probability: null };
  const grid = parameterGrid();
  for (const params of grid) {
    const evaluation = evaluateCore(dataset, trainingSeasons, params);
    const row = Object.freeze({
      params,
      metrics: evaluation.metrics,
      bySeason: evaluation.bySeason,
      scores: objectiveScores(evaluation, baseline),
    });
    for (const objective of Object.keys(best)) {
      if (isBetter(row, best[objective], objective)) best[objective] = row;
    }
  }
  return Object.freeze({
    trainingSeasons: Object.freeze([...trainingSeasons]),
    candidatesEvaluated: grid.length,
    baseline,
    best: Object.freeze(best),
  });
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(values, probability) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
}

function bootstrapMean(values, seed = BOOTSTRAP_SEED, replicates = BOOTSTRAP_REPLICATES) {
  if (!values.length) return null;
  const random = mulberry32(seed);
  const means = [];
  for (let replicate = 0; replicate < replicates; replicate++) {
    let total = 0;
    for (let index = 0; index < values.length; index++) {
      total += values[Math.floor(random() * values.length)];
    }
    means.push(total / values.length);
  }
  return Object.freeze({
    n: values.length,
    mean: round(mean(values)),
    standardError: round(sampleSd(values) / Math.sqrt(values.length)),
    bootstrap95: Object.freeze([round(percentile(means, 0.025)), round(percentile(means, 0.975))]),
    seed,
    replicates,
  });
}

function pairedDeltas(candidatePredictions, baselinePredictions, seedOffset = 0) {
  const baselineByGame = new Map(baselinePredictions.map((row) => [`${row.season}:${row.gameId}`, row]));
  const pairs = candidatePredictions.map((candidate) => [candidate, baselineByGame.get(`${candidate.season}:${candidate.gameId}`)])
    .filter(([, baseline]) => baseline);
  return Object.freeze({
    absoluteMarginError: bootstrapMean(
      pairs.map(([candidate, baseline]) => candidate.absoluteMarginError - baseline.absoluteMarginError),
      BOOTSTRAP_SEED + seedOffset,
    ),
    squaredMarginError: bootstrapMean(
      pairs.map(([candidate, baseline]) => candidate.squaredMarginError - baseline.squaredMarginError),
      BOOTSTRAP_SEED + seedOffset + 1,
    ),
    brier: bootstrapMean(
      pairs.filter(([candidate, baseline]) => candidate.brier != null && baseline.brier != null)
        .map(([candidate, baseline]) => candidate.brier - baseline.brier),
      BOOTSTRAP_SEED + seedOffset + 2,
    ),
    logLoss: bootstrapMean(
      pairs.filter(([candidate, baseline]) => candidate.logLoss != null && baseline.logLoss != null)
        .map(([candidate, baseline]) => candidate.logLoss - baseline.logLoss),
      BOOTSTRAP_SEED + seedOffset + 3,
    ),
  });
}

function empiricalHomeField(dataset, seasons) {
  const selected = new Set(seasons);
  const neutral = [];
  const nonNeutral = [];
  for (const seasonRow of dataset.seasons) {
    if (!selected.has(seasonRow.season)) continue;
    for (const game of seasonRow.games) {
      (game.neutralSite ? neutral : nonNeutral).push(game.actualHomeMargin);
    }
  }
  return Object.freeze({
    seasons: Object.freeze([...seasons]),
    neutral: Object.freeze({ n: neutral.length, meanActualHomeMargin: round(mean(neutral)) }),
    nonNeutral: Object.freeze({ n: nonNeutral.length, meanActualHomeMargin: round(mean(nonNeutral)) }),
    rawDifference: round(mean(nonNeutral) - mean(neutral)),
    note: "Descriptive only; schedule strength is not balanced by venue assignment. HFA selection uses training prediction metrics, not this raw mean alone.",
  });
}

function candidateResult(dataset, objective, selection, index) {
  const evaluation = evaluate(dataset, VALIDATION_SEASONS, selection.params, true);
  const baseline = evaluate(dataset, VALIDATION_SEASONS, V1_PARAMS, true);
  return Object.freeze({
    id: `candidate-${index + 1}-${objective}`,
    objective,
    selectedUsingSeasons: Object.freeze([...INITIAL_TRAINING_SEASONS]),
    params: selection.params,
    trainingMetrics: selection.metrics,
    trainingScores: selection.scores,
    validationMetrics: evaluation.metrics,
    validationBySeason: evaluation.bySeason,
    deltaVsV1: Object.freeze({
      marginBias: round(evaluation.metrics.marginBias - baseline.metrics.marginBias),
      mae: round(evaluation.metrics.mae - baseline.metrics.mae),
      rmse: round(evaluation.metrics.rmse - baseline.metrics.rmse),
      brier: round(evaluation.metrics.brier - baseline.metrics.brier),
      logLoss: round(evaluation.metrics.logLoss - baseline.metrics.logLoss),
      ece: round(evaluation.metrics.reliability.ece - baseline.metrics.reliability.ece),
    }),
    pairedUncertaintyVsV1: pairedDeltas(evaluation.predictions, baseline.predictions, index * 10),
  });
}

function serializeCoverage(dataset) {
  return Object.freeze(dataset.seasons.map((row) => Object.freeze({
    season: row.season,
    priorSeason: row.priorSeason,
    priorExpectedFbsTeams: row.prior.expectedFbsTeams,
    priorRatedTeams: row.prior.ratedTeams,
    priorExcludedForMinimumGames: row.prior.excludedForMinimumGames,
    ...row.coverage,
  })));
}

function runHistoricalCalibration(dataset = buildHistoricalDataset()) {
  if (dataset.outcomeSeasons.includes(2026) || dataset.outcomeSeasons.some((season) => season > 2025)) {
    throw new Error("2026 outcomes are forbidden in historical calibration");
  }
  for (const fold of FOLDS) {
    if (fold.train.some((season) => season >= fold.validate)) {
      throw new Error(`non-chronological fold ${fold.id}`);
    }
  }

  const initialSearch = search(dataset, INITIAL_TRAINING_SEASONS);
  const orderedObjectives = ["balanced", "margin", "probability"];
  const uniqueSelections = [];
  for (const objective of orderedObjectives) {
    const selection = initialSearch.best[objective];
    if (!uniqueSelections.some((row) => parameterKey(row.selection.params) === parameterKey(selection.params))) {
      uniqueSelections.push({ objective, selection });
    }
  }
  const candidates = uniqueSelections.map((row, index) => candidateResult(
    dataset, row.objective, row.selection, index,
  ));
  const walkForward = FOLDS.map((fold) => {
    const foldSearch = search(dataset, fold.train);
    return Object.freeze({
      id: fold.id,
      train: fold.train,
      validate: fold.validate,
      candidatesEvaluated: foldSearch.candidatesEvaluated,
      selected: Object.freeze(Object.fromEntries(orderedObjectives.map((objective) => {
        const selection = foldSearch.best[objective];
        return [objective, Object.freeze({
          params: selection.params,
          trainingMetrics: selection.metrics,
          validation: evaluate(dataset, [fold.validate], selection.params),
        })];
      }))),
    });
  });
  const v1Validation = evaluate(dataset, VALIDATION_SEASONS, V1_PARAMS);
  const priorOnlyValidation = evaluate(dataset, VALIDATION_SEASONS, PRIOR_ONLY_PARAMS);
  const returningOnlyValidation = evaluate(dataset, VALIDATION_SEASONS, RETURNING_ONLY_PARAMS);
  const talentOnlyValidation = evaluate(dataset, VALIDATION_SEASONS, TALENT_ONLY_PARAMS);
  const v1All = evaluate(dataset, dataset.targetSeasons, V1_PARAMS);
  const priorOnlyAll = evaluate(dataset, dataset.targetSeasons, PRIOR_ONLY_PARAMS);
  const result = {
    version: CALIBRATION_VERSION,
    datasetVersion: dataset.version,
    inputContentSha256: dataset.inputContentSha256,
    searchSpaceVersion: SEARCH_SPACE_VERSION,
    searchSpace: SEARCH_SPACE,
    folds: FOLDS,
    initialFrozenSelection: Object.freeze({
      trainingSeasons: INITIAL_TRAINING_SEASONS,
      validationSeasons: VALIDATION_SEASONS,
      candidatesEvaluated: initialSearch.candidatesEvaluated,
      rule: "Select on 2021-2022 only; freeze configurations; evaluate 2023, 2024, and 2025 independently.",
    }),
    baselines: Object.freeze({
      v1: Object.freeze({ params: V1_PARAMS, allSeasons: v1All, validation: v1Validation }),
      priorOnly: Object.freeze({ params: PRIOR_ONLY_PARAMS, allSeasons: priorOnlyAll, validation: priorOnlyValidation }),
      returningOnly: Object.freeze({ params: RETURNING_ONLY_PARAMS, validation: returningOnlyValidation }),
      talentOnly: Object.freeze({ params: TALENT_ONLY_PARAMS, validation: talentOnlyValidation }),
      market: Object.freeze({ available: false, reason: dataset.sourceNotes.market }),
    }),
    candidates: Object.freeze(candidates),
    walkForward: Object.freeze(walkForward),
    empiricalHomeField: Object.freeze({
      initialTraining: empiricalHomeField(dataset, INITIAL_TRAINING_SEASONS),
      validation: empiricalHomeField(dataset, VALIDATION_SEASONS),
    }),
    dataQuality: Object.freeze({
      coverage: serializeCoverage(dataset),
      returningProductionCaveat: dataset.sourceNotes.returningProduction,
      uncertaintyCaveat: dataset.sourceNotes.uncertainty,
      marketCaveat: dataset.sourceNotes.market,
      identityMethod: "Exact durable numeric team IDs only; no fuzzy or player-level name matching.",
      targetOutcomeLeakage: false,
      outcomesFrom2026Used: false,
      cfbdApiCalls: dataset.providerBudget.cfbdApiCalls,
      oddsApiCalls: dataset.providerBudget.oddsApiCalls,
      espnApiCalls: dataset.providerBudget.espnApiCalls,
    }),
  };
  const resultSha256 = crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex");
  return Object.freeze({ ...result, resultSha256 });
}

module.exports = {
  CALIBRATION_VERSION,
  SEARCH_SPACE_VERSION,
  BOOTSTRAP_SEED,
  BOOTSTRAP_REPLICATES,
  VALIDATION_SEASONS,
  INITIAL_TRAINING_SEASONS,
  FOLDS,
  V1_PARAMS,
  PRIOR_ONLY_PARAMS,
  RETURNING_ONLY_PARAMS,
  TALENT_ONLY_PARAMS,
  SEARCH_SPACE,
  RELIABILITY_BINS,
  parameterGrid,
  predictGame,
  summarizePredictions,
  summarizeCore,
  predictionsFor,
  evaluate,
  evaluateCore,
  search,
  pairedDeltas,
  runHistoricalCalibration,
  _internal: {
    round,
    mean,
    sampleSd,
    correlation,
    erf,
    normalCDF,
    logLoss,
    parameterKey,
    teamRating,
    calibrationRegression,
    reliability,
    uncertaintyBins,
    objectiveScores,
    isBetter,
    mulberry32,
    percentile,
    bootstrapMean,
    empiricalHomeField,
    canonicalHash: datasetMath.canonicalHash,
  },
};
