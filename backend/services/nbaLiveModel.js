// nbaLiveModel.js — NBA LIVE in-game model (v0.1, conservative)
// --------------------------------------------------------------------------
// PURE + feed-independent. Given the current game STATE (score margin, time
// remaining, current total) it returns a live win probability and a projected
// final total. The thin adapter that reads ESPN's live feed and calls these
// functions is separate (built once the live-feed diagnostic confirms the feed
// shape) — this file is the engine and can be fully self-tested offline.
//
// MODEL (well-understood live-WP math):
//   Final margin ≈ currentMargin + expected_future_margin (~0 for even teams,
//   small home nudge) with uncertainty that SHRINKS as the clock runs down.
//   Remaining scoring variance grows ~linearly with time, so the standard
//   deviation of the remaining margin scales with sqrt(timeRemaining).
//   liveSD = FULL_GAME_SD * sqrt(fractionRemaining)
//   homeWinProb = normalCDF( projectedFinalMargin / liveSD )
//
// CONSERVATIVE TUNING (per product decision): FULL_GAME_SD is set a touch HIGHER
// than the textbook ~12 so the model is LESS quick to call a game decided. A
// 12-pt 3rd-quarter lead reads as "likely", not "near-certain" — protecting a
// young live model against the comebacks NBA is famous for. Dial down toward ~12
// as the model proves itself over real games. Master switch + dials at top.
//
// LIVE TOTAL: project remaining scoring from the pace SO FAR, lightly damped for
// playoff slowdown, and add to points already scored.
//
// Node 18+. CommonJS.
// --------------------------------------------------------------------------

// ── dials ───────────────────────────────────────────────────────────────────
// Conservative: higher SD = humbler, slower to declare a game decided.
const FULL_GAME_SD = 14.5;        // textbook ~12; we inflate for caution
const MIN_SD = 2.5;               // floor so end-game isn't a hard 0/100 step
const HOME_LIVE_NUDGE = 0.4;      // tiny remaining-margin edge for the home team
const REG_SECONDS = 48 * 60;      // 4 x 12:00 regulation
const PLAYOFF_PACE_DAMP = 0.97;   // playoff scoring runs a touch under pace

function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
function normalCDF(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
function clampProb(p) { return Math.max(0.001, Math.min(0.999, p)); }

// Seconds remaining in the WHOLE game from period + clock-in-period.
// period: 1..4 (regulation) or 5+ (OT). clockSeconds: seconds left in THIS period.
// Returns total seconds left in regulation; OT is treated as "very little time
// left, near coin-flip on margin" by flooring fractionRemaining small.
function secondsRemaining(period, clockSeconds) {
  const p = Number(period) || 1;
  const c = Math.max(0, Number(clockSeconds) || 0);
  if (p >= 5) return Math.max(0, c); // OT: only the OT clock remains
  const periodsLeftAfter = 4 - p;    // full periods after the current one
  return periodsLeftAfter * 12 * 60 + c;
}

// Live win probability for the HOME team.
//  margin = homeScore - awayScore (current)
//  period, clockSeconds = game clock state
function liveWinProb(margin, period, clockSeconds) {
  const secLeft = secondsRemaining(period, clockSeconds);
  const fracRem = Math.max(0, Math.min(1, secLeft / REG_SECONDS));
  // expected remaining margin: ~0, tiny home nudge scaled by time left
  const projMargin = margin + HOME_LIVE_NUDGE * fracRem;
  const sd = Math.max(MIN_SD, FULL_GAME_SD * Math.sqrt(fracRem));
  const wp = clampProb(normalCDF(projMargin / sd));
  return { homeWinProb: wp, awayWinProb: 1 - wp, secLeft, fracRem, projMargin, sd };
}

// Live projected FINAL total from pace so far.
//  currentTotal = homeScore + awayScore
//  period, clockSeconds = game clock state
//  playoff = damp pace slightly
function liveTotal(currentTotal, period, clockSeconds, playoff) {
  const secLeft = secondsRemaining(period, clockSeconds);
  const secPlayed = Math.max(1, REG_SECONDS - secLeft);
  const pacePerSec = currentTotal / secPlayed;          // points per second so far
  let projRemaining = pacePerSec * secLeft;
  if (playoff) projRemaining *= PLAYOFF_PACE_DAMP;
  return Math.round((currentTotal + projRemaining) * 10) / 10;
}

module.exports = {
  liveWinProb,
  liveTotal,
  secondsRemaining,
  // dials exported for the self-test
  FULL_GAME_SD, MIN_SD, HOME_LIVE_NUDGE, REG_SECONDS, PLAYOFF_PACE_DAMP,
};
