// adminGuard - WZ-ADMIN-GUARD-2026-07-17 :: gate for diagnostic / manual-trigger endpoints.
// These are dev/ops tools (grading triggers, paid-API probes, key-presence diagnostics) that must
// NOT be public at launch - they leak internals and can burn metered API credits if hammered.
// Access requires the ADMIN_KEY env var (set in Railway) supplied as ?key=... or an x-admin-key
// header. If ADMIN_KEY is unset, everything is denied by default (fail-closed). Returns 404 so the
// endpoints aren't advertised.
module.exports = function adminGuard(req, res, next) {
  const key = process.env.ADMIN_KEY;
  const supplied = (req.query && req.query.key) || req.get("x-admin-key") || "";
  if (key && supplied && supplied === key) return next();
  return res.status(404).json({ error: "Not found" });
};
