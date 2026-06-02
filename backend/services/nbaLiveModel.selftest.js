// nbaLiveModel.selftest.js — guardrail self-test for the NBA LIVE model
// --------------------------------------------------------------------------
// Run:  node services/nbaLiveModel.selftest.js
//
// Known-answer checks proving the live win-probability + live-total math behaves.
// Pure + offline (no live feed needed). Run before deploying any live-model
// change; confirm "ALL GUARDRAILS PASS".
// --------------------------------------------------------------------------

const {
  liveWinProb,
  liveTotal,
  secondsRemaining,
  FULL_GAME_SD,
  MIN_SD,
  REG_SECONDS,
} = require('./nbaLiveModel');

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; fails.push(name + (detail ? ` — ${detail}` : '')); }
}
const wp = (m, p, c) => liveWinProb(m, p, c).homeWinProb;

// ── config dials ────────────────────────────────────────────────────────────
check('conservative SD = 14.5', Math.abs(FULL_GAME_SD - 14.5) < 0.001, `got ${FULL_GAME_SD}`);
check('MIN_SD floor = 2.5', Math.abs(MIN_SD - 2.5) < 0.001, `got ${MIN_SD}`);
check('regulation seconds = 2880', REG_SECONDS === 2880, `got ${REG_SECONDS}`);

// ── secondsRemaining ────────────────────────────────────────────────────────
check('tip-off = 2880s', secondsRemaining(1, 720) === 2880, `${secondsRemaining(1, 720)}`);
check('halftime = 1440s', secondsRemaining(3, 720) === 1440, `${secondsRemaining(3, 720)}`);
check('2:00 in 4th = 120s', secondsRemaining(4, 120) === 120, `${secondsRemaining(4, 120)}`);
check('buzzer = 0s', secondsRemaining(4, 0) === 0, `${secondsRemaining(4, 0)}`);
check('OT uses only OT clock', secondsRemaining(5, 180) === 180, `${secondsRemaining(5, 180)}`);

// ── win prob: basic shape ───────────────────────────────────────────────────
check('tied at tip ≈ 50% (tiny home edge)', wp(0, 1, 720) > 0.50 && wp(0, 1, 720) < 0.53, `${wp(0,1,720)}`);
check('tied at half ≈ 50%', wp(0, 3, 720) > 0.49 && wp(0, 3, 720) < 0.53, `${wp(0,3,720)}`);
check('home lead > 50%', wp(8, 3, 720) > 0.6);
check('home deficit < 50%', wp(-8, 3, 720) < 0.4);
check('symmetry: +8 and -8 mirror', Math.abs((wp(8,3,720) + wp(-8,3,720)) - 1) < 0.02,
  `${wp(8,3,720)} + ${wp(-8,3,720)}`);

// ── win prob: time sensitivity (same lead safer later) ──────────────────────
check('same lead is safer later in game', wp(8, 4, 120) > wp(8, 1, 720),
  `late ${wp(8,4,120)} vs early ${wp(8,1,720)}`);
check('big late lead near-certain', wp(15, 4, 120) > 0.98, `${wp(15,4,120)}`);
check('big late deficit near-zero', wp(-15, 4, 120) < 0.02, `${wp(-15,4,120)}`);

// ── win prob: CONSERVATIVE — early lead NOT overconfident ───────────────────
// A 12-pt halftime lead should be "likely" but well under textbook ~92%.
check('12-pt halftime lead is conservative (<0.91)', wp(12, 3, 720) < 0.91, `${wp(12,3,720)}`);
check('12-pt halftime lead still favored (>0.80)', wp(12, 3, 720) > 0.80, `${wp(12,3,720)}`);

// ── win prob: bounded ───────────────────────────────────────────────────────
check('prob never hits hard 0', wp(-40, 4, 5) > 0, `${wp(-40,4,5)}`);
check('prob never hits hard 1', wp(40, 4, 5) < 1, `${wp(40,4,5)}`);

// ── live total ──────────────────────────────────────────────────────────────
{
  const half = liveTotal(120, 3, 720, true);   // 120 at half -> ~ double, damped
  check('halftime total projects forward', half > 200 && half < 250, `${half}`);
  const late = liveTotal(200, 4, 60, true);     // 200 with 1:00 left -> small add
  check('late total adds only a little', late > 200 && late < 212, `${late}`);
  const early = liveTotal(30, 1, 540, true);    // 30 pts, 9:00 left in Q1
  check('early total extrapolates up', early > 120, `${early}`);
}

console.log('');
console.log(`NBA LIVE model self-test: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFAILED CHECKS:');
  for (const f of fails) console.log('  ✗ ' + f);
  console.log('\nGUARDRAILS FAILED ✗');
  process.exit(1);
} else {
  console.log('ALL GUARDRAILS PASS ✓');
  process.exit(0);
}
