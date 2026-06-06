// routes/gradeNow.js — manual grading trigger + diagnostics.
//
//   GET /api/grade-now           -> runs gradeFinishedGames() ONCE, returns count.
//   GET /api/grade-now?debug=1   -> READ-ONLY. Reports, per pending MLB pick's date,
//                                   whether its game_id matches the day's schedule and
//                                   what status that game has. Explains a "graded:0".
//
// Safe + idempotent: grading only settles still-pending picks of FINISHED games to
// their true box-score result; never changes an already-graded pick. debug writes
// nothing. Same safety contract as /api/expert-grade.
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const { gradeFinishedGames } = require("../services/predictionTracker");
const { getScheduleForDate } = require("../services/mlbStatsApi");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

router.get("/", async (req, res) => {
  try {
    if (req.query.debug === "1" || req.query.debug === "true") {
      return res.json(await debugReport());
    }
    const graded = await gradeFinishedGames();
    res.json({ ok: true, graded: graded == null ? 0 : graded });
  } catch (err) {
    console.error("[grade-now] failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Read-only: why aren't pending MLB picks grading? For each date, fetch the schedule
// and check game_id match + status against what's pending.
async function debugReport() {
  const supabase = db();
  const { data: pending, error } = await supabase
    .from("model_predictions")
    .select("id,league,market,selection,game_id,game_date,result")
    .eq("result", "pending");
  if (error) return { ok: false, error: error.message };

  const rows = pending || [];
  const mlb = rows.filter(p => p.league !== "nba");

  const byDate = {};
  for (const p of mlb) (byDate[p.game_date] ||= []).push(p);

  const report = {};
  for (const [date, preds] of Object.entries(byDate)) {
    let schedule = [];
    let schedErr = null;
    try { schedule = await getScheduleForDate(date); }
    catch (e) { schedErr = e.message; }

    const sched = {};
    for (const g of schedule) sched[String(g.id)] = g;

    const markets = {};
    for (const p of preds) markets[p.market] = (markets[p.market] || 0) + 1;

    const matched = [], unmatched = [], statuses = {};
    const seen = new Set();
    for (const p of preds) {
      const id = String(p.game_id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (sched[id]) { matched.push(id); statuses[id] = sched[id].status; }
      else unmatched.push(id);
    }

    report[date] = {
      pending: preds.length,
      markets,
      scheduleGames: schedule.length,
      finalGames: schedule.filter(g => g.status === "final").length,
      schedErr,
      sampleScheduleIds: schedule.slice(0, 4).map(g => ({ id: String(g.id), status: g.status })),
      matchedGameIds: matched.slice(0, 25),
      matchedStatuses: statuses,
      unmatchedGameIds: unmatched.slice(0, 25),
    };
  }

  return {
    ok: true,
    pendingTotal: rows.length,
    mlbPendingTotal: mlb.length,
    sample: mlb.slice(0, 6).map(p => ({ market: p.market, game_id: String(p.game_id), game_date: p.game_date, selection: p.selection })),
    byDate: report,
  };
}

module.exports = router;
