"use strict";

// Offline-only historical dataset builder for the CFB calibration lab. Nothing in
// server.js, routes, schedulers, customer models, or prediction recording imports
// this module. It reads one committed, normalized pre-2026 research snapshot.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATASET_VERSION = "cfb-historical-preseason-dataset-v1-2026-08-31";
const INPUT_VERSION = "cfb-historical-preseason-input-v1-2026-08-31";
const TARGET_SEASONS = Object.freeze([2021, 2022, 2023, 2024, 2025]);
const INPUT_PATH = path.join(__dirname, "data", "cfb-historical-preseason-input-v1.json");

// Exact production methodology frozen from cfbDataSource.buildTeamRatings at the
// approved baseline. The research implementation is separate so the live module
// remains untouched and provider-free.
const SRS_CONFIG = Object.freeze({
  regression: 0.72,
  minimumGames: 4,
  marginCap: 28,
  iterations: 12,
  fcsLevel: -28,
  sosWeight: 0.8,
});

const FEATURE_CONFIG = Object.freeze({
  winsorLower: 0.05,
  winsorUpper: 0.95,
  residualClipSd: 2,
});

// Historical assets do not contain the immutable transfer/QB/coaching/roster
// snapshot that exists for 2026. This availability-only proxy preserves only
// components that can be represented honestly. It is diagnostic and is never fit.
const UNCERTAINTY_PROXY = Object.freeze({
  baseTeamSd: 3,
  qbUnknownSd: 1.5,
  coachingUnknownSd: 0.75,
  rosterUnavailableSd: 1,
  missingReturningProductionSd: 1.25,
  missingTalentSd: 1,
  transferIdentitySd: null,
  exactHistoricalV1Reconstruction: false,
});

function finite(value) {
  if (value === null || value === undefined || typeof value === "boolean"
      || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 8) {
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

function keyedZ(rows, accessor) {
  const pairs = rows.map((row) => [row.teamId, accessor(row)])
    .filter(([, value]) => Number.isFinite(value));
  const center = mean(pairs.map(([, value]) => value));
  const sd = populationSd(pairs.map(([, value]) => value));
  return new Map(pairs.map(([key, value]) => [key, sd > 0 ? (value - center) / sd : 0]));
}

function keyedWinsorizedZ(rows, accessor) {
  const pairs = rows.map((row) => [row.teamId, accessor(row)])
    .filter(([, value]) => Number.isFinite(value));
  const values = pairs.map(([, value]) => value);
  const lower = quantile(values, FEATURE_CONFIG.winsorLower);
  const upper = quantile(values, FEATURE_CONFIG.winsorUpper);
  const winsorized = pairs.map(([key, value]) => [key, clamp(value, lower, upper)]);
  const center = mean(winsorized.map(([, value]) => value));
  const sd = populationSd(winsorized.map(([, value]) => value));
  return Object.freeze({
    values: new Map(winsorized.map(([key, value]) => [key, sd > 0 ? (value - center) / sd : 0])),
    lower,
    upper,
    center,
    sd,
    count: pairs.length,
  });
}

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

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function loadInputSnapshot(filePath = INPUT_PATH) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.version !== INPUT_VERSION) throw new Error(`unexpected input version ${parsed.version}`);
  const { contentSha256, ...body } = parsed;
  if (canonicalHash(body) !== contentSha256) throw new Error("historical input snapshot hash mismatch");
  const seasons = new Set([
    ...(parsed.schedules || []).map((row) => finite(row.season)),
    ...(parsed.returningProduction || []).map((row) => finite(row.season)),
    ...(parsed.talent || []).map((row) => finite(row.season)),
  ]);
  if (seasons.has(2026) || [...seasons].some((season) => season > 2025)) {
    throw new Error("2026 or future rows are forbidden in the historical input snapshot");
  }
  if (finite(parsed.providerBudget?.cfbdApiCalls) !== 0
      || finite(parsed.providerBudget?.oddsApiCalls) !== 0
      || finite(parsed.providerBudget?.pinnacleCalls) !== 0
      || finite(parsed.providerBudget?.espnApiCalls) !== 0) {
    throw new Error("historical snapshot violates the zero-provider-call manifest");
  }
  return parsed;
}

function uniqueIndex(rows, season, label) {
  const index = new Map();
  const duplicates = [];
  for (const row of rows.filter((item) => finite(item.season) === season)) {
    const teamId = String(row.teamId || "");
    if (!teamId) continue;
    if (index.has(teamId)) duplicates.push(teamId);
    else index.set(teamId, row);
  }
  if (duplicates.length) {
    throw new Error(`${label} season ${season} contains duplicate team identities: ${[...new Set(duplicates)].join(",")}`);
  }
  return index;
}

