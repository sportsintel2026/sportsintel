// routes/expertGrade.js — manual trigger to auto-grade Expert Picks straight bets.
//
//   GET /api/expert-grade           -> ADMIN DRY RUN. Read-only preview of what
//                                      WOULD be graded. Writes nothing.
//   GET /api/expert-grade?write=1   -> Actually writes results into expert_picks.
//                                      Requires the existing admin authentication.
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
const adminGuard = require("../middleware/adminGuard");
const { requireAuth, supabase } = require("../middleware/auth");

const OWNER_EMAIL = "r7002g@gmail.com";

function isWriteRequest(req) {
  return req.query.write === "1" || req.query.write === "true";
}

function hasAdminSecret(req) {
  return Boolean(
    (req.query && req.query.key)
    || req.get("x-admin-token")
    || req.get("x-admin-key")
  );
}

function requireAdminUser(req, res, next) {
  return requireAuth(req, res, async () => {
    if (req.user && req.user.email === OWNER_EMAIL) return next();
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", req.user.id)
        .single();
      if (!error && data && data.is_admin === true) return next();
    } catch (_) {}
    return res.status(404).json({ error: "Not found" });
  });
}

function guardExpertGrade(req, res, next) {
  if (hasAdminSecret(req)) return adminGuard(req, res, next);
  return requireAdminUser(req, res, next);
}

router.get("/", guardExpertGrade, async (req, res) => {
  const write = isWriteRequest(req);
  try {
    const result = await gradeExpertPicks({ dryRun: !write });
    res.json(result);
  } catch (err) {
    console.error("[expert-grade] failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._test = { guardExpertGrade, hasAdminSecret, requireAdminUser };
