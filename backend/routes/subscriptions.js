const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { createCheckoutSession, createPortalSession } = require("../services/stripe");
const { supabase } = require("../middleware/auth");
const Stripe = require("stripe"); // WZ-SUBSTATS-2026-07-13 :: owner subscriber counts read live from Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// GET /api/subscriptions/me — get current user's subscription + admin status
router.get("/me", requireAuth, async (req, res) => {
  try {
    // Fetch subscription and admin flag in parallel
    const [subResult, profileResult] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("tier, status, current_period_end")
        .eq("user_id", req.user.id)
        .single(),
      supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", req.user.id)
        .single(),
    ]);

    const isAdmin = profileResult.data?.is_admin === true;

    // Build the response
    let plan = { tier: "free", status: "active" };
    if (subResult.data) {
      plan = subResult.data;
    }

    // Safeguard: normalize the tier so stray whitespace or casing
    // (e.g. "elite " from a manual edit) can never break access gating.
    if (plan.tier && typeof plan.tier === "string") {
      plan.tier = plan.tier.trim().toLowerCase();
    }

    // Admins always get full access — surface as elite tier so all existing
    // gating logic (isPro checks) treats them correctly
    if (isAdmin) {
      plan = { ...plan, tier: "elite", status: "active", isAdmin: true };
    } else {
      plan = { ...plan, isAdmin: false };
    }

    res.json(plan);
  } catch (err) {
    console.error("[subscriptions/me] error:", err.message);
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

// GET /api/subscriptions/admin-stats — OWNER ONLY. Real subscriber counts.
//   • "paying"  = live active Stripe subscriptions (the source of truth for who pays)
//   • "trialing"= live trialing Stripe subscriptions
//   • "comped"  = a paid tier in Supabase with NO Stripe subscription (granted by hand)
//   • MRR       = sum of each live sub's price normalized to a monthly amount
// Gated on profiles.is_admin (same signal /me uses). Non-admins get 403.
router.get("/admin-stats", requireAuth, async (req, res) => {
  try {
    const { data: prof } = await supabase.from("profiles").select("is_admin").eq("id", req.user.id).single();
    if (prof?.is_admin !== true) return res.status(403).json({ error: "admin only" });

    // Supabase: whole user base + comped accounts (paid tier, active, no Stripe sub id).
    const { data: subs, error } = await supabase
      .from("subscriptions")
      .select("tier, status, stripe_subscription_id");
    if (error) throw error;
    const rows = subs || [];
    const paidTier = (t) => t && String(t).trim().toLowerCase() !== "free";
    const activeish = (s) => s === "active" || s === "trialing";
    const comped = rows.filter(r => paidTier(r.tier) && activeish(r.status) && !r.stripe_subscription_id).length;
    const freeUsers = rows.filter(r => !paidTier(r.tier)).length;
    const totalUsers = rows.length;

    // Stripe: actual paying subscribers, MRR, and new-in-last-7-days.
    let paying = 0, trialing = 0, newThisWeek = 0, mrrCents = 0, stripeOk = true;
    try {
      const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
      for (const status of ["active", "trialing"]) {
        let startingAfter;
        for (let page = 0; page < 5; page++) {
          const list = await stripe.subscriptions.list({ status, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
          for (const s of (list.data || [])) {
            if (status === "active") paying++; else trialing++;
            if (s.created >= weekAgo) newThisWeek++;
            for (const it of (s.items?.data || [])) {
              const price = it.price || {};
              const amt = Number(price.unit_amount || 0) * Number(it.quantity || 1);
              const rec = price.recurring || {};
              const n = Number(rec.interval_count || 1) || 1;
              let monthly = amt;
              if (rec.interval === "month") monthly = amt / n;
              else if (rec.interval === "year") monthly = amt / (12 * n);
              else if (rec.interval === "week") monthly = amt * (52 / 12) / n;
              else if (rec.interval === "day") monthly = amt * (365 / 12) / n;
              mrrCents += monthly;
            }
          }
          if (!list.has_more) break;
          startingAfter = list.data[list.data.length - 1]?.id;
        }
      }
    } catch (se) {
      stripeOk = false;
      console.error("[admin-stats] stripe error:", se.message);
    }

    res.json({ paying, trialing, comped, freeUsers, totalUsers, newThisWeek, mrr: Math.round(mrrCents / 100), stripeOk });
  } catch (err) {
    console.error("[admin-stats] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
