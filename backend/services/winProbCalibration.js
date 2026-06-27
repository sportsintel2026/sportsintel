// winProbCalibration.js
// WZ-WINPROB-CAL-2026-06-27 :: SHADOW recalibration of the MLB moneyline win probability.
// Pure and side-effect-free. Phase 1 uses this ONLY to log shadow fields
// (model_prob_cal, cal_edge) alongside the live values in model_predictions. It does
// NOT alter any live edge, confidence, conviction, price, board, or grading.
//
// Origin — 2026-06-27 weekly audit. The MLB moneyline win-prob is overconfident on the
// UNDERDOG side. Calibration curve over n=451 graded ML picks (claimed -> actual):
//   0.405 -> 0.316,  0.450 -> 0.405,  0.496 -> ~calibrated,  p >= 0.50 -> calibrated.
// Run line and totals were checked with their own curves and are independently
// well-calibrated (the win-prob error is absorbed by the margin->cover transform and the
// totals path never uses the win prob). So this correction is deliberately ONE-SIDED:
// it touches only the dog side (p < 0.50) and leaves favorites exactly as the model
// produces them, so applying it can never disturb run line or totals.
//
//   haircut(p) = clamp(0.45 - 0.9*p, 0, 0.09)   // 0 at p>=0.50, capped 0.09 in deep-dog tail
//   cal(p)     = p - haircut(p)                  // monotonic, continuous
//
// Phase-0 in-sample regrade (same 451 picks): qualified ML ROI +1.1% -> +2.1%, the pruned
// dog picks were -2.3%. IN-SAMPLE ONLY — a sanity gate, not a verdict. The real proof is
// the out-of-sample shadow on forward picks once enough accumulate.

function winProbHaircut(p) {
  if (p == null || typeof p !== "number" || !isFinite(p)) return 0;
  return Math.min(0.09, Math.max(0, 0.45 - 0.9 * p));
}

function calibrateWinProb(p) {
  if (p == null || typeof p !== "number" || !isFinite(p)) return p;
  return p - winProbHaircut(p);
}

module.exports = { winProbHaircut, calibrateWinProb };
