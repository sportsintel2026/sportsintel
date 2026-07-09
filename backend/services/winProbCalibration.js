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
// WZ-RL-RECAL-2026-07-09 :: slope 0.45 -> 0.35. Re-measured claimed-vs-actual cover
// (pre-cal n=485 + post-cal n=78): actual cover still flatlines ~57-62% while the model
// keeps overclaiming ~5 pts at the 60-65 bucket (and +11 pre-cal at 70+). The 07-02 curve
// helped (no post-cal picks now clear 65% claimed) but is still too soft. Dropping to 0.35
// keeps only 35 cents of each extra confidence point above the 0.57 knee, pulling high
// claims toward the real ~60% ceiling. Conservative on purpose -- post-cal sample is thin
// (n~19-30/bucket) -- re-run the cover bucket query in ~2 wks and tighten more only if it holds.
const RL_CAL_SLOPE = 0.35;  // credit per point of claimed confidence above the knee (was 0.45; see note)
const RL_CAL_MAX_HAIRCUT = 0.13;

function coverProbHaircut(c) {
  if (c == null || typeof c !== "number" || !isFinite(c)) return 0;
  return Math.min(RL_CAL_MAX_HAIRCUT, Math.max(0, (1 - RL_CAL_SLOPE) * (c - RL_CAL_KNEE)));
}

function calibrateCoverProb(c) {
  if (c == null || typeof c !== "number" || !isFinite(c)) return c;
  return c - coverProbHaircut(c);
}

// ── Hits over-probability curve ───────────────────────────────────────────────
// WZ-CAL-HITS-2026-07-02 :: the hits prop model OVERSTATES P(1+ hit) across every
// bucket, and the bias is WORSENING on the current model (all-time gap -0.061 on
// n=1027; last-14d gap -0.098 on n=456). Recent-window buckets (claimed -> actual):
//   0.525 -> 0.469 (n=81)   0.577 -> 0.538 (n=197)   0.615 -> 0.432 (n=176)
// Above ~0.58 claimed, reality flatlines ~0.49 — and 0.432 actual on the model's
// most confident bucket is roughly what a batter with only ~2 AB produces, strongly
// implicating the expected-at-bats assumption (the hits shadow decomposes this).
// Weighted isotonic fit (violating upper buckets pooled to 0.488):
//
//   calHits(h) = h                        for h <= 0.46
//   calHits(h) = 0.46 + 0.20*(h - 0.46)   for h  > 0.46   (haircut capped at 0.15)
//
// Deliberately heavy: the model keeps only 20 cents per point of claimed confidence
// above the knee, because that is what 456 recent graded picks say it has earned.
// Expect the hits board to run thin-to-empty until the feature-level fix lands —
// a thin honest board beats a full losing one (-9% ROI at time of fit). Applied at
// the hits pricing source in edgesModel; the shadow logs the RAW prob so the
// underlying model keeps being measured while the haircut protects the board.
const HITS_CAL_KNEE = 0.46;
const HITS_CAL_SLOPE = 0.20;
const HITS_CAL_MAX_HAIRCUT = 0.15;

function hitsProbHaircut(h) {
  if (h == null || typeof h !== "number" || !isFinite(h)) return 0;
  return Math.min(HITS_CAL_MAX_HAIRCUT, Math.max(0, (1 - HITS_CAL_SLOPE) * (h - HITS_CAL_KNEE)));
}

function calibrateHitsProb(h) {
  if (h == null || typeof h !== "number" || !isFinite(h)) return h;
  return h - hitsProbHaircut(h);
}

module.exports = { winProbHaircut, calibrateWinProb, coverProbHaircut, calibrateCoverProb, hitsProbHaircut, calibrateHitsProb };
