const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { createCheckoutSession, createPortalSession } = require("../services/stripe");
const { supabase } = require("../middleware/auth");

// GET /api/subscriptions/me — get current user's subscription
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("tier, status, current_period_end")
      .eq("user_id", req.user.id)
      .single();

    if (error || !data) {
      return res.json({ tier: "free", status: "active" });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
