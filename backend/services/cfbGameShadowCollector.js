"use strict";

// Production-reachable only from the existing hourly CFB measurement collector.
// This service has no provider imports: all market data arrives as arguments from
// the already-fetched US/Pinnacle payloads. It writes only immutable shadow tables.
const crypto = require("crypto");
const { teamKey } = require("./teamKey");
const CONTROL_2025 = require("./cfbPreseasonControl2025");
const {
  buildCfbPreseasonChallenger,
  MODEL_VERSION: TEAM_MODEL_VERSION,
  TARGET_SEASON,
} = require("./cfbPreseasonChallenger");
const {
  buildCfbGameShadowPrediction,
  MODEL_VERSION,
  EXPERIMENT_VERSION,
  ML_METHOD,
  SPREAD_METHOD,
} = require("./cfbGameShadowChallenger");
const {
  buildCfbPreseasonChallengerV2,
  MODEL_VERSION: TEAM_MODEL_VERSION_V2,
} = require("./cfbPreseasonChallengerV2");
const {
  buildCfbGameShadowPredictionV2,
  MODEL_VERSION: MODEL_VERSION_V2,
  EXPERIMENT_VERSION: EXPERIMENT_VERSION_V2,
  ML_METHOD: ML_METHOD_V2,
  SPREAD_METHOD: SPREAD_METHOD_V2,
} = require("./cfbGameShadowChallengerV2");
const {
  buildCfbPreseasonChallengerV3,
  MODEL_VERSION: TEAM_MODEL_VERSION_V3,
} = require("./cfbPreseasonChallengerV3");
const {
  buildCfbGameShadowPredictionV3,
  MODEL_VERSION: MODEL_VERSION_V3,
  EXPERIMENT_VERSION: EXPERIMENT_VERSION_V3,
  ML_METHOD: ML_METHOD_V3,
  SPREAD_METHOD: SPREAD_METHOD_V3,
} = require("./cfbGameShadowChallengerV3");
const {
  buildCfbContext,
  selectPreviousContexts,
  persistContexts,
} = require("./footballWeeklyContext");
const { collectFootballNewsForGames } = require("./footballNewsContext");

