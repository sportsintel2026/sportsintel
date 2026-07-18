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
// WZ-ADMIN-TRIM-2026-07-18 :: trim BOTH sides before comparing.
// Pasting a secret into a hosting dashboard very often carries an invisible trailing newline or
// space, and a browser URL can pick one up too. An invisible character is indistinguishable from
// a wrong token at the call site - it just 404s forever with nothing to debug. Trimming removes
// that entire failure class permanently. It costs no real security: whitespace-only padding is
// not entropy, and a token that differs by anything other than surrounding whitespace still fails.
//
// Accepted credentials (any one of these, all compared against ADMIN_TOKEN):
//   ?key=<token>              - query param, matches the /api/umpires/backfill convention
//   x-admin-token: <token>    - header, matches the DELETE /api/cache convention
//   x-admin-key: <token>      - header, kept so anything already sending it keeps working
//
// WZ-ADMIN-DIAG-2026-07-18 :: `?diag=1` returns WHY a request was denied, as booleans only.
// It never returns the token, any part of it, or its length - only: is ADMIN_TOKEN configured on
// the server, did the caller supply anything, and would it have matched if whitespace were the
// only difference. An attacker learns nothing they couldn't already infer from allow-vs-deny, but
// the owner instantly sees whether the problem is an unset env var, a missing param, or a stray
// space. Remove this block once it has served its purpose if you'd rather carry no diag surface.
//
// Fails CLOSED: if ADMIN_TOKEN is unset, or nothing is supplied, or it doesn't match, the request
// is denied. Returns 404 rather than 403 so the endpoints aren't advertised to a prober.
module.exports = function adminGuard(req, res, next) {
  const rawToken = process.env.ADMIN_TOKEN;
  const rawSupplied =
    (req.query && req.query.key) ||
    req.get("x-admin-token") ||
    req.get("x-admin-key") ||
    "";

  const token = String(rawToken == null ? "" : rawToken).trim();
  const supplied = String(rawSupplied).trim();

  if (token && supplied && supplied === token) return next();

  if (req.query && (req.query.diag === "1" || req.query.diag === "true")) {
    return res.status(404).json({
      error: "Not found",
      diag: {
        tokenConfigured: Boolean(token),
        tokenHadSurroundingWhitespace:
          Boolean(rawToken) && String(rawToken) !== token,
        suppliedSomething: Boolean(supplied),
        suppliedHadSurroundingWhitespace:
          Boolean(rawSupplied) && String(rawSupplied) !== supplied,
        matches: Boolean(token) && supplied === token,
        hint: !token
          ? "ADMIN_TOKEN is not set (or is empty) in this running service."
          : !supplied
          ? "No credential arrived. Check ?key= is present and not stripped."
          : "A credential arrived but did not match ADMIN_TOKEN.",
      },
    });
  }

  return res.status(404).json({ error: "Not found" });
};
