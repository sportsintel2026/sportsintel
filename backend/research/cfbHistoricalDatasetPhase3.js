"use strict";

// Offline-only CFB Phase 3 dataset. Previous-season score data build separate
// offense/defense priors; target-season outcomes are retained only for chronological
// validation and never enter a target-season preseason feature.

const fs = require("fs");
const path = require("path");
const phase1 = require("./cfbHistoricalDataset");
const { fitOffenseDefense } = require("../services/cfbOffenseDefense");

const DATASET_VERSION = "cfb-historical-od-dataset-phase3-v1-2026-08-31";
const INPUT_VERSION = "cfb-historical-phase3-input-v1-2026-08-31";
const INPUT_PATH = path.join(__dirname, "data", "cfb-historical-phase3-input-v1.json");
const TARGET_SEASONS = Object.freeze([2021, 2022, 2023, 2024, 2025]);
const OD_CONFIG = Object.freeze({
  priorPseudoGames: 4,
  minimumGames: 4,
  iterations: 30,
  homeFieldPoints: 3,
  fbsVsFbsOnly: true,
});

const {
  finite,
  round,
  clamp,
  mean,
  keyedZ,
  keyedWinsorizedZ,
  residualize,
  standardizeMap,
  canonicalHash,
} = phase1._internal;

function loadPhase3Input(filePath = INPUT_PATH) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.version !== INPUT_VERSION) throw new Error(`unexpected Phase 3 input ${parsed.version}`);
  const { contentSha256, ...body } = parsed;
  if (canonicalHash(body) !== contentSha256) throw new Error("Phase 3 input hash mismatch");
  if (parsed.providerBudget?.phase3NewCfbdCalls > parsed.providerBudget?.phase3MaximumAllowed
      || parsed.providerBudget?.phase3NewCfbdCalls > 60) {
    throw new Error("Phase 3 CFBD call cap exceeded");
  }
  if (parsed.targetSeasons.some((season) => season >= 2026)
      || parsed.rows.some((row) => finite(row.season) >= 2026)) {
    throw new Error("2026 outcomes/features are forbidden in historical Phase 3 input");
  }
  return parsed;
}

function completedFbsGames(scheduleRows, season) {
  return scheduleRows.filter((row) => (
    finite(row.season) === season
    && row.seasonType === "regular"
    && row.home?.division === "fbs"
    && row.away?.division === "fbs"
    && finite(row.home?.points) != null
    && finite(row.away?.points) != null
  ));
}

function buildOpponentAdjustedOffenseDefense(scheduleRows, season, config = OD_CONFIG) {
  const sourceGames = completedFbsGames(scheduleRows, season);
  const fitted = fitOffenseDefense(sourceGames.map((game) => ({
    gameId: String(game.gameId),
    homeId: String(game.home.id),
    awayId: String(game.away.id),
    homeName: game.home.name || null,
    awayName: game.away.name || null,
    homePoints: finite(game.home.points),
    awayPoints: finite(game.away.points),
    neutralSite: game.neutralSite === true,
  })), config);
  const teams = new Map([...fitted.teams].map(([teamId, team]) => [teamId, Object.freeze({
    ...team,
    sourceSeason: season,
  })]));
  return Object.freeze({
    season,
    sourceGameCount: sourceGames.length,
    leagueMeanPoints: fitted.leagueMeanPoints,
    ratedTeams: teams.size,
    config,
    teams,
  });
}

function targetFbsIds(scheduleRows, season) {
  const ids = new Set();
  for (const row of scheduleRows.filter((game) => finite(game.season) === season)) {
    if (row.home?.division === "fbs" && row.home?.id) ids.add(String(row.home.id));
    if (row.away?.division === "fbs" && row.away?.id) ids.add(String(row.away.id));
  }
  return ids;
}

function phase3ReturningIndex(rows, season) {
  const index = new Map();
  for (const row of rows.filter((item) => finite(item.season) === season)) {
    const teamId = String(row.espnTeamId || "");
    if (!teamId || index.has(teamId)) throw new Error(`invalid/duplicate Phase 3 returning identity ${season}:${teamId}`);
    index.set(teamId, row);
  }
  return index;
}

