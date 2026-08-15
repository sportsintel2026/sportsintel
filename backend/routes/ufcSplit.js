// WZ-UFCEDGESPLIT-2026-08-15 :: read-only BASELINE of the settled UFC record, split by the sign of
// edge_pct (model_win% - market_win%). The board ranks UFC picks on WIN PROBABILITY, not edge, so
// most of a card is picked with a NEGATIVE edge (the model rates its own side below the book). The
// question this freezes, BEFORE UFC 330 grades tonight: is the UFC record carried by the positive-edge
// picks, or do the negative-edge picks win too? Taking the read now makes tonight out-of-sample; taking
// it after would bake tonight in and the split could not be trusted (CLAUDE.md: in-sample top-50 by
// edge went 68%, frozen out-of-sample it went 51.7%).
//
// STRICTLY READ-ONLY: SELECT-only, zero writes, no schema change, no adminGuard (openable in a browser,
// no key in the URL). ROI is computed at the REAL posted price from the `odds` column via
// priceMath.payout -- there is NO -110 default anywhere. Pushes are excluded from win rate and ROI and
// counted separately. Every rate and ROI carries its own n in the same object.
//   /api/ufcsplit
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { payout, breakEven, ev } = require("../services/priceMath"); // real posted-price math; NEVER -110

const router = express.Router();

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// PURE aggregation, exported for the ruler test. `rows` are raw ufc_picks rows. Uses the priceMath
// primitives above -- no inline price math. result strings are the real ones ufcGrader writes:
// "win" / "loss" / "push" (and "pending" for ungraded, which is excluded here).
function computeSplit(rows) {
  // null/undefined/"" -> null (NOT 0): Number(null) is 0 and Number("") is 0, which would turn a
  // missing odds into payout(0) = -Infinity and a missing edge_pct into the "zero" bucket. Guard first.
  const num = (v) => { const x = (v === null || v === undefined || v === "") ? NaN : Number(v); return Number.isFinite(x) ? x : null; };
  // settled = graded to a real outcome. pushes are settled but score no win/loss and no ROI.
  const settled = (rows || []).filter((r) => r.result === "win" || r.result === "loss" || r.result === "push");
  const bucketOf = (r) => { const e = num(r.edge_pct); if (e == null) return null; return e > 0 ? "positive" : e < 0 ? "negative" : "zero"; };
  const blank = () => ({ n: 0, wins: 0, losses: 0, pushes: 0, edgeSum: 0, edgeN: 0, wpSum: 0, wpN: 0, mktSum: 0, mktN: 0, beSum: 0, evSum: 0, priced: 0, profit: 0 });
  const acc = { positive: blank(), negative: blank(), zero: blank(), value: blank() };

  const addTo = (b, r) => {
    b.n++;
    if (r.result === "win") b.wins++;
    else if (r.result === "loss") b.losses++;
    else if (r.result === "push") b.pushes++;
    const eP = num(r.edge_pct); if (eP != null) { b.edgeSum += eP; b.edgeN++; }
    const wP = num(r.win_pct); if (wP != null) { b.wpSum += wP; b.wpN++; }
    const mP = num(r.market_win_pct); if (mP != null) { b.mktSum += mP; b.mktN++; }
    // ROI only on win/loss rows that carry a usable posted price. push and priceless rows never enter it.
    if (r.result === "win" || r.result === "loss") {
      const o = num(r.odds), pay = o == null ? null : payout(o);
      if (pay != null) {
        b.priced++;
        b.profit += r.result === "win" ? pay : -1;
        const be = breakEven(o); if (be != null) b.beSum += be;      // price-implied win rate
        if (wP != null) { const e = ev(wP / 100, o); if (e != null) b.evSum += e; } // model's own EV at its claimed prob
      }
    }
  };

  for (const r of settled) {
    const bk = bucketOf(r);
    if (bk) addTo(acc[bk], r);
    if (r.is_value === true) addTo(acc.value, r);
  }

  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;
  const report = (b) => {
    const graded = b.wins + b.losses; // win/loss only
    return {
      n: b.n, wins: b.wins, losses: b.losses, pushes: b.pushes,
      winRatePct: graded ? r1((b.wins / graded) * 100) : null, winRateN: graded,
      meanEdgePct: b.edgeN ? r2(b.edgeSum / b.edgeN) : null,
      meanWinPct: b.wpN ? r2(b.wpSum / b.wpN) : null,
      meanMarketWinPct: b.mktN ? r2(b.mktSum / b.mktN) : null,
      // ROI = flat-stake return on the win/loss rows with a real price. profit at payout(odds); loss = -1.
      roiPct: b.priced ? r1((b.profit / b.priced) * 100) : null, roiN: b.priced,
      unitsProfit: b.priced ? r2(b.profit) : null,
      noPriceExcludedFromRoi: graded - b.priced,
      meanBreakEvenPct: b.priced ? r2((b.beSum / b.priced) * 100) : null, // avg price paid, as a win-rate the bucket had to beat
      meanModelEvUnits: b.priced ? r2(b.evSum / b.priced) : null,         // model's self-assessed EV/bet at its claimed prob
    };
  };

  const gradedAts = settled.map((r) => r.graded_at).filter(Boolean).sort();
  const eventSlugs = Array.from(new Set((rows || []).map((r) => r.event_slug).filter(Boolean))).sort();
  return {
    settledN: settled.length,
    window: { events: eventSlugs.length, eventSlugs, gradedAtMin: gradedAts[0] || null, gradedAtMax: gradedAts[gradedAts.length - 1] || null },
    byEdgeSign: { positive: report(acc.positive), negative: report(acc.negative), zero: report(acc.zero) },
    isValueTrue: report(acc.value),
  };
}

router.get("/", async (req, res) => {
  const TOKEN = "WZ-UFCEDGESPLIT-2026-08-15";
  try {
    const supabase = db();
    if (!supabase) return res.status(500).json({ token: TOKEN, error: "no supabase client" });
    // Supabase .select() silently caps at 1000 rows oldest-first -- paginate to get the whole table.
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("ufc_picks")
        .select("bout_id, event_slug, event_name, pick, win_pct, market_win_pct, edge_pct, is_value, odds, result, graded_at")
        .order("bout_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    const split = computeSplit(rows);
    res.json({
      token: TOKEN,
      note: "READ-ONLY baseline, frozen before UFC 330 grades so tonight is out-of-sample. Settled UFC record split by sign of edge_pct (model win% - market win%). Win rate and ROI are on win/loss rows only; pushes excluded and counted. ROI at the REAL posted price via priceMath.payout -- never -110; win/loss rows with no usable price are excluded from ROI (noPriceExcludedFromRoi) but kept in the win rate. is_value=true is reported separately to see whether the product's VALUE flag tracks the edge sign.",
      rowsFetched: rows.length,
      pagedNotExactly1000: rows.length !== 1000, // proves pagination did not silently stop at the 1000-row cap
      ...split,
    });
  } catch (e) {
    res.status(500).json({ token: TOKEN, error: String((e && e.message) || e) });
  }
});

module.exports = router;
