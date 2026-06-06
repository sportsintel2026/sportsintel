// Edges model v0.4 — research-grade MLB betting projections
// + Weather, Batter vs Pitcher, Pitcher recent form
// + NEW v0.4: lineup handedness splits vs opposing starter, reliever-only bullpen quality
const {
  getPitcherSeasonStats,
  getBatterSeasonStats,
  getTeamSeasonStats,
  getTeamLineup,
  getLineupOffense,
  getTeamPitchingStats,
  getTeamRoster,
  getBatterVsPitcherHistory,
  getPitcherRecentStarts,
  getBatterRecentStats,
  getBatterStatcast,
  getTeamHandednessSplits,
  getTeamBullpenStats,
  getPitcherHand,
} = require("./mlbStatsApi");
const { americanToImpliedProb } = require("./oddsApi");
const { getBatterExpectedStats } = require("./savantApi");
const { getWeatherForVenue } = require("./weatherApi");

const LEAGUE_AVG = {
  era: 4.30,
  runsPerGame: 4.40,
  hrPerPA: 0.032,
  homeRunsPer9: 1.20,
  iso: 0.155,
  ops: 0.720,
  bullpenEra: 4.10,
};

// ── PITCHER QUALITY HELPER ────────────────────────────────────────────────────
// ERA is noisy (defense + sequencing + luck) and slow to stabilize. FIP rebuilds
// a pitcher's run-prevention from only what they control — strikeouts, walks, and
// home runs — and predicts FUTURE ERA better than past ERA does. We already fetch
// K/9, BB/9, and HR/9, so we can compute a FIP-style number for free and BLEND it
// with ERA (not fully replace — a thin early-season sample of the components can
// be jumpy). Returns an "effective ERA" the rest of the model can use as before.
//   FIP = ((13*HR) + (3*BB) - (2*K)) / IP + constant.  Using per-9 rates this is
//   equivalent to: (13*HR9 + 3*BB9 - 2*K9)/9 + C, with C chosen so league-avg
//   FIP ~ league-avg ERA.
const FIP_CONSTANT = 3.10; // calibrates FIP onto the ERA scale (league ERA ~4.30)
function effectiveERA(p) {
  if (!p) return null;
  const era = p.era ?? null;
  const k9 = p.strikeoutsPer9 ?? null;
  const bb9 = p.walksPer9 ?? null;
  const hr9 = p.homeRunsPer9 ?? null;
  // Need the three components to compute FIP; otherwise fall back to ERA.
  if (k9 == null || bb9 == null || hr9 == null) return era;
  const fip = (13 * hr9 + 3 * bb9 - 2 * k9) / 9 + FIP_CONSTANT;
  if (era == null) return round2(fip);
  // Blend: 60% FIP (more predictive) + 40% ERA (captures real results/defense).
  return round2(0.6 * fip + 0.4 * era);
}

// ERA over the pitcher's recent starts (earned runs / innings × 9).
// `recentStarts` is the array from getPitcherRecentStarts. Returns null if the
// sample is too thin to mean anything (need ~10+ recent innings).
function recentFormEra(recentStarts) {
  if (!Array.isArray(recentStarts) || recentStarts.length === 0) return null;
  let er = 0, ip = 0;
  for (const s of recentStarts) {
    er += s.er ?? 0;
    ip += s.ip ?? 0;
  }
  if (ip < 10) return null; // too few innings — don't trust it
  return round2((er / ip) * 9);
}

// Returns a COPY of the pitcher object with its `era` lightly nudged toward
// recent form. We blend 75% season / 25% recent: recent pitching matters, but
// 3 starts is a small, noisy sample, so it should adjust — not dominate. Because
// effectiveERA() reads p.era, this flows into BOTH the moneyline and totals.
// FIP components (k9/bb9/hr9) are left at season values (3-start rate stats are
// far too noisy to touch). Clamps the recent blend so one disaster start can't
// wreck the projection.
function blendRecentForm(pitcher, recentStarts) {
  if (!pitcher || pitcher.era == null) return pitcher;
  const recentEra = recentFormEra(recentStarts);
  if (recentEra == null) return pitcher;
  // Clamp recent ERA to a sane band before blending (a 2-inning 9-ER nightmare
  // shouldn't read as a 40 ERA pitcher going forward).
  const clampedRecent = Math.max(1.0, Math.min(9.0, recentEra));
  const blended = round2(0.75 * pitcher.era + 0.25 * clampedRecent);
  return { ...pitcher, era: blended, _seasonEra: pitcher.era, _recentEra: recentEra };
}

// ── THIN-SAMPLE REGRESSION ────────────────────────────────────────────────────
// A pitcher's rate stats (ERA, WHIP, K9, BB9, HR9) are statistically meaningless
// over a handful of innings. A call-up or spot starter with 0.2 IP and one run
// allowed shows a 13.50 ERA / 13.50 HR9 — which the model would otherwise read as
// "batting practice," wildly inflating the run total AND every opposing hitter's
// HR prop at once (the exact KC @ CIN failure: model projected 11.22 vs a 9.5
// market line because CIN's starter had pitched two-thirds of an inning).
//
// The fix is standard regression to the mean: until a pitcher has thrown enough
// innings to stabilize, pull his rate stats toward league average, weighted by how
// thin the sample is. At 0 IP he is 100% league average (we genuinely know nothing
// about him); by FULL_TRUST_IP he is 100% his own numbers; in between it slides
// linearly. Counting stats (wins, hits, etc.) are left untouched — only the rate
// stats that feed the projection get regressed. This corrects the moneyline,
// totals, and HR props at the SOURCE, before any of them are computed.
const FULL_TRUST_IP = 30;        // at/above this many IP, use the pitcher's own rates as-is
const LEAGUE_RATE = {            // league-average pitcher rates to regress toward
  era: LEAGUE_AVG.era,           // 4.30
  whip: 1.30,
  strikeoutsPer9: 8.6,
  walksPer9: 3.1,
  homeRunsPer9: LEAGUE_AVG.homeRunsPer9, // 1.20
};
function regressThinSample(pitcher) {
  if (!pitcher) return pitcher;
  const ip = pitcher.inningsPitched ?? 0;
  // Enough innings to trust the pitcher's own numbers — leave untouched.
  if (ip >= FULL_TRUST_IP) return pitcher;
  // Weight on the pitcher's OWN stats grows linearly from 0 (at 0 IP) to 1 (at
  // FULL_TRUST_IP). The remainder is weight on league average.
  const wSelf = Math.max(0, Math.min(1, ip / FULL_TRUST_IP));
  const wLeague = 1 - wSelf;
  const mix = (selfVal, leagueVal) => {
    if (selfVal == null) return leagueVal; // no own number → use league
    return round2(wSelf * selfVal + wLeague * leagueVal);
  };
  return {
    ...pitcher,
    era: mix(pitcher.era, LEAGUE_RATE.era),
    whip: mix(pitcher.whip, LEAGUE_RATE.whip),
    strikeoutsPer9: mix(pitcher.strikeoutsPer9, LEAGUE_RATE.strikeoutsPer9),
    walksPer9: mix(pitcher.walksPer9, LEAGUE_RATE.walksPer9),
    homeRunsPer9: mix(pitcher.homeRunsPer9, LEAGUE_RATE.homeRunsPer9),
    _rawEra: pitcher.era,        // keep originals for debugging/display
    _regressedFromIP: ip,
  };
}


// Given a team's vsLHP/vsRHP splits and the opposing starter's hand,
// return a multiplier (~0.92–1.08) reflecting how well they hit that hand
// relative to their own overall level. Falls back to 1.0 when data is missing.
function handednessMultiplier(splits, opposingHand, teamOverallOps) {
  if (!splits || !opposingHand || !teamOverallOps) return 1.0;
  const facing = opposingHand === "L" ? splits.vsLHP : splits.vsRHP;
  if (!facing || !facing.ops || facing.atBats < 50) return 1.0; // too small a sample
  // How much better/worse they hit this hand vs their season OPS
  let mult = facing.ops / teamOverallOps;
  // Dampen so it nudges rather than dominates, and clamp to a sane band
  mult = 1 + (mult - 1) * 0.6;
  return Math.max(0.90, Math.min(1.10, mult));
}

// ── MONEYLINE MODEL ───────────────────────────────────────────────────────────
function calculateMoneylineProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, awayBullpen, homeBullpen, awayHandMult, homeHandMult) {
  // Use FIP-blended effective ERA (more predictive than raw ERA) when components exist.
  const awayEff = effectiveERA(awayPitcher);
  const homeEff = effectiveERA(homePitcher);
  const awayPitcherFactor = awayEff ? LEAGUE_AVG.era / Math.max(awayEff, 1.5) : 1.0;
  const homePitcherFactor = homeEff ? LEAGUE_AVG.era / Math.max(homeEff, 1.5) : 1.0;

  // Offense factor now adjusted by handedness vs the opposing starter
  const awayOffenseFactor = (awayTeamHit?.ops ? awayTeamHit.ops / LEAGUE_AVG.ops : 1.0) * (awayHandMult || 1.0);
  const homeOffenseFactor = (homeTeamHit?.ops ? homeTeamHit.ops / LEAGUE_AVG.ops : 1.0) * (homeHandMult || 1.0);

  // Bullpen factor now uses reliever-only ERA when available (more accurate than full-staff)
  const awayPenEra = awayBullpen?.era ?? null;
  const homePenEra = homeBullpen?.era ?? null;
  const awayBullpenFactor = awayPenEra ? LEAGUE_AVG.era / Math.max(awayPenEra, 2.5) : 1.0;
  const homeBullpenFactor = homePenEra ? LEAGUE_AVG.era / Math.max(homePenEra, 2.5) : 1.0;

  const awayStrength =
    Math.pow(awayPitcherFactor, 0.40) *
    Math.pow(awayOffenseFactor, 0.40) *
    Math.pow(awayBullpenFactor, 0.20);
  const homeStrength =
    Math.pow(homePitcherFactor, 0.40) *
    Math.pow(homeOffenseFactor, 0.40) *
    Math.pow(homeBullpenFactor, 0.20);

  // HOME_BOOST raised 1.04 -> 1.10 (Jun 2026). Backtest over ~180 finished games
  // showed the pure model under-rated home teams: predicted ~50.3% vs actual ~51.4%.
  // 1.10 centers predicted home-win within ~0.3pts of actual AND had the lowest
  // log-loss of {1.04, 1.10, 1.15}; 1.15 overshot. Mainly fixes the home/away
  // centering (trims a systematic road-underdog lean in the edges); only a marginal
  // log-loss change. NOTE: this resets the clean CLV measurement going forward.
  const HOME_BOOST = 1.10;
  const adjHomeStrength = homeStrength * HOME_BOOST;
  const homeWinProb = adjHomeStrength / (adjHomeStrength + awayStrength);
  const awayWinProb = 1 - homeWinProb;
  return { awayWinProb: round3(awayWinProb), homeWinProb: round3(homeWinProb) };
}

