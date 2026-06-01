// routes/expertGrade.js — manual trigger to auto-grade Expert Picks straight bets.
//
//   GET /api/expert-grade           -> DRY RUN. Read-only preview of what WOULD be
//                                      graded. Writes nothing. Safe to open anytime.
//   GET /api/expert-grade?write=1   -> Actually writes results into expert_picks.
//                                      Safe by design: only settles still-pending
//                                      straight bets of FINISHED MLB/NBA games to
//                                      their true result; never changes a pick
//                                      that's already graded (idempotent).
//
// Mount in server.js:
//   const expertGradeRoutes = require("./routes/expertGrade");
//   app.use("/api/expert-grade", expertGradeRoutes);
const express = require("express");
const router = express.Router();
const { gradeExpertPicks } = require("../services/expertPicksGrader");

router.get("/", async (req, res) => {
  const write = req.query.write === "1" || req.query.write === "true";
  try {
    const result = await gradeExpertPicks({ dryRun: !write });
    res.json(result);
  } catch (err) {
    console.error("[expert-grade] failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
