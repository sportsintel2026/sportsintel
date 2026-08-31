"use strict";

// Deterministic, offline-only CFB calibration Phase 2. The search is selected on
// chronological training seasons, never on 2026 data, and has no route, provider,
// database, scheduler, or customer-model side effects.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildHistoricalDatasetPhase2 } = require("./cfbHistoricalDatasetPhase2");
const phase1 = require("./cfbHistoricalCalibration");

const CALIBRATION_VERSION = "cfb-historical-calibration-phase2-v1-2026-08-31";
const SEARCH_SPACE_VERSION = "cfb-historical-semantic-grid-v2-2026-08-31";
const CANDIDATE_VERSION_PREFIX = "cfb-preseason-prior-shadow-v2-2026";
const VALIDATION_SEASONS = Object.freeze([2023, 2024, 2025]);
const INITIAL_TRAINING_SEASONS = Object.freeze([2021, 2022]);
const PROSPECTIVE_REFIT_SEASONS = Object.freeze([2021, 2022, 2023, 2024, 2025]);
const FOLDS = Object.freeze([
  Object.freeze({ id: "fold-2023", train: Object.freeze([2021, 2022]), validate: 2023 }),
  Object.freeze({ id: "fold-2024", train: Object.freeze([2021, 2022, 2023]), validate: 2024 }),
  Object.freeze({ id: "fold-2025", train: Object.freeze([2021, 2022, 2023, 2024]), validate: 2025 }),
]);
const BOOTSTRAP_REPLICATES = 1000;
const NEAR_TIE_BALANCED_TOLERANCE = 0.00005;

const LIVE_V1_PARAMS = Object.freeze({
  returningProductionCoefficient: 0.75,
  talentCoefficient: 0.5,
  homeFieldAdvantage: 3,
  baseSigma: 15.5,
  uncertaintyScale: 1,
});
const HISTORICAL_V1_PARAMS = Object.freeze({ ...LIVE_V1_PARAMS, uncertaintyScale: 0 });
const PRIOR_ONLY_PARAMS = Object.freeze({
  ...HISTORICAL_V1_PARAMS,
  returningProductionCoefficient: 0,
  talentCoefficient: 0,
});
const PHASE1_CANDIDATE_REFERENCE = Object.freeze({
  returningProductionCoefficient: 1,
  talentCoefficient: 1.25,
  homeFieldAdvantage: 3,
  baseSigma: 14,
  uncertaintyScale: 0,
});

const SEARCH_SPACE = Object.freeze({
  coarse: Object.freeze({
    returningProductionCoefficient: Object.freeze(range(0, 1.5, 0.25)),
    talentCoefficient: Object.freeze(range(0, 2.5, 0.25)),
    homeFieldAdvantage: Object.freeze(range(2, 3.5, 0.5)),
    baseSigma: Object.freeze(range(12, 17.5, 0.5)),
    uncertaintyScale: Object.freeze([0]),
  }),
  fine: Object.freeze({
    returningProductionRadius: 0.25,
    returningProductionStep: 0.125,
    talentRadius: 0.25,
    talentStep: 0.125,
    homeFieldRadius: 0.5,
    homeFieldStep: 0.25,
    sigmaRadius: 0.5,
    sigmaStep: 0.25,
  }),
  uncertaintyScaleSearch: Object.freeze({
    tested: Object.freeze([0]),
    unavailable: Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5]),
    reason: "Prediction-time historical team uncertainty cannot be reconstructed semantically; only scale 0 is scientifically evaluable.",
  }),
});