function buildHistoricalSrs(scheduleRows, season) {
  const rows = scheduleRows.filter((row) => finite(row.season) === season && row.seasonType === "regular");
  const fbsIds = new Set();
  const names = new Map();
  for (const row of rows) {
    for (const side of [row.home, row.away]) {
      if (side?.division === "fbs" && side.id) {
        fbsIds.add(String(side.id));
        names.set(String(side.id), side.name || null);
      }
    }
  }

  const raw = new Map([...fbsIds].map((teamId) => [teamId, {
    teamId, teamName: names.get(teamId), games: 0, pointsFor: 0, pointsAgainst: 0, schedule: [],
  }]));
  for (const row of rows) {
    const homeId = String(row.home?.id || "");
    const awayId = String(row.away?.id || "");
    const homePoints = finite(row.home?.points);
    const awayPoints = finite(row.away?.points);
    if (homePoints == null || awayPoints == null) continue;
    if (raw.has(homeId)) {
      const team = raw.get(homeId);
      team.games++;
      team.pointsFor += homePoints;
      team.pointsAgainst += awayPoints;
      team.schedule.push({ opponentId: awayId, margin: clamp(homePoints - awayPoints, -SRS_CONFIG.marginCap, SRS_CONFIG.marginCap) });
    }
    if (raw.has(awayId)) {
      const team = raw.get(awayId);
      team.games++;
      team.pointsFor += awayPoints;
      team.pointsAgainst += homePoints;
      team.schedule.push({ opponentId: homeId, margin: clamp(awayPoints - homePoints, -SRS_CONFIG.marginCap, SRS_CONFIG.marginCap) });
    }
  }

  const rated = new Map([...raw.entries()].filter(([, row]) => row.games >= SRS_CONFIG.minimumGames));
  const ratedIds = [...rated.keys()].sort((left, right) => Number(left) - Number(right));
  const movement = new Map(ratedIds.map((teamId) => {
    const games = rated.get(teamId).schedule;
    return [teamId, mean(games.map((game) => game.margin))];
  }));
  let srs = new Map(movement);
  for (let iteration = 0; iteration < SRS_CONFIG.iterations; iteration++) {
    const next = new Map();
    for (const teamId of ratedIds) {
      const games = rated.get(teamId).schedule;
      const opponentAverage = mean(games.map((game) => (
        srs.has(game.opponentId) ? srs.get(game.opponentId) : SRS_CONFIG.fcsLevel
      )));
      next.set(teamId, movement.get(teamId) + SRS_CONFIG.sosWeight * opponentAverage);
    }
    const center = mean([...next.values()]);
    srs = new Map([...next.entries()].map(([teamId, rating]) => [teamId, rating - center]));
  }

  const teams = new Map(ratedIds.map((teamId) => {
    const row = rated.get(teamId);
    return [teamId, Object.freeze({
      teamId,
      teamName: row.teamName,
      sourceSeason: season,
      games: row.games,
      priorRating: round(srs.get(teamId) * SRS_CONFIG.regression, 2),
      rawPointDifferentialPerGame: round((row.pointsFor - row.pointsAgainst) / row.games, 4),
      cappedMarginPerGame: round(movement.get(teamId), 4),
    })];
  }));
  return Object.freeze({
    season,
    expectedFbsTeams: fbsIds.size,
    ratedTeams: teams.size,
    excludedForMinimumGames: fbsIds.size - teams.size,
    teams,
  });
}

function uncertaintyFor(returningProduction, talent) {
  const components = {
    base: UNCERTAINTY_PROXY.baseTeamSd,
    qbUnknown: UNCERTAINTY_PROXY.qbUnknownSd,
    coachingUnknown: UNCERTAINTY_PROXY.coachingUnknownSd,
    rosterUnavailable: UNCERTAINTY_PROXY.rosterUnavailableSd,
    returningProduction: returningProduction == null ? UNCERTAINTY_PROXY.missingReturningProductionSd : 0,
    talent: talent == null ? UNCERTAINTY_PROXY.missingTalentSd : 0,
  };
  return Object.freeze({
    sd: Math.sqrt(Object.values(components).reduce((sum, value) => sum + value ** 2, 0)),
    components: Object.freeze(components),
    exactHistoricalV1Reconstruction: false,
  });
}

