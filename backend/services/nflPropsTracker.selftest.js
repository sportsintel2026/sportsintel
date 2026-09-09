"use strict";

const assert = require("assert");
const Module = require("module");
const fs = require("fs");
const path = require("path");
const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient: () => ({}) };
  if (request === "axios") return { get: async () => { throw new Error("network forbidden in self-test"); } };
  return originalLoad(request, parent, isMain);
};
const {
  CORE_MODEL_VERSION,
  buildPublishedPickRows,
  persistPublishedPicks,
  summarizeRows,
  gradeCustomerPick,
  unitPnl,
} = require("./nflPropsTracker");
const { RANKING_VERSION } = require("./nflAnytimeTdRankings");
const { extractBoxscorePlayerStats } = require("./nflPropsActuals");
Module._load = originalLoad;

const base = {
  sport: "nfl", eventId: "event-1", eventDate: "2026-09-13",
  commenceTime: "2026-09-13T17:00:00Z", matchup: "Arizona Cardinals @ Buffalo Bills",
  playerId: "42", player: "Exact Runner", teamId: "2", team: "Buffalo Bills",
  opponent: "Arizona Cardinals", book: "DraftKings", line: 67.5,
  projection: 73.2, modelOverProb: 0.58, marketFairOverProb: 0.51,
};
const rows = buildPublishedPickRows({
  predictionAt: "2026-09-09T15:00:00Z",
  verifiedProps: [
    { ...base, market: "rush_yds", modelEdge: 0.07, overOdds: -105, underOdds: -115 },
    { ...base, playerId: "43", player: "Exact Receiver", market: "rec_yds", modelEdge: -0.04, overOdds: -120, underOdds: 105 },
    { ...base, playerId: "44", player: "No Edge", market: "receptions", modelEdge: 0, overOdds: -110, underOdds: -110 },
    { ...base, playerId: null, player: "No Exact ID", market: "pass_yds", modelEdge: 0.03, overOdds: -110, underOdds: -110 },
  ],
  tdSelections: [{
    ...base, playerId: "45", player: "Exact Scorer", bestBook: "FanDuel", bestPrice: 140,
  }],
});

assert.equal(rows.length, 3, "only customer-facing, exact-ID picks are snapshotted");
assert.deepEqual(rows.map((row) => row.side), ["OVER", "UNDER", "ANYTIME_TD"]);
assert.deepEqual(rows.map((row) => row.odds), [-105, 105, 140], "the exact selected-side price is stored");
assert.equal(rows[0].model_edge, 0.07);
assert.equal(rows[1].model_edge, 0.04, "Under stores positive selected-side edge");
assert.equal(rows[0].model_version, CORE_MODEL_VERSION);
assert.equal(rows[2].model_version, RANKING_VERSION);
assert.equal(rows[2].line, null);
assert.equal(rows[2].model_projection, null);
assert.deepEqual({ season: rows[0].season, week: rows[0].season_week }, { season: 2026, week: 1 });

let persisted = null;
let options = null;
const fakeDb = { from: (table) => ({ upsert: async (next, nextOptions) => {
  assert.equal(table, "nfl_prop_customer_picks");
  persisted = next; options = nextOptions; return { error: null };
} }) };

const summary = summarizeRows([
  { category: "rush_yds", result: "WIN", unit_pnl: 0.952381 },
  { category: "rush_yds", result: "LOSS", unit_pnl: -1 },
  { category: "rec_yds", result: "PUSH", unit_pnl: 0 },
  { category: "anytime_td", result: "VOID", unit_pnl: 0 },
  { category: "anytime_td", result: "PENDING", unit_pnl: null },
]);
assert.deepEqual({ wins: summary.overall.wins, losses: summary.overall.losses, pushes: summary.overall.pushes, voids: summary.overall.voids }, { wins: 1, losses: 1, pushes: 1, voids: 1 });
assert.equal(summary.overall.units, -0.048);
assert.equal(summary.overall.roi, -1.587, "ROI includes pushes as zero-return 1-unit-risk wagers");

const box = extractBoxscorePlayerStats({ boxscore: { players: [{ statistics: [
  { name: "passing", labels: ["YDS", "TD"], athletes: [{ athlete: { id: "42", displayName: "Exact Runner" }, stats: ["250", "2"] }] },
  { name: "rushing", labels: ["YDS", "TD"], athletes: [{ athlete: { id: "42", displayName: "Exact Runner" }, stats: ["72", "1"] }] },
  { name: "receiving", labels: ["REC", "YDS", "TD"], athletes: [{ athlete: { id: "42", displayName: "Exact Runner" }, stats: ["3", "24", "0"] }] },
] }] } });
assert.equal(box.byId["42"].pass_tds, 2);
assert.equal(gradeCustomerPick({ player_id: "42", player_name: "Wrong Name", category: "rush_yds", side: "OVER", line: 67.5, odds: -105 }, box).result, "WIN", "official ESPN athlete ID is primary");
assert.equal(gradeCustomerPick({ player_id: "42", player_name: "Exact Runner", category: "pass_tds", side: "UNDER", line: 2.5, odds: -110 }, box).result, "WIN");
assert.equal(gradeCustomerPick({ player_id: "42", player_name: "Exact Runner", category: "anytime_td", side: "ANYTIME_TD", line: null, odds: 140 }, box).result, "WIN");
const passingOnly = { byId: { 9: { name: "Passing QB", pass_tds: 4, rush_tds: 0, rec_tds: 0 } }, byName: {} };
assert.equal(gradeCustomerPick({ player_id: "9", player_name: "Passing QB", category: "anytime_td", side: "ANYTIME_TD", odds: 200 }, passingOnly).result, "LOSS", "passing a TD never grades as personally scoring one");
assert.equal(unitPnl("WIN", 140), 1.4);
assert.equal(unitPnl("LOSS", 140), -1);

const sql = fs.readFileSync(path.join(__dirname, "../../sql/nfl_prop_customer_picks.sql"), "utf8");
assert.match(sql, /unique \(event_id, player_id, category\)/);
assert.match(sql, /grant update \(final_stat, result, unit_pnl, result_source, graded_at\)/);
assert.doesNotMatch(sql, /grant\s+delete/i);
assert.match(sql, /enable row level security/);
const routeSource = fs.readFileSync(path.join(__dirname, "../routes/nflPropsTracker.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
assert.match(routeSource, /router\.get\("\/", requireAuth, requireAdminUser,/,
  "tracker data requires both bearer authentication and the database admin check");
assert.match(serverSource, /app\.use\("\/api\/nfl-props-tracker", nflPropsTrackerRoutes\)/,
  "the admin tracker route is mounted by the active production entry point");

(async () => {
  const saved = await persistPublishedPicks(fakeDb, rows);
  assert.equal(saved.attempted, 3);
  assert.equal(persisted.length, 3);
  assert.deepEqual(options, {
    onConflict: "event_id,player_id,category",
    ignoreDuplicates: true,
  }, "line, side, book, and price moves cannot replace or duplicate the first customer-facing snapshot");
  console.log("nflPropsTracker self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
