// realityCorrection.js
// WZ-REALITY-2026-07-24 :: pure, dependency-free, side-effect-free.
//
// WHY
// ---
// Measured 2026-07-24 across the full graded history. Every market claims more than
// it delivers, and the moneyline board's 0.55 floor was selecting the ONLY losing
// slice of its own output:
//
//   MLB moneyline, realised ROI at real posted prices, by claimed probability:
//     claimed 43-55  ->  +3.10%   n=494   ← the floor EXCLUDES all of this
//     claimed 55+    ->  -3.62%   n=106   ← the floor PUBLISHES only this
//
// Master G called this by instinct in June — his price band "-100..-130 = 55% dog
// wins" is exactly the claimed 45-55 population, and it is the profitable one.
//
// TWO CHANGES, BOTH GROUNDED IN MEASUREMENT
// -----------------------------------------
// 1. CORRECT THE CLAIM. Weighted least squares of actual-vs-claimed, weighted by
//    bucket n, buckets under n=40 dropped as noise. Fit residuals below:
//
//    moneyline  corrected = 1.0134*claimed - 0.0223   (resid -1.18..+0.96 pts)
//      slope ~1.0 — NOT confidence-dependent overclaim, just a flat 2.2-point
//      level shift. A one-parameter correction on n=590.
//
//    total      corrected = 0.6099*claimed + 0.1689   (resid -0.46..+0.14 pts)
//      slope 0.61 — genuine overconfidence. Claim climbs 52->62, reality
//      flatlines 49-55. The model keeps 61 cents of each point of confidence.
//
//    run_line   corrected = 0.8110*claimed + 0.0601   (resid -3.17..+1.51 pts)
//      slope 0.81. The existing curve in winProbCalibration.js (knee 0.57,
//      slope 0.35) sits too high across the whole range, not just too soft.
//
// 2. PUBLISH ON EV, NOT ON A PROBABILITY FLOOR. `WINNER_MIN = 0.55` is a floor on
//    a number that was 2.2 points too high, applied without reference to the price
//    the pick has to beat. Replace it with the only condition that determines
//    whether a bet makes money:
//
//        corrected probability  >  break-even implied by the posted price
//
//    This is arithmetic, not a fitted parameter. It is also NOT the edge selector
//    that failed out-of-sample on 2026-07-20 — that one RANKED on model-vs-market
//    disagreement, which ranks on model error. This ranks on nothing; it only
//    removes bets that lose money at their own corrected number. Ranking stays
//    exactly where it was: by win probability, highest first.
//
// EXPECTED EFFECT, STATED HONESTLY
// --------------------------------
// Replaying the graded history under this rule at a 0-point EV margin, the board
// GROWS from ~107 rows to ~300-500 and realised ROI moves from -3.17% toward
// roughly +1% to +1.8%. That improvement is NOT statistically significant on its
// own (n=494 carries a +/-8.8 point band). What supports it is that three
// independent measurements point the same way: the bucket ROI above, the
// significantly negative gamma on all three markets (-0.316 combined, CI
// [-0.374, -0.259]), and Master G's own price-band read from June.
//
// It publishes MORE picks, not fewer. That was a hard requirement.
//
// REFIT: re-run /api/gammafit?league=mlb, drop the calibration buckets into FITS
// below, and update. The fit data is embedded so it can be audited, not just
// trusted.

"use strict";

// Measured claimed -> actual. slope/intercept in PROBABILITY units (not percent).
const FITS = {
  moneyline: {
    slope: 1.0134, intercept: -0.02229, n: 590,
    buckets: [
      { claimedPct: 42.95, actualPct: 40.79, n: 76 },
      { claimedPct: 47.62, actualPct: 45.83, n: 216 },
      { claimedPct: 52.06, actualPct: 51.49, n: 202 },
      { claimedPct: 56.82, actualPct: 54.17, n: 96 },
    ],
  },
  total: {
    slope: 0.6099, intercept: 0.16892, n: 760,
    buckets: [
      { claimedPct: 48.73, actualPct: 46.15, n: 65 },
      { claimedPct: 52.48, actualPct: 49.04, n: 416 },
      { claimedPct: 56.98, actualPct: 51.49, n: 202 },
      { claimedPct: 61.68, actualPct: 54.55, n: 77 },
    ],
  },
  run_line: {
    slope: 0.8110, intercept: 0.06005, n: 593,
    buckets: [
      { claimedPct: 58.36, actualPct: 52.17, n: 69 },
      { claimedPct: 62.60, actualPct: 56.52, n: 207 },
      { claimedPct: 67.36, actualPct: 62.14, n: 243 },
      { claimedPct: 71.49, actualPct: 60.81, n: 74 },
    ],
  },
};

// Outside the fitted range the curve is extrapolation, so clamp hard. These bound
// how far a correction may ever move a number — a guard against a bad refit
// silently rewriting the whole board.
const MAX_CORRECTION = 0.12; // never move a probability by more than 12 points
const FLOOR = 0.02;
const CEIL = 0.98;

/** American odds -> break-even probability (the number the pick must beat). */
function breakEven(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a < 0 ? -a / (-a + 100) : 100 / (a + 100);
}

