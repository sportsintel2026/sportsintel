"use strict";

// Offline-only, semantic-matched historical dataset for CFB calibration Phase 2.
// It reuses the frozen Phase 1 schedule/talent snapshot and math, replacing only
// the returning-production proxy with exact historical CFBD percentPPA rows.

const fs = require("fs");
const path = require("path");
const { teamKey } = require("../services/teamKey");
const phase1 = require("./cfbHistoricalDataset");

const DATASET_VERSION = "cfb-historical-preseason-dataset-phase2-v1-2026-08-31";
const SEMANTIC_INPUT_VERSION = "cfb-historical-percentppa-semantic-input-v1-2026-08-31";
const SEMANTIC_INPUT_PATH = path.join(
  __dirname,
  "data",
  "cfb-historical-percentppa-semantic-input-v1.json",
);
const TARGET_SEASONS = Object.freeze([2021, 2022, 2023, 2024, 2025]);
const HISTORICAL_UNCERTAINTY = Object.freeze({
  available: false,
  sd: 0,
  exactHistoricalV1Reconstruction: false,
  reason: "Historical transfer/QB/coaching/roster snapshots do not exist at prediction-time fidelity; uncertainty is fixed off for historical comparison.",
});

const {
  finite,
  clamp,
  keyedZ,
  keyedWinsorizedZ,
  residualize,
  standardizeMap,
  canonicalHash,
  uniqueIndex,
} = phase1._internal;

function exactCfbNameKey(value) {
  return teamKey(value, "cfb");
}

function loadSemanticInput(filePath = SEMANTIC_INPUT_PATH) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.version !== SEMANTIC_INPUT_VERSION) {
    throw new Error(`unexpected semantic input version ${parsed.version}`);
  }
  const { contentSha256, ...body } = parsed;
  if (canonicalHash(body) !== contentSha256) throw new Error("semantic input hash mismatch");
  if (parsed.providerBudget?.cfbdApiCallsAttempted > parsed.providerBudget?.maximumAllowed
      || parsed.providerBudget?.cfbdApiCallsAttempted > 40) {
    throw new Error("historical CFBD call cap exceeded");
  }
  if (parsed.targetSeasons.some((season) => season >= 2026)
      || parsed.rows.some((row) => finite(row.season) >= 2026)) {
    throw new Error("2026 or future rows are forbidden in the semantic input");
  }
  if (parsed.rows.some((row) => finite(row.percentPPA) == null)) {
    throw new Error("semantic input contains missing percentPPA");
  }
  return parsed;
}

function scheduleIdentityIndex(schedules, season) {
  const byId = new Map();
  const byKey = new Map();
  for (const game of schedules.filter((row) => finite(row.season) === season)) {
    for (const side of [game.home, game.away]) {
      if (side?.division !== "fbs" || !side.id || !side.name) continue;
      const id = String(side.id);
      const key = exactCfbNameKey(side.name);
      if (!byId.has(id)) byId.set(id, new Set());
      byId.get(id).add(key);
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key).add(id);
    }
  }
  return Object.freeze({ byId, byKey });
}

function semanticIndex(rows, schedules, season) {
  const identity = scheduleIdentityIndex(schedules, season);
  const index = new Map();
  const seasonRows = rows.filter((row) => finite(row.season) === season);
  for (const row of seasonRows) {
    const teamId = String(row.espnTeamId || "");
    const espnKey = exactCfbNameKey(row.espnTeamName);
    const cfbdKey = exactCfbNameKey(row.cfbdTeamName);
    if (!teamId || !identity.byId.has(teamId)) {
      throw new Error(`season ${season} semantic row has unknown ESPN identity ${teamId}`);
    }
    if (espnKey !== cfbdKey || !identity.byId.get(teamId).has(espnKey)
        || identity.byKey.get(espnKey)?.size !== 1) {
      throw new Error(`season ${season} semantic identity is not unique/exact for ${row.cfbdTeamName}`);
    }
    if (index.has(teamId)) throw new Error(`season ${season} duplicate semantic ESPN identity ${teamId}`);
    index.set(teamId, row);
  }
  return Object.freeze({ index, identity, sourceRows: seasonRows.length });
}

function transformSeasonTeams({ season, expectedTeamIds, prior, semantic, talentIndex }) {
  const teams = [...expectedTeamIds].sort((left, right) => Number(left) - Number(right)).map((teamId) => {
    const priorRow = prior.teams.get(teamId) || null;
    const returningRow = semantic.index.get(teamId) || null;
    const talentRow = talentIndex.get(teamId) || null;
    return {
      teamId,
      teamName: priorRow?.teamName || returningRow?.espnTeamName || talentRow?.team || null,
      priorRating: priorRow?.priorRating ?? null,
      priorSourceSeason: priorRow?.sourceSeason ?? null,
      returningProduction: finite(returningRow?.percentPPA),
      returningProductionSource: returningRow ? "cfbd-percentPPA" : null,
      returningProductionTargetSeason: returningRow ? season : null,
      talent: finite(talentRow?.talentComposite),
      uncertainty: HISTORICAL_UNCERTAINTY,
      returningResidualZ: null,
      talentResidualZ: null,
    };
  });
  const eligible = teams.filter((row) => row.priorRating != null);
  const priorZ = keyedZ(eligible, (row) => row.priorRating);
  const returning = keyedWinsorizedZ(eligible, (row) => row.returningProduction);
  const talent = keyedWinsorizedZ(eligible, (row) => row.talent);
  const returningResidual = standardizeMap(residualize(returning.values, priorZ));
  const talentVsPrior = residualize(talent.values, priorZ);
  const talentResidual = standardizeMap(residualize(talentVsPrior, returningResidual));
  for (const team of teams) {
    team.returningResidualZ = returningResidual.has(team.teamId)
      ? clamp(returningResidual.get(team.teamId), -phase1.FEATURE_CONFIG.residualClipSd, phase1.FEATURE_CONFIG.residualClipSd)
      : null;
    team.talentResidualZ = talentResidual.has(team.teamId)
      ? clamp(talentResidual.get(team.teamId), -phase1.FEATURE_CONFIG.residualClipSd, phase1.FEATURE_CONFIG.residualClipSd)
      : null;
    Object.freeze(team);
  }
  return Object.freeze({
    teams: new Map(teams.map((team) => [team.teamId, team])),
    featureDiagnostics: Object.freeze({
      returningCount: returning.count,
      returningWinsorLower: phase1._internal.round(returning.lower),
      returningWinsorUpper: phase1._internal.round(returning.upper),
      talentCount: talent.count,
      talentWinsorLower: phase1._internal.round(talent.lower),
      talentWinsorUpper: phase1._internal.round(talent.upper),
    }),
  });
}

