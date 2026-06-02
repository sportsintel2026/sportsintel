// nbaModel.selftest.js — guardrail self-test for the NBA model (v0.2)
// --------------------------------------------------------------------------
// Run:  node services/nbaModel.selftest.js
//
// Known-answer checks that prove the NBA model's protections still behave after
// ANY future change. This is a SMOKE DETECTOR for accidental breakage — it does
// NOT prove the model is accurate, only that the logic we built does what it's
// supposed to. Run it before deploying any NBA model change and confirm the
// "ALL GUARDRAILS PASS" line.
//
// Pure + offline: tests model logic and the injury-haircut MATH with fixed
// inputs. The live ESPN name-resolution / gamelog fetch is NOT tested here
// (it needs the network) — that's verified by reading /api/nba/predictions
// after deploy, as we did when building v0.2.
//
// Node 18+. CommonJS.
// --------------------------------------------------------------------------

const {
  predictGame,
  NBA_W_MODEL,
  NBA_INFLATION_THRESHOLD,
  NBA_BLEND_ENABLED,
} = require('./nbaModel');

const {
  REPLACEMENT_LOSS_SHARE,
  MAX_TEAM_HAIRCUT,
  isOut,
} = require('./nbaInjuryImpact');

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; fails.push(name + (detail ? ` — ${detail}` : '')); }
}
function approx(a, b, tol = 0.15) {
  return a != null && b != null && Math.abs(a - b) <= tol;
}

// ---- shared fixtures ----
// A balanced game: both teams league-ish, home slightly better. Real-ish numbers.
const baseCtx = {
  gameId: 't', date: '2026-06-04T00:30Z', state: 'pre', neutralSite: false,
  home: { displayName: 'Home', ppg: 116, papg: 112, netRtg: 4, isTBD: false, injuries: [] },
  away: { displayName: 'Away', ppg: 114, papg: 113, netRtg: 1, isTBD: false, injuries: [] },
};
// A near-even market line (home modest favorite) for blend/flag tests.
const evenLines = {
  home: { ml: -130, spread: { point: -2.5, price: -110 } },
  away: { ml: 110, spread: { point: 2.5, price: -110 } },
  total: { point: 228, overPrice: -110, underPrice: -110 },
};

// ── 1. CONFIG GUARDRAILS — the dials are where we set them ──────────────────
check('blend enabled', NBA_BLEND_ENABLED === true, `got ${NBA_BLEND_ENABLED}`);
check('blend weight is 0.55', approx(NBA_W_MODEL, 0.55, 0.001), `got ${NBA_W_MODEL}`);
check('inflation threshold is 0.09', approx(NBA_INFLATION_THRESHOLD, 0.09, 0.0001), `got ${NBA_INFLATION_THRESHOLD}`);
check('injury loss share is 0.60', approx(REPLACEMENT_LOSS_SHARE, 0.60, 0.001), `got ${REPLACEMENT_LOSS_SHARE}`);
check('injury cap is 12', approx(MAX_TEAM_HAIRCUT, 12, 0.001), `got ${MAX_TEAM_HAIRCUT}`);

// ── 2. MARKET BLEND — blended prob sits between model and market ─────────────
{
  const p = predictGame(baseCtx, evenLines, { playoff: true });
  const ml = p.predictions.moneyline;
  const model = ml.modelHomeWinProb;        // pre-blend
  const fair = ml.fair.home;                 // de-vigged market
  const blended = ml.homeWinProb;            // reported
  // blended must lie between model and market (inclusive)
  const lo = Math.min(model, fair), hi = Math.max(model, fair);
  check('blend lies between model and market', blended >= lo - 0.2 && blended <= hi + 0.2,
    `model ${model} fair ${fair} blended ${blended}`);
  // blended must equal 0.55*model + 0.45*fair
  const expected = Math.round((0.55 * model + 0.45 * fair) * 10) / 10;
  check('blend uses 55/45 weighting', approx(blended, expected, 0.2),
    `expected ${expected} got ${blended}`);
}

// ── 3. BLEND DISCIPLINE — a model far from the market gets pulled back ───────
{
  // Make the model think home is a huge favorite, but market says coin flip.
  const wildCtx = {
    ...baseCtx,
    home: { displayName: 'Home', ppg: 130, papg: 100, netRtg: 30, isTBD: false, injuries: [] },
    away: { displayName: 'Away', ppg: 100, papg: 130, netRtg: -30, isTBD: false, injuries: [] },
  };
  const evenMarket = {
    home: { ml: -110, spread: { point: -1, price: -110 } },
    away: { ml: -110, spread: { point: 1, price: -110 } },
    total: { point: 220, overPrice: -110, underPrice: -110 },
  };
  const p = predictGame(wildCtx, evenMarket, { playoff: true });
  const ml = p.predictions.moneyline;
  // The blended prob must be PULLED DOWN from the raw model toward the ~50% market.
  check('blend pulls a wild model toward market', ml.homeWinProb < ml.modelHomeWinProb,
    `model ${ml.modelHomeWinProb} blended ${ml.homeWinProb}`);
}

// ── 4. INFLATION FLAG — fires when market rates a side >= 9% above model ─────
{
  // Model ~ coin flip, market prices home as a big favorite => market high on home.
  const ctx = {
    ...baseCtx,
    home: { displayName: 'Home', ppg: 112, papg: 112, netRtg: 0, isTBD: false, injuries: [] },
    away: { displayName: 'Away', ppg: 112, papg: 112, netRtg: 0, isTBD: false, injuries: [] },
  };
  const heavyHome = {
    home: { ml: -300, spread: { point: -7, price: -110 } },
    away: { ml: 250, spread: { point: 7, price: -110 } },
    total: { point: 220, overPrice: -110, underPrice: -110 },
  };
  const ml = predictGame(ctx, heavyHome, { playoff: true }).predictions.moneyline;
  check('inflation flag fires on a big market-over-model gap', ml.inflation && ml.inflation.inflated === true,
    `inflation=${JSON.stringify(ml.inflation)}`);
  check('inflation flag names the inflated (home) side', ml.inflation && ml.inflation.side === 'home',
    `side=${ml.inflation && ml.inflation.side}`);
}