function talentIndex(rows, season) {
  const index = new Map();
  for (const row of rows.filter((item) => finite(item.season) === season)) {
    const teamId = String(row.teamId || "");
    if (!teamId || index.has(teamId)) throw new Error(`invalid/duplicate talent identity ${season}:${teamId}`);
    index.set(teamId, row);
  }
  return index;
}

function transformSeasonTeams({ season, expectedTeamIds, prior, returningIndex, talentIndex }) {
  const teams = [...expectedTeamIds].sort((left, right) => Number(left) - Number(right)).map((teamId) => {
    const priorRow = prior.teams.get(teamId) || null;
    const returning = returningIndex.get(teamId) || null;
    const talent = talentIndex.get(teamId) || null;
    return {
      teamId,
      teamName: priorRow?.teamName || returning?.espnTeamName || talent?.team || null,
      priorSourceSeason: priorRow?.sourceSeason ?? null,
      priorOffenseRating: priorRow?.offenseRating ?? null,
      priorDefenseRating: priorRow?.defenseRating ?? null,
      priorCompositeRating: priorRow?.compositeRating ?? null,
      priorGames: priorRow?.games ?? null,
      offenseReturningProduction: finite(returning?.percentPPA),
      passingReturningProduction: finite(returning?.percentPassingPPA),
      rushingReturningProduction: finite(returning?.percentRushingPPA),
      receivingReturningProduction: finite(returning?.percentReceivingPPA),
      defenseReturningProduction: null,
      talent: finite(talent?.talentComposite),
      offenseReturningResidualZ: null,
      talentResidualZ: null,
    };
  });
  const eligible = teams.filter((row) => row.priorCompositeRating != null);
  const priorOffenseZ = keyedZ(eligible, (row) => row.priorOffenseRating);
  const priorCompositeZ = keyedZ(eligible, (row) => row.priorCompositeRating);
  const returning = keyedWinsorizedZ(eligible, (row) => row.offenseReturningProduction);
  const talent = keyedWinsorizedZ(eligible, (row) => row.talent);
  const returningResidual = standardizeMap(residualize(returning.values, priorOffenseZ));
  const talentVsPrior = residualize(talent.values, priorCompositeZ);
  const talentResidual = standardizeMap(residualize(talentVsPrior, returningResidual));
  for (const team of teams) {
    team.offenseReturningResidualZ = returningResidual.has(team.teamId)
      ? clamp(returningResidual.get(team.teamId), -2, 2) : null;
    team.talentResidualZ = talentResidual.has(team.teamId)
      ? clamp(talentResidual.get(team.teamId), -2, 2) : null;
    Object.freeze(team);
  }
  return Object.freeze({
    teams: new Map(teams.map((team) => [team.teamId, team])),
    featureDiagnostics: Object.freeze({
      offenseReturningCount: returning.count,
      offenseReturningWinsorLower: round(returning.lower),
      offenseReturningWinsorUpper: round(returning.upper),
      passingReturningCount: eligible.filter((row) => row.passingReturningProduction != null).length,
      rushingReturningCount: eligible.filter((row) => row.rushingReturningProduction != null).length,
      receivingReturningCount: eligible.filter((row) => row.receivingReturningProduction != null).length,
      defenseReturningCount: 0,
      talentCount: talent.count,
      talentWinsorLower: round(talent.lower),
      talentWinsorUpper: round(talent.upper),
    }),
  });
}

