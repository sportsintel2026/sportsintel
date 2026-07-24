// priceMath.js
// WZ-PRICEMATH-2026-07-22 :: the price layer. Pure, dependency-free, side-effect-free.
//
// WHY THIS FILE EXISTS
// -------------------
// Every selection decision in this project is currently made on a quantity that
// ignores the vig: `edge = model_prob - devigTwoWay(...)`. The customer does not
// bet at the de-vigged price. They bet at the POSTED price. The gap between those
// two numbers is 1.1 to 2.5 probability points depending on the price, and it is
// LARGER on favorites than on underdogs — which is exactly the population the
// board's >=55% floor selects. That gap is not a rounding error; it is the whole
// of the -2.1% the moneyline board is bleeding.
//
// Nothing here changes behavior. It is math other modules can call. It is the
// foundation for: (a) selecting on EV instead of on de-vigged edge, (b) measuring
// CLV without the structural bias currently in predictionTracker, and (c) fitting
// the model's weight empirically instead of assuming W_MODEL = 0.55.
//
// House rule reminder encoded here: NEVER quote a return you have not priced.
// Every function below takes a real posted price. There is no -110 default anywhere.

"use strict";

// ── PRICE PRIMITIVES ─────────────────────────────────────────────────────────

/** American odds -> the book's implied probability, VIG INCLUDED. This is the
 *  break-even win rate for this bet. It is the number the pick must beat. */