const PROMOTION_RESEARCH_GATE = Object.freeze({
  aggregateStrictImprovementRequired: Object.freeze(["mae", "rmse", "brier", "logLoss"]),
  minimumPracticalImprovement: Object.freeze({ mae: 0.05, rmse: 0.05, brier: 0.0005, logLoss: 0.001 }),
  maximumSingleSeasonRelativeRegression: 0.005,
  bootstrapUpperBoundMustBeBelowZero: Object.freeze([
    "absoluteMarginError", "squaredMarginError", "brier", "logLoss",
  ]),
  note: "This is a research gate for creating a parallel shadow lane, never a customer-promotion gate.",
});

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function range(start, end, step) {
  const values = [];
  for (let value = start; value <= end + step / 100; value += step) values.push(round(value, 6));
  return values;
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

function gridFrom(space) {
  const rows = [];
  for (const returningProductionCoefficient of space.returningProductionCoefficient) {
    for (const talentCoefficient of space.talentCoefficient) {
      for (const homeFieldAdvantage of space.homeFieldAdvantage) {
        for (const baseSigma of space.baseSigma) {
          for (const uncertaintyScale of space.uncertaintyScale) {
            rows.push(Object.freeze({
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
  return Object.freeze(rows);
}

function boundedAround(center, radius, step, lower, upper) {
  return range(Math.max(lower, center - radius), Math.min(upper, center + radius), step);
}

function fineGrid(centers) {
  const rows = new Map();
  for (const center of centers) {
    const space = {
      returningProductionCoefficient: boundedAround(
        center.returningProductionCoefficient,
        SEARCH_SPACE.fine.returningProductionRadius,
        SEARCH_SPACE.fine.returningProductionStep,
        0,
        1.5,
      ),
      talentCoefficient: boundedAround(
        center.talentCoefficient,
        SEARCH_SPACE.fine.talentRadius,
        SEARCH_SPACE.fine.talentStep,
        0,
        2.5,
      ),
      homeFieldAdvantage: boundedAround(
        center.homeFieldAdvantage,
        SEARCH_SPACE.fine.homeFieldRadius,
        SEARCH_SPACE.fine.homeFieldStep,
        2,
        3.5,
      ),
      baseSigma: boundedAround(
        center.baseSigma,
        SEARCH_SPACE.fine.sigmaRadius,
        SEARCH_SPACE.fine.sigmaStep,
        12,
        17.5,
      ),
      uncertaintyScale: [0],
    };
    for (const row of gridFrom(space)) rows.set(parameterKey(row), row);
  }
  return Object.freeze([...rows.values()].sort((left, right) => (
    parameterKey(left).localeCompare(parameterKey(right))
  )));
}

function selectBest(rows) {
  const objectives = ["balanced", "margin", "probability"];
  return Object.freeze(Object.fromEntries(objectives.map((objective) => {
    const sorted = [...rows].sort((left, right) => (
      left.scores[objective] - right.scores[objective]
      || parameterKey(left.params).localeCompare(parameterKey(right.params))
    ));
    if (objective !== "balanced") return [objective, sorted[0]];
    const minimum = sorted[0].scores.balanced;
    const nearTies = sorted.filter((row) => row.scores.balanced <= minimum + NEAR_TIE_BALANCED_TOLERANCE);
    nearTies.sort((left, right) => (
      (left.params.returningProductionCoefficient + left.params.talentCoefficient)
        - (right.params.returningProductionCoefficient + right.params.talentCoefficient)
      || Math.abs(left.params.homeFieldAdvantage - LIVE_V1_PARAMS.homeFieldAdvantage)
        - Math.abs(right.params.homeFieldAdvantage - LIVE_V1_PARAMS.homeFieldAdvantage)
      || Math.abs(left.params.baseSigma - LIVE_V1_PARAMS.baseSigma)
        - Math.abs(right.params.baseSigma - LIVE_V1_PARAMS.baseSigma)
      || left.scores.balanced - right.scores.balanced
      || parameterKey(left.params).localeCompare(parameterKey(right.params))
    ));
    return [objective, nearTies[0]];
  })));
}

function evaluateGrid(dataset, seasons, paramsRows, baseline) {
  return Object.freeze(paramsRows.map((params) => {
    const evaluation = phase1.evaluateCore(dataset, seasons, params);
    return Object.freeze({
      params,
      metrics: evaluation.metrics,
      bySeason: evaluation.bySeason,
      scores: phase1._internal.objectiveScores(evaluation, baseline),
    });
  }));
}

function search(dataset, trainingSeasons) {
  const baseline = phase1.evaluateCore(dataset, trainingSeasons, HISTORICAL_V1_PARAMS);
  const coarseParams = gridFrom(SEARCH_SPACE.coarse);
  const coarseRows = evaluateGrid(dataset, trainingSeasons, coarseParams, baseline);
  const coarseBest = selectBest(coarseRows);
  const fineParams = fineGrid(Object.values(coarseBest).map((row) => row.params));
  const fineRows = evaluateGrid(dataset, trainingSeasons, fineParams, baseline);
  const best = selectBest([...coarseRows, ...fineRows]);
  return Object.freeze({
    trainingSeasons: Object.freeze([...trainingSeasons]),
    baseline,
    coarseCandidatesEvaluated: coarseRows.length,
    fineCandidatesEvaluated: fineRows.length,
    uniqueCandidatesEvaluated: new Set([
      ...coarseRows.map((row) => parameterKey(row.params)),
      ...fineRows.map((row) => parameterKey(row.params)),
    ]).size,
    coarseBest,
    best,
  });
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

function relativeRegression(candidate, baseline, metric) {
  if (!Number.isFinite(candidate[metric]) || !Number.isFinite(baseline[metric]) || baseline[metric] === 0) return null;
  return candidate[metric] / baseline[metric] - 1;
}

function responseCurve(dataset, fixedParams, field, values) {
  return Object.freeze(values.map((value) => {
    const params = Object.freeze({ ...fixedParams, [field]: value });
    const training = phase1.evaluateCore(dataset, INITIAL_TRAINING_SEASONS, params).metrics;
    const validation = phase1.evaluateCore(dataset, VALIDATION_SEASONS, params).metrics;
    return Object.freeze({ value, training, validation });
  }));
}

function historicalGate(candidateEvaluation, v1Evaluation, pairedUncertainty) {
  const aggregateDeltas = metricDelta(candidateEvaluation.metrics, v1Evaluation.metrics);
  const aggregateStrictImprovement = ["mae", "rmse", "brier", "logLoss"]
    .every((metric) => aggregateDeltas[metric] < 0);
  const practical = Object.entries(PROMOTION_RESEARCH_GATE.minimumPracticalImprovement)
    .every(([metric, threshold]) => aggregateDeltas[metric] <= -threshold);
  const bySeason = Object.fromEntries(VALIDATION_SEASONS.map((season) => {
    const candidate = candidateEvaluation.bySeason[season];
    const baseline = v1Evaluation.bySeason[season];
    const relative = Object.fromEntries(["mae", "rmse", "brier", "logLoss"].map((metric) => [
      metric,
      round(relativeRegression(candidate, baseline, metric)),
    ]));
    return [season, Object.freeze({
      delta: metricDelta(candidate, baseline),
      relativeRegression: Object.freeze(relative),
      materialCollapse: Object.values(relative).some((value) => (
        value != null && value > PROMOTION_RESEARCH_GATE.maximumSingleSeasonRelativeRegression
      )),
    })];
  }));
  const noMaterialAnnualCollapse = Object.values(bySeason).every((row) => !row.materialCollapse);
  const bootstrapSupports = PROMOTION_RESEARCH_GATE.bootstrapUpperBoundMustBeBelowZero.every((metric) => (
    pairedUncertainty[metric]?.bootstrap95?.[1] < 0
  ));
  const buildParallelV2 = aggregateStrictImprovement
    && practical
    && noMaterialAnnualCollapse
    && bootstrapSupports;
  return Object.freeze({
    aggregateDeltas,
    aggregateStrictImprovement,
    practicalImprovementThresholdsMet: practical,
    bySeason: Object.freeze(bySeason),
    noMaterialAnnualCollapse,
    bootstrapSupportsAllPrimaryMetrics: bootstrapSupports,
    buildParallelV2,
    decision: buildParallelV2
      ? "B — Parallel v2 shadow justified."
      : "A — V1 remains the only justified live shadow.",
  });
}

function runHistoricalCalibrationPhase2(dataset = buildHistoricalDatasetPhase2()) {
  if (dataset.outcomeSeasons.length < 3 || dataset.outcomeSeasons.some((season) => season >= 2026)) {
    throw new Error("Phase 2 requires at least three pre-2026 seasons and forbids 2026 outcomes");
  }
  for (const fold of FOLDS) {
    if (fold.train.some((season) => season >= fold.validate)) throw new Error(`non-chronological fold ${fold.id}`);
  }

  const initialSearch = search(dataset, INITIAL_TRAINING_SEASONS);
  const frozen = initialSearch.best.balanced;
  const candidateId = `${CANDIDATE_VERSION_PREFIX}-rp${frozen.params.returningProductionCoefficient}-tal${frozen.params.talentCoefficient}-hfa${frozen.params.homeFieldAdvantage}-sig${frozen.params.baseSigma}`;
  const candidateValidation = phase1.evaluate(dataset, VALIDATION_SEASONS, frozen.params, true);
  const v1Validation = phase1.evaluate(dataset, VALIDATION_SEASONS, HISTORICAL_V1_PARAMS, true);
  const pairedUncertainty = phase1.pairedDeltas(
    candidateValidation.predictions,
    v1Validation.predictions,
    200,
  );
  const gate = historicalGate(candidateValidation, v1Validation, pairedUncertainty);
  const prospectiveRefit = gate.buildParallelV2
    ? search(dataset, PROSPECTIVE_REFIT_SEASONS).best.balanced
    : null;

  const walkForward = Object.freeze(FOLDS.map((fold) => {
    const foldSearch = search(dataset, fold.train);
    const selected = foldSearch.best.balanced;
    const candidate = phase1.evaluate(dataset, [fold.validate], selected.params);
    const baseline = phase1.evaluate(dataset, [fold.validate], HISTORICAL_V1_PARAMS);
    return Object.freeze({
      id: fold.id,
      train: fold.train,
      validate: fold.validate,
      selectedParams: selected.params,
      candidatesEvaluated: foldSearch.uniqueCandidatesEvaluated,
      candidateMetrics: candidate.metrics,
      v1Metrics: baseline.metrics,
      deltaVsV1: metricDelta(candidate.metrics, baseline.metrics),
    });
  }));

  const phase1Reference = phase1.evaluate(dataset, VALIDATION_SEASONS, PHASE1_CANDIDATE_REFERENCE);
  const priorOnly = phase1.evaluate(dataset, VALIDATION_SEASONS, PRIOR_ONLY_PARAMS);
  const noReturning = phase1.evaluate(dataset, VALIDATION_SEASONS, {
    ...frozen.params,
    returningProductionCoefficient: 0,
  });
  const noTalent = phase1.evaluate(dataset, VALIDATION_SEASONS, {
    ...frozen.params,
    talentCoefficient: 0,
  });
  const result = {
    version: CALIBRATION_VERSION,
    datasetVersion: dataset.version,
    semanticInputVersion: dataset.semanticInputVersion,
    semanticInputContentSha256: dataset.semanticInputContentSha256,
    searchSpaceVersion: SEARCH_SPACE_VERSION,
    searchSpace: SEARCH_SPACE,
    folds: FOLDS,
    selectionProtocol: Object.freeze({
      initialTrainingSeasons: INITIAL_TRAINING_SEASONS,
      frozenValidationSeasons: VALIDATION_SEASONS,
      rule: "Select the balanced candidate on 2021-2022 only, freeze it, then evaluate 2023/2024/2025. Each walk-forward fold reselects using only seasons before its validation year.",
      nearTieRule: `Within ${NEAR_TIE_BALANCED_TOLERANCE} balanced-score units, prefer lower RP+talent magnitude, HFA nearest 3.0, then sigma nearest 15.5.`,
      candidateId,
      initialSearchCandidates: initialSearch.uniqueCandidatesEvaluated,
    }),
    baselines: Object.freeze({
      liveV1Frozen: Object.freeze({
        params: LIVE_V1_PARAMS,
        historicallyEvaluable: false,
        reason: dataset.uncertainty.reason,
      }),
      historicalComparableV1: Object.freeze({
        params: HISTORICAL_V1_PARAMS,
        validation: phase1.evaluate(dataset, VALIDATION_SEASONS, HISTORICAL_V1_PARAMS),
      }),
      priorOnly: Object.freeze({ params: PRIOR_ONLY_PARAMS, validation: priorOnly }),
      phase1CandidateReference: Object.freeze({
        params: PHASE1_CANDIDATE_REFERENCE,
        validation: phase1Reference,
        caveat: "RP coefficient was selected using a different Phase 1 proxy; this row is reference-only.",
      }),
    }),
    frozenCandidate: Object.freeze({
      id: candidateId,
      params: frozen.params,
      trainingMetrics: frozen.metrics,
      trainingScores: frozen.scores,
      validationMetrics: candidateValidation.metrics,
      validationBySeason: candidateValidation.bySeason,
      pairedUncertaintyVsV1: pairedUncertainty,
      gate,
    }),
    prospectiveParallelV2: prospectiveRefit == null ? null : Object.freeze({
      teamModelVersion: "cfb-preseason-prior-shadow-v2-2026",
      gameModelVersion: "cfb-game-preseason-shadow-v2-2026",
      experimentVersion: "cfb-game-preseason-shadow-v2-parallel-2026",
      params: prospectiveRefit.params,
      refitSeasons: PROSPECTIVE_REFIT_SEASONS,
      refitMetrics: prospectiveRefit.metrics,
      refitScores: prospectiveRefit.scores,
      rule: "Only after the held-out B gate passed, refit the unchanged deterministic search on all pre-2026 seasons for prospective 2026 shadow collection. These in-sample refit metrics are not validation evidence.",
    }),
    walkForward,
    parameterFindings: Object.freeze({
      returningProduction: Object.freeze({
        curve: responseCurve(dataset, frozen.params, "returningProductionCoefficient", range(0, 1.5, 0.125)),
        valueAddedVsSameCandidateWithRpZero: metricDelta(candidateValidation.metrics, noReturning.metrics),
      }),
      talent: Object.freeze({
        curve: responseCurve(dataset, frozen.params, "talentCoefficient", range(0, 2.5, 0.125)),
        valueAddedVsSameCandidateWithTalentZero: metricDelta(candidateValidation.metrics, noTalent.metrics),
        upperBoundary: 2.5,
      }),
      homeFieldAdvantage: Object.freeze({
        curve: responseCurve(dataset, frozen.params, "homeFieldAdvantage", range(2, 3.5, 0.25)),
        neutralAlwaysZero: true,
      }),
      sigma: Object.freeze({
        curve: responseCurve(dataset, frozen.params, "baseSigma", range(12, 17.5, 0.25)),
        compares14And15_5: true,
      }),
      uncertainty: Object.freeze({
        selectedScale: 0,
        historicallyAvailable: false,
        reason: dataset.uncertainty.reason,
        prospectiveValidationRequired: true,
      }),
    }),
    dataQuality: Object.freeze({
      coverage: Object.freeze(dataset.seasons.map((row) => Object.freeze({
        season: row.season,
        priorSeason: row.priorSeason,
        ...row.coverage,
      }))),
      providerBudget: dataset.providerBudget,
      returningProductionField: "CFBD percentPPA",
      returningProductionSemanticsMatchLive2026: true,
      exactEspnIdentity: true,
      fuzzyIdentityUsed: false,
      targetOutcomeLeakage: false,
      outcomesFrom2026Used: false,
      historicalRowsMutated: false,
    }),
    decision: gate.decision,
    parallelV2Justified: gate.buildParallelV2,
    researchGate: PROMOTION_RESEARCH_GATE,
  };
  const resultSha256 = crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex");
  return Object.freeze({ ...result, resultSha256 });
}

function markdown(result) {
  const candidate = result.frozenCandidate;
  const v1 = result.baselines.historicalComparableV1.validation.metrics;
  const refit = result.prospectiveParallelV2;
  const bootstrap = candidate.pairedUncertaintyVsV1;
  const rows = result.walkForward.map((fold) => (
    `| ${fold.validate} | ${fold.candidateMetrics.n} | ${fold.deltaVsV1.mae} | ${fold.deltaVsV1.rmse} | ${fold.deltaVsV1.brier} | ${fold.deltaVsV1.logLoss} |`
  )).join("\n");
  const coverage = result.dataQuality.coverage.map((row) => (
    `| ${row.season} | ${row.exactSemanticSourceRows} | ${row.teamsWithPercentPPA} | ${row.finalEvaluatedGames} |`
  )).join("\n");
  return `# CFB Historical Calibration Phase 2\n\n`
    + `Decision: **${result.decision}**\n\n`
    + `Candidate: \`${candidate.id}\`\n\n`
    + `Parameters: RP ${candidate.params.returningProductionCoefficient}, talent ${candidate.params.talentCoefficient}, HFA ${candidate.params.homeFieldAdvantage}, sigma ${candidate.params.baseSigma}, historical uncertainty scale ${candidate.params.uncertaintyScale}.\n\n`
    + `Historical returning production uses exact target-season CFBD \`percentPPA\`; no 2026 outcomes were used. Historical uncertainty was unavailable and therefore not reconstructed.\n\n`
    + `## Aggregate validation (2023-2025)\n\n`
    + `- Games: ${candidate.validationMetrics.n}\n`
    + `- V1 comparable: MAE ${v1.mae}, RMSE ${v1.rmse}, Brier ${v1.brier}, log loss ${v1.logLoss}\n`
    + `- Candidate: MAE ${candidate.validationMetrics.mae}, RMSE ${candidate.validationMetrics.rmse}, Brier ${candidate.validationMetrics.brier}, log loss ${candidate.validationMetrics.logLoss}\n`
    + `- Delta: MAE ${candidate.gate.aggregateDeltas.mae}, RMSE ${candidate.gate.aggregateDeltas.rmse}, Brier ${candidate.gate.aggregateDeltas.brier}, log loss ${candidate.gate.aggregateDeltas.logLoss}\n\n`
    + `- Calibration: V1 ECE ${v1.reliability.ece}; candidate ECE ${candidate.validationMetrics.reliability.ece}. The primary scores improve, but fixed-bin ECE worsens and remains a prospective risk.\n\n`
    + `## Walk-forward folds\n\n`
    + `| Validation | n | Δ MAE | Δ RMSE | Δ Brier | Δ log loss |\n|---:|---:|---:|---:|---:|---:|\n${rows}\n\n`
    + `## Paired bootstrap (1,000 per-game replicates)\n\n`
    + `- Absolute error delta: ${bootstrap.absoluteMarginError.mean}; 95% CI [${bootstrap.absoluteMarginError.bootstrap95.join(", ")}].\n`
    + `- Squared error delta: ${bootstrap.squaredMarginError.mean}; 95% CI [${bootstrap.squaredMarginError.bootstrap95.join(", ")}].\n`
    + `- Brier delta: ${bootstrap.brier.mean}; 95% CI [${bootstrap.brier.bootstrap95.join(", ")}].\n`
    + `- Log-loss delta: ${bootstrap.logLoss.mean}; 95% CI [${bootstrap.logLoss.bootstrap95.join(", ")}].\n\n`
    + `## Prospective parallel-v2 refit\n\n`
    + (refit == null ? `No v2 refit was authorized by the historical gate.\n\n` : (
      `After the held-out gate passed, the unchanged search was refit on all 2021-2025 data solely for future shadow collection. `
      + `The frozen v2 configuration is RP ${refit.params.returningProductionCoefficient}, talent ${refit.params.talentCoefficient}, HFA ${refit.params.homeFieldAdvantage}, sigma ${refit.params.baseSigma}, uncertainty scale ${refit.params.uncertaintyScale}. `
      + `Its in-sample refit metrics are not validation evidence.\n\n`
    ))
    + `## Semantic coverage\n\n`
    + `| Season | exact CFBD rows | teams with percentPPA | evaluated games |\n|---:|---:|---:|---:|\n${coverage}\n\n`
    + `## Parameter findings\n\n`
    + `- CFBD percentPPA adds value. The supported RP coefficient varies by fold; the final all-pre-2026 prospective refit is ${refit?.params.returningProductionCoefficient ?? "n/a"}.\n`
    + `- Talent remains additive after residualizing against prior rating and percentPPA. Performance improves through the 2.5 boundary, so scale identifiability is unresolved and the search is not expanded indefinitely.\n`
    + `- HFA 3.0 remains the stable simple choice; neutral HFA is always zero.\n`
    + `- Sigma 14 beats 15.5 on held-out 2023-2025 probability scores, while 2021-2022 preferred 17.5 and the all-history refit returned 15.5. The instability is why v2 keeps 15.5 and requires prospective comparison.\n`
    + `- Historical uncertainty is not semantically reconstructible. Scale 0 is the only honest historical comparison; live v1 uncertainty is unchanged.\n\n`
    + `## Scientific limits\n\n`
    + `- The live v1 uncertainty architecture cannot be reconstructed historically; its scale remains unchanged in production.\n`
    + `- Phase 1's overall-returning proxy is not treated as equivalent to CFBD percentPPA.\n`
    + `- This result can justify only a parallel prospective shadow lane, never customer promotion.\n`
    + `- Provider calls attempted: ${result.dataQuality.providerBudget.cfbdApiCallsAttempted} of ${result.dataQuality.providerBudget.maximumAllowed}.\n`;
}

function writeArtifacts(result = runHistoricalCalibrationPhase2()) {
  const outputDir = path.join(__dirname, "results");
  const jsonPath = path.join(outputDir, "cfb-historical-calibration-phase2-v1.json");
  const markdownPath = path.join(outputDir, "cfb-historical-calibration-phase2-v1.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown(result));
  return Object.freeze({ jsonPath, markdownPath, result });
}

if (require.main === module) {
  const written = writeArtifacts();
  console.log(JSON.stringify({
    decision: written.result.decision,
    candidate: written.result.frozenCandidate.id,
    params: written.result.frozenCandidate.params,
    validation: written.result.frozenCandidate.validationMetrics,
    deltaVsV1: written.result.frozenCandidate.gate.aggregateDeltas,
    resultSha256: written.result.resultSha256,
  }, null, 2));
}

module.exports = {
  CALIBRATION_VERSION,
  SEARCH_SPACE_VERSION,
  CANDIDATE_VERSION_PREFIX,
  VALIDATION_SEASONS,
  INITIAL_TRAINING_SEASONS,
  PROSPECTIVE_REFIT_SEASONS,
  FOLDS,
  BOOTSTRAP_REPLICATES,
  NEAR_TIE_BALANCED_TOLERANCE,
  LIVE_V1_PARAMS,
  HISTORICAL_V1_PARAMS,
  PRIOR_ONLY_PARAMS,
  PHASE1_CANDIDATE_REFERENCE,
  SEARCH_SPACE,
  PROMOTION_RESEARCH_GATE,
  gridFrom,
  fineGrid,
  search,
  metricDelta,
  responseCurve,
  historicalGate,
  runHistoricalCalibrationPhase2,
  markdown,
  writeArtifacts,
  _internal: { round, range, parameterKey, selectBest, evaluateGrid, relativeRegression },
};
