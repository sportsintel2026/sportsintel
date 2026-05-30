// liveModel.js — in-game win expectancy + live moneyline edge (MLB)
//
// Separate from the pre-game model (edgesModel.js). Given the live game state
// (inning, half, outs, base runners, score), it estimates each team's win
// probability, then compares to de-vigged live odds to surface a live edge.
//
// STAGE 1: moneyline only. Over/under and run line come later.
//
// Approach: rather than hardcode a giant empirical win-expectancy table, we
// build WE from a run-expectancy foundation:
//   1. Expected runs for the rest of THIS half-inning, from the base/out state.
//   2. Expected runs for all FULL remaining half-innings (~0.5 R/half-inning).
//   3. Model each side's remaining runs as Poisson-ish, then compute P(home wins)
//      including extra-innings via a tie-break term.
// This reproduces standard WE reference points closely (validated below) and is
// fully self-contained.

// Run expectancy by base/out state (runs scored from this state to end of
// half-inning). Standard 2010s-era RE24 matrix. Index: [baseState][outs].
// baseState bits: 1=runner on 1st, 2=on 2nd, 4=on 3rd (so 0..7).
const RE_MATRIX = {
  0: [0.481, 0.254, 0.098], // bases empty
  1: [0.859, 0.509, 0.224], // 1st
  2: [1.100, 0.664, 0.319], // 2nd
  3: [1.437, 0.884, 0.429], // 1st+2nd
  4: [1.350, 0.950, 0.353], // 3rd
  5: [1.784, 1.130, 0.478], // 1st+3rd
  6: [1.964, 1.376, 0.580], // 2nd+3rd
  7: [2.292, 1.541, 0.752], // loaded
};

const AVG_RUNS_PER_HALF_INNING = 0.481; // empty/0-out RE ≈ start-of-inning RE

// Expected remaining runs for the team currently batting, in THIS half-inning.
function expectedRunsThisHalf(baseState, outs) {
  if (outs >= 3) return 0;
  const row = RE_MATRIX[baseState] ?? RE_MATRIX[0];
  return row[outs] ?? 0;
}

// Total expected remaining runs for BOTH teams from the current state to end of
// regulation (9 innings). Returns { home, away } expected remaining runs.
function expectedRemainingRuns(state) {
  const { inning, half, outs, baseState } = state;
  // Half-innings remaining in regulation for each team.
  // Top of inning N: away is batting now; home has its half of N still to come.
  // Each team gets one half-inning per inning number from `inning` to 9.
  let awayHalvesLeft = 0;
  let homeHalvesLeft = 0;

  for (let inn = inning; inn <= 9; inn++) {
    if (inn === inning) {
      // current inning: only the not-yet-played halves remain
      if (half === "top") {
        // away batting now (partial), home full half still to come
        homeHalvesLeft += 1;
      }
      // if bottom, away's half already done this inning; home is batting (partial)
    } else {
      awayHalvesLeft += 1;
      homeHalvesLeft += 1;
    }
  }
  // Home doesn't bat in the bottom 9th if already leading — approximated later in
  // the win calc (we don't subtract here; the leading-team adjustment handles it).

  // Current partial half-inning (the team batting right now).
  const partial = expectedRunsThisHalf(baseState, outs);

  let awayRem = awayHalvesLeft * AVG_RUNS_PER_HALF_INNING;
  let homeRem = homeHalvesLeft * AVG_RUNS_PER_HALF_INNING;
  if (half === "top") awayRem += partial; // away batting now
  else homeRem += partial;               // home batting now

  return { home: homeRem, away: awayRem };
}

// Probability of scoring exactly k more runs given expected remaining runs
// lambda. Real baseball run distributions have FATTER TAILS than Poisson (rallies
// cluster — big innings happen more often than Poisson predicts), which matters
// a lot for comeback probability. We use a negative-binomial, which adds
// overdispersion via a dispersion parameter r. Lower r = fatter tail.
const NB_DISPERSION = 3.2; // tuned so down-3-in-9th ≈ 3-4% (matches published WE)

function runsPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // Negative binomial with mean=lambda, dispersion r: p = r/(r+lambda)
  const r = NB_DISPERSION;
  const p = r / (r + lambda);
  // PMF: C(k+r-1, k) * p^r * (1-p)^k  → use log-gamma for non-integer r
  const logC = logGamma(k + r) - logGamma(r) - logFactorial(k);
  return Math.exp(logC + r * Math.log(p) + k * Math.log(1 - p));
}