function impliedProb(american) {
  if (american == null || !Number.isFinite(american)) return null;
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

/** American odds -> net decimal payout per 1 unit risked (profit, not return). */
function payout(american) {
  if (american == null || !Number.isFinite(american)) return null;
  return american > 0 ? american / 100 : 100 / -american;
}

/** The win rate this price requires to break even. Alias of impliedProb, named
 *  for the thing it actually means at the point of decision. */
function breakEven(american) {
  return impliedProb(american);
}

/** Probability -> American odds. Inverse of impliedProb. */
function probToAmerican(p) {
  if (p == null || !(p > 0) || !(p < 1)) return null;
  return p > 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

/** The book's overround (margin) on a two-way market. 1.045 = 4.5% vig. */
function overround(thisOdds, otherOdds) {
  const a = impliedProb(thisOdds), b = impliedProb(otherOdds);
  if (a == null || b == null) return null;
  return a + b;
}

// ── DE-VIG ───────────────────────────────────────────────────────────────────
// Three methods. The project currently uses proportional everywhere. The other
// two exist so the choice can be AUDITED rather than assumed — they disagree by
// up to a point on lopsided markets, and a point matters at these margins.

/** Proportional / multiplicative. What devigTwoWay and devigPair already do. */
function devigProportional(thisOdds, otherOdds) {
  const a = impliedProb(thisOdds), b = impliedProb(otherOdds);
  if (a == null || b == null) return null;
  const s = a + b;
  return s > 0 ? a / s : null;
}

/** Power method: solve a^k + b^k = 1. Assumes the book's margin is applied
 *  multiplicatively in log-odds, which fits observed two-way pricing better than
 *  proportional on lopsided markets. Bisection; converges in ~40 iters. */
function devigPower(thisOdds, otherOdds) {
  const a = impliedProb(thisOdds), b = impliedProb(otherOdds);
  if (a == null || b == null || !(a > 0) || !(b > 0)) return null;
  let lo = 0.5, hi = 3.0;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const s = Math.pow(a, k) + Math.pow(b, k);
    if (s > 1) lo = k; else hi = k;
  }
  const k = (lo + hi) / 2;
  const out = Math.pow(a, k);
  return Number.isFinite(out) ? out : null;
}

/** Shin's method: models the margin as protection against informed money.
 *  Standard two-outcome closed form. Returns the fair prob for THIS side. */
function devigShin(thisOdds, otherOdds) {
  const a = impliedProb(thisOdds), b = impliedProb(otherOdds);
  if (a == null || b == null || !(a > 0) || !(b > 0)) return null;
  const s = a + b;
  if (!(s > 1)) return devigProportional(thisOdds, otherOdds);
  // z = insider fraction; closed form for n=2
  const z = Math.max(0, Math.min(0.2,
    (Math.sqrt(s * s - 4 * (s - 1) * (a * a / s + b * b / s) / (1)) - (2 - s)) / (s - 2) || 0
  ));
  const zz = Number.isFinite(z) ? z : 0;
  const num = Math.sqrt(zz * zz + 4 * (1 - zz) * ((a * a) / s)) - zz;
  const out = num / (2 * (1 - zz));
  return Number.isFinite(out) && out > 0 && out < 1 ? out : devigProportional(thisOdds, otherOdds);
}

/** Spread between de-vig methods for this market. If this is large, the choice
 *  of method is materially driving the edge and must not be left to default. */
function devigSpread(thisOdds, otherOdds) {
  const p = devigProportional(thisOdds, otherOdds);
  const w = devigPower(thisOdds, otherOdds);
  const h = devigShin(thisOdds, otherOdds);
  if (p == null || w == null || h == null) return null;
  return { proportional: p, power: w, shin: h, spreadPts: (Math.max(p, w, h) - Math.min(p, w, h)) * 100 };
}

// ── THE SELECTION QUANTITY ───────────────────────────────────────────────────
// This is the correction. `edge` in the current codebase is (p - fair). The thing
// that decides whether a bet makes money is (p - breakEven). They differ by
// a*(S-1)/S, which is 2.25 pts at -130 and 2.38 pts at -110.

/** Expected profit per 1 unit risked, at the REAL posted price. Negative = the
 *  bet loses money at this probability, no matter how good the "edge" looked. */
function ev(prob, american) {
  const b = payout(american);
  if (prob == null || b == null) return null;
  return prob * b - (1 - prob);
}

/** Edge measured against break-even instead of against the de-vigged fair price.
 *  This is the number the publish gate should use. */
function edgeVsBreakEven(prob, american) {
  const be = breakEven(american);
  return prob == null || be == null ? null : prob - be;
}

/** How many probability points the current `edge` metric overstates true edge by,
 *  for this specific market. Diagnostic — quote this, not a guess. */
function vigTax(thisOdds, otherOdds) {
  const a = impliedProb(thisOdds);
  const fair = devigProportional(thisOdds, otherOdds);
  return a == null || fair == null ? null : a - fair;
}

/** Kelly fraction at the real price. Returns 0 for -EV bets rather than a
 *  negative stake. Use fractional Kelly (0.25) in anything customer-facing. */
function kelly(prob, american, fraction = 0.25) {
  const b = payout(american);
  if (prob == null || b == null) return 0;
  const f = (prob * b - (1 - prob)) / b;
  return f > 0 ? f * fraction : 0;
}

// ── SHRINKAGE ────────────────────────────────────────────────────────────────
// W_MODEL = 0.55 in edgesModel was chosen, not measured. These fit it.

function logit(p) {
  if (p == null || !(p > 0) || !(p < 1)) return null;
  return Math.log(p / (1 - p));
}
function sigmoid(x) {
  return x == null || !Number.isFinite(x) ? null : 1 / (1 + Math.exp(-x));
}

/** Blend a raw model prob toward the market's fair prob in LOG-ODDS space with
 *  weight gamma. Log-odds blending is the correct space for probabilities — the
 *  current linear blend distorts the tails, which is where the run line lives. */
function shrinkToMarket(rawProb, fairProb, gamma) {
  const lr = logit(rawProb), lf = logit(fairProb);
  if (lr == null || lf == null) return null;
  return sigmoid(lf + gamma * (lr - lf));
}

/**
 * Fit gamma: how much of the model's disagreement with the market is REAL.
 *
 * rows: [{ rawProb, fairProb, target }] where target is either the graded
 * outcome (0/1) or — far better at our sample sizes — the sharp CLOSING fair
 * probability. Closed-form weighted least squares in logit space:
 *
 *     logit(target) = logit(fair) + gamma * (logit(raw) - logit(fair))
 *
 * gamma near 1.0  -> the model's disagreement is fully vindicated; trust it.
 * gamma near 0.0  -> the model adds nothing the market didn't already know.
 * gamma negative  -> the model is a contrarian indicator; the disagreement is
 *                    worse than useless and every "edge" is inverted.
 *
 * This single number is what killed the edge selector last session and nobody
 * measured it. Fit it before proposing any selection rule.
 */
function fitShrinkage(rows) {
  let sxx = 0, sxy = 0, n = 0;
  for (const r of rows || []) {
    const lr = logit(r.rawProb), lf = logit(r.fairProb);
    const t = typeof r.target === "number" ? r.target : null;
    if (lr == null || lf == null || t == null) continue;
    // For binary targets, clamp so logit is finite; for prob targets, use directly.
    const lt = (t === 0 || t === 1) ? logit(t === 1 ? 0.999 : 0.001) : logit(t);
    if (lt == null) continue;
    const x = lr - lf, y = lt - lf;
    sxx += x * x; sxy += x * y; n++;
  }
  if (n < 2 || !(sxx > 0)) return { gamma: null, n, se: null, note: "insufficient variation" };
  const gamma = sxy / sxx;
  // residual SE of gamma
  let ss = 0, m = 0;
  for (const r of rows || []) {
    const lr = logit(r.rawProb), lf = logit(r.fairProb);
    const t = typeof r.target === "number" ? r.target : null;
    if (lr == null || lf == null || t == null) continue;
    const lt = (t === 0 || t === 1) ? logit(t === 1 ? 0.999 : 0.001) : logit(t);
    if (lt == null) continue;
    const x = lr - lf, y = lt - lf;
    ss += Math.pow(y - gamma * x, 2); m++;
  }
  const se = m > 2 ? Math.sqrt(ss / (m - 1) / sxx) : null;
  return { gamma, n, se, ci95: se == null ? null : [gamma - 1.96 * se, gamma + 1.96 * se] };
}

// ── CLV, MEASURED WITHOUT THE BIAS ───────────────────────────────────────────
// predictionTracker computes pinnacle_clv as (de-vigged Pinnacle fair close) minus
// (our VIGGED taken price). Those are different units. The result is biased low by
// the vig on our own side — 2.2 to 2.4 points on a typical MLB moneyline. Both
// sides of the comparison must be de-vigged, or neither.

/** Correct CLV: fair-to-fair. Needs the OPPOSING price at pick time, which is
 *  currently not stored on model_predictions. That field is the blocker. */
function fairClv({ pickOdds, pickOppOdds, closeOdds, closeOppOdds }) {
  const openFair = devigProportional(pickOdds, pickOppOdds);
  const closeFair = devigProportional(closeOdds, closeOppOdds);
  if (openFair == null || closeFair == null) return null;
  return closeFair - openFair;
}

/** Raw price-to-price CLV. Vig is present on both sides and largely cancels, so
 *  this one is sound as-is. Use it while opp_odds is being backfilled. */
function rawClv(pickOdds, closeOdds) {
  const a = impliedProb(pickOdds), b = impliedProb(closeOdds);
  return a == null || b == null ? null : b - a;
}

/** Approximate the bias in an existing pinnacle_clv row using the closing pair's
 *  overround as a stand-in for the pick-time overround. Lets historical CLV be
 *  corrected retroactively without opp_odds. */
function pinnacleClvBiasEstimate(pickOdds, closeOdds, closeOppOdds) {
  const s = overround(closeOdds, closeOppOdds);
  const a = impliedProb(pickOdds);
  if (s == null || a == null || !(s > 0)) return null;
  return a * (s - 1) / s; // add this back to a stored pinnacle_clv
}

// ── POWER ────────────────────────────────────────────────────────────────────
// Why outcomes cannot settle these arguments and CLV can.

/** Bets needed to resolve an ROI difference of `deltaRoi` at 95%. At -130 the
 *  per-bet return SD is ~0.885, so a 2-point ROI question needs ~7,500 bets. */
function roiSampleSize(deltaRoi, american = -130, prob = 0.5) {
  const b = payout(american);
  if (b == null || !(deltaRoi > 0)) return null;
  const sd = (b + 1) * Math.sqrt(prob * (1 - prob));
  return Math.ceil(Math.pow((1.96 * sd) / deltaRoi, 2));
}

/** Bets needed to resolve a CLV difference of `deltaClv` at 95%. With a per-pick
 *  CLV SD around 0.02, half a point needs ~62 picks. Two orders of magnitude
 *  cheaper than the same question asked of outcomes. */
function clvSampleSize(deltaClv, clvSd = 0.02) {
  if (!(deltaClv > 0)) return null;
  return Math.ceil(Math.pow((1.96 * clvSd) / deltaClv, 2));
}

/** Flags a stored odds value that is the -110 placeholder rather than a real
 *  posted price. Any ROI computed on these rows is meaningless. */
function looksPlaceholder(american) {
  return american === -110;
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────
function _selftest() {
  const out = [];
  const ok = (name, cond, got) => out.push({ name, pass: !!cond, got });
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

  ok("impliedProb(-110)", near(impliedProb(-110), 0.5238095, 1e-6), impliedProb(-110));
  ok("impliedProb(+150)", near(impliedProb(150), 0.4, 1e-9), impliedProb(150));
  ok("payout(-130)", near(payout(-130), 0.7692307, 1e-6), payout(-130));
  ok("probToAmerican roundtrip", probToAmerican(impliedProb(-130)) === -130, probToAmerican(impliedProb(-130)));

  // The headline: at -130/+110, "edge" overstates true edge by 2.25 points.
  const tax = vigTax(-130, 110) * 100;
  ok("vigTax(-130,+110) ~= 2.25 pts", Math.abs(tax - 2.25) < 0.02, tax);

  // A pick published at the 55% floor is -EV at its own posted price.
  ok("55% claim @ -135 is -EV", ev(0.55, -135) < 0, ev(0.55, -135));
  ok("break-even at -135", near(breakEven(-135), 0.5744680, 1e-6), breakEven(-135));

  // De-vig methods must agree on a symmetric market and diverge on a lopsided one.
  ok("symmetric devig = 0.5", near(devigProportional(-110, -110), 0.5, 1e-9), devigProportional(-110, -110));
  const sp = devigSpread(-260, 210);
  ok("lopsided devig spread > 0", sp && sp.spreadPts > 0, sp && sp.spreadPts);

  // Shrinkage recovers a known gamma from synthetic data.
  const rows = [];
  for (let i = 0; i < 400; i++) {
    const fair = 0.35 + (i % 60) / 200;
    const raw = sigmoid(logit(fair) + ((i % 17) - 8) / 12);
    const target = sigmoid(logit(fair) + 0.4 * (logit(raw) - logit(fair)));
    rows.push({ rawProb: raw, fairProb: fair, target });
  }
  const fit = fitShrinkage(rows);
  ok("fitShrinkage recovers gamma=0.40", fit.gamma != null && Math.abs(fit.gamma - 0.4) < 0.01, fit.gamma);

  // Power math.
  ok("roiSampleSize(0.02) in the thousands", roiSampleSize(0.02) > 5000, roiSampleSize(0.02));
  ok("clvSampleSize(0.005) under 100", clvSampleSize(0.005) < 100, clvSampleSize(0.005));

  // CLV bias direction.
  const bias = pinnacleClvBiasEstimate(-130, -125, 105);
  ok("pinnacle clv bias is positive (stored value is too low)", bias > 0, bias);

  const failed = out.filter(r => !r.pass);
  return { passed: out.length - failed.length, failed: failed.length, results: out };
}

module.exports = {
  impliedProb, payout, breakEven, probToAmerican, overround,
  devigProportional, devigPower, devigShin, devigSpread,
  ev, edgeVsBreakEven, vigTax, kelly,
  logit, sigmoid, shrinkToMarket, fitShrinkage,
  fairClv, rawClv, pinnacleClvBiasEstimate,
  roiSampleSize, clvSampleSize, looksPlaceholder,
  _selftest,
};

if (require.main === module) {
  const r = _selftest();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.failed === 0 ? 0 : 1);
}
