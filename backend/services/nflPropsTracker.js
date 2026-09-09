"use strict";

// Immutable ledger for the exact NFL player-prop selections shown to customers.
// This mirrors the customer UI's existing selection semantics; it does not decide
// picks or change any model output.

const { createClient } = require("@supabase/supabase-js");
const { RANKING_VERSION } = require("./nflAnytimeTdRankings");
const { payout } = require("./priceMath");

const TABLE = "nfl_prop_customer_picks";
const CORE_MODEL_VERSION = "nfl-player-props-season-average-v1.1-2026";
const CORE_MARKETS = new Set(["pass_yds", "rush_yds", "rec_yds", "receptions"]);
const CATEGORIES = Object.freeze([
  "pass_yds", "pass_tds", "rush_yds", "rec_yds", "receptions", "anytime_td",
]);

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function seasonWeekFor(commenceAt) {
  const date = new Date(commenceAt);
  if (Number.isNaN(date.getTime())) return { season: null, seasonWeek: null };
  const month = date.getUTCMonth();
  const season = month <= 1 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
  const pinnedStart = season === 2026 ? Date.UTC(2026, 8, 9) : null;
  let startMs = pinnedStart;
  if (startMs == null) {
    const septemberFirst = new Date(Date.UTC(season, 8, 1));
    const firstMonday = 1 + ((8 - septemberFirst.getUTCDay()) % 7);
    startMs = Date.UTC(season, 8, firstMonday + 3);
  }
  const seasonWeek = date.getTime() < startMs
    ? null
    : Math.floor((date.getTime() - startMs) / (7 * 864e5)) + 1;
  return { season, seasonWeek };
}

// Exact server mirror of the active NFL customer rule in footballPropMarkets.js.
// modelEdge is Over-basis: a negative value means a positive selected-side Under edge.
function customerCoreSelection(prop) {
  if (!CORE_MARKETS.has(String(prop?.market || "").toLowerCase())) return null;
  const projection = finite(prop?.projection);
  const modelOverProb = finite(prop?.modelOverProb);
  const marketFairOverProb = finite(prop?.marketFairOverProb);
  const overBasisEdge = finite(prop?.modelEdge);
  const line = finite(prop?.line);
  if ([projection, modelOverProb, marketFairOverProb, overBasisEdge, line].some((value) => value == null)
      || overBasisEdge === 0 || !String(prop?.book || "").trim()) return null;
  const side = overBasisEdge > 0 ? "OVER" : "UNDER";
  const odds = finite(side === "OVER" ? prop?.overOdds : prop?.underOdds);
  if (odds == null) return null;
  return {
    side,
    odds,
    line,
    modelProjection: projection,
    modelEdge: Math.abs(overBasisEdge),
  };
}

const ACTUAL_FIELD = Object.freeze({
  pass_yds: "pass_yds",
  pass_tds: "pass_tds",
  rush_yds: "rush_yds",
  rec_yds: "rec_yds",
  receptions: "receptions",
});

function unitPnl(result, odds) {
  if (result === "LOSS") return -1;
  if (result === "PUSH" || result === "VOID") return 0;
  if (result !== "WIN") return null;
  const profit = payout(Number(odds));
  return Number.isFinite(profit) ? Math.round(profit * 1000000) / 1000000 : null;
}

function gradeCustomerPick(row, actuals = {}) {
  // Customer snapshots carry the exact ESPN athlete id used by the live roster.
  // Do not fuzzy-match a final stat onto a different player.
  const rec = actuals.byId?.[String(row.player_id)] || null;
  if (!rec) return { result: "VOID", final_stat: null, unit_pnl: 0 };
  if (row.category === "anytime_td") {
    // Passing a touchdown is not personally scoring one.
    const actual = (Number.isFinite(Number(rec.rush_tds)) ? Number(rec.rush_tds) : 0)
      + (Number.isFinite(Number(rec.rec_tds)) ? Number(rec.rec_tds) : 0);
    const result = actual > 0 ? "WIN" : "LOSS";
    return { result, final_stat: actual, unit_pnl: unitPnl(result, row.odds) };
  }
  const field = ACTUAL_FIELD[row.category];
  if (!field || rec[field] == null || !Number.isFinite(Number(row.line))) {
    return { result: "VOID", final_stat: null, unit_pnl: 0 };
  }
  const actual = Number(rec[field]);
  if (!Number.isFinite(actual)) return { result: "VOID", final_stat: null, unit_pnl: 0 };
  let result;
  if (actual === Number(row.line)) result = "PUSH";
  else if (String(row.side).toUpperCase() === "OVER") result = actual > Number(row.line) ? "WIN" : "LOSS";
  else if (String(row.side).toUpperCase() === "UNDER") result = actual < Number(row.line) ? "WIN" : "LOSS";
  else return { result: "VOID", final_stat: null, unit_pnl: 0 };
  return { result, final_stat: actual, unit_pnl: unitPnl(result, row.odds) };
}

