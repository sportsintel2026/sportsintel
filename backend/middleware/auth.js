const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Verify user is authenticated
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = user;
  next();
}

// Verify user has active Pro or Elite subscription
async function requirePro(req, res, next) {
  await requireAuth(req, res, async () => {
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("tier, status")
      .eq("user_id", req.user.id)
      .single();

    if (!subscription || subscription.status !== "active" || subscription.tier === "free") {
      return res.status(403).json({
        error: "Pro subscription required",
        upgrade_url: "/pricing",
      });
    }

    req.subscription = subscription;
    next();
  });
}

// Verify user has Elite subscription
async function requireElite(req, res, next) {
  await requireAuth(req, res, async () => {
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("tier, status")
      .eq("user_id", req.user.id)
      .single();

    if (!subscription || subscription.status !== "active" || subscription.tier !== "elite") {
      return res.status(403).json({
        error: "Elite subscription required",
        upgrade_url: "/pricing",
      });
    }

    req.subscription = subscription;
    next();
  });
}

// WZ-REQUIREPAID-2026-07-13 :: admin-aware "All-Access" gate for paid DATA endpoints.
// Mirrors the frontend (isAdmin || tier pro/elite) and the /subscriptions/me queries
// exactly, so admins/owner are NEVER locked out (requirePro above does NOT admin-bypass).
// Fails CLOSED on lookup error (denies) — flip the catch to next() if you would rather
// not risk locking a paying user during a transient Supabase error.
async function requirePaid(req, res, next) {
  await requireAuth(req, res, async () => {
    try {
      const [subResult, profileResult] = await Promise.all([
        supabase.from("subscriptions").select("tier, status").eq("user_id", req.user.id).single(),
        supabase.from("profiles").select("is_admin").eq("id", req.user.id).single(),
      ]);
      const isAdmin = profileResult.data?.is_admin === true;
      let tier = subResult.data?.tier;
      if (typeof tier === "string") tier = tier.trim().toLowerCase();
      const active = subResult.data?.status === "active";
      const isPaid = isAdmin || (active && (tier === "pro" || tier === "elite"));
      if (!isPaid) {
        return res.status(403).json({ error: "All-Access required", upgrade_url: "/pricing" });
      }
      req.subscription = subResult.data || null;
      req.isAdmin = isAdmin;
      next();
    } catch (err) {
      return res.status(403).json({ error: "All-Access required", upgrade_url: "/pricing" });
    }
  });
}

module.exports = { requireAuth, requirePro, requireElite, requirePaid, supabase };