function buildHistoricalDatasetPhase2(
  phase1Input = phase1.loadInputSnapshot(),
  semanticInput = loadSemanticInput(),
) {
  const seasons = [];
  for (const season of TARGET_SEASONS) {
    const prior = phase1.buildHistoricalSrs(phase1Input.schedules || [], season - 1);
    const targetRows = (phase1Input.schedules || []).filter((row) => (
      finite(row.season) === season && row.seasonType === "regular"
    ));
    const targetFbsIds = new Set();
    for (const row of targetRows) {
      if (row.home?.division === "fbs" && row.home?.id) targetFbsIds.add(String(row.home.id));
      if (row.away?.division === "fbs" && row.away?.id) targetFbsIds.add(String(row.away.id));
    }
    const semantic = semanticIndex(semanticInput.rows, phase1Input.schedules || [], season);
    const talentIndex = uniqueIndex(phase1Input.talent || [], season, "talent");
    const transformed = transformSeasonTeams({
      season,
      expectedTeamIds: targetFbsIds,
      prior,
      semantic,
      talentIndex,
    });
    const games = [];
    const excluded = [];
    for (const row of targetRows.filter((game) => (
      game.home?.division === "fbs" && game.away?.division === "fbs"
    ))) {
      const home = transformed.teams.get(String(row.home.id));
      const away = transformed.teams.get(String(row.away.id));
      if (home?.priorRating == null || away?.priorRating == null) {
        excluded.push(Object.freeze({
          gameId: String(row.gameId),
          reason: "missing-prior-rating",
          homeId: String(row.home.id),
          awayId: String(row.away.id),
        }));
        continue;
      }
      games.push(Object.freeze({
        gameId: String(row.gameId),
        season,
        week: finite(row.week),
        startDate: row.startDate,
        neutralSite: row.neutralSite === true,
        homeId: String(row.home.id),
        homeName: row.home.name,
        awayId: String(row.away.id),
        awayName: row.away.name,
        actualHomeMargin: finite(row.home.points) - finite(row.away.points),
      }));
    }
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
        expectedFbsTeams: targetFbsIds.size,
        exactSemanticSourceRows: semantic.sourceRows,
        exactSemanticIdentityMatches: semantic.sourceRows,
        identityFailures: 0,
        teamsWithPriorRating: teamRows.filter((row) => row.priorRating != null).length,
        teamsWithPercentPPA: teamRows.filter((row) => row.returningProduction != null).length,
        teamsWithTalent: teamRows.filter((row) => row.talent != null).length,
        gamesExcluded: excluded.length,
        finalEvaluatedGames: games.length,
      }),
    }));
  }
  return Object.freeze({
    version: DATASET_VERSION,
    phase1InputVersion: phase1Input.version,
    phase1InputContentSha256: phase1Input.contentSha256,
    semanticInputVersion: semanticInput.version,
    semanticInputContentSha256: semanticInput.contentSha256,
    targetSeasons: Object.freeze([...TARGET_SEASONS]),
    outcomeSeasons: Object.freeze(seasons.map((row) => row.season)),
    sourceNotes: Object.freeze({
      prior: "Frozen prior-season-only WizePicks SRS reconstructed from Y-1 completed schedules.",
      returningProduction: "Exact target-season preseason CFBD /player/returning percentPPA, joined to durable ESPN team identity by a unique exact normalized full-name key.",
      talent: phase1Input.sourceNotes.talent,
      uncertainty: HISTORICAL_UNCERTAINTY.reason,
      market: phase1Input.sourceNotes.market,
    }),
    providerBudget: semanticInput.providerBudget,
    srsConfig: phase1.SRS_CONFIG,
    featureConfig: phase1.FEATURE_CONFIG,
    uncertainty: HISTORICAL_UNCERTAINTY,
    seasons: Object.freeze(seasons),
  });
}

module.exports = {
  DATASET_VERSION,
  SEMANTIC_INPUT_VERSION,
  SEMANTIC_INPUT_PATH,
  TARGET_SEASONS,
  HISTORICAL_UNCERTAINTY,
  loadSemanticInput,
  scheduleIdentityIndex,
  semanticIndex,
  transformSeasonTeams,
  buildHistoricalDatasetPhase2,
  _internal: { exactCfbNameKey },
};
