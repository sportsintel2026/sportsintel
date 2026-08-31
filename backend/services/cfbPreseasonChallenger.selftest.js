"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  MODEL_VERSION,
  buildCfbPreseasonChallenger,
  compareCfbPreseasonChallenger,
} = require("./cfbPreseasonChallenger");

const GENERATED_AT = "2026-08-30T20:00:00.000Z";

function snapshot(id, overrides = {}) {
  const returningValue = overrides.returningValue === undefined ? 0.5 : overrides.returningValue;
  const transferUnresolved = overrides.transferUnresolved === undefined ? 12 : overrides.transferUnresolved;
  return {
    id,
    season: 2026,
    contractVersion: "cfb-preseason-input-v1-2026-08-30",
    snapshotAt: "2026-08-30T19:00:00.000Z",
    inputHash: String(id).padStart(64, "a").slice(-64),
    team: { name: overrides.name || `Team ${id}`, espnTeamId: String(id), cfbdTeamId: id },
    quarterback: { category: overrides.qb || "unknown-unverified" },
    roster: {
      playerCount: overrides.playerCount ?? 110,
      durableIdCount: overrides.durableIdCount ?? (overrides.playerCount ?? 110),
      missingIdCount: 0,
      duplicateIdCount: 0,
    },
    returningProduction: returningValue == null
      ? { recordFound: false, values: { percentPPA: null } }
      : { recordFound: true, values: { percentPPA: returningValue } },
    transfers: {
      arrivals: Array.from({ length: transferUnresolved }, () => ({})),
      departures: [],
      ambiguousIdentityCount: 0,
      unmatchedIdentityCount: transferUnresolved,
      safelyJoinedCount: transferUnresolved ? 0 : 1,
    },
    talent: {
      teamTalent: overrides.talent == null ? null : { year: 2026, talent: overrides.talent },
      recruitingTeams: [{ year: 2026, rank: overrides.recruitRank ?? id, points: overrides.recruiting ?? 200 }],
    },
    coaching: {
      identityStatus: "exact",
      tenureYears: overrides.coachContinuity ? 2 : 1,
      continuity: overrides.coachContinuity === true,
    },
    quality: { completeness: overrides.completeness ?? 0.75 },
  };
}

function controls(ids = [1, 2, 3, 4, 5, 6]) {
  return Object.fromEntries(ids.map((id) => [String(id), {
    espnTeamId: String(id),
    teamName: `Team ${id}`,
    priorSeason: 2025,
    currentSeason: 2026,
    priorRating: (id - 3.5) * 2,
    currentRating: null,
    controlRating: (id - 3.5) * 2,
    currentGames: 0,
    ratingSource: "prior-only",
    sosApplied: true,
  }]));
}

function build(rows) {
  return buildCfbPreseasonChallenger({ snapshots: rows, controlRatings: controls(rows.map((row) => row.team.espnTeamId)), generatedAt: GENERATED_AT });
}

const balanced = [
  snapshot(1, { returningValue: 0.15, talent: 500, coachContinuity: true }),
  snapshot(2, { returningValue: 0.30, talent: 600, coachContinuity: true }),
  snapshot(3, { returningValue: 0.45, talent: 700, coachContinuity: true }),
  snapshot(4, { returningValue: 0.60, talent: 800, coachContinuity: true }),
  snapshot(5, { returningValue: 0.75, talent: 900, coachContinuity: true }),
  snapshot(6, { returningValue: 0.90, talent: 1000, coachContinuity: true }),
];

const first = build(balanced);
const second = build(balanced);
assert.deepStrictEqual(first, second, "same snapshots, control, and generation time must be deterministic");
assert.strictEqual(first.modelVersion, MODEL_VERSION);
assert.strictEqual(first.diagnostics.targetSeasonResultsUsed, false);
assert.deepStrictEqual(first.diagnostics.historicalFittingDataUsed, []);
assert.ok(first.teams.every((team) => team.control.currentRating === null));

const withInsufficient = buildCfbPreseasonChallenger({
  snapshots: [...balanced, snapshot(7, { returningValue: null, talent: 650 })],
  controlRatings: controls(),
  generatedAt: GENERATED_AT,
});
const insufficientTeam = withInsufficient.teams.find((team) => team.team.espnTeamId === "7");
assert.strictEqual(insufficientTeam.status, "insufficient");
assert.strictEqual(insufficientTeam.challengerRating, null);
assert.strictEqual(insufficientTeam.control.priorRating, null);

// Unknown QB and unresolved transfers never alter the mean; they widen uncertainty.
const resolved = build(balanced.map((row, index) => index === 2
  ? snapshot(3, { returningValue: 0.45, talent: 700, qb: "returning-established-starter", transferUnresolved: 0, coachContinuity: true })
  : row));
const unknownTeam = first.teams.find((team) => team.team.espnTeamId === "3");
const resolvedTeam = resolved.teams.find((team) => team.team.espnTeamId === "3");
assert.strictEqual(unknownTeam.challengerRating, resolvedTeam.challengerRating);
assert.ok(unknownTeam.uncertainty.sd > resolvedTeam.uncertainty.sd);
assert.strictEqual(unknownTeam.features.quarterback.meanAdjustment, 0);
assert.strictEqual(unknownTeam.features.transfers.meanAdjustment, 0);

// Missing is explicit, not coerced to zero, and increases uncertainty.
const missingRows = balanced.map((row, index) => index === 2
  ? snapshot(3, { returningValue: null, talent: null, coachContinuity: true })
  : row);
