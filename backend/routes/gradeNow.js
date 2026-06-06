// routes/gradeNow.js — manual, on-demand trigger for finished-game grading.
//
//   GET /api/grade-now   -> runs gradeFinishedGames() ONCE and returns the count.
//
// Safe by design + idempotent: gradeFinishedGames only settles still-pending picks
// of FINISHED games to their true box-score result; it never changes a pick that's
// already graded, and any unreadable box score is left pending (never a false loss).
// Same safety contract as /api/expert-grade. Used to grade immediately instead of
// waiting for the top-of-hour cron.
const express = require("express");
const router = express.Router();
const { gradeFinishedGames } = require("../services/predictionTracker");

router.get("/", async (req, res) => {
  try {
    const graded = await gradeFinishedGames();
    res.json({ ok: true, graded: graded == null ? 0 : graded });
  } catch (err) {
    console.error("[grade-now] failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
