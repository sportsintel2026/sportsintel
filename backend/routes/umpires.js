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
const { backfillUmpireGames } = require("../services/umpireStore");

// Admin gate via ?key= matched to ADMIN_TOKEN. Browser-friendly (no custom header
// needed). The backfill only writes public box-score-derived rows, but we still
// don't want it open to spam (it costs MLB API calls).
function adminOk(req) {
  const want = process.env.ADMIN_TOKEN;
  return !!want && String(req.query.key || "") === String(want);
}

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

// GET /api/umpires/backfill?from=YYYY-MM-DD[&to=YYYY-MM-DD][&cap=150]&key=ADMIN_TOKEN
// Populates umpire_games for the range. Returns done:false + resumeFrom when capped —
// re-hit with from=resumeFrom to continue (idempotent, so overlap is safe).
router.get("/backfill", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, error: "forbidden" });
  const from = req.query.from;
  const to = req.query.to || getEasternDate(0);
  const cap = Math.max(1, Math.min(400, parseInt(req.query.cap, 10) || 150));
  if (!from) return res.status(400).json({ ok: false, error: "from=YYYY-MM-DD required" });
  try {
    const out = await backfillUmpireGames(from, to, cap);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

module.exports = router;
