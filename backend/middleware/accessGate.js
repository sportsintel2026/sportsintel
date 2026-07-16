// backend/middleware/accessGate.js
// WZ-LOCK-ROUND2-2026-07-15 :: shared access gate for the model-data endpoints (round 2). Same safe
// mechanism as the picks gate in edges.js: redact the model's data from responses for non-full
// requests, server-side, so the raw JSON stops leaking. Real users see no change -- these sections
// are already paywalled or expand-on-tap in the UI.
//
// SAFETY -- never lock out a paying/comped member:
//  * resolveFullAccess MIRRORS the frontend hasFull EXACTLY (isAdmin || tier pro/elite || owner
//    email) against the same Supabase tables, so anyone who has access in the UI passes here.
//  * Internal loopback self-calls (127.0.0.1) -> full.
//  * A transient Supabase error on an AUTHENTICATED request fails OPEN (full) -- a blip can never
//    downgrade a payer. No/invalid token -> redacted.
//  * If the Supabase client is unavailable, the gate disables itself (everyone full).
const { createClient } = require("@supabase/supabase-js");
const _sb = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY) : null;
const OWNER_EMAIL = "r7002g@gmail.com";

function isLoopback(req) {
  const ra = (req.socket && req.socket.remoteAddress) || "";
  return ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
}

async function resolveFullAccess(req) {
  if (!_sb) return true;                        // gate can't function -> fail OPEN (never lock out)
  if (isLoopback(req)) return true;             // internal self-calls
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return false;   // anonymous -> redacted
  let user;
  try {
    const r = await _sb.auth.getUser(h.slice(7));
    user = r.data && r.data.user;
    if (r.error || !user) return false;         // invalid/expired token -> redacted
  } catch (e) { return false; }
  if (user.email === OWNER_EMAIL) return true;
  try {
    const [subR, profR] = await Promise.all([
      _sb.from("subscriptions").select("tier").eq("user_id", user.id).single(),
      _sb.from("profiles").select("is_admin").eq("id", user.id).single(),
    ]);
    if (profR.data && profR.data.is_admin === true) return true;
    let tier = subR.data && subR.data.tier;
    if (typeof tier === "string") tier = tier.trim().toLowerCase();
    return tier === "pro" || tier === "elite";  // mirrors frontend hasFull exactly (no status check)
  } catch (e) {
    return true;                                // authenticated but lookup blipped -> fail OPEN
  }
}

// Empty a model-data payload: [] every array, null every nested object, keep scalars. Uniformly
// safe across the round-2 shapes because every consumer that fires for a non-full user reads
// defensively (d?.games||[] and friends).
function emptyModelData(body) {
  if (Array.isArray(body)) return [];
  if (!body || typeof body !== "object") return body;
  const out = {};
  for (const k of Object.keys(body)) {
    const v = body[k];
    if (Array.isArray(v)) out[k] = [];
    else if (v && typeof v === "object") out[k] = null;
    else out[k] = v;
  }
  out.teaser = true;
  return out;
}

// Middleware: full-access -> untouched; else wrap res.json so every exit path returns empty data.
function gateModelData(req, res, next) {
  resolveFullAccess(req).then((full) => {
    if (!full) { const oj = res.json.bind(res); res.json = (b) => oj(emptyModelData(b)); }
    next();
  }).catch(() => next());
}

module.exports = { resolveFullAccess, emptyModelData, gateModelData };