function buildHistoricalDatasetPhase3(
  baseInput = phase1.loadInputSnapshot(),
  phase3Input = loadPhase3Input(),
) {
  const seasons = [];
  for (const season of TARGET_SEASONS) {
    const prior = buildOpponentAdjustedOffenseDefense(baseInput.schedules || [], season - 1);
    const ids = targetFbsIds(baseInput.schedules || [], season);
    const returningIndex = phase3ReturningIndex(phase3Input.rows || [], season);
    const seasonTalentIndex = talentIndex(baseInput.talent || [], season);
    const transformed = transformSeasonTeams({
      season, expectedTeamIds: ids, prior, returningIndex, talentIndex: seasonTalentIndex,
    });
    const games = [];
    const excluded = [];
    for (const row of completedFbsGames(baseInput.schedules || [], season)) {
      const home = transformed.teams.get(String(row.home.id));
      const away = transformed.teams.get(String(row.away.id));
      if (home?.priorOffenseRating == null || home?.priorDefenseRating == null
          || away?.priorOffenseRating == null || away?.priorDefenseRating == null) {
        excluded.push(Object.freeze({ gameId: String(row.gameId), reason: "missing-prior-offense-defense" }));
        continue;
      }
      const startMs = Date.parse(row.startDate);
      if (!Number.isFinite(startMs)) {
        excluded.push(Object.freeze({ gameId: String(row.gameId), reason: "invalid-start-date" }));
        continue;
      }
      games.push(Object.freeze({
        gameId: String(row.gameId),
        season,
        week: finite(row.week),
        startDate: new Date(startMs).toISOString(),
        neutralSite: row.neutralSite === true,
        homeId: String(row.home.id),
        homeName: row.home.name,
        homePoints: finite(row.home.points),
        awayId: String(row.away.id),
        awayName: row.away.name,
        awayPoints: finite(row.away.points),
        actualHomeMargin: finite(row.home.points) - finite(row.away.points),
      }));
    }
    games.sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate)
      || left.gameId.localeCompare(right.gameId));
    const teamRows = [...transformed.teams.values()];
    seasons.push(Object.freeze({
      season,
      priorSeason: season - 1,
      prior,
      teams: transformed.teams,
      games: Object.freeze(games),
      excludedGames: Object.freeze(excluded),
      featureDiagnostics: transformed.featureDiagnostics,
      coverage: Object.freeze({
        expectedFbsTeams: ids.size,
        teamsWithPriorOffenseDefense: teamRows.filter((row) => row.priorOffenseRating != null
          && row.priorDefenseRating != null).length,
        teamsWithOffenseReturningProduction: teamRows.filter((row) => row.offenseReturningProduction != null).length,
        teamsWithDefenseReturningProduction: 0,
        teamsWithTalent: teamRows.filter((row) => row.talent != null).length,
        finalEvaluatedGames: games.length,
        excludedGames: excluded.length,
      }),
    }));
  }
  return Object.freeze({
    version: DATASET_VERSION,
    baseInputVersion: baseInput.version,
    baseInputContentSha256: baseInput.contentSha256,
    phase3InputVersion: phase3Input.version,
    phase3InputContentSha256: phase3Input.contentSha256,
    targetSeasons: Object.freeze([...TARGET_SEASONS]),
    outcomeSeasons: Object.freeze(seasons.map((row) => row.season)),
    providerBudget: phase3Input.providerBudget,
    odConfig: OD_CONFIG,
    sourceNotes: Object.freeze({
      offenseDefensePrior: "Previous-season-only FBS-vs-FBS final scores, opponent-adjusted by deterministic ridge-style alternating updates.",
      offenseReturningProduction: "Exact target-season preseason CFBD percentPPA; passing/rushing/receiving components retained for audit.",
      defenseReturningProduction: "Unavailable from CFBD /player/returning; no defensive value is fabricated.",
      qb: phase3Input.qbAudit.reason,
      transfers: phase3Input.transferAudit.reason,
      talent: baseInput.sourceNotes.talent,
      targetOutcomes: "Used only after each frozen historical prediction for validation and chronological updater evidence.",
    }),
    seasons: Object.freeze(seasons),
  });
}

module.exports = {
  DATASET_VERSION,
  INPUT_VERSION,
  INPUT_PATH,
  TARGET_SEASONS,
  OD_CONFIG,
  loadPhase3Input,
  completedFbsGames,
  buildOpponentAdjustedOffenseDefense,
  targetFbsIds,
  phase3ReturningIndex,
  talentIndex,
  transformSeasonTeams,
  buildHistoricalDatasetPhase3,
  _internal: { finite, round, mean },
};