function commonSnapshot(row, predictionAt) {
  const eventId = String(row?.eventId || "").trim();
  const playerId = String(row?.playerId || "").trim();
  const playerName = String(row?.player || "").trim();
  const teamName = String(row?.team || "").trim();
  const teamId = String(row?.teamId || "").trim();
  const opponentName = String(row?.opponent || "").trim();
  const matchup = String(row?.matchup || "").trim();
  const commenceAt = row?.commenceTime || null;
  const gameDate = row?.eventDate || null;
  if (!eventId || !playerId || !playerName || !teamId || !teamName || !opponentName || !matchup
      || !commenceAt || !gameDate || !predictionAt) return null;
  const { season, seasonWeek } = seasonWeekFor(commenceAt);
  if (!season) return null;
  return {
    event_id: eventId,
    event_date: gameDate,
    commence_at: commenceAt,
    prediction_at: predictionAt,
    season,
    season_week: seasonWeek,
    player_id: playerId,
    player_name: playerName,
    team_id: teamId,
    team_name: teamName,
    opponent_name: opponentName,
    matchup,
  };
}

function buildPublishedPickRows({ verifiedProps = [], tdSelections = [], predictionAt } = {}) {
  const rows = [];
  for (const prop of verifiedProps) {
    const selected = customerCoreSelection(prop);
    const common = commonSnapshot(prop, predictionAt);
    if (!selected || !common) continue;
    rows.push({
      ...common,
      category: prop.market,
      side: selected.side,
      line: selected.line,
      sportsbook: String(prop.book).trim(),
      odds: selected.odds,
      model_projection: selected.modelProjection,
      model_edge: selected.modelEdge,
      model_version: CORE_MODEL_VERSION,
      result: "PENDING",
    });
  }
  for (const selection of tdSelections) {
    const common = commonSnapshot(selection, predictionAt);
    const odds = finite(selection?.bestPrice);
    const sportsbook = String(selection?.bestBook || "").trim();
    if (!common || odds == null || !sportsbook) continue;
    rows.push({
      ...common,
      category: "anytime_td",
      side: "ANYTIME_TD",
      line: null,
      sportsbook,
      odds,
      model_projection: null,
      model_edge: null,
      model_version: RANKING_VERSION,
      result: "PENDING",
    });
  }
  return rows;
}

async function persistPublishedPicks(supabase, rows) {
  if (!rows.length) return { attempted: 0 };
  const { error } = await supabase.from(TABLE).upsert(rows, {
    onConflict: "event_id,player_id,category",
    ignoreDuplicates: true,
  });
  if (error) return { attempted: rows.length, error: error.message };
  return { attempted: rows.length };
}

function recordPublishedNflProps({ verifiedProps = [], tdSelections = [], predictionAt, supabase = db() } = {}) {
  const rows = buildPublishedPickRows({ verifiedProps, tdSelections, predictionAt });
  return persistPublishedPicks(supabase, rows);
}

function summarizeRows(rows = []) {
  const bucket = (items) => {
    const wins = items.filter((row) => row.result === "WIN").length;
    const losses = items.filter((row) => row.result === "LOSS").length;
    const pushes = items.filter((row) => row.result === "PUSH").length;
    const voids = items.filter((row) => row.result === "VOID").length;
    const settled = wins + losses;
    const roiEligible = settled + pushes;
    const units = items.reduce((sum, row) => sum + (finite(row.unit_pnl) || 0), 0);
    return {
      total: items.length,
      pending: items.filter((row) => row.result === "PENDING").length,
      wins, losses, pushes, voids,
      hitRate: settled ? wins / settled : null,
      units: Math.round(units * 1000) / 1000,
      roi: roiEligible ? Math.round((units / roiEligible) * 100000) / 1000 : null,
    };
  };
  const breakdown = {};
  for (const category of CATEGORIES) breakdown[category] = bucket(rows.filter((row) => row.category === category));
  return { overall: bucket(rows), breakdown };
}

async function loadTracker(filters = {}, supabase = db()) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(TABLE).select("*").order("prediction_at", { ascending: false });
    if (filters.dateFrom) query = query.gte("event_date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("event_date", filters.dateTo);
    if (filters.season != null) query = query.eq("season", Number(filters.season));
    if (filters.week != null) query = query.eq("season_week", Number(filters.week));
    if (filters.category && CATEGORIES.includes(filters.category)) query = query.eq("category", filters.category);
    if (filters.result && ["PENDING", "WIN", "LOSS", "PUSH", "VOID"].includes(filters.result)) query = query.eq("result", filters.result);
    if (filters.player) query = query.ilike("player_name", `%${String(filters.player).replace(/[%_,]/g, "")}%`);
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { ...summarizeRows(rows), rows };
}

module.exports = {
  TABLE,
  CORE_MODEL_VERSION,
  CATEGORIES,
  buildPublishedPickRows,
  customerCoreSelection,
  gradeCustomerPick,
  unitPnl,
  persistPublishedPicks,
  recordPublishedNflProps,
  summarizeRows,
  loadTracker,
  _internal: { finite, seasonWeekFor },
};
