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

module.exports = { requireAuth, requirePro, requireElite, supabase };
