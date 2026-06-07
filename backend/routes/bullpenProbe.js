// routes/bullpenProbe.js — READ-ONLY diagnostic.
//
//   GET /api/bullpen-probe          -> sample (first 4 teams on today's slate)
//   GET /api/bullpen-probe?all=1    -> every team on today's slate
//   GET /api/bullpen-probe?days=3   -> look-back window (1–5, default 3)
//
// WHY: before wiring a "bullpen fatigue" factor into the model, confirm the
// recent relief-innings data actually flows (golden rule: wired-in code ≠ data
// flowing). This dumps each team's recent relief workload so we can eyeball that
// the numbers are real and sane. Writes nothing; safe to open anytime. TEMP —
// remove once the fatigue factor is built and verified.
//
// Mount in server.js:
//   const bullpenProbeRoutes = require("./routes/bullpenProbe");
//   app.use("/api/bullpen-probe", bullpenProbeRoutes);

const express = require("express");
const router = express.Router();
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { getEasternDate, getScheduleForDate, getTeamBullpenUsage } = require("../services/mlbStatsApi");

router.get("/", async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 3, 1), 5);
    const all = req.query.all === "1" || req.query.all === "true";
    const date = getEasternDate(0);

    let games = [];
    try { games = await getScheduleForDate(date); } catch (_) { games = []; }

    const teams = [];
    const seen = new Set();
    for (const g of games) {
      for (const [id, name] of [[g.awayId, g.awayAbbr || g.away], [g.homeId, g.homeAbbr || g.home]]) {
        if (id && !seen.has(id)) { seen.add(id); teams.push({ id, name }); }
      }
    }

    const sample = all ? teams : teams.slice(0, 4);
    const results = [];
    for (const t of sample) {
      const usage = await getTeamBullpenUsage(t.id, days);
      results.push({ team: t.name, ...(usage || { error: "no usage" }) });
    }

    res.json({
      date, days,
      teamsToday: teams.length,
      teamsProbed: sample.length,
      note: all
        ? "Full slate. READ-ONLY — confirms recent relief-IP data flows before we build the fatigue factor."
        : "Sample (first 4 teams). Add ?all=1 for every team. READ-ONLY — confirms recent relief-IP data flows before we build the fatigue factor.",
      results,
    });
  } catch (err) {
    console.error("[bullpen-probe] error:", err);
    res.status(500).json({ error: "bullpen-probe failed", details: err.message });
  }
});

// ── ONE-TIME BACKFILL (TEMP) ────────────────────────────────────────────────
//   GET /api/bullpen-probe/backfill?confirm=1
// Fills bullpen_fatigue on TODAY's total rows still NULL (rows recorded before
// the fatigue deploy). Reads the cached edges board for the values and writes
// ONLY the bullpen_fatigue column — never the recorded odds/edge snapshot.
// Idempotent: only touches rows where the column is still null, so re-running is
// a no-op. Goes away when this whole TEMP file is removed.
router.get("/backfill", async (req, res) => {
  if (req.query.confirm !== "1") {
    return res.status(400).json({ error: "add ?confirm=1 to run the one-time fatigue backfill" });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "supabase env not configured" });
  }
  try {
    const port = process.env.PORT || 4000;
    let edges;
    try {
      const r = await axios.get(`http://127.0.0.1:${port}/api/edges/mlb`, { timeout: 25000 });
      edges = r.data;
    } catch (e) {
      return res.status(502).json({ error: "could not read model edges", details: e.message });
    }
    const slateDate = edges.date;
    const fatigueById = {};
    for (const g of (edges.games || [])) {
      const b = g.totals && g.totals.breakdown;
      if (b && b.fatigueAdj != null) {
        const a = (b.awayBullpenFatigue && b.awayBullpenFatigue.level) || "?";
        const h = (b.homeBullpenFatigue && b.homeBullpenFatigue.level) || "?";
        fatigueById[g.id] = `away=${a},home=${h},adj=${b.fatigueAdj}`;
      }
    }
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const details = [];
    let rowsUpdated = 0;
    for (const [gid, val] of Object.entries(fatigueById)) {
      const { data, error } = await sb
        .from("model_predictions")
        .update({ bullpen_fatigue: val })
        .eq("game_date", slateDate)
        .eq("market", "total")
        .eq("game_id", gid)
        .is("bullpen_fatigue", null)
        .select("game_id");
      if (error) { details.push({ gid, error: error.message }); continue; }
      const n = (data || []).length;
      rowsUpdated += n;
      if (n > 0) details.push({ gid, value: val, rows: n });
    }
    res.json({
      slateDate,
      gamesWithFatigue: Object.keys(fatigueById).length,
      rowsUpdated,
      note: "Filled bullpen_fatigue only on today's still-null total rows. Re-running is a no-op.",
      details,
    });
  } catch (err) {
    console.error("[bullpen-backfill] error:", err);
    res.status(500).json({ error: "backfill failed", details: err.message });
  }
});

module.exports = router;