const missingRun = build(missingRows);
const missingTeam = missingRun.teams.find((team) => team.team.espnTeamId === "3");
assert.strictEqual(missingTeam.features.returningProduction.percentPPA, null);
assert.strictEqual(missingTeam.features.talentRecruitingComposite.teamTalent, null);
assert.strictEqual(missingTeam.features.returningProduction.meanAdjustment, 0);
assert.strictEqual(missingTeam.features.talentRecruitingComposite.meanAdjustment, 0);
assert.strictEqual(missingTeam.missingFlags.returningProduction, true);
assert.strictEqual(missingTeam.missingFlags.talent, true);
assert.ok(missingTeam.uncertainty.sd > unknownTeam.uncertainty.sd);

// Recruiting is diagnostic only: changing it cannot change a rating.
const recruitingA = build(balanced.map((row, index) => index === 3
  ? snapshot(4, { returningValue: 0.60, talent: 800, recruiting: 50, coachContinuity: true })
  : row));
const recruitingB = build(balanced.map((row, index) => index === 3
  ? snapshot(4, { returningValue: 0.60, talent: 800, recruiting: 500, coachContinuity: true })
  : row));
assert.strictEqual(
  recruitingA.teams.find((team) => team.team.espnTeamId === "4").challengerRating,
  recruitingB.teams.find((team) => team.team.espnTeamId === "4").challengerRating,
);
assert.strictEqual(first.teams[0].features.talentRecruitingComposite.recruitingUsedNumerically, false);

// Meaningful returning/talent changes move the challenger, but clipping bounds extremes.
const changed = build(balanced.map((row, index) => index === 2
  ? snapshot(3, { returningValue: 0.95, talent: 980, coachContinuity: true })
  : row));
assert.notStrictEqual(
  changed.teams.find((team) => team.team.espnTeamId === "3").challengerRating,
  first.teams.find((team) => team.team.espnTeamId === "3").challengerRating,
);
const extreme = build([
  snapshot(1, { returningValue: -99, talent: -999, coachContinuity: true }),
  snapshot(2, { returningValue: 0.2, talent: 500, coachContinuity: true }),
  snapshot(3, { returningValue: 0.4, talent: 600, coachContinuity: true }),
  snapshot(4, { returningValue: 0.6, talent: 700, coachContinuity: true }),
  snapshot(5, { returningValue: 0.8, talent: 800, coachContinuity: true }),
  snapshot(6, { returningValue: 99, talent: 9999, coachContinuity: true }),
]);
assert.ok(extreme.teams.every((team) => Math.abs(team.deltaVsControl) <= 2.5));

// Stable returning production helps; talent can temper rebuilding or overperforming priors.
const signals = build([
  snapshot(1, { returningValue: 0.95, talent: 500, coachContinuity: true }),
  snapshot(2, { returningValue: 0.20, talent: 980, coachContinuity: true }),
  snapshot(3, { returningValue: 0.40, talent: 400, coachContinuity: true }),
  snapshot(4, { returningValue: 0.50, talent: 700, coachContinuity: true }),
  snapshot(5, { returningValue: 0.60, talent: 800, coachContinuity: true }),
  snapshot(6, { returningValue: 0.70, talent: 900, coachContinuity: true }),
]);
assert.ok(signals.teams.find((team) => team.team.espnTeamId === "1").features.returningProduction.meanAdjustment > 0);
assert.ok(signals.teams.find((team) => team.team.espnTeamId === "2").features.talentRecruitingComposite.meanAdjustment > 0);
assert.ok(signals.teams.find((team) => team.team.espnTeamId === "3").features.talentRecruitingComposite.meanAdjustment < 0);

// A coaching transition/unknown state affects only uncertainty.
const coachingKnown = build(balanced);
const coachingUnknown = build(balanced.map((row, index) => index === 4
  ? snapshot(5, { returningValue: 0.75, talent: 900, coachContinuity: false })
  : row));
const knownCoachTeam = coachingKnown.teams.find((team) => team.team.espnTeamId === "5");
const unknownCoachTeam = coachingUnknown.teams.find((team) => team.team.espnTeamId === "5");
assert.strictEqual(knownCoachTeam.challengerRating, unknownCoachTeam.challengerRating);
assert.ok(unknownCoachTeam.uncertainty.sd > knownCoachTeam.uncertainty.sd);

const comparison = compareCfbPreseasonChallenger(first);
assert.strictEqual(comparison.sample, 6);
assert.ok(comparison.correlation > 0.9);
assert.strictEqual(comparison.topPositive.length, 6);

// Static isolation guardrails: no active runtime imports this shadow module, and the
// shadow module itself has no provider/database/ledger write surface.
const serviceSource = fs.readFileSync(path.join(__dirname, "cfbPreseasonChallenger.js"), "utf8");
for (const forbidden of [
  /createClient\s*\(/,
  /\.from\s*\(/,
  /\bfetch\s*\(/,
  /model_predictions/,
  /cfb_game_input_snapshots/,
  /getCFBMainOdds/,
  /recordCFBPredictions/,
]) {
  assert.ok(!forbidden.test(serviceSource), `shadow module contains forbidden runtime surface ${forbidden}`);
}
for (const relative of [
  "../server.js",
  "cfbModel.js",
  "cfbEdges.js",
  "predictionTracker.js",
  "../routes/edges.js",
]) {
  const source = fs.readFileSync(path.join(__dirname, relative), "utf8");
  assert.ok(!source.includes("cfbPreseasonChallenger"), `${relative} must not import the challenger`);
}

console.log("cfbPreseasonChallenger self-test passed");