// ── TOTALS MODEL ──────────────────────────────────────────────────────────────
function calculateTotalProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, weather, awayBullpen, homeBullpen, awayHandMult, homeHandMult) {
  // Offense scaled by handedness vs the opposing starter
  const awayRPG = (awayTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame) * (awayHandMult || 1.0);
  const homeRPG = (homeTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame) * (homeHandMult || 1.0);
  const baseTotal = awayRPG + homeRPG;

  const awayPitcherERA = effectiveERA(awayPitcher) ?? LEAGUE_AVG.era;
  const homePitcherERA = effectiveERA(homePitcher) ?? LEAGUE_AVG.era;
  const pitcherAdj = ((awayPitcherERA + homePitcherERA) / 2 - LEAGUE_AVG.era) * 0.40;

  const parkAdj = (game.parkRunFactor - 1.0) * baseTotal;

  let weatherAdj = 0;
  if (weather && !weather.indoor) {
    if (weather.windEffect === "out") weatherAdj += 0.4;
    if (weather.windEffect === "in") weatherAdj -= 0.4;
    if (weather.tempEffect === "hot") weatherAdj += 0.3;
    if (weather.tempEffect === "cold") weatherAdj -= 0.3;
  }

  // Bullpen adjustment: both pens pitch ~3 innings/game. A good pen suppresses
  // late runs; a bad pen inflates them. Compare each pen to league avg.
  let bullpenAdj = 0;
  const awayPenEra = awayBullpen?.era;
  const homePenEra = homeBullpen?.era;
  if (awayPenEra) bullpenAdj += ((awayPenEra - LEAGUE_AVG.bullpenEra) / 9) * 3.0;
  if (homePenEra) bullpenAdj += ((homePenEra - LEAGUE_AVG.bullpenEra) / 9) * 3.0;

  const projected = baseTotal + pitcherAdj + parkAdj + weatherAdj + bullpenAdj;
  return {
    projectedTotal: round2(projected),
    breakdown: {
      base: round2(baseTotal),
      pitcherAdj: round2(pitcherAdj),
      parkAdj: round2(parkAdj),
      weatherAdj: round2(weatherAdj),
      bullpenAdj: round2(bullpenAdj),
    },
  };
}

// ── HR PROP MODEL ─────────────────────────────────────────────────────────────
// recent15 (last-15-day stats) is now an INPUT, not just display: a hitter on a
// genuine power surge (or slump) gets nudged off their season HR rate. Kept
// conservative — 15 days is a small sample — so it blends, never dominates.
//
// CALIBRATION (2026-06-06, HR): the first real graded sample (808 picks) showed
// the model's confidence running BACKWARDS — the HIGH-confidence tier claimed a
// 27.6% game-HR rate but delivered 11.4% over 362 picks (≈7.6% per-PA projected
// vs ≈2.9% actual), and was its WORST tier by ROI (-21.5%). Cause: the env
// factors (pitcher × park × iso × weather) multiply RAW, so "good in every
// category" compounds into fantasy projections (some picks implied a 40%+ game
// HR chance — no hitter does that). Three principled, reversible damps below.
// To revert toward old behavior: cap → 0.15, damp → 1.0, shrink → 1.0.
const HR_PERPA_CAP = 0.08;    // per-PA HR ceiling (was 0.15). Elite sluggers top out ~7-8%/PA.
const HR_FACTOR_DAMP = 0.5;   // pull the COMBINED env multiplier toward 1 (^0.5 = sqrt): still tilts, can't stack into a lock.
const HR_PROB_SHRINK = 0.7;   // shrink the adjusted per-PA rate 30% back toward the batter's OWN base rate (keeps player differentiation, unlike shrinking to league avg).

// ── HR MODEL v2 INPUTS (2026-06-06) ───────────────────────────────────────────
// Three new signals layered on the calibrated base. Each is bounded so it tilts
// the projection without re-creating the overconfidence the calibration removed.
// The 0.08 per-PA cap above is the final backstop beneath all of them.
//
// (a) STATCAST power — barrel rate is the most HR-predictive metric available, so
//     it (blended with xwOBA) becomes the power input, preferred over raw ISO.
const LEAGUE_BARREL_RATE = 0.080; // league-avg barrels / batted-ball event (~8%)
const LEAGUE_XWOBA = 0.320;       // league-avg xwOBA
function clampHR(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function powerFactor(batterStats, statcast) {
  const parts = [];
  if (statcast) {
    if (statcast.barrelRate != null) {
      let br = statcast.barrelRate; if (br > 1) br /= 100; // auto-normalize percent vs fraction
      parts.push(clampHR(br / LEAGUE_BARREL_RATE, 0.6, 1.8));
    }
    if (statcast.xwOBA != null && statcast.xwOBA > 0) {
      parts.push(clampHR(statcast.xwOBA / LEAGUE_XWOBA, 0.7, 1.5));
    }
  }
  if (parts.length === 0) {
    // No Statcast — fall back to the original ISO-based power factor.
    return (batterStats && batterStats.iso) ? (batterStats.iso / LEAGUE_AVG.iso) ** 0.5 : 1.0;
  }
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return clampHR(avg, 0.85, 1.30); // hard cap; further sqrt-dampened inside the env stack
}

// (b) BATTER vs PITCHER — mostly noise (tiny samples, HR is a rare event), so it
//     is a BOUNDED nudge only: needs a real sample, sample-weighted, capped ±12%.
//     Raise BVP_MAX_TILT to trust it more (not recommended), 0 to disable.
const BVP_MIN_AB = 20;     // below this many career AB vs the pitcher → ignore
const BVP_FULL_AB = 60;    // weight ramps to ~full here (HR-vs-pitcher rarely exceeds this)
const BVP_MAX_TILT = 0.12; // max ± influence on the projection
function bvpNudge(bvp) {
  if (!bvp || (bvp.atBats || 0) < BVP_MIN_AB || bvp.hr == null) return 1.0;
  const bvpRate = bvp.hr / bvp.atBats;             // HR per AB vs this pitcher
  const w = Math.min(1, bvp.atBats / BVP_FULL_AB); // sample weight
  const ratio = bvpRate / LEAGUE_AVG.hrPerPA;      // vs league HR rate
  const tilt = BVP_MAX_TILT * w * clampHR(ratio - 1, -1, 1);
  return clampHR(1 + tilt, 1 - BVP_MAX_TILT, 1 + BVP_MAX_TILT);
}

// (c) LINEUP SPOT → expected plate appearances. Leadoff sees ~4.6 PA/game, the
//     9-hole ~3.7 — more PA = more HR chances. Unknown order falls back to 4.1.
const LINEUP_PA = { 1: 4.65, 2: 4.55, 3: 4.45, 4: 4.30, 5: 4.20, 6: 4.05, 7: 3.95, 8: 3.85, 9: 3.75 };
function expectedPAForOrder(order) { return LINEUP_PA[order] ?? 4.1; }

// (d) MARKET PRIOR (owner's insight, 2026-06-06): the book's price is a sharp
//     signal of true HR likelihood. The model may sit at most this multiple above
//     the book's implied prob — a long price is the book's clue the hitter is
//     unlikely, so a model that claims a deep longshot is a lock is almost always
//     wrong. Caps longshot "edges"; lets shorter-priced book-likely hitters rise.
//     1.0 = never bet above the book; raise to trust the model's disagreement more.
const MAX_OVER_MARKET = 1.5;

// (d-exception) BvP override on the market cap: a LONGSHOT with a GENUINE record
// vs this exact pitcher earns a higher ceiling (2.0× instead of 1.5×). Strictly
// gated so it can't re-open the longshot leak the cap exists to plug — only a
// real sample qualifies (30+ career AB, 2+ HR), and only on longshot prices
// (+400 and up), where the cap actually binds. Thin "2-for-6" samples do NOT
// qualify. Even when it fires, the 0.08 per-PA cap still backstops the result.
const MAX_OVER_MARKET_BVP = 2.0; // elevated cap multiple when BvP qualifies
const BVP_EXC_MIN_AB = 30;       // need a real sample vs the pitcher
const BVP_EXC_MIN_HR = 2;        // and demonstrated power within it
const BVP_EXC_MIN_ODDS = 400;    // only for longshots (the +450–+1000 band)
function marketCapMult(bvp, americanOdds) {
  const qualifies =
    americanOdds != null && americanOdds >= BVP_EXC_MIN_ODDS &&
    bvp && (bvp.atBats || 0) >= BVP_EXC_MIN_AB && (bvp.hr || 0) >= BVP_EXC_MIN_HR;
  return qualifies ? MAX_OVER_MARKET_BVP : MAX_OVER_MARKET;
}

// RECORDING GATE (2026-06-06): only stake/record a prop when the model rates it a
// real edge. Was `edge > -0.05`, which logged the model's OWN rated-losers (a big
// driver of the -7.2% HR ROI). 0.025 = the MEDIUM confidence tier (see
// rateConfidence). Applies to HR / strikeouts / hits. Lower to 0.005 (LOW+) for
// more volume, raise to 0.05 (HIGH-only) for fewer/stronger picks.
const MIN_PROP_EDGE = 0.025;

function calculateHRProbability(batterStats, opposingPitcherStats, game, weather, recent15, statcast, bvp, battingOrder) {
  if (!batterStats) return null;
  const seasonRate = batterStats.hrPerPA ?? LEAGUE_AVG.hrPerPA;
  if (seasonRate === 0) return null;

  // Blend recent form into the base rate. recent15 gives HR over recent AB; turn
  // that into a per-PA-ish rate and require a real sample (≥25 AB) before trusting
  // it. 70% season / 30% recent, then clamp the blended rate to ±60% of season so
  // one hot/cold streak can't produce a silly projection.
  let baseHRRate = seasonRate;
  if (recent15 && recent15.atBats >= 25 && recent15.homeRuns != null) {
    const recentRate = recent15.homeRuns / (recent15.atBats * 1.08); // approx PA from AB
    const blended = 0.70 * seasonRate + 0.30 * recentRate;
    baseHRRate = Math.max(seasonRate * 0.4, Math.min(seasonRate * 1.6, blended));
  }

  const expectedPA = expectedPAForOrder(battingOrder); // (c) lineup-aware PA
  const pitcherHR9 = opposingPitcherStats?.homeRunsPer9 ?? LEAGUE_AVG.homeRunsPer9;
  const pitcherFactor = pitcherHR9 / LEAGUE_AVG.homeRunsPer9;
  const parkFactor = game.parkHRFactor || 1.0;
  const powFactor = powerFactor(batterStats, statcast); // (a) Statcast-preferred power
  let weatherFactor = 1.0;
  if (weather && !weather.indoor) {
    if (weather.windEffect === "out") weatherFactor *= 1.15;
    if (weather.windEffect === "in") weatherFactor *= 0.85;
    if (weather.tempEffect === "hot") weatherFactor *= 1.08;
    if (weather.tempEffect === "cold") weatherFactor *= 0.92;
  }
  // Environmental adjustment: dampened so good-in-everything tilts the
  // projection without compounding into a lock (see HR_FACTOR_DAMP note above).
  const envMult = Math.pow(
    pitcherFactor * parkFactor * powFactor * weatherFactor,
    HR_FACTOR_DAMP
  );
  // (b) BvP applied as a small bounded nudge OUTSIDE the dampened stack.
  const bvpFactor = bvpNudge(bvp);
  let perPAProb = baseHRRate * envMult * bvpFactor;
  // Shrink the adjusted rate back toward the batter's own base rate, then cap.
  perPAProb = baseHRRate + HR_PROB_SHRINK * (perPAProb - baseHRRate);
  perPAProb = Math.max(0, Math.min(HR_PERPA_CAP, perPAProb));
  const noHRProb = Math.pow(1 - perPAProb, expectedPA);
  return round3(1 - noHRProb);
}

// ── PITCHER STRIKEOUT PROP MODEL ──────────────────────────────────────────────
// Expected Ks for a starter = K/9 × (expected innings / 9) × opponent-K factor.
// Single-game Ks are modeled as Poisson(expectedKs); P(over a .5 line) follows.
// A v1 projection — calibrate the constants once real K-prop results accumulate.
// CALIBRATION (2026-06-06, step 1): single-game prop counts are OVERDISPERSED
// vs the Poisson we model them with, so raw over/under probabilities come out
// too extreme (June 5: model claimed ~60-67% on its OVER picks, they hit
// 25-46%). Shrink every prop probability toward 0.5 by this factor to tame the
// overconfidence WITHOUT flipping which side we take. Small, reversible nudge —
// raise toward 1.0 to weaken it, lower to strengthen. Re-evaluate after a week.
const PROP_PROB_SHRINK = 0.75;
function shrinkProb(p) { return p == null ? null : 0.5 + PROP_PROB_SHRINK * (p - 0.5); }
const LEAGUE_K9 = 8.6;              // league starter strikeouts per 9
const LEAGUE_TEAM_K_PER_GAME = 8.6; // league average team strikeouts per game
const DEFAULT_START_IP = 5.3;       // league-average starter innings per start

function poissonCdf(k, lambda) {
  if (k < 0 || !(lambda > 0)) return 0;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term; }
  return Math.min(1, sum);
}

