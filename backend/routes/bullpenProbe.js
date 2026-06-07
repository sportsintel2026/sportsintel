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

module.exports = router;
