// Odds route — multi-book line-shopping comparison for subscribers.
// Serves every US book's price per game so people can shop for the best number.
// Rides on getMLBOddsComparison's own 90s cache, so this endpoint is cheap even
// under traffic (one ~2-credit Odds API call only when the cache window lapses).
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

const { getMLBOddsComparison } = require("../services/oddsApi");

const OWNER_EMAIL = "r7002g@gmail.com";
let entitlementClient = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    entitlementClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
} catch (_) {
  entitlementClient = null;
}

async function hasVerifiedFullAccess(req) {
  if (!entitlementClient) return false;

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return false;

  try {
    const { data: { user }, error: authError } = await entitlementClient.auth.getUser(authHeader.slice(7));
    if (authError || !user) return false;
    if (user.email === OWNER_EMAIL) return true;

    const [subscriptionResult, profileResult] = await Promise.all([
      entitlementClient.from("subscriptions").select("tier").eq("user_id", user.id).single(),
      entitlementClient.from("profiles").select("is_admin").eq("id", user.id).single(),
    ]);

    let tier = subscriptionResult.data && subscriptionResult.data.tier;
    if (typeof tier === "string") tier = tier.trim().toLowerCase();
    const isPaid = tier === "pro" || tier === "elite";
    const isAdmin = profileResult.data && profileResult.data.is_admin === true;
    return isPaid || isAdmin;
  } catch (_) {
    return false;
  }
}

// GET /api/odds/mlb — per-game, per-book moneyline + total prices with the best
// price flagged in each market.
router.get("/mlb", async (req, res) => {
  try {
    if (!(await hasVerifiedFullAccess(req))) {
      return res.json({ games: [], gameCount: 0, teaser: true });
    }
    const data = await getMLBOddsComparison();
    res.json(data);
  } catch (e) {
    console.error("[odds] mlb comparison error:", e.message);
    res.status(500).json({ error: "Failed to load odds comparison" });
  }
});

module.exports = router;