const TEAM_TABLE = "cfb_team_preseason_snapshots";
const INPUT_TABLE = "cfb_game_input_snapshots";
const OUTPUT_TABLE = "cfb_game_shadow_predictions";
const MARKET_SOURCE = "the-odds-api-us-best-price";
const PROTOCOL_WEEK_ZERO_UTC = Object.freeze({ 2026: Date.UTC(2026, 7, 27) });
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const V1_LANE = Object.freeze({
  modelVersion: MODEL_VERSION,
  teamModelVersion: TEAM_MODEL_VERSION,
  experimentVersion: EXPERIMENT_VERSION,
  mlMethod: ML_METHOD,
  spreadMethod: SPREAD_METHOD,
  buildPrediction: buildCfbGameShadowPrediction,
});
const V2_LANE = Object.freeze({
  modelVersion: MODEL_VERSION_V2,
  teamModelVersion: TEAM_MODEL_VERSION_V2,
  experimentVersion: EXPERIMENT_VERSION_V2,
  mlMethod: ML_METHOD_V2,
  spreadMethod: SPREAD_METHOD_V2,
  buildPrediction: buildCfbGameShadowPredictionV2,
});
const V3_LANE = Object.freeze({
  modelVersion: MODEL_VERSION_V3,
  teamModelVersion: TEAM_MODEL_VERSION_V3,
  experimentVersion: EXPERIMENT_VERSION_V3,
  mlMethod: ML_METHOD_V3,
  spreadMethod: SPREAD_METHOD_V3,
  buildPrediction: buildCfbGameShadowPredictionV3,
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function protocolWeekForKickoff(kickoffAt, season = TARGET_SEASON) {
  const kickoffMs = Date.parse(kickoffAt);
  const startMs = PROTOCOL_WEEK_ZERO_UTC[Number(season)];
  if (!Number.isFinite(kickoffMs) || !Number.isFinite(startMs)) return null;
  const week = Math.floor((kickoffMs - startMs) / WEEK_MS);
  return week >= 0 && week <= 20 ? week : null;
}

function snapshotForChallenger(row) {
  return Object.freeze({
    id: row.id,
    season: row.season,
    contract_version: row.contract_version,
    snapshot_at: row.snapshot_at,
    input_hash: row.input_hash,
    team_name: row.team_name,
    espn_team_id: row.espn_team_id,
    cfbd_team_id: row.cfbd_team_id,
    quarterback: row.quarterback,
    roster: row.roster,
    returning_production: row.returning_production,
    transfers: row.transfers,
    talent: row.talent,
    coaching: row.coaching,
    quality: row.quality,
  });
}

function addIdentity(index, collisions, name, snapshot) {
  const key = teamKey(name, "cfb");
  if (!key || collisions.has(key)) return;
  const prior = index.get(key);
  if (prior && String(prior.espn_team_id) !== String(snapshot.espn_team_id)) {
    index.delete(key);
    collisions.add(key);
    return;
  }
  index.set(key, snapshot);
}

function buildExactIdentityIndex(snapshots, controls = CONTROL_2025) {
  const index = new Map();
  const collisions = new Set();
  for (const snapshot of snapshots) {
    addIdentity(index, collisions, snapshot.team_name, snapshot);
    const durableDisplayName = controls[String(snapshot.espn_team_id)]?.teamName;
    if (durableDisplayName) addIdentity(index, collisions, durableDisplayName, snapshot);
  }
  return Object.freeze({ index, collisions });
}

function trustedNeutralStatus(event, ledgerRows = []) {
  if (event?.neutralSite === true) return "neutral";
  if (event?.neutralSite === false) return "non-neutral";
  const statuses = new Set((ledgerRows || [])
    .map((row) => row?.neutral_site_status)
    .filter((value) => value === "neutral" || value === "non-neutral"));
  return statuses.size === 1 ? [...statuses][0] : null;
}

function eventMarket(event, capturedAt) {
  return Object.freeze({
    source: MARKET_SOURCE,
    quoteAt: capturedAt,
    h2h: Object.freeze({ ...(event?.h2h || {}) }),
    spreads: Object.freeze({ ...(event?.spreads || {}) }),
  });
}

function outputRow(candidate, input) {
  const prediction = candidate.prediction;
  const lane = candidate.lane || V1_LANE;
  const quote = prediction.market;
  const predictionAt = input.prediction_at;
  return {
    input_snapshot_id: input.id,
    game_id: candidate.input.game_id,
    season: candidate.input.season,
    game_date: candidate.input.game_date,
    prediction_at: predictionAt,
    kickoff_at: candidate.input.kickoff_at,
    model_version: lane.modelVersion,
    team_model_version: lane.teamModelVersion,
    experiment_version: lane.experimentVersion,
    ml_probability_method: lane.mlMethod,
    spread_probability_method: lane.spreadMethod,
    input_fingerprint: candidate.input.input_hash,
    output_fingerprint: sha256({ inputHash: candidate.input.input_hash, modelVersion: lane.modelVersion }),

    home_team_name: candidate.homeSnapshot.team_name,
    away_team_name: candidate.awaySnapshot.team_name,
    home_espn_team_id: String(candidate.homeSnapshot.espn_team_id),
    away_espn_team_id: String(candidate.awaySnapshot.espn_team_id),
    home_cfbd_team_id: candidate.homeSnapshot.cfbd_team_id,
    away_cfbd_team_id: candidate.awaySnapshot.cfbd_team_id,
    home_team_status: candidate.homeTeam.status,
    away_team_status: candidate.awayTeam.status,

    neutral_site_status: prediction.neutralSiteStatus,
    home_field_adjustment: prediction.homeFieldAdjustment,
    home_team_rating: prediction.homeTeamRating,
    away_team_rating: prediction.awayTeamRating,
    home_team_uncertainty: prediction.homeTeamUncertainty,
    away_team_uncertainty: prediction.awayTeamUncertainty,
    combined_rating_uncertainty: prediction.combinedRatingUncertainty,
    base_game_sigma: prediction.baseGameSigma,
    predictive_sigma: prediction.predictiveSigma,
    projected_home_margin: prediction.projectedHomeMargin,
    home_win_probability: prediction.homeWinProbability,
    away_win_probability: prediction.awayWinProbability,

    market_source: quote.source,
    market_quote_at: predictionAt,
    home_ml_odds: quote.h2h.home,
    away_ml_odds: quote.h2h.away,
    home_ml_book: quote.h2h.homeBook,
    away_ml_book: quote.h2h.awayBook,
    market_fair_home_win_probability: quote.h2h.homeFair,
    market_fair_away_win_probability: quote.h2h.awayFair,
    home_ml_disagreement: prediction.homeMlDisagreement,
    away_ml_disagreement: prediction.awayMlDisagreement,

    home_spread: quote.spread.homeLine,
    away_spread: quote.spread.awayLine,
    home_spread_odds: quote.spread.homeOdds,
    away_spread_odds: quote.spread.awayOdds,
    home_spread_book: quote.spread.homeBook,
    away_spread_book: quote.spread.awayBook,
    home_cover_probability: prediction.homeCoverProbability,
    away_cover_probability: prediction.awayCoverProbability,
    spread_push_probability: prediction.pushProbability,
    point_disagreement: prediction.pointDisagreement,
    market_fair_home_cover_probability: quote.spread.homeFair,
    market_fair_away_cover_probability: quote.spread.awayFair,
    home_spread_disagreement: prediction.homeSpreadDisagreement,
    away_spread_disagreement: prediction.awaySpreadDisagreement,
  };
}

function buildCandidate({
  event, homeSnapshot, awaySnapshot, homeTeam, awayTeam, neutralSiteStatus, capturedAt,
  lane = V1_LANE, pairedV1InputHash = null,
}) {
  const kickoffAt = new Date(event.commenceTime).toISOString();
  const prediction = lane.buildPrediction({
    game: Object.freeze({
      gameId: String(event.eventId),
      kickoffAt,
      predictionAt: capturedAt,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
    }),
    homeTeam,
    awayTeam,
    neutralSiteStatus,
    market: eventMarket(event, capturedAt),
  });

  const inputSemantic = Object.freeze({
    gameId: String(event.eventId),
    kickoffAt,
    modelVersion: lane.modelVersion,
    experimentVersion: lane.experimentVersion,
    teamModelVersion: lane.teamModelVersion,
    homeSnapshotId: homeSnapshot.id,
    awaySnapshotId: awaySnapshot.id,
    homeSnapshotHash: homeSnapshot.input_hash,
    awaySnapshotHash: awaySnapshot.input_hash,
    homeTeamInputFingerprint: homeTeam.inputFingerprint,
    awayTeamInputFingerprint: awayTeam.inputFingerprint,
    neutralSiteStatus,
    homeFieldAdjustment: prediction.homeFieldAdjustment,
    homeTeamRating: prediction.homeTeamRating,
    awayTeamRating: prediction.awayTeamRating,
    homeTeamUncertainty: prediction.homeTeamUncertainty,
    awayTeamUncertainty: prediction.awayTeamUncertainty,
    baseGameSigma: prediction.baseGameSigma,
    predictiveSigma: prediction.predictiveSigma,
    market: {
      source: prediction.market.source,
      h2h: prediction.market.h2h,
      spread: prediction.market.spread,
    },
    ...(pairedV1InputHash == null ? {} : {
      parallelPair: {
        v1ModelVersion: V1_LANE.modelVersion,
        v1InputHash: pairedV1InputHash,
        sameTeamSnapshotIds: true,
        sameMarketContext: true,
      },
    }),
    ...(prediction.provenance == null ? {} : { shadowProvenance: prediction.provenance }),
  });
  const inputHash = sha256(inputSemantic);
  const status = homeTeam.status === "rated-input-ready" && awayTeam.status === "rated-input-ready"
    ? "rated" : "suspect";
  const input = {
    game_id: String(event.eventId),
    season: TARGET_SEASON,
    game_date: kickoffAt.slice(0, 10),
    prediction_at: capturedAt,
    kickoff_at: kickoffAt,
    contract_version: homeSnapshot.contract_version,
    model_version: lane.modelVersion,
    experiment_version: lane.experimentVersion,
    home_team_snapshot_id: homeSnapshot.id,
    away_team_snapshot_id: awaySnapshot.id,
    home_cfbd_team_id: homeSnapshot.cfbd_team_id,
    away_cfbd_team_id: awaySnapshot.cfbd_team_id,
    neutral_site_status: neutralSiteStatus,
    input_status: status,
    game_context: {
      week: event.week != null && Number.isInteger(Number(event.week))
        ? Number(event.week) : protocolWeekForKickoff(kickoffAt, TARGET_SEASON),
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      homeEspnTeamId: String(homeSnapshot.espn_team_id),
      awayEspnTeamId: String(awaySnapshot.espn_team_id),
      teamModelVersion: lane.teamModelVersion,
      homeTeamInputFingerprint: homeTeam.inputFingerprint,
      awayTeamInputFingerprint: awayTeam.inputFingerprint,
      marketSource: MARKET_SOURCE,
      marketQuoteAt: capturedAt,
      market: inputSemantic.market,
      ...(inputSemantic.parallelPair == null ? {} : { parallelPair: inputSemantic.parallelPair }),
      ...(prediction.provenance == null ? {} : { shadowProvenance: prediction.provenance }),
    },
    quality: {
      homeTeamStatus: homeTeam.status,
      awayTeamStatus: awayTeam.status,
      homeFeatureCompleteness: homeTeam.featureCompleteness,
      awayFeatureCompleteness: awayTeam.featureCompleteness,
      identityMethod: "durable-espn-id-plus-exact-canonical-name",
      targetSeasonOutcomesUsed: prediction.provenance?.targetSeasonOutcomesUsed === true,
    },
    home_current_season_weight: prediction.provenance?.homeCurrentSeasonWeight ?? 0,
    away_current_season_weight: prediction.provenance?.awayCurrentSeasonWeight ?? 0,
    predicted_margin_mean: prediction.projectedHomeMargin,
    predicted_margin_sd: prediction.predictiveSigma,
    input_hash: inputHash,
  };
  return Object.freeze({
    input: Object.freeze(input), prediction, homeSnapshot, awaySnapshot, homeTeam, awayTeam, lane,
  });
}

function prepareCandidates({
  snapshots = [], usEvents = [], ledgerRows = [], capturedAt,
  controls = CONTROL_2025, odContext = null,
} = {}) {
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) throw new Error("valid capturedAt is required");
  const predictionMs = Date.parse(capturedAt);
  const normalizedSnapshots = snapshots.map(snapshotForChallenger);
  const teamChallenger = buildCfbPreseasonChallenger({
    snapshots: normalizedSnapshots,
    controlRatings: controls,
    generatedAt: capturedAt,
  });
  let teamChallengerV2 = null;
  let teamChallengerV3 = null;
  try {
    teamChallengerV2 = buildCfbPreseasonChallengerV2({ v1Challenger: teamChallenger });
  } catch (_) {
    // The parallel lane must never interrupt the already-approved v1 collector.
  }
  try {
    teamChallengerV3 = buildCfbPreseasonChallengerV3({ v1Challenger: teamChallenger, odContext });
  } catch (_) {
    // v3 is an isolated parallel lane and may be unavailable in the tick-only path.
  }
  const teamByEspn = new Map(teamChallenger.teams.map((team) => [String(team.team.espnTeamId), team]));
  const teamByEspnV2 = new Map((teamChallengerV2?.teams || [])
    .map((team) => [String(team.team.espnTeamId), team]));
  const teamByEspnV3 = new Map((teamChallengerV3?.teams || [])
    .map((team) => [String(team.team.espnTeamId), team]));
  const identity = buildExactIdentityIndex(snapshots, controls);
  const ledgerByGame = new Map();
  for (const row of ledgerRows) {
    const key = String(row.game_id);
    if (!ledgerByGame.has(key)) ledgerByGame.set(key, []);
    ledgerByGame.get(key).push(row);
  }
  const candidates = [];
  const v2Candidates = [];
  const v3Candidates = [];
  const skipped = {
    alreadyStarted: 0,
    missingGameIdentity: 0,
    ambiguousIdentity: 0,
    unresolvedTeam: 0,
    missingChallenger: 0,
    neutralUnknown: 0,
    invalidInput: 0,
    v2InvalidInput: 0,
    v3InvalidInput: 0,
  };

  for (const event of usEvents || []) {
    const gameId = event?.eventId == null ? null : String(event.eventId);
    const kickoffMs = Date.parse(event?.commenceTime);
    if (!gameId || !event?.homeTeam || !event?.awayTeam || !Number.isFinite(kickoffMs)) {
      skipped.missingGameIdentity++;
      continue;
    }
    if (predictionMs >= kickoffMs) { skipped.alreadyStarted++; continue; }
    const homeKey = teamKey(event.homeTeam, "cfb");
    const awayKey = teamKey(event.awayTeam, "cfb");
    if (identity.collisions.has(homeKey) || identity.collisions.has(awayKey)) {
      skipped.ambiguousIdentity++;
      continue;
    }
    const homeSnapshot = identity.index.get(homeKey);
    const awaySnapshot = identity.index.get(awayKey);
    if (!homeSnapshot || !awaySnapshot || homeSnapshot.id === awaySnapshot.id) {
      skipped.unresolvedTeam++;
      continue;
    }
    const homeTeam = teamByEspn.get(String(homeSnapshot.espn_team_id));
    const awayTeam = teamByEspn.get(String(awaySnapshot.espn_team_id));
    if (homeTeam?.challengerRating == null || awayTeam?.challengerRating == null) {
      skipped.missingChallenger++;
      continue;
    }
    const neutralSiteStatus = trustedNeutralStatus(event, ledgerByGame.get(gameId) || []);
    if (!neutralSiteStatus) { skipped.neutralUnknown++; continue; }
    let v1Candidate;
    try {
      v1Candidate = buildCandidate({
        event, homeSnapshot, awaySnapshot, homeTeam, awayTeam, neutralSiteStatus, capturedAt,
      });
      candidates.push(v1Candidate);
    } catch (_) {
      skipped.invalidInput++;
      continue;
    }
    try {
      v2Candidates.push(buildCandidate({
        event,
        homeSnapshot,
        awaySnapshot,
        homeTeam: teamByEspnV2.get(String(homeSnapshot.espn_team_id)),
        awayTeam: teamByEspnV2.get(String(awaySnapshot.espn_team_id)),
        neutralSiteStatus,
        capturedAt,
        lane: V2_LANE,
        pairedV1InputHash: v1Candidate.input.input_hash,
      }));
    } catch (_) {
      skipped.v2InvalidInput++;
    }
    try {
      v3Candidates.push(buildCandidate({
        event,
        homeSnapshot,
        awaySnapshot,
        homeTeam: teamByEspnV3.get(String(homeSnapshot.espn_team_id)),
        awayTeam: teamByEspnV3.get(String(awaySnapshot.espn_team_id)),
        neutralSiteStatus,
        capturedAt,
        lane: V3_LANE,
        pairedV1InputHash: v1Candidate.input.input_hash,
      }));
    } catch (_) {
      skipped.v3InvalidInput++;
    }
  }
  return Object.freeze({
    candidates: Object.freeze(candidates),
    v2Candidates: Object.freeze(v2Candidates),
    v3Candidates: Object.freeze(v3Candidates),
    skipped: Object.freeze(skipped),
    identityCollisions: identity.collisions.size,
    teamDiagnostics: teamChallenger.diagnostics.counts,
    v2SetupAvailable: teamChallengerV2 != null,
    v2TeamDiagnostics: teamChallengerV2?.diagnostics || Object.freeze({ unavailable: true }),
    v3SetupAvailable: teamChallengerV3 != null,
    v3TeamDiagnostics: teamChallengerV3?.diagnostics || Object.freeze({ unavailable: true }),
  });
}

async function insertInputSnapshot(supabase, row) {
  const inserted = await supabase
    .from(INPUT_TABLE)
    .upsert(row, { onConflict: "input_hash", ignoreDuplicates: true })
    .select("id,input_hash,prediction_at")
    .maybeSingle();
  if (inserted.error) throw new Error(inserted.error.message);
  if (inserted.data) return Object.freeze({ row: inserted.data, created: true });
  const existing = await supabase
    .from(INPUT_TABLE)
    .select("id,input_hash,prediction_at")
    .eq("input_hash", row.input_hash)
    .maybeSingle();
  if (existing.error || !existing.data) throw new Error(existing.error?.message || "deduplicated input snapshot was not found");
  return Object.freeze({ row: existing.data, created: false });
}

async function insertOutput(supabase, row) {
  const inserted = await supabase
    .from(OUTPUT_TABLE)
    .upsert(row, { onConflict: "input_snapshot_id,model_version", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data != null;
}

async function persistCandidate(supabase, candidate) {
  const input = await insertInputSnapshot(supabase, candidate.input);
  const created = await insertOutput(supabase, outputRow(candidate, input.row));
  return Object.freeze({ inputCreated: input.created, outputCreated: created });
}

async function selectLedgerRows(supabase, eventIds) {
  const rows = [];
  for (let index = 0; index < eventIds.length; index += 80) {
    const response = await supabase
      .from("model_predictions")
      .select("id,game_id,game_date,league,market,selection,snapshotted_at,model_version,experiment_version,neutral_site_status")
      .eq("league", "cfb")
      .in("game_id", eventIds.slice(index, index + 80));
    if (response.error) throw new Error(response.error.message);
    rows.push(...(response.data || []));
  }
  return rows;
}

async function collectCfbGameShadowPredictions(supabase, {
  usEvents = [], pinnacleEvents = [], capturedAt = new Date().toISOString(),
  odContext = null, espnGamesByEvent = {}, newsCollector = collectFootballNewsForGames,
} = {}) {
  if (!supabase) throw new Error("Supabase client is required");
  // Accepted only to make the no-extra-call data flow explicit; v1 comparison is
  // against the side-aligned US best-price snapshot. Pinnacle remains available to
  // the existing closing collector and is never fetched here.
  void pinnacleEvents;
  const snapshotsResponse = await supabase
    .from(TEAM_TABLE)
    .select("id,season,contract_version,snapshot_at,team_name,espn_team_id,cfbd_team_id,quarterback,roster,returning_production,transfers,talent,coaching,quality,sources,input_hash")
    .eq("season", TARGET_SEASON);
  if (snapshotsResponse.error) throw new Error(snapshotsResponse.error.message);
  const snapshots = snapshotsResponse.data || [];
  const eventIds = (usEvents || []).map((event) => String(event?.eventId || "")).filter(Boolean);
  const ledgerRows = eventIds.length ? await selectLedgerRows(supabase, eventIds) : [];
  const plan = prepareCandidates({ snapshots, usEvents, ledgerRows, capturedAt, odContext });
  const stats = {
    considered: (usEvents || []).length,
    eligible: plan.candidates.length,
    created: 0,
    duplicates: 0,
    inputSnapshotsCreated: 0,
    marketComparisonUnavailable: 0,
    persistenceErrors: 0,
    v2SetupAvailable: plan.v2SetupAvailable,
    v2Eligible: plan.v2Candidates.length,
    v2Created: 0,
    v2Duplicates: 0,
    v2InputSnapshotsCreated: 0,
    v2MarketComparisonUnavailable: 0,
    v2PersistenceErrors: 0,
    v3SetupAvailable: plan.v3SetupAvailable,
    v3Eligible: plan.v3Candidates.length,
    v3Created: 0,
    v3Duplicates: 0,
    v3InputSnapshotsCreated: 0,
    v3MarketComparisonUnavailable: 0,
    v3PersistenceErrors: 0,
    weeklyContextsAttempted: 0,
    weeklyContextErrors: [],
    weeklyNewsErrors: [],
    skipped: plan.skipped,
  };
  for (const candidate of plan.candidates) {
    if (candidate.prediction.market.h2h.homeFair == null
        || candidate.prediction.market.spread.homeFair == null) {
      stats.marketComparisonUnavailable++;
    }
    try {
      const result = await persistCandidate(supabase, candidate);
      if (result.inputCreated) stats.inputSnapshotsCreated++;
      if (result.outputCreated) stats.created++;
      else stats.duplicates++;
    } catch (error) {
      stats.persistenceErrors++;
      console.error(`[CFB Game Shadow] persistence failed game=${candidate.input.game_id}: ${error.message}`);
    }
  }
  for (const candidate of plan.v2Candidates) {
    if (candidate.prediction.market.h2h.homeFair == null
        || candidate.prediction.market.spread.homeFair == null) {
      stats.v2MarketComparisonUnavailable++;
    }
    try {
      const result = await persistCandidate(supabase, candidate);
      if (result.inputCreated) stats.v2InputSnapshotsCreated++;
      if (result.outputCreated) stats.v2Created++;
      else stats.v2Duplicates++;
    } catch (error) {
      stats.v2PersistenceErrors++;
      console.error(`[CFB Game Shadow v2] persistence failed game=${candidate.input.game_id}: ${error.message}`);
    }
  }
  for (const candidate of plan.v3Candidates) {
    if (candidate.prediction.market.h2h.homeFair == null
        || candidate.prediction.market.spread.homeFair == null) {
      stats.v3MarketComparisonUnavailable++;
    }
    try {
      const result = await persistCandidate(supabase, candidate);
      if (result.inputCreated) stats.v3InputSnapshotsCreated++;
      if (result.outputCreated) stats.v3Created++;
      else stats.v3Duplicates++;
    } catch (error) {
      stats.v3PersistenceErrors++;
      console.error(`[CFB Game Shadow v3] persistence failed game=${candidate.input.game_id}: ${error.message}`);
    }
  }
  // Normalize already-fetched CFB preseason/market/ESPN evidence into the shared
  // weekly context ledger. This is isolated from all v1/v2/v3 writes and cannot
  // affect prediction output when the new table is unavailable.
  if (Object.keys(espnGamesByEvent || {}).length) try {
    let newsResult = {
      capturedAt, byEvent: {},
      meta: { available: false, reason: "news-source-unavailable" },
    };
    try {
      newsResult = await newsCollector({
        league: "cfb",
        records: (usEvents || []).map((event) => ({
          event,
          espnGame: espnGamesByEvent[String(event?.eventId || "")] || null,
        })),
        snapshots,
      });
    } catch (error) {
      stats.weeklyNewsErrors.push(error.message);
    }
    const newsCapturedMs = Date.parse(newsResult?.capturedAt);
    const predictionMs = Date.parse(capturedAt);
    const weeklyCapturedAt = Number.isFinite(newsCapturedMs) && newsCapturedMs > predictionMs
      ? new Date(newsCapturedMs).toISOString() : capturedAt;
    const previous = await selectPreviousContexts(supabase, "cfb", eventIds, weeklyCapturedAt);
    const identity = buildExactIdentityIndex(snapshots);
    const contexts = [];
    for (const event of usEvents || []) {
      const homeKey = teamKey(event?.homeTeam);
      const awayKey = teamKey(event?.awayTeam);
      const homeSnapshot = identity.collisions.has(homeKey) ? null : identity.index.get(homeKey) || null;
      const awaySnapshot = identity.collisions.has(awayKey) ? null : identity.index.get(awayKey) || null;
      const eventId = String(event?.eventId || "");
      const context = buildCfbContext({
        event,
        espnGame: espnGamesByEvent[eventId] || null,
        homeSnapshot,
        awaySnapshot,
        predictionRows: ledgerRows,
        previousContext: previous[eventId] || null,
        capturedAt: weeklyCapturedAt,
        newsItems: newsResult?.byEvent?.[eventId] || [],
        newsMeta: newsResult?.meta || null,
      });
      if (context) contexts.push(context);
    }
    const persisted = await persistContexts(supabase, contexts);
    stats.weeklyContextsAttempted = persisted.attempted;
  } catch (error) {
    stats.weeklyContextErrors.push(error.message);
  }
  return Object.freeze(stats);
}

module.exports = {
  TEAM_TABLE,
  INPUT_TABLE,
  OUTPUT_TABLE,
  MARKET_SOURCE,
  V1_LANE,
  V2_LANE,
  V3_LANE,
  collectCfbGameShadowPredictions,
  _internal: {
    stableValue,
    sha256,
    protocolWeekForKickoff,
    snapshotForChallenger,
    buildExactIdentityIndex,
    trustedNeutralStatus,
    eventMarket,
    outputRow,
    buildCandidate,
    prepareCandidates,
    insertInputSnapshot,
    insertOutput,
    persistCandidate,
    selectLedgerRows,
  },
};
