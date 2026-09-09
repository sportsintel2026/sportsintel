const { createClient } = require("@supabase/supabase-js");

const TABLE = "nfl_anytime_td_slate_context";
const CONTEXT_VERSION = "nfl-anytime-td-slate-context-v1-2026-09-08";
const CONTEXT_MAX_AGE_MS = 30 * 60 * 60 * 1000;
const CONTEXT_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function etDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  catch (_) { return null; }
}

function impliedPoints(totalLine, homeSpreadLine, side) {
  const total = finite(totalLine);
  const spread = finite(homeSpreadLine);
  if (total == null || spread == null) return null;
  return side === "home" ? (total - spread) / 2 : (total + spread) / 2;
}

function contextRow(game, capturedAt) {
  const context = game?._tdContext;
  const homeImplied = impliedPoints(context?.totalLine, context?.homeSpreadLine, "home");
  const awayImplied = impliedPoints(context?.totalLine, context?.homeSpreadLine, "away");
  const required = [
    context?.eventId, context?.commenceTime, context?.sourceSeason,
    context?.totalLine, context?.homeSpreadLine,
    context?.home?.teamId, context?.home?.team, context?.home?.projectedPoints,
    context?.away?.teamId, context?.away?.team, context?.away?.projectedPoints,
    homeImplied, awayImplied,
  ];
  if (required.some((value) => value == null || value === "")) return null;
  const gameDate = etDate(context.commenceTime);
  if (!gameDate) return null;
  return {
    event_id: String(context.eventId),
    game_date: gameDate,
    commence_at: context.commenceTime,
    captured_at: capturedAt,
    source_season: Number(context.sourceSeason),
    context_version: CONTEXT_VERSION,
    total_line: Number(context.totalLine),
    home_spread_line: Number(context.homeSpreadLine),
    home_implied_points: homeImplied,
    away_implied_points: awayImplied,
    home_team_id: String(context.home.teamId),
    home_team: String(context.home.team),
    home_projected_points: Number(context.home.projectedPoints),
    home_offense_ppg: finite(context.home.offensePointsPerGame),
    home_opponent_defense_pa_per_game: finite(context.home.opponentDefensePointsAllowedPerGame),
    away_team_id: String(context.away.teamId),
    away_team: String(context.away.team),
    away_projected_points: Number(context.away.projectedPoints),
    away_offense_ppg: finite(context.away.offensePointsPerGame),
    away_opponent_defense_pa_per_game: finite(context.away.opponentDefensePointsAllowedPerGame),
  };
}

function buildContextRows(slate, capturedAt = new Date().toISOString()) {
  return (slate?.games || []).map((game) => contextRow(game, capturedAt)).filter(Boolean);
}

function rowToContext(row) {
  if (!row || row.context_version !== CONTEXT_VERSION) return null;
  return {
    eventId: String(row.event_id),
    commenceTime: row.commence_at,
    sourceSeason: Number(row.source_season),
    totalLine: Number(row.total_line),
    homeSpreadLine: Number(row.home_spread_line),
    home: {
      teamId: String(row.home_team_id), team: row.home_team,
      offensePointsPerGame: finite(row.home_offense_ppg),
      opponentDefensePointsAllowedPerGame: finite(row.home_opponent_defense_pa_per_game),
      projectedPoints: Number(row.home_projected_points),
    },
    away: {
      teamId: String(row.away_team_id), team: row.away_team,
      offensePointsPerGame: finite(row.away_offense_ppg),
      opponentDefensePointsAllowedPerGame: finite(row.away_opponent_defense_pa_per_game),
      projectedPoints: Number(row.away_projected_points),
    },
  };
}

async function persistNflTdSlateContext(slate, { supabase = db(), capturedAt = new Date().toISOString() } = {}) {
  const rows = buildContextRows(slate, capturedAt);
  if (!rows.length) return { recorded: 0, reason: "no complete NFL TD slate context" };
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: "event_id" });
  return error ? { recorded: 0, error: error.message } : { recorded: rows.length };
}

async function loadCurrentNflTdSlateContext({
  supabase = db(), now = new Date(), maxAgeMs = CONTEXT_MAX_AGE_MS,
  horizonMs = CONTEXT_HORIZON_MS,
} = {}) {
  const nowMs = now.getTime();
  const { data, error } = await supabase.from(TABLE).select("*")
    .gte("commence_at", new Date(nowMs).toISOString())
    .lte("commence_at", new Date(nowMs + horizonMs).toISOString())
    .gte("captured_at", new Date(nowMs - maxAgeMs).toISOString())
    .order("commence_at", { ascending: true });
  if (error) return { contextByEvent: {}, error: error.message };
  const contextByEvent = {};
  for (const row of data || []) {
    const context = rowToContext(row);
    if (context) contextByEvent[context.eventId] = context;
  }
  return { contextByEvent, loaded: Object.keys(contextByEvent).length };
}

module.exports = {
  TABLE,
  CONTEXT_VERSION,
  CONTEXT_MAX_AGE_MS,
  CONTEXT_HORIZON_MS,
  buildContextRows,
  rowToContext,
  persistNflTdSlateContext,
  loadCurrentNflTdSlateContext,
  _internal: { finite, etDate, impliedPoints, contextRow },
};
