// ============================================================================
// backtest.js — READ-ONLY edge-engine backtester / evidence harness
// ----------------------------------------------------------------------------
// Purpose: before any new "bettable edge" filter is trusted, measure how the
// EXISTING graded plays actually performed, sliced into the buckets that a
// smarter engine would filter on. This is the measurement layer the rest of the
// edge-engine work is built against — it tells us which filters truly earn,
// what the real minimum profitable edge is, and which buckets to suppress.
//
// It reads model_predictions (decisive rows only: win/loss) and reuses the
// EXACT ROI math from performance.js (unitProfit / decimal conversions) so its
// numbers reconcile with the live Performance page. It writes NOTHING.
//
// Mount: GET /api/backtest/:league        (league = mlb|nfl|cfb|nba|nhl)
//        optional ?tier=HIGH  ?market=total  ?minEdge=2  ?since=2026-01-01
// ============================================================================

const express = require("express");
const router = express.Router();
const { supabase } = require("../middleware/auth");

// Core markets per league — MUST match performance.js LEAGUE_CONFIG. Props and
// *_shadow rows are NEVER part of the bettable board (props live in their own
// table; shadow rows are model instrumentation, not real bets). The backtester
// analyzes CORE markets only unless ?market= explicitly asks for one.
const CORE_MARKETS = {
  mlb: ["moneyline", "total", "run_line"],
  nba: ["moneyline", "spread", "total"],
  nfl: ["moneyline", "spread", "total"],
  cfb: ["moneyline", "spread", "total"],
  nhl: ["moneyline", "total", "puck_line"],
};

// ── ROI math — identical to performance.js so results reconcile ─────────────
function unitProfit(odds) {
  if (odds == null) return 1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}
function americanToDecimal(o) {
  if (o == null) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}
