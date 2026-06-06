// Performance route — serves the model's tracked record, per sport (league).
//
// GET /api/performance/:league   (league = mlb | nba | nfl | cfb)
//   → win/loss/ROI by market and confidence tier, a CLV summary, and a SEPARATE
//     props table. Props NEVER count toward the core record or CLV — they live in
//     their own table, measured by hit-rate / ROI (plus-money longshots).
//
// "Qualified picks": the model publishes every edge it finds, but its low-conviction
// (NEUTRAL / LOW) plays are noise and drag the record down. The headline record
// reflects only QUALIFIED picks (confidence in QUALIFYING_TIERS). The FULL record
// is returned alongside it, so nothing is hidden.
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// --- per-sport market config -------------------------------------------------
// core  = team markets that count toward the overall record + CLV
// props = prop markets shown in their OWN table (hit-rate / ROI), never in core
// clv   = markets eligible for a captured closing line; a market with none simply
//         yields clv = null (honest "not captured yet" state for new sports)
const LEAGUE_CONFIG = {
  mlb: { core: ["moneyline", "total", "run_line"], props: ["hr_prop", "player_strikeouts", "player_hits"], clv: ["moneyline", "total"], propsLabel: "Player props" },
  nba: { core: ["moneyline", "spread", "total"], props: ["player_points", "player_rebounds", "player_assists", "player_threes"], clv: ["moneyline", "spread", "total"], propsLabel: "Player props" },
  nfl: { core: ["moneyline", "spread", "total"], props: ["player_props"], clv: ["moneyline", "spread", "total"], propsLabel: "Player props" },
  cfb: { core: ["moneyline", "spread", "total"], props: ["player_props"], clv: ["moneyline", "spread", "total"], propsLabel: "Player props" },
};

// --- selection rule (tune here) ---------------------------------------------
const QUALIFYING_TIERS = ["HIGH", "MEDIUM"];
function isQualified(r) {
  const conf = (r.confidence || "NEUTRAL").toUpperCase();
  return QUALIFYING_TIERS.includes(conf);
}
// ----------------------------------------------------------------------------

// --- per-market track-record resets -----------------------------------------
// A market's published record only counts graded picks on/after this date,
// because the model for that market was materially rebuilt and older picks no
// longer reflect it. NON-DESTRUCTIVE: the old rows stay in the DB, they're just
// not counted on the page (reversible — remove the entry to count them again).
// The cutoff date is also returned to the page so it can show an honest
// "tracking reset on <date>" note rather than silently dropping a record.
const MARKET_RESET = {
  hr_prop: "2026-06-06", // start HR count today (note: 6/6 picks recorded pre-deploy are old-model)
};
function afterReset(r) {
  const cut = MARKET_RESET[r.market];
  return !cut || (r.game_date && r.game_date >= cut);
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

router.get("/:league", async (req, res) => {
  const league = String(req.params.league || "").toLowerCase();
  const cfg = LEAGUE_CONFIG[league];
  if (!cfg) {
    return res.status(400).json({ error: "Unknown league", league, supported: Object.keys(LEAGUE_CONFIG) });
  }
  try {
    const supabase = db();
    // Fetch ALL graded rows by paging. Supabase caps a single select at 1000 rows;
    // once MLB passed ~1000 graded win/loss rows, an unpaginated query silently
    // returned only the OLDEST 1000 and dropped the NEWEST — hiding recent grades,
    // including every newly added strikeout/hits pick (the most recent rows). Page
    // through in 1000-row chunks ordered by id so nothing is lost.
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("model_predictions")
        .select("market, confidence, result, odds, edge, game_date, clv, beat_close, closing_odds")
        .eq("league", league)
        .in("result", ["win", "loss"]) // graded, decisive only (skip pending/push)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }

    // Props are kept entirely out of the core record and CLV — own table only.
    const coreRows = rows.filter(r => cfg.core.includes(r.market));
    const propRows = rows.filter(r => cfg.props.includes(r.market) && afterReset(r));

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

    // pending (core markets for THIS league only — matches the headline record)
    const { count: pendingCount } = await supabase
      .from("model_predictions")
      .select("id", { count: "exact", head: true })
      .eq("league", league)
      .eq("result", "pending")
      .in("market", cfg.core);

    // ── CLV summary (core markets with a captured closing line) ───────────────
    // A sport with no captured closing lines simply returns clv = null.
    const { data: clvData } = await supabase
      .from("model_predictions")
      .select("confidence, clv, beat_close")
      .eq("league", league)
      .in("market", cfg.clv)
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
        avgClvPct: Math.round(avgClv * 10000) / 100,
      };
    }

    // ── Props table (SEPARATE; hit-rate + ROI; never in core record or CLV) ───
    // Overall props summary PLUS a per-stat breakdown (points / rebounds /
    // assists / 3PT for NBA; a single HR-props entry for MLB). Each stat type
    // becomes its own sub-row on the page.
    let props = null;
    if (propRows.length > 0) {
      props = { label: cfg.propsLabel, ...propSummary(propRows), byMarket: {} };
      const byMkt = {};
      for (const r of propRows) { (byMkt[r.market] ||= []).push(r); }
      for (const mkt of Object.keys(byMkt)) props.byMarket[mkt] = propSummary(byMkt[mkt]);
    }

    res.json({
      league,
      // Headline = qualified picks (what we stand behind).
      ...qualified,
      totalGraded: qualifiedRows.length,
      // Full sample kept visible so nothing is hidden.
      fullSample: { ...full, totalGraded: rows.length },
      clv: clvSummary,
      props,
      // Reset cutoffs (per market) so the page can show "tracking reset on <date>".
      propResets: MARKET_RESET,
      // Back-compat: the existing MLB page reads `hrProps`. Keep it for mlb until
      // the page is updated to the generic `props` field.
      hrProps: league === "mlb" ? props : undefined,
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
// Hit-rate / ROI summary for a set of prop rows (used for the props table and
// each per-stat sub-row). Props are graded by hit-rate + ROI, never win/loss record.
function propSummary(rows) {
  let wins = 0, units = 0, oddsSum = 0, oddsN = 0;
  for (const r of rows) {
    const won = r.result === "win";
    if (won) wins++;
    units += won ? unitProfit(r.odds) : -1;
    if (r.odds != null) { oddsSum += Number(r.odds); oddsN++; }
  }
  const n = rows.length;
  return {
    picks: n,
    hits: wins,
    misses: n - wins,
    hitRatePct: Math.round((wins / n) * 1000) / 10,
    roi: Math.round((units / n) * 1000) / 10,
    avgOdds: oddsN ? Math.round(oddsSum / oddsN) : null,
  };
}
module.exports = router;
