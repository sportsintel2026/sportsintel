// winProbCalibration.js
// WZ-WINPROB-CAL-2026-06-27 :: recalibration of the MLB moneyline win probability.
// WZ-CAL-CURVES-2026-07-02 :: LIVE ACTIVATION + run-line cover curve added.
// Pure and side-effect-free.
//
// ── Moneyline curve (dog-side haircut) ────────────────────────────────────────
// Origin — 2026-06-27 weekly audit. The MLB moneyline win-prob is overconfident on the
// UNDERDOG side. Calibration curve over n=451 graded ML picks (claimed -> actual):
//   0.405 -> 0.316,  0.450 -> 0.405,  0.496 -> ~calibrated,  p >= 0.50 -> calibrated.
//
//   haircut(p) = clamp(0.45 - 0.9*p, 0, 0.09)   // 0 at p>=0.50, capped 0.09 in deep-dog tail
//   cal(p)     = p - haircut(p)                  // monotonic, continuous
//
// Phase 1 (06-27 -> 07-02) logged these as SHADOW fields (model_prob_cal, cal_edge) on
// every recorded ML pick. OUT-OF-SAMPLE verdict (2026-07-02, n=61 graded forward picks):
// claimed 0.416 cashed 0.250 (cal said 0.342), claimed 0.477 cashed 0.429 (cal said
// 0.456), and the 23 picks cal_edge would have pruned won at 14.3% / 25.0% — clear
// money-losers correctly identified in advance. On that evidence the curve went LIVE
// 2026-07-02: the board/recorded model_prob and edge for ML picks ARE the calibrated
// values (applied pick-level at assembly in edgesModel; the raw win prob still feeds the
// run-line margin derivation, which has its own curve below — never stack the two).
// Watch item (not acted on, n=17): the 50-55 bucket claimed 0.520 cashed 0.412 —
// overconfidence may extend above 0.50; re-measure before extending the curve.
//
// ── Run-line cover curve ──────────────────────────────────────────────────────
// Origin — 2026-07-02 calibration read, n=461 graded run-line picks (claimed -> actual):
//   0.385 -> 0.367 (+0.018, ~vig noise)   0.582 -> 0.571 (+0.011, fine)
//   0.629 -> 0.590 (+0.039)   0.674 -> 0.626 (+0.047)   0.714 -> 0.620 (+0.094)
// Actual cover FLATLINES ~0.62 above claimed ~0.65 — the model's high-confidence cover
// claims are its least reliable (the normal-margin transform amplifies model-vs-market
// disagreement). Weighted monotone fit (knee grid + least squares, residuals <= 0.014):
//
//   calCover(c) = c                        for c <= 0.57
//   calCover(c) = 0.57 + 0.45*(c - 0.57)   for c  > 0.57   (haircut capped at 0.13)
//
// i.e. above 57% claimed cover, the model keeps 45 cents of every extra point of
// confidence. NOT a blunt shrink toward 50% — the low end is untouched, monotonic and
// continuous at the knee. Applied in edgesModel at the cover-prob derivation to the
// LIKELIER side (the other side = 1 - calibrated, keeping the pair coherent).
// Re-verify post-deploy with the bucket query on picks created after 2026-07-02.

function winProbHaircut(p) {
  if (p == null || typeof p !== "number" || !isFinite(p)) return 0;
  return Math.min(0.09, Math.max(0, 0.45 - 0.9 * p));
}

function calibrateWinProb(p) {
  if (p == null || typeof p !== "number" || !isFinite(p)) return p;
  return p - winProbHaircut(p);
}

const RL_CAL_KNEE = 0.57;   // identity below this claimed cover prob
const RL_CAL_SLOPE = 0.45;  // credit per point of claimed confidence above the knee
const RL_CAL_MAX_HAIRCUT = 0.13;

function coverProbHaircut(c) {
  if (c == null || typeof c !== "number" || !isFinite(c)) return 0;
  return Math.min(RL_CAL_MAX_HAIRCUT, Math.max(0, (1 - RL_CAL_SLOPE) * (c - RL_CAL_KNEE)));
}

function calibrateCoverProb(c) {
  if (c == null || typeof c !== "number" || !isFinite(c)) return c;
  return c - coverProbHaircut(c);
}

module.exports = { winProbHaircut, calibrateWinProb, coverProbHaircut, calibrateCoverProb };