function expectedKsFor(pitcherStats) {
  const k9 = pitcherStats.strikeoutsPer9 ?? LEAGUE_K9;
  let expIP = DEFAULT_START_IP;
  if (pitcherStats.gamesStarted > 0 && pitcherStats.inningsPitched > 0) {
    expIP = Math.max(3.5, Math.min(7.0, pitcherStats.inningsPitched / pitcherStats.gamesStarted));
  }
  return round2((k9 / 9) * expIP);
}

// P(strikeouts OVER the line) for a starting pitcher vs a given opponent.
function strikeoutOverProb(pitcherStats, oppTeamStats, line) {
  if (!pitcherStats || line == null) return null;
  const k9 = pitcherStats.strikeoutsPer9 ?? LEAGUE_K9;
  if (!k9) return null;
  let expIP = DEFAULT_START_IP;
  if (pitcherStats.gamesStarted > 0 && pitcherStats.inningsPitched > 0) {
    expIP = pitcherStats.inningsPitched / pitcherStats.gamesStarted;
  }
  expIP = Math.max(3.5, Math.min(7.0, expIP));
  let oppFactor = 1.0;
  if (oppTeamStats && oppTeamStats.games > 0 && oppTeamStats.strikeouts != null) {
    oppFactor = (oppTeamStats.strikeouts / oppTeamStats.games) / LEAGUE_TEAM_K_PER_GAME;
    oppFactor = Math.max(0.82, Math.min(1.18, oppFactor)); // one stat shouldn't swing it wildly
  }
  const lambda = (k9 / 9) * expIP * oppFactor;
  if (!(lambda > 0)) return null;
  // .5 lines: over wins on K >= floor(line)+1, so P(over) = 1 - CDF(floor(line))
  return round3(shrinkProb(1 - poissonCdf(Math.floor(line), lambda)));
}

// ── BATTER HITS PROP MODEL ────────────────────────────────────────────────────
// Per-AB hit prob = batting avg, adjusted by the opposing starter's BAA, over
// expected at-bats. Single-game hits modeled as Poisson(expected hits). v1 — same
// calibration family as the K model, so tune both together once results land.
const LEAGUE_BAA = 0.245;          // league batting average against
const DEFAULT_AB_PER_GAME = 3.4;   // expected at-bats (lowered 3.8->3.4 2026-06-06: model over-picked fringe/platoon bats assuming full-regular ABs)

function hitsOverProb(batterStats, oppPitcherStats, line) {
  if (!batterStats || line == null) return null;
  const avg = batterStats.avg;
  if (avg == null || avg <= 0) return null;
  let perAB = avg;
  const baa = oppPitcherStats && oppPitcherStats.battingAvgAgainst;
  if (baa != null && baa > 0) {
    perAB = avg * Math.max(0.80, Math.min(1.20, baa / LEAGUE_BAA));
  }
  perAB = Math.max(0.10, Math.min(0.45, perAB)); // sane per-AB bounds
  const expHits = DEFAULT_AB_PER_GAME * perAB;
  if (!(expHits > 0)) return null;
  return round3(shrinkProb(1 - poissonCdf(Math.floor(line), expHits)));
}

// ── EDGE CALCULATION ──────────────────────────────────────────────────────────
// One-sided edge (model prob minus raw vig-inflated implied). Kept for HR props,
// where we only have the "Over" side and can't cleanly de-vig.
function calculateEdge(modelProb, americanOdds) {
  if (modelProb == null || americanOdds == null) return null;
  const implied = americanToImpliedProb(americanOdds);
  if (implied == null) return null;
  return round3(modelProb - implied);
}

// De-vig a two-way market: the book's two implied probs sum to >1 (their margin).
// Normalizing them to sum to 1 recovers the book's FAIR probability — which is
// what we must compare the model against. Comparing to the raw implied prob
// instead overstates every edge by roughly half the vig (~2-2.5% on a -110 market),
// which is larger than our entire LOW->MEDIUM threshold. This is the single most
// important correctness fix in the model.
function devigTwoWay(thisOdds, otherOdds) {
  if (thisOdds == null || otherOdds == null) return null;
  const a = americanToImpliedProb(thisOdds);
  const b = americanToImpliedProb(otherOdds);
  if (a == null || b == null) return null;
  const sum = a + b;
  if (!(sum > 0)) return null;
  return a / sum; // fair, no-vig probability for THIS side
}

// Edge vs the FAIR (de-vigged) line. Needs both sides' odds.
function calculateEdgeDevig(modelProb, thisOdds, otherOdds) {
  if (modelProb == null) return null;
  const fair = devigTwoWay(thisOdds, otherOdds);
  if (fair == null) return calculateEdge(modelProb, thisOdds); // fallback if a side is missing
  return round3(modelProb - fair);
}
function rateConfidence(edge) {
  if (edge == null) return "NEUTRAL";
  if (edge >= 0.05) return "HIGH";
  if (edge >= 0.025) return "MEDIUM";
  if (edge >= 0.005) return "LOW";
  return "NEUTRAL";
}

