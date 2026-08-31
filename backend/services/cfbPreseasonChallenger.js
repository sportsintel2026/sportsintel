"use strict";

// Offline/shadow-only 2026 CFB preseason prior. This module is intentionally pure:
// callers must supply immutable team snapshots and a frozen control-rating map. It
// has no provider, database, route, scheduler, prediction, or customer-model imports.

const crypto = require("crypto");

const MODEL_VERSION = "cfb-preseason-prior-shadow-v1-2026";
const TARGET_SEASON = 2026;

// These are deliberately small, provisional regularization dials, not coefficients
// fitted to 2026 results. Each feature is orthogonalized to the prior rating first,
// standardized across the frozen FBS population, and clipped to two residual SDs.
const MEAN_ARCHITECTURE = Object.freeze({
  returningResidualPointsPerSd: 0.75,
  talentResidualPointsPerSd: 0.50,
  residualClipSd: 2,
  winsorLower: 0.05,
  winsorUpper: 0.95,
});

const UNCERTAINTY_ARCHITECTURE = Object.freeze({
  baseTeamSd: 3.0,
  qbUnknownSd: 1.5,
  transferUnresolvedBaseSd: 1.0,
  transferUnresolvedScaleSd: 0.75,
  transferUnresolvedSaturation: 40,
  coachingUnknownOrTransitionSd: 0.75,
  missingReturningProductionSd: 1.25,
  missingTalentSd: 1.0,
  rosterEvidenceGapMaxSd: 1.0,
});

