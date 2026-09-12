"use strict";

// Immutable, shadow-only weekly context shared by the active NFL and CFB
// recording flows. This module consumes data those flows already fetched; it has
// no provider client and cannot alter a prediction or customer response.

const crypto = require("crypto");

const TABLE = "football_weekly_context_snapshots";
const CONTEXT_VERSION = "football-weekly-context-v1-2026-09-11";
const STATUSES = Object.freeze({
  CLEAR: "CLEAR",
  MATERIAL: "MATERIAL CONTEXT",
  UNRESOLVED: "UNRESOLVED MATERIAL CONTEXT",
});
const PREDICTION_MARKETS = new Set([
  "moneyline", "spread", "total",
  "moneyline_shadow", "spread_shadow", "total_shadow",
]);

function clean(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function etDate(value) {
  if (!value) return null;
  try { return new Date(value).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  catch (_) { return null; }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function predictionKeys(rows = [], eventId) {
  return rows
    .filter((row) => String(row?.game_id) === String(eventId) && PREDICTION_MARKETS.has(row?.market))
    .map((row) => ({
      predictionId: row.id ?? null,
      gameId: String(row.game_id),
      gameDate: row.game_date || null,
      league: row.league || null,
      market: row.market,
      selection: row.selection,
      snapshottedAt: row.snapshotted_at || null,
      modelVersion: row.model_version || null,
      experimentVersion: row.experiment_version || null,
    }))
    .sort((a, b) => `${a.market}:${a.selection}`.localeCompare(`${b.market}:${b.selection}`));
}

function playerIdentity(row) {
  return {
    playerId: clean(row?.playerId),
    playerName: clean(row?.playerName),
    teamId: clean(row?.teamId),
    teamName: clean(row?.teamName),
    position: clean(row?.position),
    unit: clean(row?.unit),
  };
}

function starterState(players = []) {
  const state = {};
  for (const row of players) {
    if (row?.starter !== true || !row?.teamId || !row?.unit || !row?.playerId) continue;
    const key = `${row.teamId}:${row.unit}`;
    if (!state[key]) state[key] = [];
    state[key].push(playerIdentity(row));
  }
  for (const rows of Object.values(state)) rows.sort((a, b) => String(a.playerId).localeCompare(String(b.playerId)));
  return state;
}

function cfbStarterState(homeSnapshot, awaySnapshot) {
  const state = {};
  for (const snapshot of [homeSnapshot, awaySnapshot]) {
    const qb = snapshot?.quarterback;
    if (!snapshot?.espn_team_id || !qb?.playerId || qb.evidenceStatus !== "confirmed") continue;
    state[`${snapshot.espn_team_id}:quarterback`] = [{
      playerId: String(qb.playerId),
      playerName: qb.playerName || null,
      teamId: String(snapshot.espn_team_id),
      teamName: snapshot.team_name || null,
      position: "QB",
      unit: "quarterback",
    }];
  }
  return state;
}

function compareStarterState(previous = {}, current = {}) {
  const changes = [];
  for (const key of new Set([...Object.keys(previous || {}), ...Object.keys(current || {})])) {
    const before = (previous?.[key] || []).map((row) => String(row.playerId)).sort();
    const after = (current?.[key] || []).map((row) => String(row.playerId)).sort();
    if (before.join("|") === after.join("|") || (!before.length && !after.length)) continue;
    changes.push({
      teamUnit: key,
      previous: clone(previous?.[key] || []),
      current: clone(current?.[key] || []),
      exactIdentity: true,
    });
  }
  return changes;
}

function injuryEvidence(players = []) {
  const injuries = players.filter((row) => row?.reportedInjury || row?.rosterActive === false).map((row) => ({
    ...playerIdentity(row),
    status: row.rosterActive === false && row.status === "no-reported-injury" ? "inactive-roster" : row.status || null,
    statusRaw: row.statusRaw || null,
    clearlyUnavailable: row.clearlyUnavailable === true || row.rosterActive === false,
    uncertain: row.uncertain === true,
    rosterActive: row.rosterActive === true ? true : row.rosterActive === false ? false : null,
    starter: row.starter === true ? true : row.starter === false ? false : null,
    starterStatus: row.starterStatus || "unavailable",
    bodyPart: row.bodyPart || null,
    bodyLocation: row.bodyLocation || null,
    injuryDetail: row.injuryDetail || null,
    returnDate: row.returnDate || null,
    roleUsage: clone(row.roleUsage || null),
    importanceStatus: row.importanceStatus || "unavailable",
    replacementStatus: row.replacementStatus || "unavailable",
    source: row.source || null,
  }));
  const suspensions = injuries.filter((row) => row.status === "suspended");
  const workloadRestrictions = injuries.filter((row) => row.status === "limited").map((row) => ({
    ...playerIdentity(row),
    restriction: "reported-limited",
    snapLimit: null,
    source: row.source,
  }));
  const byUnit = new Map();
  for (const row of injuries) {
    if (!row.teamId || !row.unit) continue;
    const key = `${row.teamId}:${row.unit}`;
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key).push(row);
  }
  const unitClusters = [...byUnit.entries()].filter(([, rows]) => rows.length >= 2).map(([teamUnit, rows]) => ({
    teamUnit,
    count: rows.length,
    clearlyUnavailable: rows.filter((row) => row.clearlyUnavailable).length,
    uncertain: rows.filter((row) => row.uncertain).length,
    confirmedStarters: rows.filter((row) => row.starter === true).length,
    players: rows.map(playerIdentity),
  }));
  return { injuries, suspensions, workloadRestrictions, unitClusters };
}

function highImpactPlayer(row) {
  return row?.position === "QB" || row?.starter === true;
}

function classify({ injuries = [], unitClusters = [], starterDepthChanges = [], cfb = null, newsItems = [] } = {}) {
  const material = [];
  const unresolved = [];
  for (const row of injuries) {
    if (row.uncertain && highImpactPlayer(row)) {
      unresolved.push({ type: "availability", reason: "high-impact-player-status-unresolved", ...playerIdentity(row), status: row.status });
    } else if (row.clearlyUnavailable && highImpactPlayer(row)) {
      material.push({ type: row.status === "suspended" ? "suspension" : "availability", reason: "high-impact-player-unavailable", ...playerIdentity(row), status: row.status });
    }
  }
  for (const cluster of unitClusters) {
    if (cluster.confirmedStarters >= 2 && cluster.uncertain >= 2) {
      unresolved.push({ type: "unit-cluster", reason: "multiple-confirmed-starters-unresolved", teamUnit: cluster.teamUnit });
    } else if (cluster.confirmedStarters >= 2 && cluster.clearlyUnavailable >= 2) {
      material.push({ type: "unit-cluster", reason: "multiple-confirmed-starters-unavailable", teamUnit: cluster.teamUnit });
    }
  }
  for (const change of starterDepthChanges) {
    const isQuarterback = String(change.teamUnit).endsWith(":quarterback");
    if (isQuarterback && change.previous?.length && change.current?.length) {
      material.push({ type: "starter-change", reason: "exact-quarterback-starter-identity-changed", teamUnit: change.teamUnit });
    }
  }
  for (const team of cfb?.teams || []) {
    const qb = team?.quarterback || {};
    if (qb.category === "open-competition" || qb.category === "unknown-unverified") {
      unresolved.push({ type: "cfb-quarterback", reason: "starting-quarterback-unresolved", teamId: team.teamId, teamName: team.teamName, category: qb.category });
    } else if (qb.category === "confirmed-unavailable") {
      material.push({ type: "cfb-quarterback", reason: "starting-quarterback-confirmed-unavailable", teamId: team.teamId, teamName: team.teamName, category: qb.category, playerId: qb.playerId || null });
    } else if (["returning-roster-new-starter", "confirmed-transfer-starter", "freshman-new-starter"].includes(qb.category)) {
      material.push({ type: "cfb-quarterback", reason: "verified-new-starting-quarterback", teamId: team.teamId, teamName: team.teamName, category: qb.category, playerId: qb.playerId || null });
    }
    if (team?.coaching?.identityStatus === "exact" && team.coaching.continuity === false) {
      material.push({ type: "coaching", reason: "verified-head-coach-continuity-change", teamId: team.teamId, teamName: team.teamName, headCoach: clone(team.coaching.headCoach || null) });
    }
  }
  for (const item of newsItems || []) {
    const evidence = {
      type: "news",
      reason: item.contextImpact === "unresolved" ? "high-impact-news-status-unresolved" : "confirmed-material-news",
      newsId: item.newsId,
      source: item.source,
      category: item.category,
      statusChange: item.statusChange,
      teamId: item.teamId,
      teamName: item.teamName,
      playerId: item.playerId,
      playerName: item.playerName,
      position: item.position,
      publishedAt: item.publishedAt,
    };
    if (item.contextImpact === "unresolved") unresolved.push(evidence);
    else if (item.contextImpact === "material") material.push(evidence);
  }
  return {
    status: unresolved.length ? STATUSES.UNRESOLVED : material.length ? STATUSES.MATERIAL : STATUSES.CLEAR,
    material,
    unresolved,
  };
}

function coverage(domains) {
  const entries = Object.entries(domains || {});
  const available = entries.filter(([, value]) => value === true).length;
  return {
    domains: Object.fromEntries(entries),
    available,
    expected: entries.length,
    completeness: entries.length ? Math.round((available / entries.length) * 10000) / 10000 : 0,
  };
}

function confidenceFor({ exactGameIdentity, exactTeamIdentity, availabilityComplete, contextCoverage }) {
  if (!exactGameIdentity || !exactTeamIdentity) return "low";
  if (availabilityComplete && contextCoverage?.completeness >= 0.7) return "high";
  return "medium";
}

function baseRow({
  league, event, espnGame, capturedAt, keys, classification, confidence,
  completeness, structuredContext, sourceContext, homeTeamId = null,
  awayTeamId = null,
}) {
  const kickoffAt = event?.commenceTime || espnGame?.date || null;
  const payload = {
    league,
    eventId: String(event.eventId),
    espnGameId: espnGame?.gameId == null ? null : String(espnGame.gameId),
    capturedAt,
    kickoffAt,
    homeTeamId: espnGame?.home?.id == null ? clean(homeTeamId) : String(espnGame.home.id),
    awayTeamId: espnGame?.away?.id == null ? clean(awayTeamId) : String(espnGame.away.id),
    predictionKeys: keys,
    status: classification.status,
    confidence,
    completeness,
    structuredContext,
    materialItems: classification.material,
    unresolvedItems: classification.unresolved,
    sourceContext,
    contextVersion: CONTEXT_VERSION,
  };
  return {
    league,
    event_id: String(event.eventId),
    espn_game_id: payload.espnGameId,
    game_date: etDate(kickoffAt),
    kickoff_at: kickoffAt,
    captured_at: capturedAt,
    home_team_id: espnGame?.home?.id == null ? clean(homeTeamId) : String(espnGame.home.id),
    away_team_id: espnGame?.away?.id == null ? clean(awayTeamId) : String(espnGame.away.id),
    home_team: event.homeTeam,
    away_team: event.awayTeam,
    prediction_keys: keys,
    context_status: classification.status,
    context_confidence: confidence,
    context_completeness: completeness,
    structured_context: structuredContext,
    material_items: classification.material,
    unresolved_items: classification.unresolved,
    source_context: sourceContext,
    context_version: CONTEXT_VERSION,
    input_fingerprint: fingerprint(payload),
  };
}

function buildNflContext({
  game, comparison, predictionRows = [], previousContext = null,
  capturedAt, newsItems = [], newsMeta = null,
} = {}) {
  const input = game?._injuryWeatherShadowInput;
  const event = input?.event;
  const espnGame = input?.espnGame || null;
  const capturedMs = Date.parse(capturedAt);
  const kickoffMs = Date.parse(event?.commenceTime);
  if (!event?.eventId || !clean(event?.homeTeam) || !clean(event?.awayTeam)
      || !Number.isFinite(capturedMs) || !Number.isFinite(kickoffMs)
      || capturedMs >= kickoffMs) return null;
  const home = comparison?.contextRow?.home_availability || [];
  const away = comparison?.contextRow?.away_availability || [];
  const allPlayers = [...home, ...away];
  const evidence = injuryEvidence(allPlayers);
  const currentStarters = starterState(allPlayers);
  const previousStarters = previousContext?.structured_context?.starterState || {};
  const starterDepthChanges = previousContext ? compareStarterState(previousStarters, currentStarters) : [];
  const classification = classify({ ...evidence, starterDepthChanges, newsItems });
  const weather = clone(comparison?.contextRow?.weather_context || null);
  const cov = coverage({
    exactGameIdentity: !!espnGame?.gameId,
    exactTeamIdentity: !!espnGame?.home?.id && !!espnGame?.away?.id,
    availability: home.length > 0 && away.length > 0,
    starterRole: allPlayers.some((row) => typeof row?.starter === "boolean"),
    workloadRestriction: allPlayers.some((row) => row?.status === "limited") || allPlayers.length > 0,
    weather: weather?.available === true,
    exactNewsJoin: newsMeta?.available === true,
    coachingContext: false,
    restTravelContext: false,
  });
  const sourceContext = {
    availability: { source: "espn-roster-athlete-id", capturedAt, exactPlayerIdentity: true, available: home.length > 0 && away.length > 0 },
    roleUsage: { source: "espn-prior-season-athlete-statistics", capturedAt, available: allPlayers.some((row) => row?.roleUsage) },
    weather: { source: weather?.source || null, capturedAt: weather?.capturedAt || capturedAt, available: weather?.available === true, reason: weather?.reason || null },
    news: newsMeta || { available: false, reason: "news-source-unavailable" },
    coaching: { available: false, reason: "not-present-in-active-nfl-slate-context" },
    playCalling: { available: false, reason: "not-present-in-active-nfl-slate-context" },
    restTravel: { available: false, reason: "not-present-in-active-nfl-slate-context" },
  };
  const structuredContext = {
    injuriesAvailability: evidence.injuries,
    starterState: currentStarters,
    starterDepthChanges,
    workloadRestrictions: evidence.workloadRestrictions,
    suspensions: evidence.suspensions,
    skillRoleChanges: starterDepthChanges.filter((row) => /:(backfield|receiver)$/.test(row.teamUnit)),
    unitClusters: evidence.unitClusters,
    coachingChanges: [],
    playCallingChanges: [],
    cfbRosterContext: null,
    restTravelContext: { available: false },
    weather,
    newsContext: { items: clone(newsItems), exactJoinAvailable: newsMeta?.available === true },
    coverage: cov,
  };
  const exactTeamIdentity = !!espnGame?.home?.id && !!espnGame?.away?.id;
  return baseRow({
    league: "nfl", event, espnGame, capturedAt,
    keys: predictionKeys(predictionRows, event.eventId), classification,
    confidence: confidenceFor({ exactGameIdentity: !!espnGame?.gameId, exactTeamIdentity, availabilityComplete: home.length > 0 && away.length > 0, contextCoverage: cov }),
    completeness: cov.completeness, structuredContext, sourceContext,
  });
}

function cfbTeamContext(snapshot) {
  if (!snapshot) return null;
  const roster = snapshot.roster || null;
  return {
    teamId: snapshot.espn_team_id == null ? null : String(snapshot.espn_team_id),
    teamName: snapshot.team_name || null,
    snapshotId: snapshot.id ?? null,
    snapshotAt: snapshot.snapshot_at || null,
    inputFingerprint: snapshot.input_hash || null,
    quarterback: clone(snapshot.quarterback || null),
    // The immutable preseason snapshot ID/fingerprint is the durable join to the
    // full roster. Repeating ~110 player rows for every game/day would add no new
    // evidence, so the weekly ledger stores coverage/identity counts only.
    roster: roster ? {
      available: roster.available === true,
      playerCount: roster.playerCount ?? null,
      durableIdCount: roster.durableIdCount ?? null,
      missingIdCount: roster.missingIdCount ?? null,
      duplicateIdCount: roster.duplicateIdCount ?? null,
    } : null,
    transfers: clone(snapshot.transfers || null),
    coaching: clone(snapshot.coaching || null),
    quality: clone(snapshot.quality || null),
    sources: clone(snapshot.sources || null),
  };
}

function buildCfbContext({
  event, espnGame = null, homeSnapshot = null, awaySnapshot = null,
  predictionRows = [], previousContext = null, capturedAt,
  newsItems = [], newsMeta = null,
} = {}) {
  const capturedMs = Date.parse(capturedAt);
  const kickoffMs = Date.parse(event?.commenceTime);
  if (!event?.eventId || !clean(event?.homeTeam) || !clean(event?.awayTeam)
      || !Number.isFinite(capturedMs) || !Number.isFinite(kickoffMs)
      || capturedMs >= kickoffMs) return null;
  const teams = [cfbTeamContext(homeSnapshot), cfbTeamContext(awaySnapshot)].filter(Boolean);
  const currentStarters = cfbStarterState(homeSnapshot, awaySnapshot);
  const previousStarters = previousContext?.structured_context?.starterState || {};
  const starterDepthChanges = previousContext ? compareStarterState(previousStarters, currentStarters) : [];
  const classification = classify({ starterDepthChanges, cfb: { teams }, newsItems });
  const indoor = espnGame?.venue?.indoor === true;
  const weather = indoor
    ? { available: true, source: "espn-event-venue", capturedAt, kickoffAt: event.commenceTime, indoor: true }
    : { available: false, source: "espn-event-venue", capturedAt, kickoffAt: event.commenceTime, indoor: espnGame?.venue?.indoor ?? null, reason: "no-trustworthy-cfb-venue-coordinate-in-active-path" };
  const cov = coverage({
    exactGameIdentity: !!espnGame?.gameId,
    exactTeamIdentity: teams.length === 2 && teams.every((team) => team.teamId),
    preseasonRoster: teams.length === 2 && teams.every((team) => team.roster?.available === true),
    quarterbackDepth: teams.length === 2 && teams.every((team) => team.quarterback?.evidenceStatus === "confirmed"),
    transferContext: teams.length === 2 && teams.every((team) => team.transfers?.available === true),
    coachingContext: teams.length === 2 && teams.every((team) => team.coaching?.available === true),
    currentAvailability: false,
    weather: weather.available === true,
    exactNewsJoin: newsMeta?.available === true,
    restTravelContext: false,
  });
  const sourceContext = {
    preseason: teams.map((team) => ({
      teamId: team.teamId,
      snapshotId: team.snapshotId,
      snapshotAt: team.snapshotAt,
      sources: team.sources,
    })),
    currentAvailability: { available: false, reason: "no-active-exact-id-cfb-injury-feed" },
    weeklyRosterChanges: { available: false, reason: "only-immutable-preseason-roster-snapshot-is-active" },
    weather: { source: weather.source, capturedAt, available: weather.available, reason: weather.reason || null },
    news: newsMeta || { available: false, reason: "news-source-unavailable" },
    playCalling: { available: false, reason: "no-active-exact-source-cfb-play-caller-feed" },
    restTravel: { available: false, reason: "not-present-in-active-cfb-slate-context" },
  };
  const structuredContext = {
    injuriesAvailability: [],
    starterState: currentStarters,
    starterDepthChanges,
    workloadRestrictions: [],
    suspensions: [],
    skillRoleChanges: starterDepthChanges.filter((row) => /:(backfield|receiver)$/.test(row.teamUnit)),
    unitClusters: [],
    coachingChanges: classification.material.filter((row) => row.type === "coaching"),
    playCallingChanges: [],
    cfbRosterContext: {
      teams,
      weeklyChangeStatus: "unavailable",
      reason: "only-immutable-preseason-roster-snapshot-is-active",
    },
    restTravelContext: { available: false },
    weather,
    newsContext: { items: clone(newsItems), exactJoinAvailable: newsMeta?.available === true },
    coverage: cov,
  };
  const exactTeamIdentity = teams.length === 2 && teams.every((team) => team.teamId);
  return baseRow({
    league: "cfb", event, espnGame, capturedAt,
    keys: predictionKeys(predictionRows, event.eventId), classification,
    confidence: confidenceFor({ exactGameIdentity: !!espnGame?.gameId, exactTeamIdentity, availabilityComplete: false, contextCoverage: cov }),
    completeness: cov.completeness, structuredContext, sourceContext,
    homeTeamId: homeSnapshot?.espn_team_id,
    awayTeamId: awaySnapshot?.espn_team_id,
  });
}

async function selectPredictionRows(supabase, league, eventIds = []) {
  if (!eventIds.length) return [];
  const rows = [];
  for (let offset = 0; offset < eventIds.length; offset += 80) {
    const response = await supabase.from("model_predictions")
      .select("id,game_id,game_date,league,market,selection,snapshotted_at,model_version,experiment_version")
      .eq("league", league)
      .in("game_id", eventIds.slice(offset, offset + 80));
    if (response.error) throw new Error(response.error.message);
    rows.push(...(response.data || []));
  }
  return rows;
}

async function selectPreviousContexts(supabase, league, eventIds = [], capturedAt) {
  if (!eventIds.length) return {};
  const response = await supabase.from(TABLE)
    .select("event_id,captured_at,structured_context")
    .eq("league", league)
    .in("event_id", eventIds)
    .lt("captured_at", capturedAt)
    .order("captured_at", { ascending: false })
    .limit(1000);
  if (response.error) throw new Error(response.error.message);
  const byEvent = {};
  for (const row of response.data || []) {
    const key = String(row.event_id);
    if (!byEvent[key]) byEvent[key] = row;
  }
  return byEvent;
}

async function persistContexts(supabase, rows = []) {
  if (!rows.length) return { attempted: 0 };
  const response = await supabase.from(TABLE).upsert(rows, {
    onConflict: "league,event_id,captured_at,context_version",
    ignoreDuplicates: true,
  });
  if (response.error) throw new Error(response.error.message);
  // With ignoreDuplicates PostgreSQL intentionally does not tell this lightweight
  // path whether a row was newly inserted. Report attempts, never fabricate an
  // inserted count.
  return { attempted: rows.length };
}

module.exports = {
  TABLE,
  CONTEXT_VERSION,
  STATUSES,
  buildNflContext,
  buildCfbContext,
  selectPredictionRows,
  selectPreviousContexts,
  persistContexts,
  _internal: {
    clean, etDate, stable, fingerprint, predictionKeys, playerIdentity,
    starterState, cfbStarterState, compareStarterState, injuryEvidence,
    highImpactPlayer, classify, coverage, confidenceFor, cfbTeamContext,
  },
};