// ── SANITY BACKSTOP ───────────────────────────────────────────────────────────
// A legitimate pre-game edge is almost never larger than ~15% (a strong play is
// 5-10%; the clean pre-game slate tops out around 12%). An edge beyond
// SANE_EDGE_MAX is virtually ALWAYS a symptom of the model being compared against
// the wrong number — e.g. a stale pre-game projection measured against a LIVE
// in-game line for a game already underway, or a bad odds-to-game match — not a
// real opportunity. Surfacing a wild +44% / +69% "edge" destroys trust, so we
// DROP it at the source: every edge the model produces passes through here, and
// anything implausible becomes null. Because all display paths already hide a
// null edge (lists guard `edge != null`; game pages render an edge only when
// present), a dropped edge cleanly disappears EVERYWHERE — every list, every game
// page, and any future view — without each of them needing its own guard. This is
// the last line of defense; the primary correctness gate is still showing
// pre-game edges only for games that haven't started.
const SANE_EDGE_MAX = 0.30;
function sanitizeEdge(edge) {
  if (edge == null) return null;
  if (!Number.isFinite(edge)) return null;
  if (Math.abs(edge) > SANE_EDGE_MAX) return null; // implausible → almost certainly a bad comparison
  return edge;
}

// ── MARKET BLEND + OVERREACTION FLAG (v0.5) ───────────────────────────────────
// The de-vigged closing line is the single sharpest predictor in sports betting —
// sharper than almost any model. So instead of trusting our raw model number 100%,
// we ANCHOR it partway toward the market's fair (de-vigged) probability. This does
// two honest things at once:
//   1. Accuracy: we borrow the market's wisdom, so our number is better calibrated.
//   2. Discipline: a model number that wildly disagrees with a sharp price gets
//      pulled back toward reality, so we can't manufacture a fake edge by being
//      stubbornly far from the market. (Same inflated-edge problem, fixed at the
//      math level rather than just capped after the fact.)
//
// The edge we then report is (blended model view) − (fair market) — i.e. how far
// our blended opinion still sits from the market AFTER respecting it. If we fully
// agreed with the market the edge would be ~0, which is correct: agreeing with a
// sharp price is not an edge.
//
// SAFETY: this is core model math. It is behind an on/off switch + a single weight
// knob. To revert to exact pre-blend behavior, set MARKET_BLEND_ENABLED = false
// (or W_MODEL = 1.0) and redeploy — no old code to dig up.
const MARKET_BLEND_ENABLED = true; // master switch — false = exact old behavior
const W_MODEL = 0.55;              // 0.55 = 55% our model, 45% market. Higher = trust model more.

// Blend our model probability toward the market's fair probability, then return the
// edge vs that fair market number. Needs BOTH sides' odds for a real de-vig; if a
// side is missing we fall back to the existing un-blended edge so nothing breaks.
function blendedEdge(modelProb, thisOdds, otherOdds) {
  if (modelProb == null) return null;
  if (!MARKET_BLEND_ENABLED) {
    return calculateEdgeDevig(modelProb, thisOdds, otherOdds); // old path
  }
  const fair = devigTwoWay(thisOdds, otherOdds);
  if (fair == null) {
    // No clean two-way market → can't blend meaningfully; keep old behavior.
    return calculateEdgeDevig(modelProb, thisOdds, otherOdds);
  }
  const blended = W_MODEL * modelProb + (1 - W_MODEL) * fair;
  return round3(blended - fair);
}

// "Market overreaction" flag — the owner's contrarian read as honest CONTEXT, not a
// bet recommendation. When the market's fair probability for a side sits well ABOVE
// our model's fundamentals (market thinks this side is more likely than we do by
// >= INFLATION_THRESHOLD), the price is probably carrying public/streak hype the
// fundamentals don't support — the classic "hot team over-bet by the public" spot.
// We surface a neutral note; the user decides what to do with it. We NEVER tell
// them to bet a side. We flag the side the MARKET is high on (the likely-inflated
// favorite), so a fade-the-public reader knows where to look.
const INFLATION_THRESHOLD = 0.08; // market fair prob exceeds model prob by 8%+
function overreactionNote(modelProb, thisOdds, otherOdds) {
  if (modelProb == null) return null;
  const fair = devigTwoWay(thisOdds, otherOdds);
  if (fair == null) return null;
  const gap = fair - modelProb; // + => market rates this side higher than our model
  if (gap >= INFLATION_THRESHOLD) {
    return {
      inflated: true,
      gap: round3(gap),
      note: "Market rates this side higher than our model — possible public/streak inflation.",
    };
  }
  return null;
}

// ── ORCHESTRATION ─────────────────────────────────────────────────────────────
const MAX_HR_GAMES = 5;
// ── CONVICTION (v0.6) ─────────────────────────────────────────────────────────
// Conviction is ORTHOGONAL to edge. Edge = how much value vs the line; conviction
// = how much we trust the projection behind it, 0–100, from three signals the
// model already computes:
//   • stability    — are the starters past the sample where their stats mean
//                    something (regressThinSample's ip/FULL_TRUST_IP), or mostly
//                    league-average guesswork?
//   • completeness — how many real inputs fed the projection vs league-average
//                    placeholders (confirmed starters, lineup, bullpen, weather…)?
//   • agreement    — do the independent factors point the SAME way as the pick,
//                    or does the edge rest on one factor while the others disagree?
// Conviction NEVER changes the edge, the pick, or grading — pure annotation, so a
// user can tell "modest edge, high conviction" from "juicy edge, thin data." It is
// deliberately falsifiable: persisted so we can later check whether high-conviction
// picks actually beat the close more than low ones.
const CONVICTION_WEIGHTS = { stability: 0.40, completeness: 0.35, agreement: 0.25 };
const clampScore = (x) => Math.max(0, Math.min(100, x));

// Shared game-level inputs: stability + completeness (same for every side).
function convictionBase(ctx) {
  // stability: average of each starter's own-sample weight (ip / FULL_TRUST_IP).
  const ipWeight = (p) => {
    if (!p || p.inningsPitched == null) return 0; // TBD / unknown starter → no trust
    return Math.max(0, Math.min(1, p.inningsPitched / FULL_TRUST_IP));
  };
  const stability = clampScore(((ipWeight(ctx.awayPitcher) + ipWeight(ctx.homePitcher)) / 2) * 100);

  // completeness: 100 minus a dock for every input running on a placeholder.
  let completeness = 100;
  if (!ctx.awayPitcher) completeness -= 20;
  if (!ctx.homePitcher) completeness -= 20;
  const lineupDock = (src) => (src === "confirmed" ? 0 : src === "recent" ? 4 : 8);
  completeness -= lineupDock(ctx.awayLineupSource);
  completeness -= lineupDock(ctx.homeLineupSource);
  if (!ctx.awayBullpen?.era) completeness -= 6;
  if (!ctx.homeBullpen?.era) completeness -= 6;
  if (!ctx.weather) completeness -= 5;
  if (!ctx.awayHandSplits) completeness -= 3;
  if (!ctx.homeHandSplits) completeness -= 3;
  if (!ctx.awayHit?.ops) completeness -= 5;
  if (!ctx.homeHit?.ops) completeness -= 5;

  return { stability: Math.round(stability), completeness: Math.round(clampScore(completeness)) };
}

// Agreement for a TOTAL pick: of the signed adjustments moving the projection off
// its base, how many push the SAME way as our side (over = up, under = down)?
// All aligned → high; an edge that exists despite most factors disagreeing → low.
function totalAgreement(breakdown, side /* "over" | "under" */) {
  if (!breakdown) return 50;
  const adjs = [breakdown.pitcherAdj, breakdown.parkAdj, breakdown.weatherAdj, breakdown.bullpenAdj];
  const want = side === "over" ? 1 : -1;
  const moving = adjs.filter((a) => Math.abs(a) > 0.05); // ignore ~zero factors
  if (moving.length === 0) return 45; // nothing pushing the total → weak read
  const aligned = moving.filter((a) => Math.sign(a) === want).length;
  return clampScore(30 + (aligned / moving.length) * 70);
}

// Agreement for a MONEYLINE / run-line pick: how decisive is our side's win-prob
// lean (distance from a coin flip), plus a small bonus when the matchup reads as
// pitching-driven (a coherent reason to back a side rather than chase offense).
function leanAgreement(ml, breakdown, side /* "away" | "home" */) {
  const winProb = side === "away" ? ml.awayWinProb : ml.homeWinProb;
  if (winProb == null) return 50;
  const lean = Math.min(1, Math.abs(winProb - 0.5) / 0.25); // .25 over a coin flip = full
  let score = 40 + lean * 50;
  if (breakdown && breakdown.pitcherAdj < -0.15) score += 5; // pitching-driven matchup
  return clampScore(score);
}

function convictionTier(score) {
  if (score >= 72) return "HIGH";
  if (score >= 50) return "MEDIUM";
  return "LOW";
}

function finalizeConviction(base, agreement) {
  const score = Math.round(
    CONVICTION_WEIGHTS.stability * base.stability +
    CONVICTION_WEIGHTS.completeness * base.completeness +
    CONVICTION_WEIGHTS.agreement * agreement
  );
  return { score, tier: convictionTier(score) };
}

