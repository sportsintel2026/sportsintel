// Performance route — serves the model's tracked record.
//
// GET /api/performance/mlb  → win/loss/ROI by market and confidence tier.

const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// American odds → profit on a 1-unit win (for ROI). -110 → 0.909, +150 → 1.5
function unitProfit(odds) {
  if (odds == null) return 1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

router.get("/mlb", async (req, res) => {
  try {
    const supabase = db();
    const { data, error } = await supabase
      .from("model_predictions")
      .select("market, confidence, result, odds, edge, game_date")
      .eq("league", "mlb")
      .in("result", ["win", "loss"]); // graded, decisive only (skip pending/push)

    if (error) throw new Error(error.message);

    const rows = data || [];

    // Overall + by market + by confidence
    const buckets = {
      overall: blank(),
      byMarket: {},
      byConfidence: {},
    };

    for (const r of rows) {
      const won = r.result === "win";
      const profit = won ? unitProfit(r.odds) : -1;

      tally(buckets.overall, won, profit);

      buckets.byMarket[r.market] ||= blank();
      tally(buckets.byMarket[r.market], won, profit);

      const conf = r.confidence || "NEUTRAL";
      buckets.byConfidence[conf] ||= blank();
      tally(buckets.byConfidence[conf], won, profit);
    }

    finalize(buckets.overall);
    for (const k of Object.keys(buckets.byMarket)) finalize(buckets.byMarket[k]);
    for (const k of Object.keys(buckets.byConfidence)) finalize(buckets.byConfidence[k]);

    // also count pending + how many days tracked
    const { count: pendingCount } = await supabase
      .from("model_predictions")
      .select("id", { count: "exact", head: true })
      .eq("result", "pending");

    res.json({
      ...buckets,
      pendingCount: pendingCount || 0,
      totalGraded: rows.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Performance] error:", err.message);
    res.status(500).json({ error: "Failed to load performance", details: err.message });
  }
});

function blank() { return { wins: 0, losses: 0, units: 0 }; }
function tally(b, won, profit) {
  if (won) b.wins++; else b.losses++;
  b.units += profit;
}
function finalize(b) {
  const total = b.wins + b.losses;
  b.total = total;
  b.winPct = total > 0 ? Math.round((b.wins / total) * 1000) / 10 : null;
  b.roi = total > 0 ? Math.round((b.units / total) * 1000) / 10 : null; // % ROI per unit
  b.units = Math.round(b.units * 100) / 100;
}

module.exports = router;
