"use strict";

// Pure Phase 3 offense/defense shadow transform. It consumes the existing v1
// preseason output plus already-fetched ESPN offense/defense context. It has no
// provider, database, route, scheduler, or customer-model dependency.
const crypto = require("crypto");
const {
  MODEL_VERSION: V1_MODEL_VERSION,
  TARGET_SEASON,
  _internal: v1Math,
} = require("./cfbPreseasonChallenger");

const MODEL_VERSION = "cfb-preseason-od-shadow-v3-2026";
const UPDATER_VERSION = "cfb-inseason-od-shadow-v3-2026";
const SOURCE_CALIBRATION_VERSION = "cfb-historical-calibration-phase3-v1-2026-08-31";
const ARCHITECTURE = Object.freeze({
  offenseReturningWeight: 1.5,
  talentWeight: 4,
  residualClipSd: 2,
  updaterPriorGames: 4,
  updaterMinimumGames: 4,
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

function normalizeOdContext(context = {}) {
  const entries = context.teams instanceof Map ? [...context.teams] : Object.entries(context.teams || {});
  return Object.freeze({
    asOf: context.asOf || null,
    priorSeason: finite(context.priorSeason),
    currentSeason: finite(context.currentSeason),
    teams: new Map(entries.map(([id, row]) => [String(id), Object.freeze({ ...(row || {}) })])),
  });
}

function buildCfbPreseasonChallengerV3({ v1Challenger, odContext } = {}) {
  if (!v1Challenger || v1Challenger.modelVersion !== V1_MODEL_VERSION
      || v1Challenger.season !== TARGET_SEASON) {
    throw new Error("v3 requires the current approved v1 preseason challenger");
  }
  const od = normalizeOdContext(odContext);
  if (!od.asOf || !Number.isFinite(Date.parse(od.asOf))) throw new Error("v3 requires a stable offense/defense as-of timestamp");
  const records = v1Challenger.teams.map((team) => ({
    key: String(team.team.espnTeamId),
    team,
    od: od.teams.get(String(team.team.espnTeamId)) || null,
  }));
  const eligible = records.filter((record) => finite(record.od?.priorOffenseRating) != null
    && finite(record.od?.priorDefenseRating) != null);
  const priorOffenseZ = v1Math.keyedZ(eligible, (record) => finite(record.od.priorOffenseRating));
  const priorCompositeZ = v1Math.keyedZ(eligible, (record) => (
    finite(record.od.priorOffenseRating) + finite(record.od.priorDefenseRating)
  ));
  const returning = v1Math.keyedWinsorizedZ(eligible,
    (record) => finite(record.team.features?.returningProduction?.percentPPA));
  const talent = v1Math.keyedWinsorizedZ(eligible,
    (record) => finite(record.team.features?.talentRecruitingComposite?.teamTalent));
  const returningResidual = v1Math.standardizeMap(v1Math.residualize(returning.z, priorOffenseZ));
  const talentVsPrior = v1Math.residualize(talent.z, priorCompositeZ);
  const talentResidual = v1Math.standardizeMap(v1Math.residualize(talentVsPrior, returningResidual));

  const teams = records.map((record) => {
    const priorOffense = finite(record.od?.priorOffenseRating);
    const priorDefense = finite(record.od?.priorDefenseRating);
    const rp = returningResidual.get(record.key) ?? null;
    const talentSignal = talentResidual.get(record.key) ?? null;
    const rpAdjustment = rp == null ? 0 : ARCHITECTURE.offenseReturningWeight
      * clamp(rp, -ARCHITECTURE.residualClipSd, ARCHITECTURE.residualClipSd);
    const talentAdjustment = talentSignal == null ? 0 : ARCHITECTURE.talentWeight
      * clamp(talentSignal, -ARCHITECTURE.residualClipSd, ARCHITECTURE.residualClipSd);
    const preseasonOffense = priorOffense == null ? null : priorOffense + rpAdjustment + talentAdjustment / 2;
    const preseasonDefense = priorDefense == null ? null : priorDefense + talentAdjustment / 2;
    const currentGames = finite(record.od?.currentOdGames) ?? 0;
    const currentOffense = finite(record.od?.currentOffenseRating);
    const currentDefense = finite(record.od?.currentDefenseRating);
    const updaterActive = currentGames >= ARCHITECTURE.updaterMinimumGames
      && currentOffense != null && currentDefense != null;
    const denominator = ARCHITECTURE.updaterPriorGames + currentGames;
    const offense = updaterActive
      ? (ARCHITECTURE.updaterPriorGames * preseasonOffense + currentGames * currentOffense) / denominator
      : preseasonOffense;
    const defense = updaterActive
      ? (ARCHITECTURE.updaterPriorGames * preseasonDefense + currentGames * currentDefense) / denominator
      : preseasonDefense;
    const composite = offense == null || defense == null ? null : offense + defense;
    const status = composite == null ? "insufficient" : record.team.status;
    const output = {
      modelVersion: MODEL_VERSION,
      updaterVersion: UPDATER_VERSION,
      generatedAt: v1Challenger.generatedAt,
      team: record.team.team,
      snapshot: record.team.snapshot,
      status,
      uncertainty: record.team.uncertainty,
      featureCompleteness: record.team.featureCompleteness,
      offenseRating: round(offense),
      defenseRating: round(defense),
      challengerRating: round(composite),
      currentSeasonWeight: updaterActive ? round(currentGames / denominator) : 0,
      updateAsOf: od.asOf,
      gamesUsed: currentGames,
      updaterActive,
      features: Object.freeze({
        preseasonOffenseRating: round(preseasonOffense),
        preseasonDefenseRating: round(preseasonDefense),
        priorOffenseRating: round(priorOffense),
        priorDefenseRating: round(priorDefense),
        priorOdGames: finite(record.od?.priorOdGames),
        currentOffenseRating: round(currentOffense),
        currentDefenseRating: round(currentDefense),
        offenseReturningResidualZ: round(rp),
        offenseReturningAdjustment: round(rpAdjustment),
        talentResidualZ: round(talentSignal),
        talentAdjustment: round(talentAdjustment),
        defenseReturningProduction: null,
        quarterbackAdjustment: 0,
        transferAdjustment: 0,
      }),
    };
    return Object.freeze({
      ...output,
      inputFingerprint: sha256({
        modelVersion: MODEL_VERSION,
        updaterVersion: UPDATER_VERSION,
        sourceV1InputFingerprint: record.team.inputFingerprint,
        od: record.od,
        architecture: ARCHITECTURE,
        sourceCalibrationVersion: SOURCE_CALIBRATION_VERSION,
      }),
    });
  }).sort((left, right) => String(left.team.espnTeamId)
    .localeCompare(String(right.team.espnTeamId), "en", { numeric: true }));

  return Object.freeze({
    modelVersion: MODEL_VERSION,
    updaterVersion: UPDATER_VERSION,
    sourceModelVersion: V1_MODEL_VERSION,
    sourceCalibrationVersion: SOURCE_CALIBRATION_VERSION,
    generatedAt: v1Challenger.generatedAt,
    season: TARGET_SEASON,
    architecture: ARCHITECTURE,
    diagnostics: Object.freeze({
      sourceTeamCount: records.length,
      ratedTeamCount: teams.filter((team) => team.challengerRating != null).length,
      updaterActiveTeamCount: teams.filter((team) => team.updaterActive).length,
      targetSeasonResultsUsedForFitting: false,
      providerCallsAdded: 0,
      defensiveReturningProductionAvailable: false,
      quarterbackDirectionalFeatureIncluded: false,
      transferDirectionalFeatureIncluded: false,
    }),
    teams: Object.freeze(teams),
  });
}

module.exports = {
  MODEL_VERSION,
  UPDATER_VERSION,
  SOURCE_CALIBRATION_VERSION,
  ARCHITECTURE,
  buildCfbPreseasonChallengerV3,
  _internal: { finite, round, clamp, sha256, normalizeOdContext },
};