// ── HONEST REASONING GENERATOR (template-assembled from real model fields) ──────
// Every clause is gated on a real data field. If a field is missing, its clause
// is omitted — we never paper over a gap with a guess. No free-written prose:
// the narrative can only ever say what the model's inputs actually contain.
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const pct = (p) => (p == null ? null : Math.round(p * 100));
function eraWord(era) {
  if (era == null) return null;
  if (era <= 3.3) return "sharp";
  if (era <= 4.0) return "solid";
  if (era >= 4.75) return "hittable";
  return null;
}
function parkClause(parkRunFactor, adj) {
  if (parkRunFactor == null || adj == null || Math.abs(adj) < 0.15) return null;
  if (parkRunFactor > 1.03) return "a hitter-friendly park";
  if (parkRunFactor < 0.97) return "a pitcher-friendly park";
  return null;
}
function weatherClause(weather, adj) {
  if (!weather || weather.indoor || adj == null || Math.abs(adj) < 0.15) return null;
  if (weather.windEffect === "out") return "wind blowing out";
  if (weather.windEffect === "in") return "wind holding the ball in";
  if (weather.tempEffect === "hot") return "warm air helping carry";
  if (weather.tempEffect === "cold") return "cold air suppressing carry";
  return null;
}
function bullpenClause(adj) {
  if (adj == null || Math.abs(adj) < 0.2) return null;
  return adj > 0 ? "shaky bullpens" : "strong bullpens";
}
function trustLine(tier, stability, completeness, agreement) {
  const parts = [];
  if (completeness >= 85) parts.push("full data");
  else if (completeness >= 70) parts.push("most inputs in");
  else parts.push("partial data — some inputs on league averages");
  if (stability >= 70) parts.push("starters past the small-sample zone");
  else if (stability >= 40) parts.push("starter sample still building");
  else parts.push("very early starter sample");
  if (agreement >= 65) parts.push("factors aligned");
  else if (agreement >= 45) parts.push("factors mostly aligned");
  else parts.push("edge rests mainly on one factor");
  const word = tier === "HIGH" ? "High" : tier === "MEDIUM" ? "Medium" : "Low";
  return `${word} conviction: ${parts.join(", ")}.`;
}
function describeTotals(side, ctx) {
  const { projected, line, breakdown, awayEra, homeEra, awayAbbr, homeAbbr, parkRunFactor, weather } = ctx;
  const lead = projected != null && line != null
    ? `Model projects ${r1(projected)} runs against the ${line} line.`
    : projected != null ? `Model projects ${r1(projected)} runs.` : null;
  const clauses = [];
  if (breakdown && Math.abs(breakdown.pitcherAdj) >= 0.15) {
    const aw = eraWord(awayEra), hw = eraWord(homeEra);
    if (side === "under" && breakdown.pitcherAdj < 0 && (aw || hw)) {
      const bits = [];
      if (aw) bits.push(`${awayAbbr} ${r1(awayEra)} ERA`);
      if (hw) bits.push(`${homeAbbr} ${r1(homeEra)} ERA`);
      clauses.push(`starting pitching pulls it down (${bits.join(", ")})`);
    } else if (side === "over" && breakdown.pitcherAdj > 0) {
      clauses.push("the starters profile as hittable");
    }
  }
  const pk = parkClause(parkRunFactor, breakdown && breakdown.parkAdj);
  if (pk && ((side === "over") === (breakdown.parkAdj > 0))) clauses.push(pk);
  const wx = weatherClause(weather, breakdown && breakdown.weatherAdj);
  if (wx && ((side === "over") === (breakdown.weatherAdj > 0))) clauses.push(wx);
  const bp = bullpenClause(breakdown && breakdown.bullpenAdj);
  if (bp && ((side === "over") === (breakdown.bullpenAdj > 0))) clauses.push(bp);
  if (!lead && clauses.length === 0) return null;
  if (clauses.length === 0) return lead;
  const joined = clauses.length === 1 ? clauses[0] : clauses.slice(0, -1).join(", ") + " and " + clauses.slice(-1);
  const cap = joined.charAt(0).toUpperCase() + joined.slice(1);
  return `${lead ? lead + " " : ""}${cap}.`;
}
function describeMoneyline(side, ctx) {
  const { winProb, marketProb, teamAbbr, oppAbbr, era, oppEra, ops, oppOps } = ctx;
  const lead = winProb != null && marketProb != null
    ? `Model gives ${teamAbbr} a ${pct(winProb)}% chance vs the market's ${marketProb}%.`
    : winProb != null ? `Model gives ${teamAbbr} a ${pct(winProb)}% chance.` : null;
  const clauses = [];
  if (era != null && oppEra != null && oppEra - era >= 0.4) {
    clauses.push(`a starting-pitcher edge (${teamAbbr} ${r1(era)} vs ${oppAbbr} ${r1(oppEra)} ERA)`);
  }
  if (ops != null && oppOps != null && ops - oppOps >= 0.03) {
    clauses.push(`the bats (${teamAbbr} ${ops.toFixed(3)} vs ${oppAbbr} ${oppOps.toFixed(3)} OPS)`);
  }
  if (!lead && clauses.length === 0) return null;
  if (clauses.length === 0) return lead;
  const joined = clauses.length === 1 ? clauses[0] : clauses.slice(0, -1).join(", ") + " and " + clauses.slice(-1);
  return `${lead ? lead + " " : ""}Lean rests on ${joined}.`;
}

