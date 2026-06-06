// routes/gradeNow.js — manual grading trigger + diagnostics.
//
//   GET /api/grade-now           -> runs gradeFinishedGames() ONCE, returns count.
//   GET /api/grade-now?debug=1   -> READ-ONLY. Per pending MLB date: game_id match +
//                                   status vs the schedule. Explains a "graded:0".
//   GET /api/grade-now?probe=1   -> READ-ONLY. For pending picks whose game is FINAL +
//                                   matched (the ones that *should* grade), fetch the
//                                   real box score and report: box ok? the normalized
//                                   name we search for, whether it's in the box, and a
//                                   sample of the actual box names. Pinpoints why a
//                                   pick won't settle (bad read vs name mismatch).
//
// Safe + idempotent. debug/probe write nothing. Same contract as /api/expert-grade.
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const { gradeFinishedGames } = require("../services/predictionTracker");
const {
  getScheduleForDate, getGameHRHitters, getGamePitcherStrikeouts,
  getGameBatterHits, normPlayerName,
} = require("../services/mlbStatsApi");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

router.get("/", async (req, res) => {
  try {
    if (req.query.debug === "1" || req.query.debug === "true") return res.json(await debugReport());
    if (req.query.probe === "1" || req.query.probe === "true") return res.json(await probeReport());
    const graded = await gradeFinishedGames();
    res.json({ ok: true, graded: graded == null ? 0 : graded });
  } catch (err) {
    console.error("[grade-now] failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function pendingMlb() {
  const supabase = db();
  const { data, error } = await supabase
    .from("model_predictions")
    .select("id,league,market,selection,game_id,game_date,line,result")
    .eq("result", "pending");
  if (error) throw new Error(error.message);
  return (data || []).filter(p => p.league !== "nba");
}

async function debugReport() {
  const mlb = await pendingMlb();
  const byDate = {};
  for (const p of mlb) (byDate[p.game_date] ||= []).push(p);
  const report = {};
  for (const [date, preds] of Object.entries(byDate)) {
    let schedule = [], schedErr = null;
    try { schedule = await getScheduleForDate(date); } catch (e) { schedErr = e.message; }
    const sched = {};
    for (const g of schedule) sched[String(g.id)] = g;
    const markets = {};
    for (const p of preds) markets[p.market] = (markets[p.market] || 0) + 1;
    const matched = [], unmatched = [], statuses = {}, seen = new Set();
    for (const p of preds) {
      const id = String(p.game_id);
      if (seen.has(id)) continue; seen.add(id);
      if (sched[id]) { matched.push(id); statuses[id] = sched[id].status; } else unmatched.push(id);
    }
    report[date] = {
      pending: preds.length, markets, scheduleGames: schedule.length,
      finalGames: schedule.filter(g => g.status === "final").length, schedErr,
      matchedGameIds: matched.slice(0, 25), matchedStatuses: statuses, unmatchedGameIds: unmatched.slice(0, 25),
    };
  }
  return { ok: true, mlbPendingTotal: mlb.length, byDate: report };
}

async function probeReport() {
  const mlb = await pendingMlb();
  const byDate = {};
  for (const p of mlb) (byDate[p.game_date] ||= []).push(p);

  const schedCache = {};      // date -> {id: game}
  const boxCache = new Map();  // `${market}:${game_id}` -> box
  const results = [];
  let probed = 0;
  const MAX = 10;

  for (const [date, preds] of Object.entries(byDate)) {
    if (probed >= MAX) break;
    if (!schedCache[date]) {
      try { const s = await getScheduleForDate(date); const m = {}; for (const g of s) m[String(g.id)] = g; schedCache[date] = m; }
      catch { schedCache[date] = {}; }
    }
    const sched = schedCache[date];
    for (const p of preds) {
      if (probed >= MAX) break;
      const g = sched[String(p.game_id)];
      if (!g || g.status !== "final") continue;        // only probe what *should* grade
      probed++;

      // selection -> player name (strip ":SIDE" for two-sided props)
      const ci = p.selection.lastIndexOf(":");
      const pname = (p.market === "hr_prop") ? p.selection : (ci >= 0 ? p.selection.slice(0, ci) : p.selection);
      const target = normPlayerName(pname);

      const key = `${p.market}:${p.game_id}`;
      let box;
      if (boxCache.has(key)) box = boxCache.get(key);
      else {
        try {
          if (p.market === "player_strikeouts") box = await getGamePitcherStrikeouts(p.game_id);
          else if (p.market === "player_hits") box = await getGameBatterHits(p.game_id);
          else if (p.market === "hr_prop") box = await getGameHRHitters(p.game_id);
          else box = { ok: "n/a (team market)" };
        } catch (e) { box = { ok: false, threw: e.message }; }
        boxCache.set(key, box);
      }

      const map = box && (box.hits || box.ks || box.hr);
      const inMap = map instanceof Map ? map.has(target) : false;
      results.push({
        market: p.market, game_id: String(p.game_id), selection: p.selection,
        boxOk: box ? box.ok : null, boxThrew: box && box.threw ? box.threw : undefined,
        searchName: pname, normalized: target, foundInBox: inMap,
        value: inMap ? map.get(target) : null,
        boxNameCount: map instanceof Map ? map.size : 0,
        sampleBoxNames: map instanceof Map ? Array.from(map.keys()).slice(0, 18) : [],
      });
    }
  }
  return { ok: true, mlbPendingTotal: mlb.length, probed, results };
}

module.exports = router;
