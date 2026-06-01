const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { createCheckoutSession, createPortalSession } = require("../services/stripe");
const { supabase } = require("../middleware/auth");

// GET /api/subscriptions/me — get current user's subscription + admin status
router.get("/me", requireAuth, async (req, res) => {
  // --- TEMP DEBUG LOGGING (remove once subscription bug is fixed) ---
  console.log("[me-debug] ===== /me called =====");
  console.log("[me-debug] req.user.id:", req.user?.id);
  console.log("[me-debug] req.user.email:", req.user?.email);
  try {
    // Run the two reads SEPARATELY so we can see which one (if any) fails,
    // instead of hiding it inside Promise.all.
    const subResult = await supabase
      .from("subscriptions")
      .select("tier, status, current_period_end")
      .eq("user_id", req.user.id)
      .single();

    console.log("[me-debug] subscription data:", JSON.stringify(subResult.data));
    console.log("[me-debug] subscription error:", JSON.stringify(subResult.error));

    const profileResult = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", req.user.id)
      .single();

    console.log("[me-debug] profile data:", JSON.stringify(profileResult.data));
    console.log("[me-debug] profile error:", JSON.stringify(profileResult.error));

    const isAdmin = profileResult.data?.is_admin === true;

    // Build the response
    let plan = { tier: "free", status: "active" };
    if (subResult.data) {
      plan = subResult.data;
    }

    // Admins always get full access — surface as elite tier so all existing
    // gating logic (isPro checks) treats them correctly
    if (isAdmin) {
      plan = { ...plan, tier: "elite", status: "active", isAdmin: true };
    } else {
      plan = { ...plan, isAdmin: false };
    }

    console.log("[me-debug] FINAL plan returned:", JSON.stringify(plan));
    console.log("[me-debug] ======================");
    res.json(plan);
  } catch (err) {
    console.error("[subscriptions/me] error:", err.message);
    console.error("[me-debug] FULL error object:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    // Even on error, fall back to safe default
    res.json({ tier: "free", status: "active", isAdmin: false });
  }
});

// POST /api/subscriptions/checkout — create Stripe checkout session
router.post("/checkout", requireAuth, async (req, res) => {
  try {
    const { priceKey } = req.body;
    // priceKey: "pro_monthly" | "pro_yearly" | "elite_monthly" | "elite_yearly"
    if (!priceKey) {
      return res.status(400).json({ error: "priceKey is required" });
    }
    const session = await createCheckoutSession({
      userId: req.user.id,
      email: req.user.email,
      priceKey,
      successUrl: `${process.env.FRONTEND_URL}/dashboard?upgraded=true`,
      cancelUrl: `${process.env.FRONTEND_URL}/pricing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscriptions/portal — open Stripe billing portal
router.post("/portal", requireAuth, async (req, res) => {
  try {
    const session = await createPortalSession(
      req.user.id,
      `${process.env.FRONTEND_URL}/dashboard`
    );
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