async function calculateGameEdges(game, oddsForGame) {
  const [
    awayPitcher,
    homePitcher,
    awayTeamHit,
    homeTeamHit,
    awayBullpen,
    homeBullpen,
    weather,
    awayPitcherRecent,
    homePitcherRecent,
    awayHandSplits,
    homeHandSplits,
    awayPitcherHand,
    homePitcherHand,
  ] = await Promise.all([
    game.awayProbable ? getPitcherSeasonStats(game.awayProbable.id) : null,
    game.homeProbable ? getPitcherSeasonStats(game.homeProbable.id) : null,
    getTeamSeasonStats(game.awayId),
    getTeamSeasonStats(game.homeId),
    getTeamBullpenStats(game.awayId),
    getTeamBullpenStats(game.homeId),
    getWeatherForVenue(game.venue),
    game.awayProbable ? getPitcherRecentStarts(game.awayProbable.id, 3) : [],
    game.homeProbable ? getPitcherRecentStarts(game.homeProbable.id, 3) : [],
    getTeamHandednessSplits(game.awayId),
    getTeamHandednessSplits(game.homeId),
    game.awayProbable ? getPitcherHand(game.awayProbable.id) : null,
    game.homeProbable ? getPitcherHand(game.homeProbable.id) : null,
  ]);

  // Confirmed/projected lineups → lineup-based offense (who's ACTUALLY playing),
  // replacing full-team OPS when we have a trustworthy lineup. Tier:
  // confirmed (today's card) > recent (last game) > team season stats (fallback).
  let awayLineup = { lineup: [], source: "none" };
  let homeLineup = { lineup: [], source: "none" };
  let awayLineupOff = null;
  let homeLineupOff = null;
  try {
    [awayLineup, homeLineup] = await Promise.all([
      getTeamLineup(game.awayId, game.id),
      getTeamLineup(game.homeId, game.id),
    ]);
    [awayLineupOff, homeLineupOff] = await Promise.all([
      getLineupOffense(awayLineup.lineup),
      getLineupOffense(homeLineup.lineup),
    ]);
  } catch (_) { /* fall back to team stats below */ }

  // Overlay: if we have a lineup offense, use ITS ops as the offense input while
  // keeping the team's season ops for the handedness baseline comparison. We do
  // NOT touch runsPerGame (that stays team-level) — lineup ops drives the ML
  // offense factor, which is where who's-playing matters most.
  const awayTeamOps = awayTeamHit?.ops ?? null;
  const homeTeamOps = homeTeamHit?.ops ?? null;
  const awayHit = awayLineupOff
    ? { ...awayTeamHit, ops: awayLineupOff.ops, _lineupSource: awayLineup.source }
    : awayTeamHit;
  const homeHit = homeLineupOff
    ? { ...homeTeamHit, ops: homeLineupOff.ops, _lineupSource: homeLineup.source }
    : homeTeamHit;

  // Away offense faces the HOME starter's hand; home offense faces the AWAY starter's hand.
  // Handedness multiplier compares the team's split vs its TEAM-level ops baseline.
  const awayHandMult = handednessMultiplier(awayHandSplits, homePitcherHand, awayTeamOps);
  const homeHandMult = handednessMultiplier(homeHandSplits, awayPitcherHand, homeTeamOps);

  // Blend recent form (last 3 starts) lightly into each starter's ERA before
  // projecting. Catches a pitcher who's clearly hot or slumping without letting
  // a tiny sample dominate. Flows into both ML and totals via effectiveERA.
  // First regress thin-sample starters toward league average (a 0.2-IP "13.50
  // ERA" must not be taken at face value), THEN nudge for recent form. Order
  // matters: regress the unreliable raw number first, then apply form on top.
  const awayPitcherReg = regressThinSample(awayPitcher);
  const homePitcherReg = regressThinSample(homePitcher);
  const awayPitcherForm = blendRecentForm(awayPitcherReg, awayPitcherRecent);
  const homePitcherForm = blendRecentForm(homePitcherReg, homePitcherRecent);

  console.log(`[Edges] ${game.awayAbbr}@${game.homeAbbr} | lineup away=${awayLineup.source}(ops ${awayLineupOff?.ops ?? "n/a"}) home=${homeLineup.source}(ops ${homeLineupOff?.ops ?? "n/a"}) | recentForm away ${awayPitcher?.era ?? "n/a"}→${awayPitcherForm?.era ?? "n/a"} home ${homePitcher?.era ?? "n/a"}→${homePitcherForm?.era ?? "n/a"} | handMult away=${awayHandMult.toFixed(3)} home=${homeHandMult.toFixed(3)}`);

  const ml = calculateMoneylineProjection(game, awayPitcherForm, homePitcherForm, awayHit, homeHit, awayBullpen, homeBullpen, awayHandMult, homeHandMult);
  const totals = calculateTotalProjection(game, awayPitcherForm, homePitcherForm, awayHit, homeHit, weather, awayBullpen, homeBullpen, awayHandMult, homeHandMult);

  const odds = oddsForGame || { h2h: {}, totals: {} };
  const awayML = odds.h2h?.away;
  const homeML = odds.h2h?.home;
  const totalLine = odds.totals?.line;
  const overOdds = odds.totals?.over;
  const underOdds = odds.totals?.under;

  // Every edge is blended toward the de-vigged market line (v0.5) then passed
  // through sanitizeEdge() so an implausible number can never surface.
  const awayEdge = sanitizeEdge(blendedEdge(ml.awayWinProb, awayML, homeML));
  const homeEdge = sanitizeEdge(blendedEdge(ml.homeWinProb, homeML, awayML));
  // Neutral "market overreaction" context (the side the market is high on).
  const awayInflation = overreactionNote(ml.awayWinProb, awayML, homeML);
  const homeInflation = overreactionNote(ml.homeWinProb, homeML, awayML);

  let overProb = null;
  let underProb = null;
  if (totalLine != null) {
    // Convert the projected-vs-line gap into a probability. The divisor is the
    // approximate standard deviation of an MLB game total (~4 runs). The old
    // value of 3.0 was too small, making the sigmoid too steep and OVERSTATING
    // how confident we were on every total (inflated edges). ~4.0 is closer to
    // the real spread of game outcomes.
    const TOTAL_SD = 4.0;
    overProb = sigmoid((totals.projectedTotal - totalLine) / TOTAL_SD);
    underProb = 1 - overProb;
  }
  const overEdge = sanitizeEdge(blendedEdge(overProb, overOdds, underOdds));
  const underEdge = sanitizeEdge(blendedEdge(underProb, underOdds, overOdds));
  const overInflation = overreactionNote(overProb, overOdds, underOdds);
  const underInflation = overreactionNote(underProb, underOdds, overOdds);

  // Run line (±1.5). Derive an expected run margin from the win prob, then the
  // probability each side covers. This is the moneyline opinion expressed at a
  // spread price (same lean, more variance) — blended toward the market like ML.
  const MARGIN_SD = 3.0; // approx SD of an MLB game's run margin
  const homeRLLine = odds.spreads?.homeLine ?? null;
  const awayRLLine = odds.spreads?.awayLine ?? null;
  const homeRLOdds = odds.spreads?.home ?? null;
  const awayRLOdds = odds.spreads?.away ?? null;
  let homeCoverProb = null, awayCoverProb = null, homeRLEdge = null, awayRLEdge = null;
  if (homeRLLine != null && awayRLLine != null && homeRLOdds != null && awayRLOdds != null) {
    // Derive the margin from the market-BLENDED win prob — the same humility the
    // moneyline edge gets. Using the raw win prob lets an overconfident model
    // inflate the run line into implausible cover %s and edges.
    const fairHomeWin = devigTwoWay(homeML, awayML);
    const blendedHomeWin = (MARKET_BLEND_ENABLED && fairHomeWin != null)
      ? (W_MODEL * ml.homeWinProb + (1 - W_MODEL) * fairHomeWin)
      : ml.homeWinProb;
    const muHome = MARGIN_SD * invNorm(blendedHomeWin); // expected home run margin
    const hCover = normalCDF((muHome + homeRLLine) / MARGIN_SD);
    const aCover = 1 - hCover;
    homeCoverProb = round3(hCover);
    awayCoverProb = round3(aCover);
    homeRLEdge = sanitizeEdge(blendedEdge(hCover, homeRLOdds, awayRLOdds));
    awayRLEdge = sanitizeEdge(blendedEdge(aCover, awayRLOdds, homeRLOdds));
  }

  // ── Conviction (v0.6): trust in the projection, ORTHOGONAL to edge size. ──────
  // Shared stability+completeness from the inputs that actually fed this game,
  // then a per-side factor-agreement term. Never alters edge, pick, or grading.
  const convBase = convictionBase({
    awayPitcher, homePitcher,
    awayLineupSource: awayLineup.source, homeLineupSource: homeLineup.source,
    awayBullpen, homeBullpen, weather, awayHandSplits, homeHandSplits, awayHit, homeHit,
  });
  const agAwayML = leanAgreement(ml, totals.breakdown, "away");
  const agHomeML = leanAgreement(ml, totals.breakdown, "home");
  const agOver = totalAgreement(totals.breakdown, "over");
  const agUnder = totalAgreement(totals.breakdown, "under");
  const cvAwayML = finalizeConviction(convBase, agAwayML);
  const cvHomeML = finalizeConviction(convBase, agHomeML);
  const cvOver = finalizeConviction(convBase, agOver);
  const cvUnder = finalizeConviction(convBase, agUnder);

  // Honest reasoning strings — assembled from the real fields above; never free-written.
  const mlMarket = (wp, edge) => (wp != null && edge != null ? Math.round((wp - edge) * 100) : null);
  const totReasonCtx = {
    projected: totals.projectedTotal, line: totalLine, breakdown: totals.breakdown,
    awayEra: awayPitcherForm?.era, homeEra: homePitcherForm?.era,
    awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr,
    parkRunFactor: game.parkRunFactor, weather,
  };
  const awayReason = describeMoneyline("away", { winProb: ml.awayWinProb, marketProb: mlMarket(ml.awayWinProb, awayEdge), teamAbbr: game.awayAbbr, oppAbbr: game.homeAbbr, era: awayPitcherForm?.era, oppEra: homePitcherForm?.era, ops: awayHit?.ops, oppOps: homeHit?.ops });
  const homeReason = describeMoneyline("home", { winProb: ml.homeWinProb, marketProb: mlMarket(ml.homeWinProb, homeEdge), teamAbbr: game.homeAbbr, oppAbbr: game.awayAbbr, era: homePitcherForm?.era, oppEra: awayPitcherForm?.era, ops: homeHit?.ops, oppOps: awayHit?.ops });
  const overReason = describeTotals("over", totReasonCtx);
  const underReason = describeTotals("under", totReasonCtx);
  const awayTrust = trustLine(cvAwayML.tier, convBase.stability, convBase.completeness, agAwayML);
  const homeTrust = trustLine(cvHomeML.tier, convBase.stability, convBase.completeness, agHomeML);
  const overTrust = trustLine(cvOver.tier, convBase.stability, convBase.completeness, agOver);
  const underTrust = trustLine(cvUnder.tier, convBase.stability, convBase.completeness, agUnder);

  return {
    game: {
      id: game.id,
      away: game.away,
      home: game.home,
      awayAbbr: game.awayAbbr,
      homeAbbr: game.homeAbbr,
      time: game.time,
      venue: game.venue,
      parkHRFactor: game.parkHRFactor,
      parkRunFactor: game.parkRunFactor,
      lineups: {
        away: { source: awayLineup.source, ops: awayLineupOff?.ops ?? null, batters: awayLineupOff?.batters ?? 0, order: (awayLineup.lineup || []).map(p => ({ name: p.name, pos: p.position, season: p.season || null })) },
        home: { source: homeLineup.source, ops: homeLineupOff?.ops ?? null, batters: homeLineupOff?.batters ?? 0, order: (homeLineup.lineup || []).map(p => ({ name: p.name, pos: p.position, season: p.season || null })) },
      },
    },
    pitchers: {
      away: game.awayProbable ? {
        ...game.awayProbable,
        hand: awayPitcherHand,
        stats: awayPitcher,
        recentStarts: awayPitcherRecent,
      } : null,
      home: game.homeProbable ? {
        ...game.homeProbable,
        hand: homePitcherHand,
        stats: homePitcher,
        recentStarts: homePitcherRecent,
      } : null,
    },
    weather,
    bullpen: {
      away: awayBullpen ? { era: awayBullpen.era, whip: awayBullpen.whip } : null,
      home: homeBullpen ? { era: homeBullpen.era, whip: homeBullpen.whip } : null,
    },
    handedness: {
      awayMult: round3(awayHandMult),
      homeMult: round3(homeHandMult),
      awayVsHand: homePitcherHand,
      homeVsHand: awayPitcherHand,
    },
    convictionInputs: { stability: convBase.stability, completeness: convBase.completeness },
    moneyline: {
      awayWinProb: ml.awayWinProb,
      homeWinProb: ml.homeWinProb,
      awayOdds: awayML,
      homeOdds: homeML,
      awayBook: odds.h2h?.awayBook ?? null,
      homeBook: odds.h2h?.homeBook ?? null,
      awayEdge,
      homeEdge,
      awayConfidence: rateConfidence(awayEdge),
      homeConfidence: rateConfidence(homeEdge),
      awayConviction: cvAwayML.tier,
      homeConviction: cvHomeML.tier,
      awayConvictionScore: cvAwayML.score,
      homeConvictionScore: cvHomeML.score,
      awayReason,
      homeReason,
      awayTrust,
      homeTrust,
      awayInflation,
      homeInflation,
    },
    totals: {
      projected: totals.projectedTotal,
      breakdown: totals.breakdown,
      line: totalLine,
      overOdds,
      underOdds,
      overBook: odds.totals?.overBook ?? null,
      underBook: odds.totals?.underBook ?? null,
      overProb: overProb != null ? round3(overProb) : null,
      underProb: underProb != null ? round3(underProb) : null,
      overEdge,
      underEdge,
      overConfidence: rateConfidence(overEdge),
      underConfidence: rateConfidence(underEdge),
      overConviction: cvOver.tier,
      underConviction: cvUnder.tier,
      overConvictionScore: cvOver.score,
      underConvictionScore: cvUnder.score,
      overReason,
      underReason,
      overTrust,
      underTrust,
      overInflation,
      underInflation,
    },
    runLine: {
      awayLine: awayRLLine,
      homeLine: homeRLLine,
      awayOdds: awayRLOdds,
      homeOdds: homeRLOdds,
      awayBook: odds.spreads?.awayBook ?? null,
      homeBook: odds.spreads?.homeBook ?? null,
      awayCoverProb,
      homeCoverProb,
      awayEdge: awayRLEdge,
      homeEdge: homeRLEdge,
      awayConfidence: awayRLEdge != null ? rateConfidence(awayRLEdge) : null,
      homeConfidence: homeRLEdge != null ? rateConfidence(homeRLEdge) : null,
      awayConviction: awayRLEdge != null ? cvAwayML.tier : null,
      homeConviction: homeRLEdge != null ? cvHomeML.tier : null,
      awayConvictionScore: awayRLEdge != null ? cvAwayML.score : null,
      homeConvictionScore: homeRLEdge != null ? cvHomeML.score : null,
    },
  };
}

