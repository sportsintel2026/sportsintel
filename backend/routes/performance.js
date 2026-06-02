// Performance route — serves the model's tracked record.
//
// GET /api/performance/mlb  → win/loss/ROI by market and confidence tier.
//
// "Qualified picks": the model publishes every edge it finds, but its low-conviction
// (NEUTRAL / LOW) plays are noise and drag the record down. The headline record now
// reflects only QUALIFIED picks — those the model actually rated with conviction
// (confidence in QUALIFYING_TIERS) OR whose modeled edge clears MIN_EDGE.
// We still return the FULL record alongside it, so nothing is hidden.
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// --- selection rule (tune here) ---------------------------------------------
// Qualified picks = the model's conviction plays. NEUTRAL/LOW are the model
// saying "no real lean" — those are the noise that drags the record down, so
// they're set aside. Change QUALIFYING_TIERS to widen/narrow what counts.
const QUALIFYING_TIERS = ["HIGH", "MEDIUM"];
function isQualified(r) {
  const conf = (r.confidence || "NEUTRAL").toUpperCase();
  return QUALIFYING_TIERS.includes(conf);
}
// ----------------------------------------------------------------------------

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
      .select("market, confidence, result, odds, edge, game_date, clv, beat_close, closing_odds")
      .eq("league", "mlb")
      .in("result", ["win", "loss"]); // graded, decisive only (skip pending/push)
    if (error) throw new Error(error.message);
    const rows = data || [];

    // HR props are plus-money longshots — a win/loss record is meaningless for them
    // (a 12% hit rate can still be profitable). They distort the headline, so the
    // core record (overall, by market, by confidence) is moneyline + totals only.
    // HR props live exclusively in their own section below (hrProps), measured by ROI.
    const coreRows = rows.filter(r => r.market !== "hr_prop");

    // Qualified set drives the headline; full set kept for transparency.
    const qualifiedRows = coreRows.filter(isQualified);

    const build = (set) => {
      const buckets = { overall: blank(), byMarket: {}, byConfidence: {} };
      for (const r of set) {
        const won = r.result === "win";
        const profit = won ? unitProfit(r.odds) : -1;
        tally(buckets.overall, won, profit);
        buckets.byMarket[r.market] ||= blank();
        tally(buckets.byMarket[r.market], won, profit);
        const conf = (r.confidence || "NEUTRAL").toUpperCase();
        buckets.byConfidence[conf] ||= blank();
        tally(buckets.byConfidence[conf], won, profit);
      }
      finalize(buckets.overall);
      for (const k of Object.keys(buckets.byMarket)) finalize(buckets.byMarket[k]);
      for (const k of Object.keys(buckets.byConfidence)) finalize(buckets.byConfidence[k]);
      return buckets;
    };

    const qualified = build(qualifiedRows);
    const full = build(coreRows);

    // also count pending (core markets only — matches the headline record)
    const { count: pendingCount } = await supabase
      .from("model_predictions")
      .select("id", { count: "exact", head: true })
      .eq("result", "pending")
      .in("market", ["moneyline", "total"]);

    // ── CLV summary ───────────────────────────────────────────────────────────
    // CLV is captured at game start regardless of win/loss, so we compute it over
    // ALL qualified MLB ML/totals picks that have a closing line (not just decided
    // ones). Average CLV and % that beat the close are the sharp-signal metrics.
    const { data: clvData } = await supabase
      .from("model_predictions")
      .select("confidence, clv, beat_close")
      .eq("league", "mlb")
      .in("market", ["moneyline", "total"])
      .not("clv", "is", null);
    const clvRows = (clvData || []).filter(isQualified);
    let clvSummary = null;
    if (clvRows.length > 0) {
      const beat = clvRows.filter(r => r.beat_close === true).length;
      const avgClv = clvRows.reduce((s, r) => s + (Number(r.clv) || 0), 0) / clvRows.length;
      clvSummary = {
        sample: clvRows.length,
        beatClose: beat,
        beatClosePct: Math.round((beat / clvRows.length) * 1000) / 10,
        // express avg CLV as a percentage-point swing in fair win prob
        avgClvPct: Math.round(avgClv * 10000) / 100,
      };
    }

    // ── HR-prop accuracy ──────────────────────────────────────────────────────
    // HR props are plus-money longshots, so they're shown separately and NOT gated
    // to the qualified tiers. Hit rate = how often the picked player actually homered.
    const hrRows = rows.filter(r => r.market === "hr_prop");
    let hrProps = null;
    if (hrRows.length > 0) {
      let wins = 0, units = 0, oddsSum = 0, oddsN = 0;
      for (const r of hrRows) {
        const won = r.result === "win";
        if (won) wins++;
        units += won ? unitProfit(r.odds) : -1;
        if (r.odds != null) { oddsSum += Number(r.odds); oddsN++; }
      }
      const n = hrRows.length;
      hrProps = {
        picks: n,
        hits: wins,
        misses: n - wins,
        hitRatePct: Math.round((wins / n) * 1000) / 10,
        roi: Math.round((units / n) * 1000) / 10,
        avgOdds: oddsN ? Math.round(oddsSum / oddsN) : null,
      };
    }

    res.json({
      // Headline = qualified picks (what we stand behind).
      ...qualified,
      totalGraded: qualifiedRows.length,
      // Full sample kept visible so nothing is hidden.
      fullSample: {
        ...full,
        totalGraded: rows.length,
      },
      clv: clvSummary,
      hrProps,
      filter: {
        qualifyingTiers: QUALIFYING_TIERS,
        excludedCount: rows.length - qualifiedRows.length,
      },
      pendingCount: pendingCount || 0,
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