// ── 5. INFLATION FLAG — does NOT fire when model and market agree ────────────
{
  // Genuinely even matchup AND an even market line, so model ≈ market (no gap).
  const evenCtx = {
    ...baseCtx,
    home: { displayName: 'Home', ppg: 113, papg: 112, netRtg: 1, isTBD: false, injuries: [] },
    away: { displayName: 'Away', ppg: 113, papg: 112, netRtg: 1, isTBD: false, injuries: [] },
  };
  const trulyEven = {
    home: { ml: -120, spread: { point: -1.5, price: -110 } },
    away: { ml: 100, spread: { point: 1.5, price: -110 } },
    total: { point: 226, overPrice: -110, underPrice: -110 },
  };
  const ml = predictGame(evenCtx, trulyEven, { playoff: true }).predictions.moneyline;
  // With even teams + ~even line the model-vs-market gap is well under 9%.
  const gap = Math.abs((ml.fair.home) - (ml.modelHomeWinProb));
  check('inflation flag silent when model ≈ market', ml.inflation == null,
    `gap ${gap.toFixed(1)}% inflation=${JSON.stringify(ml.inflation)}`);
}

// ── 6. INJURY HAIRCUT — subtracting points drops home pts/margin/total/winprob ──
{
  const base = predictGame(baseCtx, evenLines, { playoff: true });
  const inj = predictGame(baseCtx, evenLines, { playoff: true, homeInjuryHaircut: 9, awayInjuryHaircut: 0 });
  check('injury drops home expected points', inj.expected.home < base.expected.home,
    `${base.expected.home} -> ${inj.expected.home}`);
  check('injury drops home expected points by ~9', approx(base.expected.home - inj.expected.home, 9, 0.2),
    `delta ${base.expected.home - inj.expected.home}`);
  check('injury drops projected margin', inj.predictions.spread.projectedMargin < base.predictions.spread.projectedMargin);
  check('injury drops projected total', inj.predictions.total.projectedTotal < base.predictions.total.projectedTotal);
  check('injury drops home win prob', inj.predictions.moneyline.modelHomeWinProb < base.predictions.moneyline.modelHomeWinProb);
  check('injuryAdjustment surfaced in output', inj.injuryAdjustment && inj.injuryAdjustment.home === 9,
    `got ${JSON.stringify(inj.injuryAdjustment)}`);
}

// ── 7. INJURY = 0 leaves the projection identical to baseline ────────────────
{
  const base = predictGame(baseCtx, evenLines, { playoff: true });
  const zero = predictGame(baseCtx, evenLines, { playoff: true, homeInjuryHaircut: 0, awayInjuryHaircut: 0 });
  check('zero injury haircut = unchanged margin', approx(base.predictions.spread.projectedMargin, zero.predictions.spread.projectedMargin, 0.01));
  check('zero injury haircut = unchanged total', approx(base.predictions.total.projectedTotal, zero.predictions.total.projectedTotal, 0.01));
}

// ── 8. isOut — only 'Out' is weighted; day-to-day / questionable are NOT ─────
check('isOut: Out is true', isOut('Out') === true);
check('isOut: out (lowercase) is true', isOut('out') === true);
check('isOut: Day-To-Day is false', isOut('Day-To-Day') === false);
check('isOut: Questionable is false', isOut('Questionable') === false);
check('isOut: null is false', isOut(null) === false);

// ── 9. EXISTING GUARDRAIL — extreme projection flagged suspect, pick suppressed ──
{
  // Valid in-range PPG (90-135) but a huge offense/defense mismatch → the model
  // projects a >18-pt margin, which should trip 'suspect' (NOT 'insufficient',
  // which is for out-of-range/missing data).
  const blowout = {
    ...baseCtx,
    home: { displayName: 'Home', ppg: 134, papg: 95, netRtg: 39, isTBD: false, injuries: [] },
    away: { displayName: 'Away', ppg: 96, papg: 134, netRtg: -38, isTBD: false, injuries: [] },
  };
  const p = predictGame(blowout, evenLines, { playoff: true });
  check('extreme projection flagged suspect', p.dataQuality === 'suspect',
    `dataQuality=${p.dataQuality} margin=${p.predictions.spread.projectedMargin}`);
  check('suspect game suppresses ML pick', p.predictions.moneyline.pick == null, `pick=${p.predictions.moneyline.pick}`);
}

// ── 10. BAD INPUT — missing scoring data flagged insufficient ────────────────
{
  const noData = {
    ...baseCtx,
    home: { displayName: 'Home', ppg: null, papg: null, isTBD: false, injuries: [] },
    away: { displayName: 'Away', ppg: null, papg: null, isTBD: false, injuries: [] },
  };
  const p = predictGame(noData, evenLines, { playoff: true });
  check('missing scoring flagged insufficient', p.dataQuality === 'insufficient', `dataQuality=${p.dataQuality}`);
}

// ---- report ----
console.log('');
console.log(`NBA model self-test: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('');
  console.log('FAILED CHECKS:');
  for (const f of fails) console.log('  ✗ ' + f);
  console.log('');
  console.log('GUARDRAILS FAILED ✗');
  process.exit(1);
} else {
  console.log('ALL GUARDRAILS PASS ✓');
  process.exit(0);
}
