// adminGuard - WZ-ADMIN-GUARD-2026-07-17 :: gate for diagnostic / manual-trigger endpoints.
// These are dev/ops tools (grading triggers, paid-API probes, key-presence diagnostics) that must
// NOT be public at launch - they leak internals and can burn metered API credits if hammered.
//
// WZ-ADMIN-SECRET-SSOT-2026-07-18 :: ONE admin secret for the whole app: ADMIN_TOKEN.
// This guard originally invented a SECOND env var (ADMIN_KEY) for the same job ADMIN_TOKEN was
// already doing for `DELETE /api/cache` (x-admin-token header) and `/api/umpires/backfill`
// (?key=...). Two secrets for one purpose is drift: rotate one and the other silently keeps
// working (or silently 404s everything, which is what happened - ADMIN_KEY was never set, so
// every guarded diagnostic was locked out including from the owner). Root fix: read the
// pre-existing ADMIN_TOKEN. Nothing new to configure, and rotating that one value now rotates
// admin access everywhere at once.
//
// Accepted credentials (any one of these, all compared against ADMIN_TOKEN):
//   ?key=<token>              - query param, matches the /api/umpires/backfill convention
//   x-admin-token: <token>    - header, matches the DELETE /api/cache convention
//   x-admin-key: <token>      - header, kept so anything already sending it keeps working
//
// Fails CLOSED: if ADMIN_TOKEN is unset, or nothing is supplied, or it doesn't match, the request
// is denied. Returns 404 rather than 403 so the endpoints aren't advertised to a prober.
module.exports = function adminGuard(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  const supplied =
    (req.query && req.query.key) ||
    req.get("x-admin-token") ||
    req.get("x-admin-key") ||
    "";
  if (token && supplied && String(supplied) === String(token)) return next();
  return res.status(404).json({ error: "Not found" });
};