function finite(value) {
  if (value === null || value === undefined || typeof value === "boolean"
      || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, lower, upper) {
  return Math.max(lower, Math.min(upper, value));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function quantile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function populationSd(values) {
  if (!values.length) return null;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length);
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

function normalizeSnapshot(row) {
  const team = row.team || {};
  const returningProduction = row.returningProduction || row.returning_production || {};
  return Object.freeze({
    id: row.id ?? null,
    season: finite(row.season),
    contractVersion: row.contractVersion || row.contract_version || null,
    snapshotAt: row.snapshotAt || row.snapshot_at || null,
    inputHash: row.inputHash || row.input_hash || null,
    team: Object.freeze({
      name: team.name || row.teamName || row.team_name || null,
      espnTeamId: String(team.espnTeamId || row.espnTeamId || row.espn_team_id || "") || null,
      cfbdTeamId: finite(team.cfbdTeamId ?? row.cfbdTeamId ?? row.cfbd_team_id),
    }),
    quarterback: row.quarterback || {},
    roster: row.roster || {},
    returningProduction,
    transfers: row.transfers || {},
    talent: row.talent || {},
    coaching: row.coaching || {},
    quality: row.quality || {},
  });
}

function normalizeControls(controlRatings) {
  const entries = controlRatings instanceof Map
    ? [...controlRatings.entries()]
    : Object.entries(controlRatings || {});
  const out = new Map();
  for (const [key, rowValue] of entries) {
    const row = typeof rowValue === "number" ? { priorRating: rowValue } : (rowValue || {});
    const espnTeamId = String(row.espnTeamId || row.id || key || "");
    if (!espnTeamId) continue;
    const priorRating = finite(row.priorRating ?? row.rating);
    const currentRating = finite(row.currentRating);
    const controlRating = finite(row.controlRating) ?? currentRating ?? priorRating;
    out.set(espnTeamId, Object.freeze({
      espnTeamId,
      teamName: row.teamName || row.name || null,
      priorSeason: finite(row.priorSeason) ?? TARGET_SEASON - 1,
      currentSeason: finite(row.currentSeason) ?? TARGET_SEASON,
      priorRating,
      currentRating,
      controlRating,
      currentGames: finite(row.currentGames) ?? 0,
      ratingSource: row.ratingSource || (currentRating == null ? "prior-only" : "blended"),
      sosApplied: row.sosApplied === true,
    }));
  }
  return out;
}

function returningValue(snapshot) {
  if (snapshot.returningProduction.recordFound !== true) return null;
  return finite(snapshot.returningProduction.values?.percentPPA);
}

function talentValue(snapshot) {
  return finite(snapshot.talent.teamTalent?.talent);
}

function recruitingDiagnostic(snapshot) {
  const rows = Array.isArray(snapshot.talent.recruitingTeams)
    ? snapshot.talent.recruitingTeams
    : [];
  const current = rows
    .filter((row) => finite(row?.year) === TARGET_SEASON && finite(row?.points) != null)
    .sort((left, right) => finite(left.rank) - finite(right.rank))[0];
  return current ? Object.freeze({ rank: finite(current.rank), points: finite(current.points) }) : null;
}

function keyedWinsorizedZ(records, accessor) {
  const pairs = records
    .map((record) => [record.key, accessor(record)])
    .filter(([, value]) => Number.isFinite(value));
  const rawValues = pairs.map(([, value]) => value);
  const lower = quantile(rawValues, MEAN_ARCHITECTURE.winsorLower);
  const upper = quantile(rawValues, MEAN_ARCHITECTURE.winsorUpper);
  const winsorized = pairs.map(([key, value]) => [key, clamp(value, lower, upper)]);
  const values = winsorized.map(([, value]) => value);
  const center = mean(values);
  const sd = populationSd(values);
  const z = new Map(winsorized.map(([key, value]) => [key, sd > 0 ? (value - center) / sd : 0]));
  return Object.freeze({ z, lower, upper, center, sd, count: pairs.length });
}

function keyedZ(records, accessor) {
  const pairs = records
    .map((record) => [record.key, accessor(record)])
    .filter(([, value]) => Number.isFinite(value));
  const values = pairs.map(([, value]) => value);
  const center = mean(values);
  const sd = populationSd(values);
  return new Map(pairs.map(([key, value]) => [key, sd > 0 ? (value - center) / sd : 0]));
}

// This is redundancy removal, not target fitting: no result or target-season field
// enters the slope. The residual preserves only the feature information not linearly
// restating the frozen prior rating (and, for talent, returning production).
function residualize(target, predictor) {
  const keys = [...target.keys()].filter((key) => predictor.has(key));
  if (keys.length < 2) return new Map(target);
  const x = keys.map((key) => predictor.get(key));
  const y = keys.map((key) => target.get(key));
  const xMean = mean(x);
  const yMean = mean(y);
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < keys.length; index++) {
    covariance += (x[index] - xMean) * (y[index] - yMean);
    variance += (x[index] - xMean) ** 2;
  }
  const slope = variance > 0 ? covariance / variance : 0;
  const intercept = yMean - slope * xMean;
  return new Map([...target.entries()].map(([key, value]) => [
    key,
    predictor.has(key) ? value - (intercept + slope * predictor.get(key)) : value,
  ]));
}

function standardizeMap(values) {
  const entries = [...values.entries()].filter(([, value]) => Number.isFinite(value));
  const center = mean(entries.map(([, value]) => value));
  const sd = populationSd(entries.map(([, value]) => value));
  return new Map(entries.map(([key, value]) => [key, sd > 0 ? (value - center) / sd : 0]));
}

function rosterEvidence(snapshot, rosterReferenceCount) {
  const playerCount = finite(snapshot.roster.playerCount) ?? 0;
  const durableIdCount = finite(snapshot.roster.durableIdCount) ?? 0;
  const missingIdCount = finite(snapshot.roster.missingIdCount) ?? 0;
  const duplicateIdCount = finite(snapshot.roster.duplicateIdCount) ?? 0;
  const durableIdRatio = playerCount > 0 ? clamp(durableIdCount / playerCount, 0, 1) : 0;
  const populationCoverage = rosterReferenceCount > 0 ? clamp(playerCount / rosterReferenceCount, 0, 1) : 0;
  const completeness = Math.min(durableIdRatio, populationCoverage);
  return Object.freeze({
    playerCount,
    durableIdCount,
    missingIdCount,
    duplicateIdCount,
    durableIdRatio: round(durableIdRatio),
    populationCoverage: round(populationCoverage),
    completeness: round(completeness),
  });
}

function transferEvidence(snapshot) {
  const arrivals = Array.isArray(snapshot.transfers.arrivals) ? snapshot.transfers.arrivals.length : finite(snapshot.transfers.arrivalCount) ?? 0;
  const departures = Array.isArray(snapshot.transfers.departures) ? snapshot.transfers.departures.length : finite(snapshot.transfers.departureCount) ?? 0;
  const ambiguous = finite(snapshot.transfers.ambiguousIdentityCount) ?? 0;
  const unmatched = finite(snapshot.transfers.unmatchedIdentityCount) ?? 0;
  const safelyJoined = finite(snapshot.transfers.safelyJoinedCount) ?? 0;
  const unresolvedCount = ambiguous + unmatched;
  return Object.freeze({ arrivals, departures, safelyJoined, unresolvedCount, unresolved: unresolvedCount > 0 });
}

function coachingEvidence(snapshot) {
  // The 2026 /coaches?year=2026 payload resolved coach identity, but every stored
  // tenure is one season. Therefore false cannot distinguish a real change from a
  // year-scoped response. Only true is treated as confirmed continuity in v1.
  const confirmedContinuity = snapshot.coaching.continuity === true;
  return Object.freeze({
    identityStatus: snapshot.coaching.identityStatus || null,
    tenureYears: finite(snapshot.coaching.tenureYears),
    continuity: confirmedContinuity ? "confirmed-continuity" : "unknown-or-transition",
    directionalAdjustment: 0,
  });
}

function uncertaintyFor({ snapshot, roster, transfers, returning, talent }) {
  const components = {
    base: UNCERTAINTY_ARCHITECTURE.baseTeamSd,
    qbUnknown: snapshot.quarterback.category === "unknown-unverified"
      ? UNCERTAINTY_ARCHITECTURE.qbUnknownSd : 0,
    transferIdentity: transfers.unresolved
      ? UNCERTAINTY_ARCHITECTURE.transferUnresolvedBaseSd
        + UNCERTAINTY_ARCHITECTURE.transferUnresolvedScaleSd
          * Math.min(1, transfers.unresolvedCount / UNCERTAINTY_ARCHITECTURE.transferUnresolvedSaturation)
      : 0,
    coaching: snapshot.coaching.continuity === true
      ? 0 : UNCERTAINTY_ARCHITECTURE.coachingUnknownOrTransitionSd,
    returningProduction: returning == null
      ? UNCERTAINTY_ARCHITECTURE.missingReturningProductionSd : 0,
    talent: talent == null ? UNCERTAINTY_ARCHITECTURE.missingTalentSd : 0,
    rosterEvidence: UNCERTAINTY_ARCHITECTURE.rosterEvidenceGapMaxSd * (1 - roster.completeness),
  };
  const variance = Object.values(components).reduce((sum, component) => sum + component ** 2, 0);
  return Object.freeze({
    sd: round(Math.sqrt(variance)),
    variance: round(variance),
    components: Object.freeze(Object.fromEntries(
      Object.entries(components).map(([name, value]) => [name, round(value)]),
    )),
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildCfbPreseasonChallenger({ snapshots = [], controlRatings = {}, generatedAt } = {}) {
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("a stable generatedAt timestamp is required");
  }
  const normalized = snapshots.map(normalizeSnapshot);
  if (normalized.some((snapshot) => snapshot.season !== TARGET_SEASON)) {
    throw new Error(`all challenger snapshots must be season ${TARGET_SEASON}`);
  }
  const controls = normalizeControls(controlRatings);
  const records = normalized.map((snapshot) => ({
    key: `${snapshot.team.espnTeamId}:${snapshot.inputHash || snapshot.id}`,
    snapshot,
    control: controls.get(snapshot.team.espnTeamId) || null,
  }));
  const eligible = records.filter((record) => record.control?.priorRating != null);
  const priorZ = keyedZ(eligible, (record) => record.control.priorRating);
  const returningStats = keyedWinsorizedZ(eligible, (record) => returningValue(record.snapshot));
  const talentStats = keyedWinsorizedZ(eligible, (record) => talentValue(record.snapshot));
  const returningResidual = standardizeMap(residualize(returningStats.z, priorZ));
  const talentVsPrior = residualize(talentStats.z, priorZ);
  const talentResidual = standardizeMap(residualize(talentVsPrior, returningResidual));
  const rosterReferenceCount = quantile(
    normalized.map((snapshot) => finite(snapshot.roster.playerCount)).filter(Number.isFinite),
    0.25,
  ) || 1;

  const teams = records.map((record) => {
    const { snapshot, control, key } = record;
    const returning = returningValue(snapshot);
    const talent = talentValue(snapshot);
    const roster = rosterEvidence(snapshot, rosterReferenceCount);
    const transfers = transferEvidence(snapshot);
    const coaching = coachingEvidence(snapshot);
    const qbUnknown = snapshot.quarterback.category === "unknown-unverified";
    const missingFlags = Object.freeze({
      priorRating: control?.priorRating == null,
      returningProduction: returning == null,
      talent: talent == null,
      rosterEvidence: roster.completeness < 1,
      quarterback: qbUnknown,
      transferIdentity: transfers.unresolved,
      coachingContinuity: coaching.continuity !== "confirmed-continuity",
    });
    const usableInputCount = [control?.priorRating, returning, talent, roster.completeness > 0 ? roster.completeness : null]
      .filter((value) => value != null).length;
    const returningSignal = returningResidual.get(key) ?? null;
    const talentSignal = talentResidual.get(key) ?? null;
    const returningAdjustment = returningSignal == null ? 0
      : MEAN_ARCHITECTURE.returningResidualPointsPerSd
        * clamp(returningSignal, -MEAN_ARCHITECTURE.residualClipSd, MEAN_ARCHITECTURE.residualClipSd);
    const talentAdjustment = talentSignal == null ? 0
      : MEAN_ARCHITECTURE.talentResidualPointsPerSd
        * clamp(talentSignal, -MEAN_ARCHITECTURE.residualClipSd, MEAN_ARCHITECTURE.residualClipSd);
    const priorRating = control?.priorRating ?? null;
    const challengerRating = priorRating == null ? null : priorRating + returningAdjustment + talentAdjustment;
    const uncertainty = uncertaintyFor({ snapshot, roster, transfers, returning, talent });
    const status = challengerRating == null ? "insufficient"
      : Object.values(missingFlags).some(Boolean) ? "suspect" : "rated-input-ready";
    const currentControlRating = control?.controlRating ?? null;
    const featureCompleteness = finite(snapshot.quality.completeness);
    const output = {
      modelVersion: MODEL_VERSION,
      generatedAt: new Date(generatedAt).toISOString(),
      team: snapshot.team,
      snapshot: Object.freeze({
        id: snapshot.id,
        inputHash: snapshot.inputHash,
        snapshotAt: snapshot.snapshotAt,
        contractVersion: snapshot.contractVersion,
      }),
      control: Object.freeze({
        priorSeason: control?.priorSeason ?? TARGET_SEASON - 1,
        currentSeason: control?.currentSeason ?? TARGET_SEASON,
        priorRating: round(priorRating),
        currentRating: round(control?.currentRating),
        currentGames: control?.currentGames ?? 0,
        currentControlRating: round(currentControlRating),
        ratingSource: control?.ratingSource || "unavailable",
        sosApplied: control?.sosApplied === true,
      }),
      challengerRating: round(challengerRating),
      deltaVsControl: challengerRating == null || currentControlRating == null
        ? null : round(challengerRating - currentControlRating),
      uncertainty,
      featureCompleteness: round(featureCompleteness),
      usedInputCompleteness: round(usableInputCount / 4),
      usableInputCount,
      missingFlags,
      status,
      features: Object.freeze({
        priorPerformance: Object.freeze({
          rating: round(priorRating),
          alreadyRegressedByProduction: true,
        }),
        returningProduction: Object.freeze({
          percentPPA: round(returning),
          residualZ: round(returningSignal),
          meanAdjustment: round(returningAdjustment),
        }),
        talentRecruitingComposite: Object.freeze({
          teamTalent: round(talent),
          recruiting: recruitingDiagnostic(snapshot),
          compositeBasis: "team-talent-only",
          recruitingUsedNumerically: false,
          residualZ: round(talentSignal),
          meanAdjustment: round(talentAdjustment),
        }),
        roster,
        coaching,
        quarterback: Object.freeze({ category: snapshot.quarterback.category || "unknown-unverified", meanAdjustment: 0 }),
        transfers: Object.freeze({ ...transfers, meanAdjustment: 0 }),
      }),
    };
    return Object.freeze({
      ...output,
      inputFingerprint: sha256({
        modelVersion: MODEL_VERSION,
        snapshotId: snapshot.id,
        inputHash: snapshot.inputHash,
        control,
        meanArchitecture: MEAN_ARCHITECTURE,
        uncertaintyArchitecture: UNCERTAINTY_ARCHITECTURE,
      }),
    });
  }).sort((left, right) => String(left.team.espnTeamId).localeCompare(String(right.team.espnTeamId), "en", { numeric: true }));

  const diagnostics = Object.freeze({
    historicalFittingDataUsed: Object.freeze([]),
    coefficientsEmpiricallyFit: false,
    targetSeasonResultsUsed: false,
    counts: Object.freeze({
      snapshots: normalized.length,
      rated: teams.filter((team) => team.challengerRating != null).length,
      suspect: teams.filter((team) => team.status === "suspect").length,
      ratedInputReady: teams.filter((team) => team.status === "rated-input-ready").length,
      insufficient: teams.filter((team) => team.status === "insufficient").length,
    }),
    redundancy: Object.freeze({
      priorVsReturningCorrelation: round(correlation(
        eligible.map((record) => record.control.priorRating).filter((_, index) => returningValue(eligible[index].snapshot) != null),
        eligible.filter((record) => returningValue(record.snapshot) != null).map((record) => returningValue(record.snapshot)),
      )),
      priorVsTalentCorrelation: round(correlation(
        eligible.map((record) => record.control.priorRating).filter((_, index) => talentValue(eligible[index].snapshot) != null),
        eligible.filter((record) => talentValue(record.snapshot) != null).map((record) => talentValue(record.snapshot)),
      )),
      talentVsRecruitingCorrelation: (() => {
        const paired = eligible
          .map((record) => [talentValue(record.snapshot), recruitingDiagnostic(record.snapshot)?.points])
          .filter(([talentNumber, recruitingNumber]) => talentNumber != null && recruitingNumber != null);
        return round(correlation(paired.map((row) => row[0]), paired.map((row) => row[1])));
      })(),
      returningWinsorBounds: Object.freeze({ lower: round(returningStats.lower), upper: round(returningStats.upper) }),
      talentWinsorBounds: Object.freeze({ lower: round(talentStats.lower), upper: round(talentStats.upper) }),
      rosterReferenceCount: round(rosterReferenceCount),
    }),
  });

  return Object.freeze({
    modelVersion: MODEL_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    season: TARGET_SEASON,
    architecture: Object.freeze({ mean: MEAN_ARCHITECTURE, uncertainty: UNCERTAINTY_ARCHITECTURE }),
    diagnostics,
    teams: Object.freeze(teams),
  });
}

function compareCfbPreseasonChallenger(challenger) {
  const rated = challenger.teams.filter((team) => (
    team.challengerRating != null && team.control.currentControlRating != null
  ));
  const deltas = rated.map((team) => team.deltaVsControl);
  const controlValues = rated.map((team) => team.control.currentControlRating);
  const challengerValues = rated.map((team) => team.challengerRating);
  const controlRanks = new Map([...rated]
    .sort((left, right) => right.control.currentControlRating - left.control.currentControlRating)
    .map((team, index) => [team.team.espnTeamId, index + 1]));
  const challengerRanks = new Map([...rated]
    .sort((left, right) => right.challengerRating - left.challengerRating)
    .map((team, index) => [team.team.espnTeamId, index + 1]));
  const withRanks = rated.map((team) => Object.freeze({
    ...team,
    controlRank: controlRanks.get(team.team.espnTeamId),
    challengerRank: challengerRanks.get(team.team.espnTeamId),
    rankMovement: controlRanks.get(team.team.espnTeamId) - challengerRanks.get(team.team.espnTeamId),
  }));
  const byDelta = [...withRanks].sort((left, right) => right.deltaVsControl - left.deltaVsControl);
  const byUncertainty = [...withRanks].sort((left, right) => left.uncertainty.sd - right.uncertainty.sd || left.team.name.localeCompare(right.team.name));
  const abs = deltas.map(Math.abs);
  return Object.freeze({
    sample: rated.length,
    correlation: round(correlation(controlValues, challengerValues)),
    meanDelta: round(mean(deltas)),
    medianAbsoluteDelta: round(quantile(abs, 0.5)),
    deltaSd: round(populationSd(deltas)),
    changedBy: Object.freeze({
      over1: abs.filter((value) => value > 1).length,
      over2: abs.filter((value) => value > 2).length,
      over3: abs.filter((value) => value > 3).length,
      over5: abs.filter((value) => value > 5).length,
    }),
    distribution: Object.freeze({
      controlMean: round(mean(controlValues)),
      challengerMean: round(mean(challengerValues)),
      controlSd: round(populationSd(controlValues)),
      challengerSd: round(populationSd(challengerValues)),
      maxAbsoluteRating: round(Math.max(...challengerValues.map(Math.abs))),
    }),
    topPositive: Object.freeze(byDelta.slice(0, 15)),
    topNegative: Object.freeze(byDelta.slice(-15).reverse()),
    lowestUncertainty: Object.freeze(byUncertainty.slice(0, 15)),
    highestUncertainty: Object.freeze(byUncertainty.slice(-15).reverse()),
    largestRankRises: Object.freeze([...withRanks].sort((left, right) => right.rankMovement - left.rankMovement).slice(0, 15)),
    largestRankFalls: Object.freeze([...withRanks].sort((left, right) => left.rankMovement - right.rankMovement).slice(0, 15)),
  });
}

module.exports = {
  MODEL_VERSION,
  TARGET_SEASON,
  MEAN_ARCHITECTURE,
  UNCERTAINTY_ARCHITECTURE,
  buildCfbPreseasonChallenger,
  compareCfbPreseasonChallenger,
  _internal: {
    normalizeSnapshot,
    normalizeControls,
    returningValue,
    talentValue,
    recruitingDiagnostic,
    quantile,
    correlation,
    residualize,
    standardizeMap,
  },
};
