// WZ-UFCEDGESPLIT-2026-08-15 / WZ-UFCSPLIT-WINDOW-2026-08-15 :: read-only split of the settled UFC
// record by the sign of edge_pct (model_win% - market_win%). The board ranks UFC on WIN PROBABILITY,
// not edge, so most of a card is picked with a NEGATIVE edge (the model rates its own side below the
// book). This asks whether the record is carried by the positive-edge picks or the negative-edge ones.
//
// The first baseline read was contaminated: UFC 330 early prelims had already graded before it ran
// (gradedAtMax came back after UFC 330 with ufc-330 in eventSlugs), so "out-of-sample" was lost.
// WINDOWING recovers it retroactively -- graded_before=<UFC 330 first graded_at> reconstructs the true
// pre-330 baseline; graded_after=<same> isolates UFC 330 once its main card finishes. Both bounds are
// EXCLUSIVE ISO-8601 timestamps, applied at the query so the 1000-row cap cannot truncate before the
// window is applied; a malformed bound returns 400, never a silent unfiltered read.
//
// STRICTLY READ-ONLY: SELECT-only, zero writes, no schema change, no adminGuard (openable in a browser,
// no key in the URL). ROI is computed at the REAL posted price from the `odds` column via
// priceMath.payout -- there is NO -110 default anywhere. Pushes are excluded from win rate and ROI and
// counted separately. Every rate and ROI carries its own n in the same object.
//   /api/ufcsplit  [?graded_before=ISO-8601] [?graded_after=ISO-8601]
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

// Strict ISO-8601 parse. Date.parse alone is lenient (accepts "2026", "May 3 2026"), so gate on an
// explicit ISO shape FIRST, then require a real date. Returns { iso, ms } or null; a null becomes a 400
// at the call site -- never a silent fall-through to an unfiltered read. Exported-by-brace for the ruler.
function parseIsoStrict(v) {
  if (typeof v !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  return { iso: new Date(ms).toISOString(), ms };
}

router.get("/", async (req, res) => {
  const TOKEN = "WZ-UFCEDGESPLIT-2026-08-15";
  try {
    // WZ-UFCSPLIT-WINDOW-2026-08-15 :: optional EXCLUSIVE graded_at bounds. Validate BEFORE any fetch.
    // A malformed bound is a hard 400 with the offending value echoed -- it must NOT fall back to an
    // unfiltered read, because a whole-table answer that looks real is exactly the trap here.
    let before = null;
    let after = null;
    if (req.query.graded_before !== undefined) {
      before = parseIsoStrict(req.query.graded_before);
      if (!before) return res.status(400).json({ token: TOKEN, error: "graded_before is not a valid ISO-8601 timestamp", graded_before: req.query.graded_before });
    }
    if (req.query.graded_after !== undefined) {
      after = parseIsoStrict(req.query.graded_after);
      if (!after) return res.status(400).json({ token: TOKEN, error: "graded_after is not a valid ISO-8601 timestamp", graded_after: req.query.graded_after });
    }
    if (before && after && after.ms >= before.ms) {
      return res.status(400).json({ token: TOKEN, error: "empty window: graded_after must be strictly before graded_before", graded_after: after.iso, graded_before: before.iso });
    }

    const supabase = db();
    if (!supabase) return res.status(500).json({ token: TOKEN, error: "no supabase client" });
    // Supabase .select() silently caps at 1000 rows oldest-first -- paginate to get the whole window.
    // The bounds are applied INSIDE the query (.lt/.gt on graded_at), NOT to the fetched array: filtering
    // after the fetch would let the 1000-row cap truncate before the window and return a partial answer.
    // .lt/.gt also drop rows whose graded_at is NULL (SQL null comparisons are never true) -- the intended
    // exclusion, since a null graded_at cannot satisfy a time bound (reported as nullGradedAtExcluded).
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from("ufc_picks")
        .select("bout_id, event_slug, event_name, pick, win_pct, market_win_pct, edge_pct, is_value, odds, result, graded_at");
      if (before) q = q.lt("graded_at", before.iso); // exclusive upper bound
      if (after) q = q.gt("graded_at", after.iso); // exclusive lower bound
      q = q.order("bout_id", { ascending: true }).range(from, from + PAGE - 1);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    const split = computeSplit(rows);
    const bounded = !!(before || after);
    res.json({
      token: TOKEN,
      note: "READ-ONLY. Settled UFC record split by sign of edge_pct (model win% - market win%), over the graded_at window in appliedWindow -- both bounds EXCLUSIVE, null = unbounded. Rows with a null graded_at are EXCLUDED whenever either bound is set (they cannot satisfy a time bound) and are included only on a fully unbounded read. Win rate and ROI are on win/loss rows only; pushes excluded and counted. ROI at the REAL posted price via priceMath.payout -- never -110; win/loss rows with no usable price are excluded from ROI (noPriceExcludedFromRoi) but kept in the win rate. is_value=true is reported separately. Reconstruct the pre-UFC-330 baseline with graded_before=<UFC 330 first graded_at>; isolate UFC 330 with graded_after=<same>.",
      appliedWindow: { graded_before: before ? before.iso : null, graded_after: after ? after.iso : null },
      nullGradedAtExcluded: bounded,
      rowsFetched: rows.length,
      pagedNotExactly1000: rows.length !== 1000, // proves pagination did not silently stop at the 1000-row cap
      ...split,
    });
  } catch (e) {
    res.status(500).json({ token: TOKEN, error: String((e && e.message) || e) });
  }
});

module.exports = router;