async function calculateHRPropEdges(games, hrOddsByEvent) {
  const targetGames = games.slice(0, MAX_HR_GAMES);
  const allHRProps = [];
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, hrOddsByEvent);
    const hrOdds = eventId ? hrOddsByEvent[eventId] : null;
    if (!hrOdds || hrOdds.length === 0) continue;
    const weather = await getWeatherForVenue(game.venue);
    // v2: pull both teams' batting orders once per game (confirmed when MLB posts
    // it, recent-game order as fallback) so each batter gets a lineup-aware PA.
    const [awayLineupRes, homeLineupRes] = await Promise.all([
      getTeamLineup(game.awayId, game.id),
      getTeamLineup(game.homeId, game.id),
    ]);
    for (const propOdds of hrOdds) {
      const batter = await findPlayerByName(propOdds.player, [game.awayId, game.homeId]);
      if (!batter) continue;
      const onAwayTeam = batter.teamId === game.awayId;
      // v2: find this batter's spot in his team's batting order (1-9), null if absent.
      const myLineupRes = onAwayTeam ? awayLineupRes : homeLineupRes;
      const myLineup = (myLineupRes && myLineupRes.lineup) || [];
      const lineupIdx = myLineup.findIndex(p => p.id === batter.id);
      const battingOrder = lineupIdx >= 0 ? lineupIdx + 1 : null;
      const lineupSource = (myLineupRes && myLineupRes.source) || "none";
      const opposingPitcherProbable = onAwayTeam ? game.homeProbable : game.awayProbable;
      const opposingPitcherStats = opposingPitcherProbable
        ? regressThinSample(await getPitcherSeasonStats(opposingPitcherProbable.id))
        : null;
      const [batterStats, recent15, bvp, statcast] = await Promise.all([
        getBatterSeasonStats(batter.id),
        getBatterRecentStats(batter.id, 15),
        opposingPitcherProbable ? getBatterVsPitcherHistory(batter.id, opposingPitcherProbable.id) : null,
        getBatterStatcast(batter.id),
      ]);
      const hrProbRaw = calculateHRProbability(batterStats, opposingPitcherStats, game, weather, recent15, statcast, bvp, battingOrder);
      if (hrProbRaw == null) continue;
      // (d) Market cap: don't let the model sit more than the cap multiple above
      // the book's implied prob. Default 1.5×; a longshot with a genuine record vs
      // this pitcher (see marketCapMult) earns 2.0×. Only binds on wild disagreement.
      const marketImplied = americanToImpliedProb(propOdds.price);
      const capMult = marketCapMult(bvp, propOdds.price);
      const hrProb = (marketImplied != null && marketImplied > 0)
        ? Math.min(hrProbRaw, marketImplied * capMult)
        : hrProbRaw;
      const edge = sanitizeEdge(calculateEdge(hrProb, propOdds.price));
      allHRProps.push({
        gameId: game.id,
        player: propOdds.player,
        team: onAwayTeam ? game.awayAbbr : game.homeAbbr,
        opposingPitcher: opposingPitcherProbable?.name,
        game: `${game.awayAbbr} @ ${game.homeAbbr}`,
        venue: game.venue,
        hrProb,
        odds: propOdds.price,
        book: propOdds.book,
        edge,
        confidence: rateConfidence(edge),
        batterStats: batterStats ? {
          hr: batterStats.homeRuns,
          iso: round3(batterStats.iso),
          slg: batterStats.slg,
          hrPerPA: round3(batterStats.hrPerPA),
        } : null,
        recent15: recent15 ? {
          atBats: recent15.atBats,
          hr: recent15.homeRuns,
          avg: recent15.avg,
          ops: recent15.ops,
          hrPerAB: round3(recent15.hrPerAB),
        } : null,
        bvp: bvp ? {
          atBats: bvp.atBats,
          hits: bvp.hits,
          hr: bvp.homeRuns,
          avg: round3(bvp.avg),
          ops: bvp.ops ? round3(bvp.ops) : null,
        } : null,
        statcast: statcast ? {
          avgExitVelo: statcast.avgExitVelocity,
          maxExitVelo: statcast.maxExitVelocity,
          barrelRate: statcast.barrelRate,
          hardHitRate: statcast.hardHitRate,
          xwOBA: statcast.xwOBA,
        } : null,
        parkHRFactor: game.parkHRFactor,
        battingOrder,
        lineupSource,
        bvpCapException: capMult > MAX_OVER_MARKET,
        opposingPitcherHR9: opposingPitcherStats?.homeRunsPer9 ?? null,
        weatherEffect: weather?.windEffect || null,
      });
    }
  }
  return allHRProps
    .filter(p => p.edge != null && p.edge >= MIN_PROP_EDGE)
    .sort((a, b) => (b.hrProb ?? -1) - (a.hrProb ?? -1)); // likelihood-first, not payout-first
}

const MAX_K_GAMES = 8; // cap games we pull K props for (Odds API credit budget)

// Match a prop's pitcher name to one of the game's two probable starters.
function findProbableStarter(playerName, game) {
  const target = normalizePlayerName(playerName);
  const cands = [];
  if (game.awayProbable) cands.push({ id: game.awayProbable.id, name: game.awayProbable.name, teamId: game.awayId });
  if (game.homeProbable) cands.push({ id: game.homeProbable.id, name: game.homeProbable.name, teamId: game.homeId });
  for (const c of cands) if (normalizePlayerName(c.name) === target) return c;
  const tl = extractLastName(target);
  for (const c of cands) if (extractLastName(normalizePlayerName(c.name)) === tl) return c;
  return null;
}

// Pitcher strikeout prop edges. Two-sided market, so we de-vig and take the better
// side (over/under). Mirrors calculateHRPropEdges but per-pitcher, not per-batter.
async function calculateStrikeoutPropEdges(games, kOddsByEvent) {
  const targetGames = games.slice(0, MAX_K_GAMES);
  const out = [];
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, kOddsByEvent);
    const kOdds = eventId ? kOddsByEvent[eventId] : null;
    if (!kOdds || kOdds.length === 0) continue;
    const [awayTeam, homeTeam] = await Promise.all([
      getTeamSeasonStats(game.awayId),
      getTeamSeasonStats(game.homeId),
    ]);
    for (const propOdds of kOdds) {
      const pitcher = findProbableStarter(propOdds.player, game);
      if (!pitcher) continue;
      const pitcherStats = regressThinSample(await getPitcherSeasonStats(pitcher.id));
      if (!pitcherStats) continue;
      const onAwayTeam = pitcher.teamId === game.awayId;
      const oppTeamStats = onAwayTeam ? homeTeam : awayTeam; // the lineup he faces
      const overProb = strikeoutOverProb(pitcherStats, oppTeamStats, propOdds.line);
      if (overProb == null) continue;
      const fairOver = devigTwoWay(propOdds.overOdds, propOdds.underOdds);
      const underProb = round3(1 - overProb);
      const edgeOver = sanitizeEdge(fairOver != null ? round3(overProb - fairOver) : calculateEdge(overProb, propOdds.overOdds));
      const edgeUnder = sanitizeEdge(fairOver != null ? round3(underProb - (1 - fairOver)) : calculateEdge(underProb, propOdds.underOdds));
      const overBetter = (edgeOver ?? -1) >= (edgeUnder ?? -1);
      const side = overBetter ? "over" : "under";
      const edge = overBetter ? edgeOver : edgeUnder;
      const modelProb = overBetter ? overProb : underProb;
      const odds = overBetter ? propOdds.overOdds : propOdds.underOdds;
      const oppOdds = overBetter ? propOdds.underOdds : propOdds.overOdds;
      out.push({
        gameId: game.id,
        player: propOdds.player,
        team: onAwayTeam ? game.awayAbbr : game.homeAbbr,
        opponent: onAwayTeam ? game.homeAbbr : game.awayAbbr,
        game: `${game.awayAbbr} @ ${game.homeAbbr}`,
        line: propOdds.line,
        side,
        kProb: modelProb,
        odds,
        oppOdds,
        book: propOdds.book,
        edge,
        confidence: rateConfidence(edge),
        expectedKs: expectedKsFor(pitcherStats),
        pitcherK9: pitcherStats.strikeoutsPer9 ?? null,
      });
    }
  }
  return out
    .filter(p => p.edge != null && p.edge >= MIN_PROP_EDGE)
    .sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
}

const MAX_HITS_GAMES = 6; // cap games we pull hits props for (credit budget)