/** American odds -> profit per 1 unit risked. */
function profitPerUnit(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? a / 100 : 100 / Math.abs(a);
}

/**
 * Correct a claimed probability to what that claim has historically DELIVERED.
 * Unknown market -> returned unchanged (fail-open; never invents a correction).
 */
function correct(market, claimedProb) {
  const f = FITS[market];
  const p = Number(claimedProb);
  if (!f || !Number.isFinite(p) || p <= 0 || p >= 1) return claimedProb;
  let out = f.slope * p + f.intercept;
  const delta = out - p;
  if (delta > MAX_CORRECTION) out = p + MAX_CORRECTION;
  if (delta < -MAX_CORRECTION) out = p - MAX_CORRECTION;
  return Math.min(CEIL, Math.max(FLOOR, out));
}

/** Expected profit per unit risked, at the corrected probability and real price. */
function evAtPrice(market, claimedProb, american) {
  const p = correct(market, claimedProb);
  const b = profitPerUnit(american);
  if (!Number.isFinite(p) || b == null) return null;
  return p * b - (1 - p);
}

/**
 * THE PUBLISH CONDITION. Replaces `prob < WINNER_MIN`.
 *
 * A pick qualifies when its CORRECTED probability beats the break-even implied by
 * the price it is actually offered at. `minEvMargin` (in units of stake) is the
 * only dial: 0 = publish everything with non-negative expectation; 0.01 = require
 * a 1% edge. Start at 0.
 *
 * Fails OPEN: if the price is missing we cannot price the bet, so we fall back to
 * the old probability floor rather than silently dropping the pick.
 */
function qualifies(market, claimedProb, american, minEvMargin = 0, legacyFloor = 0.55) {
  const b = profitPerUnit(american);
  if (b == null) {
    const p = Number(claimedProb);
    return Number.isFinite(p) && p >= legacyFloor;
  }
  const ev = evAtPrice(market, claimedProb, american);
  return ev != null && ev > minEvMargin;
}

/** Everything about one pick, for display and for the record. */
function describe(market, claimedProb, american) {
  const corrected = correct(market, claimedProb);
  const be = breakEven(american);
  const ev = evAtPrice(market, claimedProb, american);
  return {
    claimed: claimedProb,
    corrected,
    correctionPts: Number.isFinite(corrected) && Number.isFinite(claimedProb)
      ? Math.round((corrected - claimedProb) * 1000) / 10 : null,
    breakEven: be,
    evPerUnit: ev == null ? null : Math.round(ev * 1000) / 1000,
    qualifies: qualifies(market, claimedProb, american),
  };
}

function _selftest() {
  const out = [];
  const ok = (name, cond, got) => out.push({ name, pass: !!cond, got });

  // Moneyline is a flat ~2.2 point haircut across the range.
  ok("ML 55% -> ~53.5%", Math.abs(correct("moneyline", 0.55) - 0.535) < 0.003, correct("moneyline", 0.55));
  ok("ML 60% -> ~58.6%", Math.abs(correct("moneyline", 0.60) - 0.586) < 0.003, correct("moneyline", 0.60));

  // Totals overclaim grows with confidence.
  ok("TOT 55% -> ~50.4%", Math.abs(correct("total", 0.55) - 0.504) < 0.004, correct("total", 0.55));
  ok("TOT 65% -> ~56.5%", Math.abs(correct("total", 0.65) - 0.565) < 0.004, correct("total", 0.65));

  // Run line.
  ok("RL 70% -> ~62.8%", Math.abs(correct("run_line", 0.70) - 0.628) < 0.004, correct("run_line", 0.70));

  // A 57% claim at -150 (break-even 60%) must NOT publish. This is the exact shape
  // of the picks the old floor was letting through.
  ok("57% claim at -150 is rejected", qualifies("moneyline", 0.57, -150) === false, evAtPrice("moneyline", 0.57, -150));

  // A 52% claim at +115 (break-even 46.5%) MUST publish. The old floor killed these.
  ok("52% claim at +115 is published", qualifies("moneyline", 0.52, 115) === true, evAtPrice("moneyline", 0.52, 115));

  // Unknown market passes through untouched.
  ok("unknown market unchanged", correct("spread", 0.6) === 0.6, correct("spread", 0.6));

  // Missing price falls back to the legacy floor rather than dropping the pick.
  ok("no price -> legacy floor applies", qualifies("moneyline", 0.60, null) === true, null);
  ok("no price -> below legacy floor rejected", qualifies("moneyline", 0.50, null) === false, null);

  // The correction clamp holds.
  ok("clamp caps movement", Math.abs(correct("total", 0.95) - 0.95) <= 0.1201, correct("total", 0.95));

  const failed = out.filter(r => !r.pass);
  return { passed: out.length - failed.length, failed: failed.length, results: out };
}

module.exports = { FITS, correct, evAtPrice, qualifies, describe, breakEven, profitPerUnit, _selftest };

if (require.main === module) {
  const r = _selftest();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.failed === 0 ? 0 : 1);
}
