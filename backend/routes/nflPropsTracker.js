"use strict";

const express = require("express");
const { requireAuth, supabase } = require("../middleware/auth");
const { CATEGORIES, loadTracker } = require("../services/nflPropsTracker");

const router = express.Router();

async function requireAdminUser(req, res, next) {
  try {
    const { data, error } = await supabase.from("profiles")
      .select("is_admin")
      .eq("id", req.user.id)
      .single();
    if (error || data?.is_admin !== true) return res.status(403).json({ error: "admin only" });
    return next();
  } catch (_) {
    return res.status(403).json({ error: "admin only" });
  }
}

function positiveInteger(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

router.get("/", requireAuth, requireAdminUser, async (req, res) => {
  try {
    const category = CATEGORIES.includes(String(req.query.category || "")) ? String(req.query.category) : null;
    const result = ["PENDING", "WIN", "LOSS", "PUSH", "VOID"].includes(String(req.query.result || "").toUpperCase())
      ? String(req.query.result).toUpperCase() : null;
    const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
    const filters = {
      dateFrom: date(req.query.date_from),
      dateTo: date(req.query.date_to),
      season: positiveInteger(req.query.season),
      week: positiveInteger(req.query.week),
      category,
      player: String(req.query.player || "").trim().slice(0, 80) || null,
      result,
    };
    res.json({ ok: true, filters, ...(await loadTracker(filters)) });
  } catch (error) {
    console.error("[NFL Props Tracker] read failed:", error.message);
    res.status(500).json({ error: "NFL Props tracker unavailable" });
  }
});

module.exports = router;
module.exports._test = { requireAdminUser, positiveInteger };