function decimalToAmerican(d) {
  if (d == null || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}

// ── Bucket accumulator ──────────────────────────────────────────────────────
function blank() {
  return { w: 0, l: 0, units: 0, clvSum: 0, clvN: 0, beat: 0, beatN: 0, decSum: 0 };
}
function tally(b, won, profit, clv, beatClose) {
  if (won) b.w++; else b.l++;
  b.units += profit;
  if (clv != null && !Number.isNaN(clv)) { b.clvSum += clv; b.clvN++; }
  if (beatClose != null) { b.beatN++; if (beatClose) b.beat++; }
}
function finalize(b) {
  const n = b.w + b.l;
  return {
    plays: n,
    wins: b.w,
    losses: b.l,
    winPct: n ? Math.round((b.w / n) * 1000) / 10 : 0,
    roi: n ? Math.round((b.units / n) * 1000) / 10 : 0,   // % ROI per unit staked
    units: Math.round(b.units * 100) / 100,
    avgClv: b.clvN ? Math.round((b.clvSum / b.clvN) * 100) / 100 : null,
    beatClosePct: b.beatN ? Math.round((b.beat / b.beatN) * 1000) / 10 : null,
  };
}

// ── Bucketing helpers ───────────────────────────────────────────────────────
// Edge ranges (model edge in percentage points). Tuned to common edge sizes.
function edgeBucket(edge) {
  if (edge == null) return "unknown";
  // edge is stored as a decimal fraction (0.05 = 5%). Convert to percentage points.
  const e = Math.abs(edge) * 100;
  if (e < 1) return "0-1%";
  if (e < 2) return "1-2%";
  if (e < 3) return "2-3%";
  if (e < 4) return "3-4%";
  if (e < 5) return "4-5%";
  if (e < 7) return "5-7%";
  return "7%+";
}
// Odds ranges (American). Heavy favorites behave very differently from dogs.
function oddsBucket(odds) {
  if (odds == null) return "unknown";
  if (odds <= -200) return "≤-200 (heavy fav)";
  if (odds <= -130) return "-200..-130 (fav)";
  if (odds < 100)   return "-130..-100 (slight fav)";
  if (odds < 130)   return "+100..+130 (slight dog)";
  if (odds < 200)   return "+130..+200 (dog)";
  return "+200+ (longshot)";
}
// Line-move direction: did the close beat our entry (CLV) — proxy for "money
// moved toward us". Uses beat_close when present, else sign of clv.
function moveBucket(clv, beatClose) {
  if (beatClose === true) return "toward us (beat close)";
  if (beatClose === false) return "against us";
  if (clv == null) return "unknown";
  return clv > 0 ? "toward us (beat close)" : clv < 0 ? "against us" : "flat";
}

router.get("/:league", async (req, res) => {
  const league = String(req.params.league || "").toLowerCase();
  const fTier = req.query.tier ? String(req.query.tier).toUpperCase() : null;
  const fMarket = req.query.market ? String(req.query.market).toLowerCase() : null;
  const fMinEdge = req.query.minEdge != null ? Number(req.query.minEdge) : null;
  const since = req.query.since || null;

  try {
    // Pull decisive graded rows. Paginate defensively (the table is large).
    const PAGE = 1000;
    let from = 0, rows = [];
    for (let i = 0; i < 20; i++) {
      let q = supabase
        .from("model_predictions")
        .select("market, selection, line, odds, edge, confidence, conviction, result, game_date, clv, beat_close, closing_odds, pinnacle_clv, pinnacle_beat_close")
        .eq("league", league)
        .in("result", ["win", "loss"])
        .order("game_date", { ascending: true })
        .range(from, from + PAGE - 1);
      if (since) q = q.gte("game_date", since);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Data hygiene: some prop-shadow rows wrote a raw probability (e.g. "0.665")
    // into the confidence column instead of a tier label. Normalize: anything not
    // in the known tier set is treated as NEUTRAL so it can't pollute tier analysis.
    const TIERS = new Set(["HIGH", "MEDIUM", "LOW", "NEUTRAL"]);
    for (const r of rows) {
      const c = (r.confidence || "NEUTRAL").toUpperCase();
      r.confidence = TIERS.has(c) ? c : "NEUTRAL";
    }

    // Optional pre-filters (so we can backtest "what if we only showed X").
    const coreSet = new Set(CORE_MARKETS[league] || []);
    let filtered = rows.filter((r) => {
      // CORE ONLY by default — props + shadow rows never count toward the bettable
      // board (this mirrors performance.js, which keeps props in their own table).
      if (fMarket) { if (String(r.market || "").toLowerCase() !== fMarket) return false; }
      else if (!coreSet.has(r.market)) return false;
      if (fTier && (r.confidence || "NEUTRAL").toUpperCase() !== fTier) return false;
      if (fMinEdge != null && (r.edge == null || Math.abs(r.edge) < fMinEdge)) return false;
      return true;
    });

    // ── Accumulate into every requested category ────────────────────────────
    const cats = {
      overall: blank(),
      byMarket: {},
      byTier: {},
      byEdge: {},
      byOdds: {},
      byMove: {},
      byClvSign: {},
    };

    for (const r of filtered) {
      const won = r.result === "win";
      const profit = won ? unitProfit(r.odds) : -1;
      const tier = (r.confidence || "NEUTRAL").toUpperCase();
      const clv = r.clv != null ? Number(r.clv) : null;
      const bc = r.beat_close;

      tally(cats.overall, won, profit, clv, bc);
      (cats.byMarket[r.market || "?"] ||= blank()) && tally(cats.byMarket[r.market || "?"], won, profit, clv, bc);
      (cats.byTier[tier] ||= blank()) && tally(cats.byTier[tier], won, profit, clv, bc);
      (cats.byEdge[edgeBucket(r.edge)] ||= blank()) && tally(cats.byEdge[edgeBucket(r.edge)], won, profit, clv, bc);
      (cats.byOdds[oddsBucket(r.odds)] ||= blank()) && tally(cats.byOdds[oddsBucket(r.odds)], won, profit, clv, bc);
      (cats.byMove[moveBucket(clv, bc)] ||= blank()) && tally(cats.byMove[moveBucket(clv, bc)], won, profit, clv, bc);
      const clvSign = clv == null ? "unknown" : clv > 0 ? "positive CLV" : clv < 0 ? "negative CLV" : "flat";
      (cats.byClvSign[clvSign] ||= blank()) && tally(cats.byClvSign[clvSign], won, profit, clv, bc);
    }

    const finalizeMap = (m) => Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, finalize(v)])
    );

    const out = {
      overall: finalize(cats.overall),
      byMarket: finalizeMap(cats.byMarket),
      byTier: finalizeMap(cats.byTier),
      byEdge: finalizeMap(cats.byEdge),
      byOdds: finalizeMap(cats.byOdds),
      byMove: finalizeMap(cats.byMove),
      byClvSign: finalizeMap(cats.byClvSign),
    };

    // ── Recommended minimum edge threshold ──────────────────────────────────
    // Walk edge buckets in ascending order; the threshold is the lowest edge at
    // which ROI is positive AND every higher bucket is also positive (a stable
    // monotonic turn, not a single noisy spike). Needs MIN_N per bucket to count.
    const MIN_N = 25;
    const edgeOrder = ["0-1%", "1-2%", "2-3%", "3-4%", "4-5%", "5-7%", "7%+"];
    const edgeSeq = edgeOrder
      .map((k) => ({ k, ...(out.byEdge[k] || { plays: 0, roi: 0 }) }))
      .filter((e) => e.plays >= MIN_N);
    let recommendedMinEdge = null;
    for (let i = 0; i < edgeSeq.length; i++) {
      if (edgeSeq[i].roi > 0 && edgeSeq.slice(i).every((e) => e.roi > 0)) {
        recommendedMinEdge = edgeSeq[i].k;
        break;
      }
    }

    // ── Best / worst filters (by ROI, among buckets with enough sample) ──────
    const rankable = [];
    const pushRank = (dim, map) => {
      for (const [k, v] of Object.entries(map)) {
        if (v.plays >= MIN_N) rankable.push({ dim, bucket: k, roi: v.roi, plays: v.plays, winPct: v.winPct, avgClv: v.avgClv });
      }
    };
    pushRank("market", out.byMarket);
    pushRank("tier", out.byTier);
    pushRank("edge", out.byEdge);
    pushRank("odds", out.byOdds);
    pushRank("move", out.byMove);
    pushRank("clvSign", out.byClvSign);
    const byRoi = [...rankable].sort((a, b) => b.roi - a.roi);
    const bestFilters = byRoi.slice(0, 5);
    const worstFilters = byRoi.slice(-5).reverse();

    res.json({
      league,
      filters: { tier: fTier, market: fMarket, minEdge: fMinEdge, since },
      sampleSize: filtered.length,
      minBucketN: MIN_N,
      headline: out.overall,
      categories: out,
      recommendedMinEdge,
      bestFilters,
      worstFilters,
      note: "Read-only. Buckets with < " + MIN_N + " plays are excluded from recommendations (too noisy to trust).",
    });
  } catch (err) {
    console.error("[backtest] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
