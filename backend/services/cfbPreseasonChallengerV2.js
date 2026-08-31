"use strict";

// Pure parallel-shadow transform. It reuses the already-built v1 team outputs so
// both lanes share the exact prediction-time snapshots and residualized features.
// It has no provider, database, route, scheduler, or customer-model dependency.
const crypto = require("crypto");
const {
  MODEL_VERSION: V1_MODEL_VERSION,
  TARGET_SEASON,
} = require("./cfbPreseasonChallenger");

const MODEL_VERSION = "cfb-preseason-prior-shadow-v2-2026";
const SOURCE_CALIBRATION_VERSION = "cfb-historical-calibration-phase2-v1-2026-08-31";
const MEAN_ARCHITECTURE = Object.freeze({
  returningResidualPointsPerSd: 1.25,
  talentResidualPointsPerSd: 2.5,
  residualClipSd: 2.0,
});

function finite(value) {
  const number = Number(value);
  return value !== null && value !== "" && Number.isFinite(number) ? number : null;
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildV2TeamFromV1(team) {
  if (!team || team.modelVersion !== V1_MODEL_VERSION) {
    throw new Error("v2 requires an approved v1 preseason team output");
  }
  const priorRating = finite(team.control?.priorRating);
  const returningResidual = finite(team.features?.returningProduction?.residualZ);
  const talentResidual = finite(team.features?.talentRecruitingComposite?.residualZ);
  const returningAdjustment = returningResidual == null ? 0
    : MEAN_ARCHITECTURE.returningResidualPointsPerSd
      * clamp(returningResidual, -MEAN_ARCHITECTURE.residualClipSd, MEAN_ARCHITECTURE.residualClipSd);
  const talentAdjustment = talentResidual == null ? 0
    : MEAN_ARCHITECTURE.talentResidualPointsPerSd
      * clamp(talentResidual, -MEAN_ARCHITECTURE.residualClipSd, MEAN_ARCHITECTURE.residualClipSd);
  const challengerRating = priorRating == null
    ? null : priorRating + returningAdjustment + talentAdjustment;
  const currentControlRating = finite(team.control?.currentControlRating);
  const features = Object.freeze({
    ...team.features,
    returningProduction: Object.freeze({
      ...team.features.returningProduction,
      meanAdjustment: round(returningAdjustment),
    }),
    talentRecruitingComposite: Object.freeze({
      ...team.features.talentRecruitingComposite,
      meanAdjustment: round(talentAdjustment),
    }),
  });
  return Object.freeze({
    ...team,
    modelVersion: MODEL_VERSION,
    challengerRating: round(challengerRating),
    deltaVsControl: challengerRating == null || currentControlRating == null
      ? null : round(challengerRating - currentControlRating),
    features,
    inputFingerprint: sha256({
      modelVersion: MODEL_VERSION,
      sourceModelVersion: V1_MODEL_VERSION,
      sourceInputFingerprint: team.inputFingerprint,
      meanArchitecture: MEAN_ARCHITECTURE,
      sourceCalibrationVersion: SOURCE_CALIBRATION_VERSION,
    }),
  });
}

function buildCfbPreseasonChallengerV2({ v1Challenger } = {}) {
  if (!v1Challenger || v1Challenger.modelVersion !== V1_MODEL_VERSION
      || v1Challenger.season !== TARGET_SEASON) {
    throw new Error("v2 requires the current-season approved v1 challenger");
  }
  const teams = Object.freeze(v1Challenger.teams.map(buildV2TeamFromV1));
  return Object.freeze({
    modelVersion: MODEL_VERSION,
    sourceModelVersion: V1_MODEL_VERSION,
    sourceCalibrationVersion: SOURCE_CALIBRATION_VERSION,
    generatedAt: v1Challenger.generatedAt,
    season: TARGET_SEASON,
    architecture: Object.freeze({
      mean: MEAN_ARCHITECTURE,
      uncertainty: Object.freeze({
        source: "v1-diagnostic-only",
        predictiveSigmaScale: 0,
        historicalSupport: "unavailable-prospective-validation-required",
      }),
    }),
    diagnostics: Object.freeze({
      sourceTeamCount: v1Challenger.teams.length,
      targetSeasonResultsUsed: false,
      providerCallsAdded: 0,
    }),
    teams,
  });
}

module.exports = {
  MODEL_VERSION,
  SOURCE_CALIBRATION_VERSION,
  MEAN_ARCHITECTURE,
  buildCfbPreseasonChallengerV2,
  _internal: { finite, round, clamp, sha256, buildV2TeamFromV1 },
};