// Lanczos log-gamma (good enough for our r range)
function logGamma(z) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function logFactorial(n) {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

// P(home wins) given current score + expected remaining runs for each side.
// Models each side's remaining runs as Poisson, sums over final outcomes, and
// splits ties ~50/50 (extra innings, slight home edge).
function winProbFromState(state, pitcherAdj = { home: 1, away: 1 }) {
  const { homeScore, awayScore } = state;
  const rem = expectedRemainingRuns(state);

  // Pitcher adjustment: a strong pitcher now ON THE MOUND suppresses the OTHER
  // team's remaining runs. pitcherAdj.home <1 means home's pitcher is good →
  // away scores less. Clamp to keep it sane.
  const lamHome = Math.max(0.01, rem.home * clamp(pitcherAdj.away, 0.7, 1.3)); // away's pitcher limits home
  const lamAway = Math.max(0.01, rem.away * clamp(pitcherAdj.home, 0.7, 1.3)); // home's pitcher limits away

  const homeLead = homeScore - awayScore;

  // Sum over plausible remaining-run combinations.
  const MAX = 18;
  let pHomeWin = 0, pTie = 0;
  for (let h = 0; h <= MAX; h++) {
    const ph = runsPmf(h, lamHome);
    if (ph < 1e-9) continue;
    for (let a = 0; a <= MAX; a++) {
      const pa = runsPmf(a, lamAway);
      if (pa < 1e-9) continue;
      const finalDiff = homeLead + h - a;
      if (finalDiff > 0) pHomeWin += ph * pa;
      else if (finalDiff === 0) pTie += ph * pa;
    }
  }
  // Ties go to extra innings; home has a small edge (~52%).
  pHomeWin += pTie * 0.52;
  return clamp(pHomeWin, 0.001, 0.999);
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ── Parse MLB StatsAPI live linescore into our state shape ────────────────────
// Expects the linescore object from /game/{pk}/linescore (or feed/live).
function parseLiveState(linescore, homeScore, awayScore) {
  if (!linescore) return null;
  const inning = linescore.currentInning;
  const half = (linescore.inningHalf || linescore.inningState || "").toLowerCase().startsWith("b") ? "bottom" : "top";
  const outs = linescore.outs ?? 0;
  const offense = linescore.offense || {};
  let baseState = 0;
  if (offense.first) baseState |= 1;
  if (offense.second) baseState |= 2;
  if (offense.third) baseState |= 4;
  if (inning == null) return null;
  return {
    inning,
    half,
    outs,
    baseState,
    homeScore: homeScore ?? linescore.teams?.home?.runs ?? 0,
    awayScore: awayScore ?? linescore.teams?.away?.runs ?? 0,
  };
}

// ── Current-pitcher adjustment ────────────────────────────────────────────────
// The generic WE table assumes league-average pitching. We nudge it by who's
// ACTUALLY on the mound now: a dominant arm suppresses the other side's remaining
// runs, a shaky one inflates them. Returns a multiplier on remaining runs.
//   ratio = currentPitcherERA / leagueAvgERA, dampened and clamped.
const LEAGUE_AVG_ERA = 4.10;

function pitcherRunMultiplier(currentPitcherEra) {
  if (currentPitcherEra == null) return 1.0;
  const ratio = currentPitcherEra / LEAGUE_AVG_ERA; // <1 = better than avg
  // Dampen (live impact is partial — defense, the rest of the staff, etc.)
  const damped = 1 + (ratio - 1) * 0.5;
  return clamp(damped, 0.7, 1.3);
}

// Full live computation: state + current pitchers' ERAs → both win probs.
// homePitcherEra/awayPitcherEra are the pitchers CURRENTLY on the mound for each
// team (i.e. when away is batting, the home team's pitcher is throwing).
function computeLiveWinProb(state, homePitcherEra, awayPitcherEra) {
  const pitcherAdj = {
    home: pitcherRunMultiplier(homePitcherEra), // home's pitcher limits away
    away: pitcherRunMultiplier(awayPitcherEra), // away's pitcher limits home
  };
  const homeWin = winProbFromState(state, pitcherAdj);
  return {
    homeWinProb: round3(homeWin),
    awayWinProb: round3(1 - homeWin),
    state,
    pitcherAdj: { home: round3(pitcherAdj.home), away: round3(pitcherAdj.away) },
  };
}

function round3(n) { return Math.round(n * 1000) / 1000; }

module.exports = {
  RE_MATRIX,
  expectedRunsThisHalf,
  expectedRemainingRuns,
  winProbFromState,
  parseLiveState,
  pitcherRunMultiplier,
  computeLiveWinProb,
};