// Batter hits prop edges. Two-sided market — de-vig and take the better side.
// Mirrors calculateHRPropEdges (per batter) with the strikeout build's de-vig.
async function calculateHitsPropEdges(games, hitsOddsByEvent) {
  const targetGames = games.slice(0, MAX_HITS_GAMES);
  const out = [];
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, hitsOddsByEvent);
    const hitsOdds = eventId ? hitsOddsByEvent[eventId] : null;
    if (!hitsOdds || hitsOdds.length === 0) continue;
    for (const propOdds of hitsOdds) {
      const batter = await findPlayerByName(propOdds.player, [game.awayId, game.homeId]);
      if (!batter) continue;
      const onAwayTeam = batter.teamId === game.awayId;
      const opposingPitcherProbable = onAwayTeam ? game.homeProbable : game.awayProbable;
      const oppPitcherStats = opposingPitcherProbable
        ? regressThinSample(await getPitcherSeasonStats(opposingPitcherProbable.id))
        : null;
      const batterStats = await getBatterSeasonStats(batter.id);
      const overProb = hitsOverProb(batterStats, oppPitcherStats, propOdds.line);
      if (overProb == null) continue;
      const fairOver = devigTwoWay(propOdds.overOdds, propOdds.underOdds);
      const underProb = round3(1 - overProb);
      const edgeOver = sanitizeEdge(fairOver != null ? round3(overProb - fairOver) : calculateEdge(overProb, propOdds.overOdds));
      const edgeUnder = sanitizeEdge(fairOver != null ? round3(underProb - (1 - fairOver)) : calculateEdge(underProb, propOdds.underOdds));
      const overBetter = (edgeOver ?? -1) >= (edgeUnder ?? -1);
      const side = overBetter ? "over" : "under";
      const edge = overBetter ? edgeOver : edgeUnder;
      const modelProb = overBetter ? overProb : underProb;
      const odds = overBetter ? propOdds.overOdds : propOdds.underOdds;
      const oppOdds = overBetter ? propOdds.underOdds : propOdds.overOdds;
      out.push({
        gameId: game.id,
        player: propOdds.player,
        team: onAwayTeam ? game.awayAbbr : game.homeAbbr,
        opposingPitcher: opposingPitcherProbable?.name,
        game: `${game.awayAbbr} @ ${game.homeAbbr}`,
        line: propOdds.line,
        side,
        hitsProb: modelProb,
        odds,
        oppOdds,
        book: propOdds.book,
        edge,
        confidence: rateConfidence(edge),
        battingAvg: batterStats?.avg ?? null,
      });
    }
  }
  return out
    .filter(p => p.edge != null && p.edge >= MIN_PROP_EDGE)
    .sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
}

// DIAGNOSTIC (read-only): replays the hits projection for today's props and
// exposes every input — the Odds API name vs the player we matched (+ whether it
// was an exact match), the season AVG and sample we pulled, the opposing pitcher,
// and the chain into expected hits / model side. Surfaced via
// /api/edges?hits_debug=1 so we can see WHY the model picks Under on everyone.
async function debugHitsProps(games, hitsOddsByEvent) {
  const targetGames = games.slice(0, MAX_HITS_GAMES);
  const rows = [];
  // Pull the Savant expected-stats map once (cached). Null-safe: if Savant is
  // unreachable the probe simply shows savantJoined:false and falls through.
  let savantMap = null;
  try { savantMap = await getBatterExpectedStats(); } catch (e) { savantMap = null; }
  const PROBE_LIMIT = 12; // deep-probe (statcast/recent/lineup) only the first N batters to bound API calls
  let probed = 0;
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, hitsOddsByEvent);
    const hitsOdds = eventId ? hitsOddsByEvent[eventId] : null;
    if (!hitsOdds || hitsOdds.length === 0) continue;
    // Lineups once per game (for batting-order spot → expected AB).
    const [awayLineupRes, homeLineupRes] = await Promise.all([
      getTeamLineup(game.awayId, game.id),
      getTeamLineup(game.homeId, game.id),
    ]);
    for (const propOdds of hitsOdds) {
      const batter = await findPlayerByName(propOdds.player, [game.awayId, game.homeId]);
      const onAwayTeam = batter ? batter.teamId === game.awayId : null;
      const opposingPitcherProbable = batter ? (onAwayTeam ? game.homeProbable : game.awayProbable) : null;
      const oppPitcherStats = opposingPitcherProbable
        ? regressThinSample(await getPitcherSeasonStats(opposingPitcherProbable.id))
        : null;
      const oppBaa = oppPitcherStats?.battingAvgAgainst ?? null;
      const batterStats = batter ? await getBatterSeasonStats(batter.id) : null;

      let perAB = null, expHits = null;
      if (batterStats && batterStats.avg != null && batterStats.avg > 0) {
        perAB = batterStats.avg;
        if (oppBaa != null && oppBaa > 0) perAB = batterStats.avg * Math.max(0.80, Math.min(1.20, oppBaa / LEAGUE_BAA));
        perAB = Math.max(0.10, Math.min(0.45, perAB));
        expHits = round3(DEFAULT_AB_PER_GAME * perAB);
      }
      const overProb = hitsOverProb(batterStats, oppPitcherStats, propOdds.line);
      const underProb = overProb != null ? round3(1 - overProb) : null;
      const marketFairOver = devigTwoWay(propOdds.overOdds, propOdds.underOdds);
      let modelSide = null;
      if (overProb != null) {
        const eOver = marketFairOver != null ? overProb - marketFairOver : null;
        const eUnder = marketFairOver != null ? underProb - (1 - marketFairOver) : null;
        modelSide = (eOver ?? -1) >= (eUnder ?? -1) ? "over" : "under";
      }

      // ── B-INPUT PROBE: do the inputs a real model would need actually come back?
      //    Deep-probe only the first PROBE_LIMIT matched batters to bound API calls.
      let probe = null;
      if (batter && probed < PROBE_LIMIT) {
        probed++;
        const [statcast, recent] = await Promise.all([
          getBatterStatcast(batter.id),
          getBatterRecentStats(batter.id, 15),
        ]);
        const lineupRes = onAwayTeam ? awayLineupRes : homeLineupRes;
        const myLineup = (lineupRes && lineupRes.lineup) || [];
        const spotIdx = myLineup.findIndex(p => p.id === batter.id);
        probe = {
          statcastPresent: !!statcast,
          statcastXwoba: statcast?.xwOBA ?? null,
          statcastBarrelRate: statcast?.barrelRate ?? null,
          statcastHardHit: statcast?.hardHitRate ?? null,
          recentPresent: !!recent,
          recentAB: recent?.atBats ?? null,
          recentHits: recent?.hits ?? null,
          recentAvg: recent?.avg ?? null,
          lineupSpot: spotIdx >= 0 ? spotIdx + 1 : null,
          lineupSource: (lineupRes && lineupRes.source) || "none",
          // ── SAVANT JOIN: does this batter's MLBAM id find his xBA in the feed? ──
          savantJoined: !!(savantMap && savantMap.get(batter.id)),
          savantXBA: savantMap ? (savantMap.get(batter.id)?.xBA ?? null) : null,
          savantXwoba: savantMap ? (savantMap.get(batter.id)?.xwOBA ?? null) : null,
          savantBA: savantMap ? (savantMap.get(batter.id)?.ba ?? null) : null,
          savantPA: savantMap ? (savantMap.get(batter.id)?.pa ?? null) : null,
        };
      }

      rows.push({
        oddsApiName: propOdds.player,
        matchedName: batter ? (batter.name || null) : null,
        matchedId: batter ? (batter.id ?? null) : null,
        exactMatch: batter ? normalizePlayerName(batter.name) === normalizePlayerName(propOdds.player) : false,
        line: propOdds.line,
        overOdds: propOdds.overOdds,
        underOdds: propOdds.underOdds,
        marketFairOverProb: marketFairOver,
        seasonAvg: batterStats?.avg ?? null,
        atBats: batterStats?.atBats ?? null,
        hits: batterStats?.hits ?? null,
        oppPitcher: opposingPitcherProbable?.name ?? null,
        oppBaaAgainst: oppBaa,
        perAB: perAB != null ? round3(perAB) : null,
        expHits,
        modelOverProb: overProb,
        modelUnderProb: underProb,
        modelSide,
        probe,
      });
    }
  }
  return rows;
}

function findEventIdForGame(game, hrOddsByEvent) {
  return game._oddsEventId || null;
}

// ── PLAYER NAME MATCHING ──────────────────────────────────────────────────────
const rosterCache = new Map();
function normalizePlayerName(name) {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,'`]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}
function extractLastName(normalizedName) {
  if (!normalizedName) return "";
  const parts = normalizedName.split(" ");
  return parts[parts.length - 1];
}
async function findPlayerByName(playerName, teamIds) {
  if (!playerName) return null;
  const normalized = normalizePlayerName(playerName);
  const targetLastName = extractLastName(normalized);
  for (const teamId of teamIds) {
    if (!teamId) continue;
    if (!rosterCache.has(teamId)) {
      rosterCache.set(teamId, await getTeamRoster(teamId));
    }
    const roster = rosterCache.get(teamId);
    let match = roster.find(p => normalizePlayerName(p.name) === normalized);
    if (match) return { ...match, teamId };
    match = roster.find(p => extractLastName(normalizePlayerName(p.name)) === targetLastName);
    if (match) return { ...match, teamId };
    match = roster.find(p => {
      const rn = normalizePlayerName(p.name);
      return rn.includes(normalized) || normalized.includes(rn);
    });
    if (match) return { ...match, teamId };
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
// Standard normal CDF (Zelen & Severo approximation, ~7.5e-8 accuracy).
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
// Inverse normal CDF (Acklam's algorithm, ~1e-9 accuracy). Input clamped to (0,1).
function invNorm(p) {
  p = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const plow = 0.02425, phigh = 1 - 0.02425;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}
function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

module.exports = {
  calculateGameEdges,
  calculateHRPropEdges,
  calculateStrikeoutPropEdges,
  calculateHitsPropEdges,
  debugHitsProps,
  rateConfidence,
  calculateEdge,
  calculateEdgeDevig,
  devigTwoWay,
  effectiveERA,
  sanitizeEdge,
  blendedEdge,
  overreactionNote,
  regressThinSample,
  LEAGUE_AVG,
};