function transformSeasonTeams({ season, expectedTeamIds, prior, returningIndex, talentIndex }) {
  const teams = [...expectedTeamIds].sort((left, right) => Number(left) - Number(right)).map((teamId) => {
    const priorRow = prior.teams.get(teamId) || null;
    const returningRow = returningIndex.get(teamId) || null;
    const talentRow = talentIndex.get(teamId) || null;
    return {
      teamId,
      teamName: priorRow?.teamName || talentRow?.team || null,
      priorRating: priorRow?.priorRating ?? null,
      priorSourceSeason: priorRow?.sourceSeason ?? null,
      returningProduction: finite(returningRow?.overallReturning),
      returningProductionSource: returningRow ? "sportsdataverse-overall-returning-proxy" : null,
      talent: finite(talentRow?.talentComposite),
      uncertainty: null,
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
      ? clamp(returningResidual.get(team.teamId), -FEATURE_CONFIG.residualClipSd, FEATURE_CONFIG.residualClipSd) : null;
    team.talentResidualZ = talentResidual.has(team.teamId)
      ? clamp(talentResidual.get(team.teamId), -FEATURE_CONFIG.residualClipSd, FEATURE_CONFIG.residualClipSd) : null;
    team.uncertainty = uncertaintyFor(team.returningProduction, team.talent);
    Object.freeze(team);
  }
  return Object.freeze({
    season,
    teams: new Map(teams.map((team) => [team.teamId, team])),
    featureDiagnostics: Object.freeze({
      returningCount: returning.count,
      returningWinsorLower: round(returning.lower),
      returningWinsorUpper: round(returning.upper),
      talentCount: talent.count,
      talentWinsorLower: round(talent.lower),
      talentWinsorUpper: round(talent.upper),
    }),
  });
}

function buildHistoricalDataset(input = loadInputSnapshot()) {
  const seasons = [];
  for (const season of TARGET_SEASONS) {
    const prior = buildHistoricalSrs(input.schedules || [], season - 1);
    const targetRows = (input.schedules || []).filter((row) => finite(row.season) === season && row.seasonType === "regular");
    const targetFbsIds = new Set();
    for (const row of targetRows) {
      if (row.home?.division === "fbs" && row.home?.id) targetFbsIds.add(String(row.home.id));
      if (row.away?.division === "fbs" && row.away?.id) targetFbsIds.add(String(row.away.id));
    }
    const returningIndex = uniqueIndex(input.returningProduction || [], season, "returning production");
    const talentIndex = uniqueIndex(input.talent || [], season, "talent");
    const transformed = transformSeasonTeams({
      season,
      expectedTeamIds: targetFbsIds,
      prior,
      returningIndex,
      talentIndex,
    });
    const targetGames = targetRows.filter((row) => row.home?.division === "fbs" && row.away?.division === "fbs");
    const games = [];
    const excluded = [];
    for (const row of targetGames) {
      const home = transformed.teams.get(String(row.home.id));
      const away = transformed.teams.get(String(row.away.id));
      if (home?.priorRating == null || away?.priorRating == null) {
        excluded.push(Object.freeze({
          gameId: String(row.gameId),
          reason: "missing-prior-rating",
          homeId: String(row.home.id),
          awayId: String(row.away.id),
          homePriorAvailable: home?.priorRating != null,
          awayPriorAvailable: away?.priorRating != null,
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
        matchedTeams: transformed.teams.size,
        teamsWithPriorRating: teamRows.filter((row) => row.priorRating != null).length,
        teamsWithReturningProduction: teamRows.filter((row) => row.returningProduction != null).length,
        teamsWithTalent: teamRows.filter((row) => row.talent != null).length,
        gamesEligibleBeforePriorGate: targetGames.length,
        gamesExcluded: excluded.length,
        identityFailures: 0,
        missingPriorFailures: excluded.length,
        neutralGames: games.filter((game) => game.neutralSite).length,
        finalEvaluatedGames: games.length,
      }),
    }));
  }
  const result = {
    version: DATASET_VERSION,
    inputVersion: input.version,
    inputContentSha256: input.contentSha256,
    targetSeasons: [...TARGET_SEASONS],
    outcomeSeasons: seasons.map((row) => row.season),
    sourceNotes: input.sourceNotes,
    providerBudget: input.providerBudget,
    srsConfig: SRS_CONFIG,
    featureConfig: FEATURE_CONFIG,
    uncertaintyProxy: UNCERTAINTY_PROXY,
    seasons: Object.freeze(seasons),
  };
  return Object.freeze(result);
}

module.exports = {
  DATASET_VERSION,
  INPUT_VERSION,
  INPUT_PATH,
  TARGET_SEASONS,
  SRS_CONFIG,
  FEATURE_CONFIG,
  UNCERTAINTY_PROXY,
  loadInputSnapshot,
  buildHistoricalSrs,
  buildHistoricalDataset,
  _internal: {
    finite,
    round,
    clamp,
    mean,
    quantile,
    populationSd,
    keyedZ,
    keyedWinsorizedZ,
    residualize,
    standardizeMap,
    canonicalHash,
    uniqueIndex,
    uncertaintyFor,
    transformSeasonTeams,
  },
};
