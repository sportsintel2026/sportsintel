// Umpire tendency endpoints.
//
// STEP 1 (this file): a READ-ONLY probe to verify the extraction against real
// finished games BEFORE any storage is built. No DB writes, no new data sources —
// it just calls getGameUmpireAndTotals (boxscore + linescore we already fetch) and
// returns what it found, so we can eyeball that ump names + K/BB/R/NRFI are real.
//
// Later steps will add: a umpire_games table, a nightly logger, a season backfill,
// and the aggregation endpoint that powers the game-page tendency line + model factor.

const express = require("express");
const router = express.Router();
const {
  getScheduleForDate,
  getGameUmpireAndTotals,
  getEasternDate,
} = require("../services/mlbStatsApi");

// GET /api/umpires/probe                  -> yesterday's finished games (ET)
// GET /api/umpires/probe?date=YYYY-MM-DD  -> a specific date's finished games
// GET /api/umpires/probe?gamePk=716123    -> a single game
router.get("/probe", async (req, res) => {
  try {
    if (req.query.gamePk) {
      const row = await getGameUmpireAndTotals(String(req.query.gamePk));
      return res.json({ ok: true, mode: "single", row });
    }

    const date = req.query.date || getEasternDate(-1); // default: yesterday ET
    const sched = await getScheduleForDate(date).catch(() => null);
    const finals = (sched || []).filter((g) => /final/i.test(g.status || ""));

    const rows = [];
    for (const g of finals.slice(0, 15)) {
      const pk = g.id; // parseGame stores gamePk in .id
      if (!pk) continue;
      const row = await getGameUmpireAndTotals(pk);
      rows.push({
        matchup: `${g.awayAbbr || g.away || "?"} @ ${g.homeAbbr || g.home || "?"}`,
        ...(row || { gamePk: String(pk), umpire: null, note: "extract failed" }),
      });
    }

    res.json({
      ok: true,
      mode: "day",
      date,
      finalGames: finals.length,
      sampled: rows.length,
      withUmpire: rows.filter((r) => r.umpire).length,
      rows,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

module.exports = router;
