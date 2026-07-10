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
  getBatterHandednessSplits,
  getTeamBullpenStats,
  getTeamBullpenUsage,
  getPitcherHand,
  getGameHPUmpire,
} = require("./mlbStatsApi");
const { getUmpireByName } = require("./umpireStore");
const { winProbHaircut, calibrateWinProb, calibrateCoverProb, calibrateHitsProb } = require("./winProbCalibration"); // WZ-CAL-LIVE-2026-07-02 + WZ-HITS-CAL-2026-07-02
const { americanToImpliedProb } = require("./oddsApi");
const { getBatterExpectedStats, getBatterBarrels, getPitcherWhiffStats, getTeamFielding } = require("./savantApi");
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
// Starter-depth-aware bullpen exposure + elite-starter run suppression.
// Rationale (bettor logic): a worn-down bullpen can't inflate runs it never
// pitches. When two aces are likely to go 6-7, the pen throws ~2 innings — so the
// bullpen-quality term AND the fatigue bump scale by EXPECTED bullpen innings
// (driven by starter quality), not a flat 3 IP. And genuinely elite starters
// suppress runs MORE than the linear ERA term credits. Both are bounded and only
// bite in strong-starter games, so average-starter totals (the profitable core)
// are left alone. All tunable / reversible.
const ACE_ERA_THRESHOLD = LEAGUE_AVG.era - 0.6; // only starters clearly better than league get extra credit
const ACE_SUPPRESS_PER = 0.35;   // extra runs suppressed per run of ERA below the threshold
const ACE_SUPPRESS_MAX = 0.6;    // hard cap on extra suppression per starter (runs)
// ===== WZ-TOTALS-MEANADJ-2026-06-26 =====
// Conservative mean correction for a CONFIRMED Under bias in the LIVE total projection.
// Evidence (graded MLB totals): model's Under picks ran -9.0% ROI (47.5% win, avg line 9.14)
// while Over picks ran +6.0% (54.6% win, avg line 8.28) — the live projection sits low, so it
// manufactures losing Unders on high-total games. This nudges every live projection up a touch
// to trim those Unders without disturbing the profitable Over book. DELIBERATELY conservative:
// the live projection (calculateTotalProjection) is not yet stored, so exact bias is unmeasured.
// Refine from the by-side ROI split after ~2 weeks. Applied to the LIVE projection ONLY — the
// shadow projection (calculateTotalProjectionShadow) is grading-only and is intentionally untouched.
const TOTAL_MEAN_ADJ = 0.20;     // runs added to the live total projection (tunable / reversible)
// Expected starter innings, anchored on the pitcher's REAL avg innings/start when
// the sample is real (else ERA-derived). EXCEPTION (Roland's rule): a bad starter
// — high ERA AND high WHIP — facing a strong-hitting lineup gets pulled EARLIER
// than his season average, which hands more innings to the bullpen. That extra
// bullpen exposure then amplifies the bullpen-quality + fatigue terms below, so a
// worn/weak pen behind a bad starter vs good offense leans the total OVER.
function expectedStarterIP(pitcher, oppTeamHit) {
  let ip;
  if (pitcher && pitcher.gamesStarted >= 3 && pitcher.inningsPitched > 0) {
    ip = pitcher.inningsPitched / pitcher.gamesStarted;          // real avg IP/start
  } else {
    const era0 = effectiveERA(pitcher) ?? LEAGUE_AVG.era;
    ip = DEFAULT_START_IP + (LEAGUE_AVG.era - era0) * 0.9;        // thin sample → ERA-derived
  }
  const era = effectiveERA(pitcher) ?? LEAGUE_AVG.era;
  const whip = (pitcher && pitcher.whip != null) ? pitcher.whip : LEAGUE_RATE.whip;
  const oppFactor = oppTeamHit?.ops ? (oppTeamHit.ops / LEAGUE_AVG.ops)
    : ((oppTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame) / LEAGUE_AVG.runsPerGame);
  // short hook only for a genuinely bad starter vs an above-average offense
  if (era > LEAGUE_AVG.era + 0.5 && whip > LEAGUE_RATE.whip + 0.10 && oppFactor > 1.0) {
    const hook = Math.min(1.3, (era - (LEAGUE_AVG.era + 0.5)) * 0.40 + (oppFactor - 1.0) * 3.0);
    ip -= hook;
  }
  return Math.max(3.3, Math.min(7.2, ip));
}
function expectedBullpenIP(pitcher, oppTeamHit) {
  return Math.max(1.5, Math.min(5.5, 9 - expectedStarterIP(pitcher, oppTeamHit)));
}
function aceSuppression(era) {
  if (era == null || era >= ACE_ERA_THRESHOLD) return 0;
  return -Math.min(ACE_SUPPRESS_MAX, (ACE_ERA_THRESHOLD - era) * ACE_SUPPRESS_PER);
}

// ===== WZ-OU-TENDENCY-2026-07-09 =====
// Team over/under TENDENCY nudge for the totals projection. Validated on graded
// history (n=642, baseline 52.5% over): games where BOTH teams' own games lean over
// hit the over 62.9%; both-under games went UNDER ~77% (only 23.1% over). Each team's
// prior over-rate (vs the total line) nudges the projected total up or down.
// DEFAULT-SAFE: a team with no record or fewer than OU_MIN_GAMES graded games
// contributes ZERO, so a missing/failed lookup leaves the frozen projection exactly
// as it was. Sourced from model_predictions (the graded-totals ledger); cached per run.
const { createClient: _ouCreateClient } = require("@supabase/supabase-js");
const OU_TENDENCY_WEIGHT = 1.6;      // runs per unit of summed over-rate deviation (both teams)
const OU_MAX_NUDGE = 0.70;           // hard cap on the tendency nudge (runs), either direction
const OU_MIN_GAMES = 8;              // a team needs >= this many graded totals before its tendency counts
const OU_CACHE_MS = 20 * 60 * 1000;  // re-fetch the tendency table at most every 20 min
let _ouCache = { at: 0, map: null };

async function getTeamOuTendency() {
  const now = Date.now();
  if (_ouCache.map && (now - _ouCache.at) < OU_CACHE_MS) return _ouCache.map;
  const map = new Map(); // abbr -> { over, n }
  try {
    const sb = _ouCreateClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await sb
      .from("model_predictions")
      .select("matchup, selection, result")
      .eq("league", "mlb").eq("market", "total")
      .in("result", ["win", "loss"]);
    if (error || !data) { _ouCache = { at: now, map }; return map; }
    for (const r of data) {
      const over = (r.result === "win" && r.selection === "over")
        || (r.result === "loss" && r.selection === "under");
      const under = (r.result === "win" && r.selection === "under")
        || (r.result === "loss" && r.selection === "over");
      if (!over && !under) continue; // selection wasn't over/under -> skip
      const m = String(r.matchup || "");
      const at = m.indexOf("@");
      if (at < 0) continue;
      const teams = [m.slice(0, at).trim(), m.slice(at + 1).trim()];
      for (const team of teams) {
        if (!team) continue;
        const cur = map.get(team) || { over: 0, n: 0 };
        cur.n += 1;
        if (over) cur.over += 1;
        map.set(team, cur);
      }
    }
  } catch (_) { /* leave map as-is (possibly empty) -> nudge defaults to 0 */ }
  _ouCache = { at: now, map };
  return map;
}

// A team's over-rate deviation from even (0.50), or 0 when unknown / below the
// games threshold. This is the per-team signal fed into the totals nudge.
function ouDeviation(entry) {
  if (!entry || entry.n < OU_MIN_GAMES) return 0;
  return (entry.over / entry.n) - 0.50;
}

// WZ-FIELDING-2026-07-10 :: team DEFENSE (OAA) run factor for the game TOTAL.
// A team's season Outs Above Average converts to runs (~0.75 runs per out saved)
// and is spread across games played, giving a per-game run rate. Good gloves
// (positive OAA) SUPPRESS the total; poor gloves (negative OAA, e.g. Angels -22)
// inflate it. Both teams' defenses act on the game's total runs, so the two OAA
// values combine. Shrunk toward 0 (season OAA -> single-game-total transfer is
// imperfect) and hard-clamped. Default-safe: contributes 0 whenever a team's OAA
// is missing/thin, so a failed Savant fetch never moves a total.
const OAA_RUNS_PER_OUT = 0.75;   // Statcast run value of an out prevented
const DEF_WEIGHT = 0.8;          // shrink the raw OAA-derived runs toward the mean
const DEF_MAX = 0.40;            // clamp the combined defensive nudge to +/-0.40 runs
function estTeamGamesPlayed() {
  const SEASON_START = Date.UTC(2026, 2, 26); // ~Opening Day 2026
  const days = Math.max(1, Math.floor((Date.now() - SEASON_START) / 86400000));
  return Math.max(10, Math.min(162, Math.round(days * 0.885))); // ~0.885 team games/day
}
function defRunsAdj(awayOaa, homeOaa) {
  const gp = estTeamGamesPlayed();
  const a = Number.isFinite(awayOaa) ? awayOaa : 0;
  const h = Number.isFinite(homeOaa) ? homeOaa : 0;
  // per-game runs SAVED by both defenses; positive saved -> total goes DOWN (negative adj)
  const savedPerGame = ((a + h) * OAA_RUNS_PER_OUT) / gp;
  const adj = -savedPerGame * DEF_WEIGHT;
  return Math.max(-DEF_MAX, Math.min(DEF_MAX, adj));
}
// Look up both teams' season OAA from the cached Savant fielding map, keyed by MLB
// team_id (== game.awayId/homeId). Default-safe: returns 0/0 on any miss or error.
async function getFieldingOaaForGame(awayId, homeId) {
  try {
    const map = await getTeamFielding();
    if (!map) return { away: 0, home: 0 };
    const a = map.get(String(awayId));
    const h = map.get(String(homeId));
    return {
      away: a && Number.isFinite(a.oaa) ? a.oaa : 0,
      home: h && Number.isFinite(h.oaa) ? h.oaa : 0,
    };
  } catch (_) {
    return { away: 0, home: 0 };
  }
}
function calculateTotalProjection(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, weather, awayBullpen, homeBullpen, awayHandMult, homeHandMult, awayFatigue, homeFatigue, awayOuDev = 0, homeOuDev = 0, umpRunsAdj = 0, defAdj = 0) {
  // Offense scaled by handedness vs the opposing starter
  const awayRPG = (awayTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame) * (awayHandMult || 1.0);
  const homeRPG = (homeTeamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame) * (homeHandMult || 1.0);
  const baseTotal = awayRPG + homeRPG;

  const awayPitcherERA = effectiveERA(awayPitcher) ?? LEAGUE_AVG.era;
  const homePitcherERA = effectiveERA(homePitcher) ?? LEAGUE_AVG.era;
  const linPitcherAdj = ((awayPitcherERA + homePitcherERA) / 2 - LEAGUE_AVG.era) * 0.40;
  const aceAdj = aceSuppression(awayPitcherERA) + aceSuppression(homePitcherERA);
  const pitcherAdj = linPitcherAdj + aceAdj;

  const parkAdj = (game.parkRunFactor - 1.0) * baseTotal;

  let weatherAdj = 0;
  if (weather && !weather.indoor) {
    if (weather.windEffect === "out") weatherAdj += 0.4;
    if (weather.windEffect === "in") weatherAdj -= 0.4;
    if (weather.tempEffect === "hot") weatherAdj += 0.3;
    if (weather.tempEffect === "cold") weatherAdj -= 0.3;
  }

  // Bullpen adjustment: scale by EXPECTED bullpen innings (9 minus the starter's
  // expected workload) instead of a flat 3 IP — an ace going deep means its pen
  // barely pitches, so a good/bad pen moves the total less. A good pen suppresses
  // late runs; a bad pen inflates them. Compare each pen to league avg.
  let bullpenAdj = 0;
  const awayPenEra = awayBullpen?.era;
  const homePenEra = homeBullpen?.era;
  const awayPenIP = expectedBullpenIP(awayPitcher, homeTeamHit);
  const homePenIP = expectedBullpenIP(homePitcher, awayTeamHit);
  if (awayPenEra) bullpenAdj += ((awayPenEra - LEAGUE_AVG.bullpenEra) / 9) * awayPenIP;
  if (homePenEra) bullpenAdj += ((homePenEra - LEAGUE_AVG.bullpenEra) / 9) * homePenIP;

  // Fatigue (worn-down bullpen) bump, scaled by each pen's expected exposure vs the
  // 3-IP baseline — a worn pen behind an ace barely pitches, so it inflates little.
  const fatigueAdj = fatigueRunAdj(awayFatigue, homeFatigue, awayPenIP / 3.0, homePenIP / 3.0);

  // WZ-OU-TENDENCY-2026-07-09 :: bounded nudge from both teams' over/under tendency.
  // Zero whenever a team's record is missing/thin (ouDeviation returns 0), so this
  // line is a no-op unless real tendency data is present.
  const ouAdj = Math.max(-OU_MAX_NUDGE, Math.min(OU_MAX_NUDGE, OU_TENDENCY_WEIGHT * ((awayOuDev || 0) + (homeOuDev || 0))));
  // WZ-UMP-RUNS-2026-07-09 :: additive plate-ump run-environment nudge (0 when unknown/thin).
  const umpAdj = Number.isFinite(umpRunsAdj) ? umpRunsAdj : 0;
  // WZ-FIELDING-2026-07-10 :: additive team-defense (OAA) run nudge (0 when unknown/thin).
  const defAdjSafe = Number.isFinite(defAdj) ? defAdj : 0;
  const projected = baseTotal + pitcherAdj + parkAdj + weatherAdj + bullpenAdj + fatigueAdj + ouAdj + umpAdj + defAdjSafe + TOTAL_MEAN_ADJ;
  return {
    projectedTotal: round2(projected),
    breakdown: {
      base: round2(baseTotal),
      pitcherAdj: round2(pitcherAdj),
      aceAdj: round2(aceAdj),
      parkAdj: round2(parkAdj),
      weatherAdj: round2(weatherAdj),
      bullpenAdj: round2(bullpenAdj),
      fatigueAdj: round2(fatigueAdj),
      ouAdj: round2(ouAdj),
      umpAdj: round2(umpAdj),
      defAdj: round2(defAdjSafe),
      awayBullpenFatigue: awayFatigue || null,
      homeBullpenFatigue: homeFatigue || null,
    },
  };
}

// ── SHADOW TOTALS MODEL (2026-06-14) ──────────────────────────────────────────
// Roland's pitching-built, MULTIPLICATIVE alternative to the live additive model.
// Computed ALONGSIDE the live projection (it never drives a pick, never grades a
// bet) so we can score the two side-by-side for a few weeks and switch only with
// evidence. Shape per staff:
//
//   runs allowed = (starterERA × starterIP)/9 × envˢ  +  (bullpenERA × bullpenIP)/9 × env
//   where env = opposing-offense adj × park factor × weather factor
//
// Offense/park/weather scale the WHOLE projection (both starter and bullpen runs).
// The bullpen takes the full env multiplier; the STARTER takes a damped one — a
// starter suppresses runs more independently of the environment, the bullpen is
// fully exposed. "envˢ" above = env pulled toward 1.0 by SHADOW_STARTER_ENV_SCALE.
//
// Two-sided & symmetric (same formula each staff): away staff is faced by the HOME
// bats, home staff by the AWAY bats; the two halves are summed into the game total.
// Faithful to the drawn formula with two principled hardenings agreed up front:
//   • ERA uses effectiveERA (60% FIP + 40% raw ERA), NOT raw ERA — raw ERA is noisy
//     and chases luck/defense; effectiveERA is more predictive of next-start runs.
//   • offense stays a REAL input (each team's runsPerGame × handedness vs the
//     league, clamped 0.75–1.30), not a throwaway multiplier.
// NOTE: ERA is EARNED runs only, so this should sit a touch under actual totals; if
// the shadow diagnostic later shows a steady under-bias, a ~1.07 unearned-run
// constant is the principled place to add it.
const SHADOW_STARTER_ENV_SCALE = 0.4; // starter feels ~40% of the env swing the bullpen feels ("slightly")
function shadowOffAdj(teamHit, handMult) {
  const rpg = (teamHit?.runsPerGame ?? LEAGUE_AVG.runsPerGame) * (handMult || 1.0);
  return Math.max(0.75, Math.min(1.30, rpg / LEAGUE_AVG.runsPerGame));
}
function shadowWeatherFactor(weather) {
  if (!weather || weather.indoor) return 1.0;
  let f = 1.0;
  if (weather.windEffect === "out") f += 0.04;
  if (weather.windEffect === "in")  f -= 0.04;
  if (weather.tempEffect === "hot") f += 0.03;
  if (weather.tempEffect === "cold") f -= 0.03;
  return f;
}
function shadowStaffRunsAllowed(starterERA, starterIP, penERA, penIP, offAdj, park, wx) {
  const starterRuns = (starterERA * starterIP) / 9;
  const penRuns = (penERA * penIP) / 9;
  // Offense/park/weather scale the WHOLE projection (starter AND bullpen runs), but
  // the STARTER is damped: a starter suppresses runs more independently of the
  // environment, while the bullpen is fully exposed to it. The bullpen takes the
  // full combined multiplier; the starter takes one pulled most of the way back
  // toward 1.0 (feels ~SHADOW_STARTER_ENV_SCALE of the swing the bullpen feels).
  const mult = offAdj * park * wx;
  const starterMult = 1 + (mult - 1) * SHADOW_STARTER_ENV_SCALE;
  return starterRuns * starterMult + penRuns * mult;
}
function calculateTotalProjectionShadow(game, awayPitcher, homePitcher, awayTeamHit, homeTeamHit, weather, awayBullpen, homeBullpen, awayHandMult, homeHandMult) {
  const awayStarterERA = effectiveERA(awayPitcher) ?? LEAGUE_AVG.era;
  const homeStarterERA = effectiveERA(homePitcher) ?? LEAGUE_AVG.era;
  const awayStarterIP = expectedStarterIP(awayPitcher, homeTeamHit);
  const homeStarterIP = expectedStarterIP(homePitcher, awayTeamHit);
  const awayPenIP = expectedBullpenIP(awayPitcher, homeTeamHit);
  const homePenIP = expectedBullpenIP(homePitcher, awayTeamHit);
  const awayPenERA = awayBullpen?.era ?? LEAGUE_AVG.bullpenEra;
  const homePenERA = homeBullpen?.era ?? LEAGUE_AVG.bullpenEra;

  const park = (game.parkRunFactor != null) ? game.parkRunFactor : 1.0;
  const wx = shadowWeatherFactor(weather);

  // away staff faces the HOME bats; home staff faces the AWAY bats
  const homeOffAdj = shadowOffAdj(homeTeamHit, homeHandMult);
  const awayOffAdj = shadowOffAdj(awayTeamHit, awayHandMult);

  const awayStaffRA = shadowStaffRunsAllowed(awayStarterERA, awayStarterIP, awayPenERA, awayPenIP, homeOffAdj, park, wx);
  const homeStaffRA = shadowStaffRunsAllowed(homeStarterERA, homeStarterIP, homePenERA, homePenIP, awayOffAdj, park, wx);

  const projected = awayStaffRA + homeStaffRA;
  return {
    projectedTotal: round2(projected),
    breakdown: {
      awayStaffRA: round2(awayStaffRA),   // runs the home bats put up
      homeStaffRA: round2(homeStaffRA),   // runs the away bats put up
      awayStarterIP: round2(awayStarterIP),
      homeStarterIP: round2(homeStarterIP),
      awayPenIP: round2(awayPenIP),
      homePenIP: round2(homePenIP),
      park: round2(park),
      wx: round2(wx),
      homeOffAdj: round2(homeOffAdj),
      awayOffAdj: round2(awayOffAdj),
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
// RECALIBRATION (2026-06-09): hr_audit confirmed all feeds 100% live (no flow bug);
// hr_backtest showed the model claimed ~20-29% on its top picks that hit ~11-13%
// (post-rebuild -24.6% ROI). Root cause: the raw projection ran to ~30% game probs
// and the market cap (1.5×) then displayed 1.5× a SHARP book — structurally +50%
// overconfident on every pick. Fix: cap 0.08→0.05 (game-prob ceiling ~20%, not 30%),
// shrink 0.7→0.55 (pull the env-stack inflation harder toward the batter's own rate),
// and the market cap tightened to 1.1 (see MAX_OVER_MARKET below). HR is shown as an
// honest likelihood ranking, NOT a +EV bet — the HR market is sharp and the model
// does not beat it; this makes the displayed % truthful.
const HR_PERPA_CAP = 0.05;    // per-PA HR ceiling. Over ~4.3 PA → game-prob tops ~20% (realistic elite ceiling).
const HR_FACTOR_DAMP = 0.5;   // pull the COMBINED env multiplier toward 1 (^0.5 = sqrt): still tilts, can't stack into a lock.
const HR_PROB_SHRINK = 0.55;  // shrink the adjusted per-PA rate 45% back toward the batter's OWN base rate (tightened from 0.7 — the env stack was over-inflating).

// ── SLG-AGAINST FACTOR (2026-06-15) ───────────────────────────────────────────
// A mild, clamped opposing-pitcher power factor derived from how hard the pitcher
// gets hit (true SLG-against from the feed; BAA-derived proxy if SLG is missing so
// the mound is never ignored). Applied to HR, hits, and TB. Env-toggleable and
// conservative by default so it nudges rather than swings live pricing.
const SLG_FACTOR_ENABLED = process.env.SLG_FACTOR_ENABLED !== "false"; // default on; set "false" to disable
const SLG_FACTOR_STRENGTH = parseFloat(process.env.SLG_FACTOR_STRENGTH || "0.5"); // 0=off, 1=full; 0.5 = half-weight (mild)
const SLG_FACTOR_CLAMP = parseFloat(process.env.SLG_FACTOR_CLAMP || "0.10");      // max ±10% swing by default
const LEAGUE_SLG_AGAINST = 0.405; // league-average slugging allowed (≈ league SLG)
// Returns a multiplier ~1.0 (e.g. 1.06 vs a hittable arm, 0.95 vs a tough one) or
// exactly 1.0 when disabled / no data — so callers can multiply unconditionally.
function slgAgainstFactor(oppPitcherStats) {
  if (!SLG_FACTOR_ENABLED) return 1.0;
  let ratio = null;
  const sa = oppPitcherStats && oppPitcherStats.sluggingAgainst;
  if (sa != null && sa > 0) ratio = sa / LEAGUE_SLG_AGAINST;
  else {
    const baa = oppPitcherStats && oppPitcherStats.battingAvgAgainst;
    if (baa != null && baa > 0) ratio = baa / LEAGUE_BAA; // proxy
  }
  if (ratio == null) return 1.0;
  // Apply strength (pull toward 1) then clamp the total swing.
  const adj = 1 + SLG_FACTOR_STRENGTH * (ratio - 1);
  return Math.max(1 - SLG_FACTOR_CLAMP, Math.min(1 + SLG_FACTOR_CLAMP, adj));
}

// ── PLATOON FACTOR (2026-06-15) ───────────────────────────────────────────────
// How a batter performs vs the OPPOSING PITCHER'S HAND relative to their overall.
// Uses per-batter vs-LHP/vs-RHP OPS splits when available. Returns ~1.0 (e.g. 1.08
// for a platoon-advantage matchup, 0.93 for the wrong side), or exactly 1.0 when
// disabled / no usable split. Env-toggleable + clamped, mild by default.
// `metric` selects which split stat anchors the ratio: "ops" (hits-ish/overall) or
// "slg" (power/total-bases). Falls back to ops.
const PLATOON_ENABLED = process.env.PLATOON_ENABLED !== "false"; // default on
const PLATOON_STRENGTH = parseFloat(process.env.PLATOON_STRENGTH || "0.5"); // half-weight (mild)
const PLATOON_CLAMP = parseFloat(process.env.PLATOON_CLAMP || "0.10");      // ±10% max
const PLATOON_MIN_AB = 40; // need a real split sample before trusting it
function platoonFactor(splits, pitcherHand, metric = "ops") {
  if (!PLATOON_ENABLED || !splits || !pitcherHand) return 1.0;
  // Pitcher throws L → batter's vs-LHP split applies; R → vs-RHP.
  const facing = pitcherHand === "L" ? splits.vsLHP : splits.vsRHP;
  const other = pitcherHand === "L" ? splits.vsRHP : splits.vsLHP;
  if (!facing || (facing.atBats || 0) < PLATOON_MIN_AB) return 1.0;
  const f = facing[metric], o = other && other[metric];
  if (f == null || f <= 0) return 1.0;
  // Anchor: batter's vs-this-hand stat relative to their combined baseline.
  // Use the average of the two sides as the baseline when both exist, else league-ish.
  const baseline = (o != null && o > 0) ? (f + o) / 2 : f;
  if (!(baseline > 0)) return 1.0;
  const ratio = f / baseline;
  const adj = 1 + PLATOON_STRENGTH * (ratio - 1);
  return Math.max(1 - PLATOON_CLAMP, Math.min(1 + PLATOON_CLAMP, adj));
}
const HR_MIN_DISPLAY_PROB = 0.06; // HR picks are RANKED BY LIKELIHOOD, not a fake edge. Widened from 0.08 → 0.06 for a fuller props board; shows batters with ≥6% game HR chance, ranked by hrProb.

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

// Merge live Statcast (currently dead for batters via MLB StatsAPI) with Baseball
// Savant data so the HR power factor is no longer stuck on the ISO fallback. Live
// Statcast wins if it ever returns; otherwise Savant fills in. xwOBA comes from the
// expected-stats leaderboard, barrel rate from the statcast leaderboard. Barrel rate
// below BARREL_MIN_BBE batted balls is too noisy to trust, so it's dropped (xwOBA
// then carries the power factor alone). Returns null only with no power signal at all.
const BARREL_MIN_BBE = 25;
function effectiveStatcast(statcast, savantEntry, barrelEntry) {
  const sx = statcast && statcast.xwOBA != null && statcast.xwOBA > 0 ? statcast.xwOBA : null;
  const vx = savantEntry && savantEntry.xwOBA != null && savantEntry.xwOBA > 0 ? savantEntry.xwOBA : null;
  const xwOBA = sx != null ? sx : vx;
  const sb = statcast && statcast.barrelRate != null ? statcast.barrelRate : null;
  let vb = null;
  if (barrelEntry && barrelEntry.barrelRate != null && (barrelEntry.bbe == null || barrelEntry.bbe >= BARREL_MIN_BBE)) vb = barrelEntry.barrelRate;
  const barrelRate = sb != null ? sb : vb;
  if (!statcast && xwOBA == null && barrelRate == null) return null;
  return {
    ...(statcast || {}),
    xwOBA, barrelRate,
    xwobaSource: sx != null ? "statcast" : (vx != null ? "savant" : null),
    barrelSource: sb != null ? "statcast" : (vb != null ? "savant" : null),
    bbe: barrelEntry ? (barrelEntry.bbe ?? null) : null,
  };
}

// (b) BATTER vs PITCHER — mostly noise (tiny samples, HR is a rare event), so it
//     is a BOUNDED nudge only: needs a real sample, sample-weighted, capped ±12%.
//     Raise BVP_MAX_TILT to trust it more (not recommended), 0 to disable.
const BVP_MIN_AB = 20;     // below this many career AB vs the pitcher → ignore
const BVP_FULL_AB = 60;    // weight ramps to ~full here (HR-vs-pitcher rarely exceeds this)
const BVP_MAX_TILT = 0.12; // max ± influence on the projection
function bvpNudge(bvp) {
  if (!bvp || (bvp.atBats || 0) < BVP_MIN_AB || bvp.homeRuns == null) return 1.0;
  const bvpRate = bvp.homeRuns / bvp.atBats;       // HR per AB vs this pitcher
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
//     RECALIBRATION (2026-06-09): tightened 1.5 → 1.1. The HR market is sharp — the
//     backtest proved the model does NOT beat it — so letting the model sit 50% above
//     the book was the core overconfidence. 1.1 = at most a slim 10% above implied.
const MAX_OVER_MARKET = 1.1;

// (d-exception) BvP override on the market cap: a LONGSHOT with a GENUINE record
// vs this exact pitcher earns a higher ceiling (2.0× instead of 1.5×). Strictly
// gated so it can't re-open the longshot leak the cap exists to plug — only a
// real sample qualifies (30+ career AB, 2+ HR), and only on longshot prices
// (+400 and up), where the cap actually binds. Thin "2-for-6" samples do NOT
// qualify. Even when it fires, the 0.08 per-PA cap still backstops the result.
const MAX_OVER_MARKET_BVP = 1.25; // elevated cap multiple when BvP qualifies (tightened from 2.0 with the 2026-06-09 recalibration)
const BVP_EXC_MIN_AB = 30;       // need a real sample vs the pitcher
const BVP_EXC_MIN_HR = 2;        // and demonstrated power within it
const BVP_EXC_MIN_ODDS = 400;    // only for longshots (the +450–+1000 band)
function marketCapMult(bvp, americanOdds) {
  const qualifies =
    americanOdds != null && americanOdds >= BVP_EXC_MIN_ODDS &&
    bvp && (bvp.atBats || 0) >= BVP_EXC_MIN_AB && (bvp.homeRuns || 0) >= BVP_EXC_MIN_HR;
  return qualifies ? MAX_OVER_MARKET_BVP : MAX_OVER_MARKET;
}

// RECORDING GATE (2026-06-06): only stake/record a prop when the model rates it a
// real edge. Was `edge > -0.05`, which logged the model's OWN rated-losers (a big
// driver of the -7.2% HR ROI). 0.025 = the MEDIUM confidence tier (see
// rateConfidence). Applies to HR / strikeouts / hits. Lower to 0.005 (LOW+) for
// more volume, raise to 0.05 (HIGH-only) for fewer/stronger picks.
const MIN_PROP_EDGE = 0.015; // widened from 0.025 → 0.015 for a fuller props board; keeps a real ~1.5% edge floor (no coin-flips dressed up as edges).

function calculateHRProbability(batterStats, opposingPitcherStats, game, weather, recent15, statcast, bvp, battingOrder, batterSplits, pitcherHand) {
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
    // Scale wind effect by MAGNITUDE (we have windMph) instead of a flat binary.
    // Ramp from 1.0 at calm to full effect at ~15 mph, capped beyond that.
    const mph = typeof weather.windMph === "number" ? weather.windMph : 8; // sane default
    const windScale = Math.max(0, Math.min(1, mph / 15));
    if (weather.windEffect === "out") weatherFactor *= 1 + 0.15 * windScale;
    if (weather.windEffect === "in") weatherFactor *= 1 - 0.15 * windScale;
    if (weather.tempEffect === "hot") weatherFactor *= 1.08;
    if (weather.tempEffect === "cold") weatherFactor *= 0.92;
  }
  // Environmental adjustment: dampened so good-in-everything tilts the
  // projection without compounding into a lock (see HR_FACTOR_DAMP note above).
  const envMult = Math.pow(
    pitcherFactor * parkFactor * powFactor * weatherFactor * slgAgainstFactor(opposingPitcherStats) * platoonFactor(batterSplits, pitcherHand, "slg"),
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

// ── PITCHER STRIKEOUT PROP MODEL v2 (2026-06-09) ──────────────────────────────
// v1 was Poisson(λ) with λ = season K/9 × a FLAT 5.3 IP × team-K factor, then a
// blunt 0.75→0.50 shrink to fight overconfidence. k_backtest (68 graded) exposed
// the real failure: OVER picks hit 35% for -32% ROI — the model assumed starters
// go deeper (and miss more bats) than they actually do. v2 fixes the ROOT:
//   • Expected innings AND K/9 are now blended toward the pitcher's ACTUAL RECENT
//     STARTS (getPitcherRecentStarts — already flowing in the team model), so early
//     hooks / pitch limits pull λ DOWN instead of the flat 5.3 inflating it.
//   • Single-game K counts are modeled NEGATIVE-BINOMIAL (overdispersed: variance
//     = φ·mean) instead of Poisson. The wider, honest tails REPLACE the blunt
//     shrink — no more hacking probabilities toward 0.5 after the fact.
// Overs stay suppressed (K_ALLOW_OVERS=false) until v2 is re-backtested; this
// rebuild tightens the unders' calibration and sets overs up to be re-enabled once
// the data confirms λ is no longer inflated.
const LEAGUE_K9 = 8.6;              // league starter strikeouts per 9
const LEAGUE_TEAM_K_PER_GAME = 8.6; // league average team strikeouts per game
const DEFAULT_START_IP = 5.3;       // league-average starter innings per start
const K_ALLOW_OVERS = false;        // K OVER picks were confirmed -EV pre-v2; unders only until v2 overs re-validate via k_backtest. Flip to true to re-enable.
const K_DISPERSION_PHI = 2.5;       // negbin variance/mean ratio (>1 = overdispersed). 1.5->2.0 (2026-06-16), 2.0->2.5 (2026-06-17): k_backtest v2.1-era (n=85) still overconfident — best temper 0.5, calibrationGap +0.121, and EVERY temper (incl. as-is) lost to a coin-flip baseline (logLoss 0.6931). Wider tails pull mid-range probs toward 0.5. Re-backtest after a few graded slates.
const K_MIN_EDGE = 0.10;            // K-specific edge gate (2026-06-17). k_backtest byEdgeBand: the 0.05-0.10 band bled -42% ROI (noise) while the 0.10+ band returned +11.6% (55.9%) — the only +EV slice. Fire K picks ONLY at >=0.10 model-vs-market edge. Keeps ~40% of volume. Loosen toward MIN_PROP_EDGE only if a future backtest proves the middle band.

function poissonCdf(k, lambda) {
  if (k < 0 || !(lambda > 0)) return 0;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term; }
  return Math.min(1, sum);
}

// Negative-binomial (mean μ, overdispersion φ = variance/μ). φ→1 collapses to Poisson.
function _logGamma(z) {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - _logGamma(1 - z);
  z -= 1; let x = c[0]; for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7 + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function negBinomPmf(k, mu, phi) {
  if (!(mu > 0)) return k === 0 ? 1 : 0;
  if (phi <= 1.0001) return Math.exp(-mu + k * Math.log(mu) - _logGamma(k + 1)); // Poisson limit
  const r = mu / (phi - 1);          // size; variance = μ + μ²/r = φ·μ
  const p = r / (r + mu);
  return Math.exp(_logGamma(k + r) - _logGamma(k + 1) - _logGamma(r) + r * Math.log(p) + k * Math.log(1 - p));
}
function kNegBinomCdf(k, mu, phi) {
  if (k < 0 || !(mu > 0)) return 0;
  let s = 0; for (let i = 0; i <= k; i++) s += negBinomPmf(i, mu, phi);
  return Math.min(1, s);
}

// v2.1 (2026-06-09): the strikeout RATE now comes from Savant k_percent (true K per
// batter faced) when available — a cleaner rate than K/9, which is contaminated by
// baserunners/innings. λ = kRate × expected batters faced × opponent factor, where
// expBF = expIP × BF_PER_IP and expIP is the recent-aware innings estimate from v2.
// When a pitcher isn't in the Savant map, kRate falls back to the K/9-derived rate —
// which makes λ mathematically identical to v2, so missing Savant data degrades
// gracefully (never a silent break). Savant k% is regressed to league for thin PA.
const BF_PER_IP = 4.3;       // league avg batters faced per inning
const LEAGUE_K_PCT = 0.22;   // league avg strikeout rate per plate appearance
const LEAGUE_BB_PCT = 0.085; // league avg pitcher walk rate (per PA)
const LEAGUE_BATTER_K_PCT = 0.225; // league avg batter strikeout rate (per PA)
const K_WHIFF_WEIGHT = 0.20; // weight on the whiff%-implied K rate vs raw k% (mild)
const K_WHIFF_TO_KPCT = 1.85; // empirical scaler: whiff% (swstr) × this ≈ k% (e.g. 0.12 whiff → ~0.22 k%)

// WZ-UMPK-RATE-2026-07-02 :: umpire strikeout-environment factor (Option A).
// The plate ump is knowable same-day only (~a few hours pre-first-pitch, from boxscore
// officials — no day-ahead feed exists anywhere), and the board recomputes every ~12-15
// min, so this is a late-arriving overlay: when tonight's HP ump is posted AND his sample
// isn't thin (>=10 games), his kIndex (ump K/game vs league, from umpire_games) is
// dampened to half-weight, clamped to +/-6%, and multiplied into the K lambda via the
// RATE side only — expIP is NEVER touched (the IP-fix shadow measurement must stay
// clean). Applied to the LIVE K pricing path only; calculateStrikeoutShadow deliberately
// does NOT receive it — the shadow is mid-measurement of the IP fix (one change at a
// time), and its first-write-wins daily snapshot usually lands before umps post anyway.
// Skips cleanly (factor null -> 1.0) when the ump isn't posted, isn't in the store, or
// is thin. Never throws.
const UMP_K_WEIGHT = 0.5;        // dampen: use half of the ump's distance from league avg
const UMP_K_FACTOR_MIN = 0.94;   // clamp the applied factor to +/-6%
const UMP_K_FACTOR_MAX = 1.06;
async function getUmpKFactorForGame(gamePk) {
  try {
    const name = await getGameHPUmpire(gamePk);
    if (!name) return null;
    const res = await getUmpireByName(name);
    const u = res && res.umpire;
    if (!u || u.thin || !Number.isFinite(u.kIndex) || u.kIndex <= 0) return null;
    let f = 1 + UMP_K_WEIGHT * (u.kIndex - 1);
    f = Math.max(UMP_K_FACTOR_MIN, Math.min(UMP_K_FACTOR_MAX, f));
    return { factor: round3(f), name: u.name, kIndex: u.kIndex, games: u.games };
  } catch (_) {
    return null;
  }
}

// WZ-UMP-RUNS-2026-07-09 :: umpire RUN-environment nudge for the game TOTAL. Same data
// and same late-arriving, default-safe pattern as the K factor above, but on the RUNS
// dimension: an ump whose games average more (or fewer) total runs than league average
// nudges the projected total up (or down). Half-weight, clamped to +/-UMP_RUNS_MAX runs.
// Returns 0 -- a clean no-op -- whenever the ump isn't posted yet, isn't in the store, is
// thin (<10 games), or anything throws. Additive (runs), consistent with park/weather adj.
const UMP_RUNS_WEIGHT = 0.5;     // use half the ump's runs/game distance from league avg
const UMP_RUNS_MAX = 0.35;       // clamp the runs nudge to +/-0.35 runs
async function getUmpRunsForGame(gamePk) {
  try {
    const name = await getGameHPUmpire(gamePk);
    if (!name) return 0;
    const res = await getUmpireByName(name);
    const u = res && res.umpire;
    const la = res && res.leagueAvg;
    if (!u || u.thin || !la) return 0;
    if (!Number.isFinite(u.runsPerGame) || !Number.isFinite(la.runsPerGame)) return 0;
    const diff = (u.runsPerGame - la.runsPerGame) * UMP_RUNS_WEIGHT;
    return Math.max(-UMP_RUNS_MAX, Math.min(UMP_RUNS_MAX, diff));
  } catch (_) {
    return 0;
  }
}

// WZ-KMEAN-HAIRCUT-2026-07-05 :: K shadow (n=353) showed the projection runs ~10% hot
// (proj 5.80 vs actual 5.21 Ks/start). ~78% of that miss is the K-RATE, not innings, so we
// center the whole projection with a mean haircut (same calibration pattern as Total Bases).
// This fixes the over-projection that made K OVER picks a confirmed leak (the reason overs
// are currently disabled). Re-measure via the K shadow after deploy before re-enabling overs.
const K_MEAN_HAIRCUT = 0.90;
// Recent-aware K projection. expIP from recent starts + season; strikeout RATE from
// Savant k% (preferred) blended with recent form; opponent-adjusted. savantK is the
// pitcher's Savant row {kPct, whiffPct, pa} or null. umpKFactor (optional) is the
// dampened plate-ump strikeout-environment multiplier from getUmpKFactorForGame —
// applied to the rate side of lambda only, never expIP; null/omitted = 1.0.
// Returns {lambda, expIP, kRate, ...}.
function kProjection(pitcherStats, recentStarts, oppTeamStats, savantK, umpKFactor) {
  const ps = pitcherStats || {};
  const seasonK9 = ps.strikeoutsPer9 ?? LEAGUE_K9;
  let seasonIP_GS = DEFAULT_START_IP;
  if (ps.gamesStarted > 0 && ps.inningsPitched > 0) seasonIP_GS = ps.inningsPitched / ps.gamesStarted;

  const starts = Array.isArray(recentStarts) ? recentStarts.filter(s => s && s.ip > 0) : [];
  const n = starts.length;
  let recentIP = null, recentIPsum = 0, recentKsum = 0;
  if (n) {
    recentIPsum = starts.reduce((a, s) => a + s.ip, 0);
    recentKsum = starts.reduce((a, s) => a + (s.k || 0), 0);
    recentIP = recentIPsum / n;
  }
  // expected innings (the v2 root-cause fix): lean on recent starts, clamp sane.
  const wRecent = Math.min(0.6, n * 0.2);
  let expIP = recentIP != null ? wRecent * recentIP + (1 - wRecent) * seasonIP_GS : seasonIP_GS;
  // WZ-KIP-SHRINK-2026-07-02 :: shadow brackets showed the IP *tail* is broken, not the mean
  // (overall proj 5.42 vs actual 5.45). Actual IP is nearly flat ~5.5 across every bracket, but
  // the raw guess swung 4.5→6.9: deep-projected aces run to ~6.9 while real starts top out ~5.5
  // (bullpen hook / 3rd-time-through), inflating their Ks by ~3; short starters were mirror-
  // under-projected. Fix: regress expIP toward the empirical per-start mean (~5.5) and cap the
  // ceiling at a realistic modern number. Pulls both tails toward reality; the accurate 5-6 IP
  // middle barely moves. Re-measure via the K shadow before tuning the residual rate bias.
  const IP_ANCHOR = 5.5, IP_SHRINK = 0.45;
  expIP = expIP + IP_SHRINK * (IP_ANCHOR - expIP);
  expIP = Math.max(4.0, Math.min(6.3, expIP));
  const expBF = expIP * BF_PER_IP;

  // strikeout RATE per batter faced. Prefer Savant k%; else derive from K/9 (the
  // (k9/9)/BF_PER_IP identity makes the no-Savant path collapse exactly to v2).
  const haveSavant = !!(savantK && Number.isFinite(savantK.kPct) && savantK.kPct > 0);
  let baseKPct = haveSavant ? savantK.kPct : (seasonK9 / 9) / BF_PER_IP;
  // whiff% refinement: whiff rate (swinging-strike%) is a cleaner bat-missing signal
  // than k% (which is contaminated by called strikes / umpiring). Nudge the base rate
  // toward what the pitcher's whiff% implies, lightly and clamped, when available.
  if (haveSavant && savantK.whiffPct != null && savantK.whiffPct > 0) {
    const whiffImplied = savantK.whiffPct * K_WHIFF_TO_KPCT; // empirical whiff→k% scaler
    baseKPct = (1 - K_WHIFF_WEIGHT) * baseKPct + K_WHIFF_WEIGHT * whiffImplied;
  }
  // recent-form nudge: recent K over estimated recent batters faced
  const recentKPct = recentIPsum > 0 ? recentKsum / (recentIPsum * BF_PER_IP) : null;
  const wRecentK = recentKPct != null ? Math.min(0.3, n * 0.1) : 0; // up to 0.3 at 3+ starts
  let kRate = (1 - wRecentK) * baseKPct + wRecentK * recentKPct;
  // thin Savant sample (early season) → pull toward league k%
  if (haveSavant) {
    const pa = savantK.pa || 0;
    if (pa < 80) { const w = pa / 80; kRate = w * kRate + (1 - w) * LEAGUE_K_PCT; }
  } else if (n < 2) {
    kRate = 0.5 * kRate + 0.5 * (LEAGUE_K9 / 9) / BF_PER_IP; // thin & no Savant → league
  }
  kRate = Math.max(0.08, Math.min(0.45, kRate)); // sane bounds

  let oppFactor = 1.0;
  if (oppTeamStats && oppTeamStats.games > 0 && oppTeamStats.strikeouts != null) {
    oppFactor = (oppTeamStats.strikeouts / oppTeamStats.games) / LEAGUE_TEAM_K_PER_GAME;
    oppFactor = Math.max(0.82, Math.min(1.18, oppFactor)); // one stat shouldn't swing it wildly
  }
  // Plate-ump strikeout environment (rate side only — expIP above is untouched).
  // kRate in the return stays the pitcher's INTRINSIC rate so the residual rate-bias
  // investigation reads clean; the ump lives in its own factor: lambda = kRate x expBF
  // x oppFactor x umpFactor.
  const umpF = (Number.isFinite(umpKFactor) && umpKFactor > 0) ? umpKFactor : 1.0;
  const lambda = kRate * expBF * oppFactor * umpF * K_MEAN_HAIRCUT;
  return { lambda: lambda > 0 ? lambda : null, expIP: round2(expIP), kRate: round3(kRate), expBF: round2(expBF), oppFactor: round3(oppFactor), umpFactor: round3(umpF), usedSavant: haveSavant };
}

function expectedKsFor(pitcherStats, recentStarts, savantK, umpKFactor) {
  const { lambda } = kProjection(pitcherStats, recentStarts, null, savantK, umpKFactor);
  return lambda != null ? round2(lambda) : null;
}

// P(strikeouts OVER the line) — negative-binomial, recent-aware, Savant-k%-driven.
// No blunt shrink: the overdispersion (φ) does the tempering the old 0.75 shrink hacked in.
function strikeoutOverProb(pitcherStats, oppTeamStats, line, recentStarts, savantK, umpKFactor) {
  if (!pitcherStats || line == null) return null;
  const { lambda } = kProjection(pitcherStats, recentStarts, oppTeamStats, savantK, umpKFactor);
  if (!(lambda > 0)) return null;
  // .5 lines: over wins on K ≥ floor(line)+1, so P(over) = 1 - CDF(floor(line))
  return round3(1 - kNegBinomCdf(Math.floor(line), lambda, K_DISPERSION_PHI));
}

// ── BATTER HITS PROP MODEL v2 ─────────────────────────────────────────────────
// True-talent per-AB hit rate driven by Baseball Savant xBA (expected batting avg
// from contact quality) — NOT raw season AVG, which is luck-noisy and was making the
// old model chase hot/cold streaks. Adjusted gently by the opposing starter's BAA,
// spread over LINEUP-BASED expected at-bats, and the single-game hit count is modeled
// BINOMIALLY (the old Poisson form overstated P(0 hits) → systematic false Unders).
// Finally the projection is ANCHORED to the de-vigged market: this is a sharp full-game
// market that season-level inputs only narrowly beat, so we trust it substantially and
// only diverge when our xBA/AB read disagrees strongly. No shrink-to-0.5 (that dragged
// every legit Over toward a coin flip). EXPERIMENTAL — validate on graded results.
const LEAGUE_BAA = 0.245;          // league batting average against
const DEFAULT_AB_PER_GAME = 3.78;  // fallback effective AB when lineup spot unknown (≈ avg of AB_BY_SPOT)
const HITS_MARKET_WEIGHT = 0.65;   // anchor weight on the sharp de-vigged market (0=pure model, 1=pure market)
const HITS_XBA_BLEND = 0.70;       // weight on Savant xBA vs season AVG when xBA present
const HITS_REGRESS_K = 160;        // AB-equivalent prior weight: regress per-AB rate toward league (kills small-sample noise)
// Selection floors specific to hits (stricter than the global MIN_PROP_EDGE=0.015).
// The lowered global floor admitted too many marginal hits plays that bled ROI at
// juiced prices (winning ~53% but losing money = taking overs too heavily juiced).
const HITS_MIN_EDGE = 0.03;        // hits-only edge floor — only the strongest signals make the tracked board
const HITS_MAX_JUICE = -160;       // skip hits plays priced worse than -160 (need >61.5% to profit) — kills the deep-juice overs

// Effective AB per game by batting-order spot (1..9). Discounted below full-game
// starter AB to reflect walks, early exits, and game-to-game usage variance — the
// level that actually centers single-game P(1+ hit) on the sharp de-vigged market.
// Expected AT-BATS per game by lineup spot. Derived from the HR model's plate-
// appearance table (LINEUP_PA: 4.65→3.75) × ~0.90 for the PA→AB conversion
// (walks/HBP/sac are not at-bats and can't be hits). The old table topped out at
// 3.65 AB for the leadoff spot — it assumed ~20% of PAs were non-AB when the real
// figure is ~10%, undercounting every hitter's chances by ~0.4-0.5 AB and biasing
// P(>=1 hit) low (the root of the measured UNDER bias). Spots 1→9:
const AB_BY_SPOT = [4.19, 4.10, 4.01, 3.87, 3.78, 3.65, 3.56, 3.47, 3.38];
function expABForSpot(spot) {
  if (!spot || spot < 1 || spot > 9) return DEFAULT_AB_PER_GAME;
  return AB_BY_SPOT[spot - 1];
}

// Binomial helpers (log-space PMF for stability). Used for line >= 1.5; the standard
// 0.5 line uses the closed form 1-(1-p)^AB so fractional expected AB is honoured.
function binomPmf(k, n, p) {
  if (k < 0 || k > n) return 0;
  let logC = 0;
  for (let i = 1; i <= k; i++) logC += Math.log((n - i + 1) / i);
  return Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
function binomCdf(k, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let s = 0;
  for (let i = 0; i <= k; i++) s += binomPmf(i, n, p);
  return Math.min(1, s);
}

// opts: { xBA, expAB, marketFairOver } — all optional (backward compatible).
function hitsOverProb(batterStats, oppPitcherStats, line, opts = {}) {
  if (line == null) return null;
  const avg = batterStats && batterStats.avg != null ? batterStats.avg : null;
  const xBA = opts.xBA != null && opts.xBA > 0 ? opts.xBA : null;
  if ((avg == null || avg <= 0) && xBA == null) return null;

  // 1) True-talent per-AB hit rate: prefer xBA, blend with season AVG for stability.
  let base;
  if (xBA != null) base = (avg != null && avg > 0) ? (HITS_XBA_BLEND * xBA + (1 - HITS_XBA_BLEND) * avg) : xBA;
  else base = avg;

  // 1a) Recent-form nudge: blend in last-15-day AVG (needs a real sample), capped so
  //     one hot/cold streak can't dominate. Mirrors the HR model's recency logic.
  const recAvg = opts.recentAvg, recAB = opts.recentAB;
  if (recAvg != null && recAvg > 0 && recAB != null && recAB >= 25) {
    const wRec = Math.min(0.30, recAB / 200); // up to 30% weight on recent
    const blended = (1 - wRec) * base + wRec * recAvg;
    base = Math.max(base * 0.80, Math.min(base * 1.20, blended)); // ±20% cap
  }

  // 1b) Regress toward league by sample size — small samples (noisy xBA/AVG) pull
  //     hard toward league, killing fake edges on 14-AB hitters.
  const n = opts.sampleAB != null && opts.sampleAB > 0 ? opts.sampleAB : 80;
  base = (base * n + LEAGUE_BAA * HITS_REGRESS_K) / (n + HITS_REGRESS_K);

  // 2) Gentle opposing-pitcher adjustment (tighter clamp than v1).
  let perAB = base;
  const baa = oppPitcherStats && oppPitcherStats.battingAvgAgainst;
  if (baa != null && baa > 0) perAB = base * Math.max(0.85, Math.min(1.15, baa / LEAGUE_BAA));
  perAB *= slgAgainstFactor(oppPitcherStats); // mild SLG-against nudge (clamped, env-toggleable)

  // 2a) Platoon: batter vs the opposing pitcher's hand (per-batter splits, OPS-anchored).
  perAB *= platoonFactor(opts.batterSplits, opts.pitcherHand, "ops");

  // 2b) Pitcher control: high walk-rate pitchers put fewer balls in play (more walks =
  //     fewer ABs that can become hits). Mild, clamped. Savant pitcher bb% when present.
  const pbb = opts.pitcherBbPct;
  if (pbb != null && pbb > 0) perAB *= Math.max(0.95, Math.min(1.05, 1 - (pbb - LEAGUE_BB_PCT) * 0.8));

  // 2c) Batter's own contact: high-K batters put fewer balls in play → fewer hits.
  const bK = opts.batterKPct;
  if (bK != null && bK > 0) perAB *= Math.max(0.92, Math.min(1.08, 1 - (bK - LEAGUE_BATTER_K_PCT) * 0.6));

  // 2d) Park + weather (BABIP/carry). Mild, clamped, indoor = no weather effect.
  const park = opts.parkFactor;
  if (park != null && park > 0) perAB *= Math.max(0.96, Math.min(1.04, 1 + (park - 1) * 0.3));
  const wx = opts.weather;
  if (wx && !wx.indoor) {
    const mph = typeof wx.windMph === "number" ? wx.windMph : 8;
    const windScale = Math.max(0, Math.min(1, mph / 15));
    if (wx.windEffect === "out") perAB *= 1 + 0.03 * windScale;
    if (wx.windEffect === "in") perAB *= 1 - 0.03 * windScale;
  }

  perAB = Math.max(0.10, Math.min(0.45, perAB));

  // 3) Lineup-based expected at-bats.
  const expAB = opts.expAB != null && opts.expAB > 0 ? opts.expAB : DEFAULT_AB_PER_GAME;

  // 4) Binomial P(over). k+1 hits needed to clear the line.
  const k = Math.floor(line);
  let pOver;
  if (k <= 0) pOver = 1 - Math.pow(1 - perAB, expAB);        // P(>=1 hit) — fractional AB ok
  else pOver = 1 - binomCdf(k, Math.max(1, Math.round(expAB)), perAB);
  if (!(pOver >= 0)) return null;

  // 5) Anchor to the sharp de-vigged market (no shrink-to-0.5).
  const m = opts.marketFairOver;
  let finalP = pOver;
  if (m != null && m > 0 && m < 1) finalP = HITS_MARKET_WEIGHT * m + (1 - HITS_MARKET_WEIGHT) * pOver;
  // WZ-HITS-CAL-2026-07-02 :: optional trace side-channel — when the caller passes
  // opts._trace = {}, the operative components are written into it (no behavior
  // change). The hits shadow logs these EXACT numbers so the bias decomposes into
  // the at-bats assumption vs the per-AB rate at the source, never a re-derivation.
  if (opts._trace && typeof opts._trace === "object") {
    opts._trace.perAB = round3(perAB);
    opts._trace.expAB = round2(expAB);
    opts._trace.pOverRaw = round3(pOver);
    opts._trace.finalP = round3(Math.max(0.02, Math.min(0.98, finalP)));
  }
  return round3(Math.max(0.02, Math.min(0.98, finalP)));
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
const MAX_HR_GAMES = 20;   // process all games we have odds for. Actual coverage/cost is gated in edges.js (getMLBHRPropsForAllEvents maxEvents — currently 10). Keep this >= that.
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
  if (breakdown && breakdown.fatigueAdj != null && Math.abs(breakdown.fatigueAdj) >= 0.15 && ((side === "over") === (breakdown.fatigueAdj > 0))) {
    clauses.push(breakdown.fatigueAdj > 0 ? "a worn-down bullpen" : "fresh bullpens");
  }
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

// ── Bullpen fatigue → totals (EXPERIMENTAL, live 2026-06-07, small + capped) ──
// A gassed pen tends to give up more late runs than its season ERA implies.
// This is UNCALIBRATED — the magnitudes below are a deliberately small starting
// guess, hard-capped, and fully reversible. To kill it: set FATIGUE_ENABLED=false.
// To retune once we have results: edit FATIGUE_PER_TEAM / FATIGUE_MAX. The applied
// adjustment and the per-team levels are persisted on each totals pick so we can
// later check whether it actually helped before trusting these numbers.
const FATIGUE_ENABLED = true;
const FATIGUE_PER_TEAM = { heavy: 0.15, normal: 0, light: -0.10 }; // runs per pen
const FATIGUE_MAX = 0.30; // hard cap on the total fatigue swing (runs)

// Recent bullpen workload descriptor. Thresholds are per-GAME relief load so a
// normal 3-game stretch isn't misread as heavy. Returns null when no recent games.
function describeFatigue(u) {
  if (!u || !u.gamesInWindow) return null;
  const back2back = (u.relieversUsedMultipleDays || []).length;
  const perGameOuts = u.reliefOutsTotal / u.gamesInWindow;
  let level = "normal";
  if (perGameOuts >= 13 || back2back >= 2) level = "heavy";
  else if (perGameOuts <= 8 && u.gamesInWindow >= 2) level = "light";
  return {
    level,
    reliefIP: u.reliefIPTotal,
    gamesInWindow: u.gamesInWindow,
    backToBack: u.relieversUsedMultipleDays || [],
  };
}

// Capped run adjustment from both pens' fatigue. Heavy → more runs (over), light
// → fewer. Small by design; never larger than FATIGUE_MAX in either direction.
function fatigueRunAdj(awayF, homeF, awayExp = 1, homeExp = 1) {
  if (!FATIGUE_ENABLED) return 0;
  const a = (awayF ? (FATIGUE_PER_TEAM[awayF.level] || 0) : 0) * awayExp;
  const h = (homeF ? (FATIGUE_PER_TEAM[homeF.level] || 0) : 0) * homeExp;
  let adj = a + h;
  if (adj > FATIGUE_MAX) adj = FATIGUE_MAX;
  if (adj < -FATIGUE_MAX) adj = -FATIGUE_MAX;
  return round2(adj);
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
    awayBullpenUsage,
    homeBullpenUsage,
  ] = await Promise.all([
    game.awayProbable ? getPitcherSeasonStats(game.awayProbable.id) : null,
    game.homeProbable ? getPitcherSeasonStats(game.homeProbable.id) : null,
    getTeamSeasonStats(game.awayId),
    getTeamSeasonStats(game.homeId),
    getTeamBullpenStats(game.awayId),
    getTeamBullpenStats(game.homeId),
    getWeatherForVenue(game.venue, game.startTimeUTC),
    game.awayProbable ? getPitcherRecentStarts(game.awayProbable.id, 3) : [],
    game.homeProbable ? getPitcherRecentStarts(game.homeProbable.id, 3) : [],
    getTeamHandednessSplits(game.awayId),
    getTeamHandednessSplits(game.homeId),
    game.awayProbable ? getPitcherHand(game.awayProbable.id) : null,
    game.homeProbable ? getPitcherHand(game.homeProbable.id) : null,
    getTeamBullpenUsage(game.awayId).catch(() => null),
    getTeamBullpenUsage(game.homeId).catch(() => null),
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
  const awayFatigue = describeFatigue(awayBullpenUsage);
  const homeFatigue = describeFatigue(homeBullpenUsage);
  // WZ-OU-TENDENCY-2026-07-09 :: look up each team's over/under tendency (cached; default-safe).
  const _ouMap = await getTeamOuTendency();
  const awayOuDev = ouDeviation(_ouMap.get(game.awayAbbr));
  const homeOuDev = ouDeviation(_ouMap.get(game.homeAbbr));
  // WZ-UMP-RUNS-2026-07-09 :: plate-ump run-environment nudge for the total (0 when unknown).
  const umpRunsAdj = await getUmpRunsForGame(game.id);
  // WZ-FIELDING-2026-07-10 :: team-defense (OAA) run nudge for the total (0 when unknown).
  const _oaa = await getFieldingOaaForGame(game.awayId, game.homeId);
  const defAdj = defRunsAdj(_oaa.away, _oaa.home);
  const totals = calculateTotalProjection(game, awayPitcherForm, homePitcherForm, awayHit, homeHit, weather, awayBullpen, homeBullpen, awayHandMult, homeHandMult, awayFatigue, homeFatigue, awayOuDev, homeOuDev, umpRunsAdj, defAdj);
  // SHADOW: pitching-built multiplicative projection computed in parallel, stored
  // for grading, never used to price a pick (see calculateTotalProjectionShadow).
  const totalsShadow = calculateTotalProjectionShadow(game, awayPitcherForm, homePitcherForm, awayHit, homeHit, weather, awayBullpen, homeBullpen, awayHandMult, homeHandMult);

  const odds = oddsForGame || { h2h: {}, totals: {} };
  const awayML = odds.h2h?.away;
  const homeML = odds.h2h?.home;
  const totalLine = odds.totals?.line;
  const overOdds = odds.totals?.over;
  const underOdds = odds.totals?.under;
  console.log(`[SHADOW] ${game.awayAbbr}@${game.homeAbbr} | live=${totals.projectedTotal} shadow=${totalsShadow.projectedTotal} line=${totalLine ?? "n/a"} | shadowSplit a/h=${totalsShadow.breakdown.homeStaffRA}/${totalsShadow.breakdown.awayStaffRA}`);

  // Every edge is blended toward the de-vigged market line (v0.5) then passed
  // through sanitizeEdge() so an implausible number can never surface.
  const awayEdge = sanitizeEdge(blendedEdge(ml.awayWinProb, awayML, homeML));
  const homeEdge = sanitizeEdge(blendedEdge(ml.homeWinProb, homeML, awayML));
  // WZ-ML-WINBLEND-2026-07-08 :: anchor the WIN PROBABILITY (the number that PICKS and ranks
  // moneyline winners, and gates the >=55% floor) to the sharp de-vigged market -- the SAME
  // 55/45 blend the moneyline EDGE (blendedEdge) and the run-line margin already use. Until now
  // the board's win% was the raw strength model alone (market-blind), which is why moneyline
  // lagged (~43.7%) while totals and hits -- both market-anchored -- profited. The model keeps
  // its opinion; it just stops ignoring the sharpest who-wins estimate there is. The edge is
  // derived from the SAME blended number, so on every card win% - edge == the fair market price
  // (fully consistent). No clean two-way price to blend against -> fall back to the prior
  // calibrated-raw prob (WZ-CAL-LIVE-2026-07-02, n=61 forward-validated) so nothing breaks. Raw
  // ml.awayWinProb / ml.homeWinProb are UNTOUCHED -- the run line derives its own blend below,
  // and we never stack the win-prob haircut on top of the market blend (one correction, not two).
  const fairAwayWin = devigTwoWay(awayML, homeML);
  const fairHomeWin = devigTwoWay(homeML, awayML);
  const awayWinProbCal = ml.awayWinProb == null ? null
    : (MARKET_BLEND_ENABLED && fairAwayWin != null)
      ? round3(W_MODEL * ml.awayWinProb + (1 - W_MODEL) * fairAwayWin)
      : round3(calibrateWinProb(ml.awayWinProb));
  const homeWinProbCal = ml.homeWinProb == null ? null
    : (MARKET_BLEND_ENABLED && fairHomeWin != null)
      ? round3(W_MODEL * ml.homeWinProb + (1 - W_MODEL) * fairHomeWin)
      : round3(calibrateWinProb(ml.homeWinProb));
  // Edge = blended win% - fair (exactly what blendedEdge already returns). When we blended the
  // win% above, take that edge as-is; only in the no-market fallback do we apply the raw-model
  // haircut that matches the calibrated-raw prob -- so the correction is never double-counted.
  const awayEdgeCal = awayEdge == null ? null
    : (MARKET_BLEND_ENABLED && fairAwayWin != null) ? round3(awayEdge)
      : round3(awayEdge - winProbHaircut(ml.awayWinProb));
  const homeEdgeCal = homeEdge == null ? null
    : (MARKET_BLEND_ENABLED && fairHomeWin != null) ? round3(homeEdge)
      : round3(homeEdge - winProbHaircut(ml.homeWinProb));
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
  // A valid run line is a matched pair: one side -1.5, the other +1.5. If the two
  // lines aren't exact opposites (e.g. corrupt odds quoting BOTH teams at -1.5), the
  // data is incoherent — skip the run line rather than price a phantom edge.
  const validRunLine = homeRLLine != null && awayRLLine != null
    && homeRLOdds != null && awayRLOdds != null
    && homeRLLine === -awayRLLine;
  if (validRunLine) {
    // Derive the margin from the market-BLENDED win prob — the same humility the
    // moneyline edge gets. Using the raw win prob lets an overconfident model
    // inflate the run line into implausible cover %s and edges.
    const fairHomeWin = devigTwoWay(homeML, awayML);
    const blendedHomeWin = (MARKET_BLEND_ENABLED && fairHomeWin != null)
      ? (W_MODEL * ml.homeWinProb + (1 - W_MODEL) * fairHomeWin)
      : ml.homeWinProb;
    const muHome = MARGIN_SD * invNorm(blendedHomeWin); // expected home run margin
    // WZ-CAL-LIVE-2026-07-02 :: run-line cover calibration. Measured on n=461 graded
    // picks: actual cover flatlines ~0.62 above ~0.65 claimed (70%+ bucket claimed
    // 0.714, cashed 0.620). Apply the fitted monotone curve to the LIKELIER side and
    // set the other side to its complement so the pair stays coherent (sums to 1).
    // Identity below 0.57, so near-coin-flip lines are untouched.
    const hCoverRaw = normalCDF((muHome + homeRLLine) / MARGIN_SD);
    const hCover = hCoverRaw >= 0.5
      ? calibrateCoverProb(hCoverRaw)
      : 1 - calibrateCoverProb(1 - hCoverRaw);
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
  const awayReason = describeMoneyline("away", { winProb: awayWinProbCal, marketProb: mlMarket(awayWinProbCal, awayEdgeCal), teamAbbr: game.awayAbbr, oppAbbr: game.homeAbbr, era: awayPitcherForm?.era, oppEra: homePitcherForm?.era, ops: awayHit?.ops, oppOps: homeHit?.ops });
  const homeReason = describeMoneyline("home", { winProb: homeWinProbCal, marketProb: mlMarket(homeWinProbCal, homeEdgeCal), teamAbbr: game.homeAbbr, oppAbbr: game.awayAbbr, era: homePitcherForm?.era, oppEra: awayPitcherForm?.era, ops: homeHit?.ops, oppOps: awayHit?.ops });
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
      // WZ-CAL-LIVE-2026-07-02 :: calibrated claims are the live values from here on.
      awayWinProb: awayWinProbCal,
      homeWinProb: homeWinProbCal,
      awayOdds: awayML,
      homeOdds: homeML,
      awayBook: odds.h2h?.awayBook ?? null,
      homeBook: odds.h2h?.homeBook ?? null,
      awayEdge: awayEdgeCal,
      homeEdge: homeEdgeCal,
      awayConfidence: rateConfidence(awayEdgeCal),
      homeConfidence: rateConfidence(homeEdgeCal),
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
      shadow: totalsShadow.projectedTotal,
      shadowBreakdown: totalsShadow.breakdown,
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
  // Savant maps once (cached); null-safe — HR power falls back to ISO if absent.
  let savantMap = null, barrelMap = null;
  try { [savantMap, barrelMap] = await Promise.all([getBatterExpectedStats(), getBatterBarrels()]); } catch (e) { savantMap = savantMap || null; barrelMap = barrelMap || null; }
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, hrOddsByEvent);
    const hrOdds = eventId ? hrOddsByEvent[eventId] : null;
    if (!hrOdds || hrOdds.length === 0) continue;
    const weather = await getWeatherForVenue(game.venue, game.startTimeUTC);
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
      // Platoon: per-batter splits + opposing pitcher hand.
      const [batterSplitsHr, pitcherHandHr] = await Promise.all([
        getBatterHandednessSplits(batter.id).catch(() => null),
        opposingPitcherProbable ? getPitcherHand(opposingPitcherProbable.id).catch(() => null) : null,
      ]);
      // Fill xwOBA + barrel rate from Savant when live Statcast is empty (it always is).
      const sc = effectiveStatcast(
        statcast,
        savantMap ? savantMap.get(batter.id) : null,
        barrelMap ? barrelMap.get(batter.id) : null
      );
      const hrProbRaw = calculateHRProbability(batterStats, opposingPitcherStats, game, weather, recent15, sc, bvp, battingOrder, batterSplitsHr, pitcherHandHr);
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
        playerId: batter.id,
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
        statcast: sc ? {
          avgExitVelo: sc.avgExitVelocity,
          maxExitVelo: sc.maxExitVelocity,
          barrelRate: sc.barrelRate,
          barrelSource: sc.barrelSource,
          bbe: sc.bbe,
          hardHitRate: sc.hardHitRate,
          xwOBA: sc.xwOBA,
          xwobaSource: sc.xwobaSource,
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
    .filter(p => p.hrProb != null && p.hrProb >= HR_MIN_DISPLAY_PROB) // likelihood ranking, not a (now-honest, near-zero) edge gate
    .sort((a, b) => (b.hrProb ?? -1) - (a.hrProb ?? -1)); // most likely to homer first
}

const MAX_K_GAMES = 20; // process all games we have odds for. Coverage/cost gated in edges.js (getMLBStrikeoutPropsForAllEvents maxEvents — currently 10). Keep >= that.

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
  // Savant k%/whiff% map (cached daily). Verified to flow via ?whiff_data=1. If it's
  // null (Savant outage), kProjection falls back to the K/9 path — identical to v2.
  let whiffMap = null;
  try { whiffMap = await getPitcherWhiffStats(); } catch (e) { whiffMap = null; }
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, kOddsByEvent);
    const kOdds = eventId ? kOddsByEvent[eventId] : null;
    if (!kOdds || kOdds.length === 0) continue;
    const [awayTeam, homeTeam] = await Promise.all([
      getTeamSeasonStats(game.awayId),
      getTeamSeasonStats(game.homeId),
    ]);
    // WZ-UMPK-RATE-2026-07-02 :: same-day plate-ump factor (LIVE pricing only — the
    // shadow below deliberately never receives this; see getUmpKFactorForGame).
    const ump = await getUmpKFactorForGame(game.id);
    const umpF = ump ? ump.factor : null;
    for (const propOdds of kOdds) {
      const pitcher = findProbableStarter(propOdds.player, game);
      if (!pitcher) continue;
      const pitcherStats = regressThinSample(await getPitcherSeasonStats(pitcher.id));
      if (!pitcherStats) continue;
      const recentStarts = await getPitcherRecentStarts(pitcher.id, 5).catch(() => []);
      const savantK = whiffMap ? (whiffMap.get(Number(pitcher.id)) || null) : null;
      const onAwayTeam = pitcher.teamId === game.awayId;
      const oppTeamStats = onAwayTeam ? homeTeam : awayTeam; // the lineup he faces
      const overProb = strikeoutOverProb(pitcherStats, oppTeamStats, propOdds.line, recentStarts, savantK, umpF);
      if (overProb == null) continue;
      const fairOver = devigTwoWay(propOdds.overOdds, propOdds.underOdds);
      const underProb = round3(1 - overProb);
      const edgeOver = sanitizeEdge(fairOver != null ? round3(overProb - fairOver) : calculateEdge(overProb, propOdds.overOdds));
      const edgeUnder = sanitizeEdge(fairOver != null ? round3(underProb - (1 - fairOver)) : calculateEdge(underProb, propOdds.underOdds));
      const overBetter = (edgeOver ?? -1) >= (edgeUnder ?? -1);
      const side = overBetter ? "over" : "under";
      // CALIBRATION (2026-06-08): K OVER picks are a confirmed leak — across 34 graded
      // they hit 35% for -32% ROI (actual Ks 4.06 vs a 4.85 line). The model overrates
      // strikeout upside, and an over's "edge" comes from that inflated projection, so a
      // bigger over-edge is MORE wrong, not less. UNDERs validate (50%, -8.5% = ~vig).
      // Skip overs until lambda is rebuilt. Reversible: set K_ALLOW_OVERS = true above.
      if (side === "over" && !K_ALLOW_OVERS) continue;
      const edge = overBetter ? edgeOver : edgeUnder;
      const modelProb = overBetter ? overProb : underProb;
      const odds = overBetter ? propOdds.overOdds : propOdds.underOdds;
      const oppOdds = overBetter ? propOdds.underOdds : propOdds.overOdds;
      out.push({
        gameId: game.id,
        playerId: pitcher.id,
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
        expectedKs: expectedKsFor(pitcherStats, recentStarts, savantK, umpF),
        pitcherK9: pitcherStats.strikeoutsPer9 ?? null,
        // audit trail: which plate ump (if any) shaped this price
        umpire: ump ? ump.name : null,
        umpFactor: umpF,
      });
    }
  }
  return out
    .filter(p => p.edge != null && p.edge >= K_MIN_EDGE)
    .sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
}

// Pitcher strikeout projection SHADOW (log-only, like the TB shadow). Records EVERY
// probable starter's K projection — not just edge-passing picks, and regardless of
// over/under side — so the strikeout overprojection can be measured directly against
// graded results. The live K pick path (calculateStrikeoutPropEdges) is untouched and
// only bets unders; that selected slice can't reveal the over-side leak, so this logs
// the full population: expectedKs (operative lambda, opponent-adjusted), projIP, kRate,
// pitcherK9, oppFactor, and a representative line + over prob. Graded later vs actual
// Ks AND actual IP, so the bias decomposes into innings vs rate at the source.
async function calculateStrikeoutShadow(games, kOddsByEvent) {
  const targetGames = games.slice(0, MAX_K_GAMES);
  const out = [];
  let whiffMap = null;
  try { whiffMap = await getPitcherWhiffStats(); } catch (e) { whiffMap = null; }
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, kOddsByEvent);
    const kOdds = eventId ? kOddsByEvent[eventId] : null;
    if (!kOdds || kOdds.length === 0) continue;
    const [awayTeam, homeTeam] = await Promise.all([
      getTeamSeasonStats(game.awayId),
      getTeamSeasonStats(game.homeId),
    ]);
    const seen = new Set(); // one row per pitcher per slate (projection is side/line-independent)
    for (const propOdds of kOdds) {
      const pitcher = findProbableStarter(propOdds.player, game);
      if (!pitcher) continue;
      if (seen.has(pitcher.id)) continue;
      const pitcherStats = regressThinSample(await getPitcherSeasonStats(pitcher.id));
      if (!pitcherStats) continue;
      const recentStarts = await getPitcherRecentStarts(pitcher.id, 5).catch(() => []);
      const savantK = whiffMap ? (whiffMap.get(Number(pitcher.id)) || null) : null;
      const onAwayTeam = pitcher.teamId === game.awayId;
      const oppTeamStats = onAwayTeam ? homeTeam : awayTeam; // the lineup he faces
      // Operative projection — opponent-adjusted, the SAME lambda that prices the pick.
      const proj = kProjection(pitcherStats, recentStarts, oppTeamStats, savantK);
      if (!proj || !(proj.lambda > 0)) continue;
      seen.add(pitcher.id);
      const overProb = round3(1 - kNegBinomCdf(Math.floor(propOdds.line ?? 0), proj.lambda, K_DISPERSION_PHI));
      out.push({
        gameId: game.id,
        playerId: pitcher.id,
        player: propOdds.player,
        game: `${game.awayAbbr} @ ${game.homeAbbr}`,
        line: propOdds.line ?? null,
        overProb,
        expectedKs: round2(proj.lambda),
        projIP: proj.expIP ?? null,
        kRate: proj.kRate ?? null,
        oppFactor: proj.oppFactor ?? null,
        pitcherK9: pitcherStats.strikeoutsPer9 ?? null,
      });
    }
  }
  return out;
}

const MAX_HITS_GAMES = 20; // process all games we have odds for. Coverage/cost gated in edges.js (getMLBHitsPropsForAllEvents maxEvents — currently 10). Keep >= that.

// Batter hits prop edges. Two-sided market — de-vig and take the better side.
// Mirrors calculateHRPropEdges (per batter) with the strikeout build's de-vig.
async function calculateHitsPropEdges(games, hitsOddsByEvent, shadowSink) {
  // WZ-HITS-CAL-2026-07-02 :: two changes, one pass.
  // (1) CALIBRATION: the raw (market-anchored) over prob gets the fitted haircut
  //     from winProbCalibration before pricing — recent buckets showed claims of
  //     ~0.62 cashing 0.43 (-9% ROI board-wide), so the board now prices the
  //     calibrated claim and HITS_MIN_EDGE prunes what no longer clears. Expect a
  //     thin board until the feature fix lands.
  // (2) SHADOW: when the caller passes a shadowSink array, EVERY evaluated batter
  //     (pre-filter) is pushed with the operative projection components (RAW prob,
  //     perAB, expAB, batting order) so the bias decomposes vs graded actuals —
  //     same single-pass, zero extra fetches.
  const targetGames = games.slice(0, MAX_HITS_GAMES);
  const out = [];
  const shadowSeen = new Set();
  // Savant xBA map once (cached); null-safe — model falls back to season AVG if absent.
  let savantMap = null;
  try { savantMap = await getBatterExpectedStats(); } catch (e) { savantMap = null; }
  // Savant pitcher whiff/bb map once (for pitcher walk-rate); null-safe.
  let whiffMap = null;
  try { whiffMap = await getPitcherWhiffStats(); } catch (e) { whiffMap = null; }
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, hitsOddsByEvent);
    const hitsOdds = eventId ? hitsOddsByEvent[eventId] : null;
    if (!hitsOdds || hitsOdds.length === 0) continue;
    // Lineups once per game for batting-order spot → expected AB.
    const [awayLineupRes, homeLineupRes] = await Promise.all([
      getTeamLineup(game.awayId, game.id),
      getTeamLineup(game.homeId, game.id),
    ]);
    // Per-game (fetched once): opposing pitcher hands + weather.
    const [awayPHand, homePHand, hitsWeather] = await Promise.all([
      game.awayProbable ? getPitcherHand(game.awayProbable.id).catch(() => null) : null,
      game.homeProbable ? getPitcherHand(game.homeProbable.id).catch(() => null) : null,
      getWeatherForVenue(game.venue, game.startTimeUTC).catch(() => null),
    ]);
    for (const propOdds of hitsOdds) {
      const batter = await findPlayerByName(propOdds.player, [game.awayId, game.homeId]);
      if (!batter) continue;
      const onAwayTeam = batter.teamId === game.awayId;
      const opposingPitcherProbable = onAwayTeam ? game.homeProbable : game.awayProbable;
      const oppPitcherStats = opposingPitcherProbable
        ? regressThinSample(await getPitcherSeasonStats(opposingPitcherProbable.id))
        : null;
      const batterStats = await getBatterSeasonStats(batter.id);
      const recent15 = await getBatterRecentStats(batter.id, 15).catch(() => null);
      const fairOver = devigTwoWay(propOdds.overOdds, propOdds.underOdds);
      const lineupRes = onAwayTeam ? awayLineupRes : homeLineupRes;
      const myLineup = (lineupRes && lineupRes.lineup) || [];
      const spotIdx = myLineup.findIndex(p => p.id === batter.id);
      const expAB = expABForSpot(spotIdx >= 0 ? spotIdx + 1 : null);
      const savantXBA = savantMap ? (savantMap.get(batter.id)?.xBA ?? null) : null;
      // Platoon: batter's per-batter splits vs the opposing pitcher's hand.
      const batterSplits = await getBatterHandednessSplits(batter.id).catch(() => null);
      const pitcherHand = onAwayTeam ? homePHand : awayPHand;
      // Pitcher walk rate (Savant bb%), batter's own K rate (season K/PA).
      const oppId = opposingPitcherProbable?.id;
      const pitcherBbPct = (whiffMap && oppId) ? (whiffMap.get(Number(oppId))?.bbPct ?? null) : null;
      const batterKPct = (batterStats && batterStats.strikeouts != null && batterStats.plateAppearances > 0)
        ? batterStats.strikeouts / batterStats.plateAppearances : null;
      const trace = {};
      const overProbRaw = hitsOverProb(batterStats, oppPitcherStats, propOdds.line, {
        xBA: savantXBA, expAB, marketFairOver: fairOver, sampleAB: batterStats?.atBats ?? null,
        recentAvg: recent15?.avg ?? null, recentAB: recent15?.atBats ?? null,
        batterSplits, pitcherHand, pitcherBbPct, batterKPct,
        parkFactor: game.parkHRFactor ?? null, weather: hitsWeather,
        _trace: trace,
      });
      if (overProbRaw == null) continue;
      // shadow row: RAW prob + operative components, every batter, pre-filter
      if (Array.isArray(shadowSink) && !shadowSeen.has(batter.id) && propOdds.line != null) {
        shadowSeen.add(batter.id);
        shadowSink.push({
          gameId: game.id, playerId: batter.id, player: propOdds.player,
          game: `${game.awayAbbr} @ ${game.homeAbbr}`, line: propOdds.line,
          overProbRaw, perAB: trace.perAB ?? null, expAB: trace.expAB ?? null,
          pOverUnanchored: trace.pOverRaw ?? null,
          battingOrder: spotIdx >= 0 ? spotIdx + 1 : null,
          seasonAvg: batterStats?.avg ?? null, xBA: savantXBA ?? null,
        });
      }
      // calibrated price is the live claim from here on
      const overProb = round3(calibrateHitsProb(overProbRaw));
      const underProb = round3(1 - overProb);
      const edgeOver = sanitizeEdge(fairOver != null ? round3(overProb - fairOver) : calculateEdge(overProb, propOdds.overOdds));
      const edgeUnder = sanitizeEdge(fairOver != null ? round3(underProb - (1 - fairOver)) : calculateEdge(underProb, propOdds.underOdds));
      // WZ-HITS-OVERONLY-2026-06-30 :: Hits is a milestone market — the book only posts the
      // OVER side (1+ hits, 2+ hits). The under / "No Hits" side isn't bettable anywhere, so we
      // never surface it: always take the over and let HITS_MIN_EDGE below drop it when the over
      // itself isn't a real edge. (Previously took whichever side had the bigger edge, which
      // produced unbettable "No Hits +178"-type picks.)
      const side = "over";
      const edge = edgeOver;
      const modelProb = overProb;
      const odds = propOdds.overOdds;
      const oppOdds = propOdds.underOdds;
      out.push({
        gameId: game.id,
        playerId: batter.id,
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
    .filter(p => p.edge != null && p.edge >= HITS_MIN_EDGE && (p.odds == null || p.odds >= HITS_MAX_JUICE))
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

      // v2 inputs (computed for ALL batters; cheap — lineups already fetched above).
      const lineupResAll = batter ? (onAwayTeam ? awayLineupRes : homeLineupRes) : null;
      const myLineupAll = (lineupResAll && lineupResAll.lineup) || [];
      const spotIdxAll = batter ? myLineupAll.findIndex(p => p.id === batter.id) : -1;
      const expABAll = expABForSpot(spotIdxAll >= 0 ? spotIdxAll + 1 : null);
      const savantXBAAll = (batter && savantMap) ? (savantMap.get(batter.id)?.xBA ?? null) : null;
      const marketFairOver = devigTwoWay(propOdds.overOdds, propOdds.underOdds);

      // Informational: the per-AB rate and expected hits the v2 model actually uses.
      let perAB = null, expHits = null;
      const baseAvg = batterStats && batterStats.avg != null ? batterStats.avg : null;
      if ((baseAvg != null && baseAvg > 0) || savantXBAAll != null) {
        let base;
        if (savantXBAAll != null) base = (baseAvg != null && baseAvg > 0) ? (HITS_XBA_BLEND * savantXBAAll + (1 - HITS_XBA_BLEND) * baseAvg) : savantXBAAll;
        else base = baseAvg;
        const nAB = batterStats?.atBats != null && batterStats.atBats > 0 ? batterStats.atBats : 80;
        base = (base * nAB + LEAGUE_BAA * HITS_REGRESS_K) / (nAB + HITS_REGRESS_K);
        perAB = base;
        if (oppBaa != null && oppBaa > 0) perAB = base * Math.max(0.85, Math.min(1.15, oppBaa / LEAGUE_BAA));
        perAB = round3(Math.max(0.10, Math.min(0.45, perAB)));
        expHits = round3(expABAll * perAB);
      }
      const overProb = hitsOverProb(batterStats, oppPitcherStats, propOdds.line, {
        xBA: savantXBAAll, expAB: expABAll, marketFairOver, sampleAB: batterStats?.atBats ?? null,
      });
      const underProb = overProb != null ? round3(1 - overProb) : null;
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
        usedXBA: savantXBAAll,
        expAB: round3(expABAll),
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

// ════════════════════════════════════════════════════════════════════════════
// TOTAL BASES — SHADOW MODEL (2026-06-15). READ-ONLY / LOG-ONLY.
// Does NOT price any pick, surface any edge, or touch the live props path. It
// computes an expected-total-bases projection for batters who have a TB prop line
// today and logs it (with a negative-binomial Over prob vs the line) so we can
// grade it later and decide whether to promote it to a live prop.
//
// Model: total bases per AB is exactly SLG (by definition). So expTB = expAB ×
// SLG_regressed, where SLG is regressed toward league by sample size to kill fake
// reads on tiny samples — same philosophy as the hits model. We anchor lightly to
// the de-vigged market (the book's line is a sharp prior) and wrap the mean in a
// negative-binomial for the Over probability. Inputs we actually have: season SLG,
// AB sample, lineup-spot expected AB, Savant xwOBA (used only as a soft sanity
// multiplier on power), opposing-pitcher SLG-against when present.
// Tunables (shadow-only; safe to change, nothing live depends on them):
const TB_LEAGUE_SLG = 0.405;      // league-average slugging
const TB_REGRESS_K = 110;         // AB-equivalent pull toward league for small samples
const TB_MARKET_WEIGHT = 0.45;    // weight on de-vigged market mean vs model mean
const TB_DISPERSION_PHI = 1.35;   // negative-binomial overdispersion (variance/mean) for TB count
const TB_SLG_MIN = 0.230;         // clamp regressed SLG to sane range
const TB_SLG_MAX = 0.720;
const TB_XSLG_BLEND = 0.55;       // weight on Savant xSLG vs season SLG when xSLG present. Lowered 0.65->0.55 (2026-06-17): xSLG running above real SLG for many hitters (e.g. Wood slg .560 / xSLG .630), over-weighting it inflated 2+ TB projections.
const TB_MEAN_HAIRCUT = 0.93;     // moderate haircut on the model's TB mean (2026-06-17). tb_grade n=302: model over-projects across EVERY bucket; 1.5 line claimed 50.2% over / actual 33% (-37% ROI). This pulls the model mean down ~7% (=~3.8% on final mu after the 0.45 market anchor), closing ~half the gap. Re-measure ?tb_grade=1 at n~140 more; deepen toward 0.88 if 1.5-line over-bias persists, or raise TB_DISPERSION_PHI if extremes stay overconfident.

function tbExpectedAndOverProb(batterStats, oppPitcherStats, line, opts = {}) {
  if (line == null) return null;
  const seasonSlg = batterStats && batterStats.slg != null && batterStats.slg > 0 ? batterStats.slg : null;
  const xSLG = opts.xSLG != null && opts.xSLG > 0 ? opts.xSLG : null;
  if (seasonSlg == null && xSLG == null) return null; // no usable power signal → skip

  // 1) Base bases-per-AB: prefer Savant xSLG (luck-stripped expected slugging),
  //    blend with season SLG for stability. Falls back cleanly to whichever exists.
  let slg;
  if (xSLG != null && seasonSlg != null) slg = TB_XSLG_BLEND * xSLG + (1 - TB_XSLG_BLEND) * seasonSlg;
  else slg = xSLG != null ? xSLG : seasonSlg;

  // 1a) Recent-form nudge: blend in last-15-day SLG (needs a real sample), capped.
  const recSlg = opts.recentSlg, recAB = opts.recentAB;
  if (recSlg != null && recSlg > 0 && recAB != null && recAB >= 25) {
    const wRec = Math.min(0.30, recAB / 200);
    const blended = (1 - wRec) * slg + wRec * recSlg;
    slg = Math.max(slg * 0.80, Math.min(slg * 1.20, blended)); // ±20% cap
  }

  // 1b) Regress toward league by AB sample size.
  const nAB = opts.sampleAB != null && opts.sampleAB > 0 ? opts.sampleAB : 80;
  let slgTrue = (slg * nAB + TB_LEAGUE_SLG * TB_REGRESS_K) / (nAB + TB_REGRESS_K);

  // 2) Opposing-pitcher adjustment via the shared SLG-against factor (true
  //    SLG-against, BAA proxy fallback, clamped + env-toggleable).
  slgTrue *= slgAgainstFactor(oppPitcherStats);

  // 3) Tiny power nudge from Savant xwOBA (sanity only, ±6%).
  const xw = opts.xwOBA;
  if (xw != null && xw > 0) slgTrue *= Math.max(0.94, Math.min(1.06, 1 + (xw - LEAGUE_XWOBA) * 0.5));

  // 3b) Park factor: extra-base output is park-sensitive (Coors vs Petco). Use the
  //     park HR factor as a proxy for XBH-friendliness, dampened + clamped.
  const park = opts.parkFactor;
  if (park != null && park > 0) slgTrue *= Math.max(0.93, Math.min(1.07, 1 + (park - 1) * 0.5));

  // 3c) Weather: wind/temp affect carry on extra-base hits. Scaled by magnitude,
  //     clamped, indoor = no effect.
  const wx = opts.weather;
  if (wx && !wx.indoor) {
    const mph = typeof wx.windMph === "number" ? wx.windMph : 8;
    const windScale = Math.max(0, Math.min(1, mph / 15));
    if (wx.windEffect === "out") slgTrue *= 1 + 0.06 * windScale;
    if (wx.windEffect === "in") slgTrue *= 1 - 0.06 * windScale;
    if (wx.tempEffect === "hot") slgTrue *= 1.03;
    if (wx.tempEffect === "cold") slgTrue *= 0.97;
  }

  // 3d) Platoon: batter vs opposing pitcher's hand, SLG-anchored (power split).
  slgTrue *= platoonFactor(opts.batterSplits, opts.pitcherHand, "slg");

  // 3e) Batter's own contact: high-K batters reach base for extra bases less often.
  const bK = opts.batterKPct;
  if (bK != null && bK > 0) slgTrue *= Math.max(0.94, Math.min(1.06, 1 - (bK - LEAGUE_BATTER_K_PCT) * 0.4));

  slgTrue = Math.max(TB_SLG_MIN, Math.min(TB_SLG_MAX, slgTrue));

  // 4) Expected total bases = expected AB × bases-per-AB (SLG).
  const expAB = opts.expAB != null && opts.expAB > 0 ? opts.expAB : DEFAULT_AB_PER_GAME;
  let muModel = expAB * slgTrue * TB_MEAN_HAIRCUT;

  // 5) Light anchor to the de-vigged market mean implied by the line (if provided).
  //    We approximate the market's implied mean as the line itself nudged by which
  //    side is favored — handled by the caller passing marketFairOver; here we just
  //    blend means if a market mean estimate is available.
  const mMean = opts.marketMean;
  let mu = muModel;
  if (mMean != null && mMean > 0) mu = TB_MARKET_WEIGHT * mMean + (1 - TB_MARKET_WEIGHT) * muModel;

  // 6) Over probability via negative-binomial CDF around mu (overdispersed Poisson).
  //    P(TB > line) = 1 - P(TB <= floor(line)).
  const k = Math.floor(line);
  const pOver = 1 - kNegBinomCdf(k, mu, TB_DISPERSION_PHI);
  if (!(pOver >= 0)) return null;
  return { expTB: round3(mu), slgTrue: round3(slgTrue), expAB: round2(expAB), overProb: round3(Math.max(0.02, Math.min(0.98, pOver))) };
}

// SHADOW orchestration: logs per-batter projections vs the TB line. Prices nothing.
// Call signature mirrors calculateHitsPropEdges so wiring is trivial when promoted.
async function calculateTotalBasesShadow(games, tbOddsByEvent) {
  const targetGames = games.slice(0, MAX_HITS_GAMES);
  const out = [];
  let savantMap = null;
  try { savantMap = await getBatterExpectedStats(); } catch (e) { savantMap = null; }
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, tbOddsByEvent);
    const tbOdds = eventId ? tbOddsByEvent[eventId] : null;
    if (!tbOdds || tbOdds.length === 0) continue;
    const [awayLineupRes, homeLineupRes] = await Promise.all([
      getTeamLineup(game.awayId, game.id),
      getTeamLineup(game.homeId, game.id),
    ]);
    const gameWeather = await getWeatherForVenue(game.venue, game.startTimeUTC).catch(() => null);
    const [awayPHandTb, homePHandTb] = await Promise.all([
      game.awayProbable ? getPitcherHand(game.awayProbable.id).catch(() => null) : null,
      game.homeProbable ? getPitcherHand(game.homeProbable.id).catch(() => null) : null,
    ]);
    for (const propOdds of tbOdds) {
      const batter = await findPlayerByName(propOdds.player, [game.awayId, game.homeId]);
      if (!batter) continue;
      const onAwayTeam = batter.teamId === game.awayId;
      const opposingPitcherProbable = onAwayTeam ? game.homeProbable : game.awayProbable;
      const oppPitcherStats = opposingPitcherProbable
        ? regressThinSample(await getPitcherSeasonStats(opposingPitcherProbable.id))
        : null;
      const batterStats = await getBatterSeasonStats(batter.id);
      const recent15 = await getBatterRecentStats(batter.id, 15).catch(() => null);
      const fairOver = devigTwoWay(propOdds.overOdds, propOdds.underOdds);
      const lineupRes = onAwayTeam ? awayLineupRes : homeLineupRes;
      const myLineup = (lineupRes && lineupRes.lineup) || [];
      const spotIdx = myLineup.findIndex(p => p.id === batter.id);
      const expAB = expABForSpot(spotIdx >= 0 ? spotIdx + 1 : null);
      const xwOBA = savantMap ? (savantMap.get(batter.id)?.xwOBA ?? null) : null;
      const xSLG = savantMap ? (savantMap.get(batter.id)?.xSLG ?? null) : null;
      const batterSplitsTb = await getBatterHandednessSplits(batter.id).catch(() => null);
      const pitcherHandTb = onAwayTeam ? homePHandTb : awayPHandTb;
      const batterKPctTb = (batterStats && batterStats.strikeouts != null && batterStats.plateAppearances > 0)
        ? batterStats.strikeouts / batterStats.plateAppearances : null;
      const proj = tbExpectedAndOverProb(batterStats, oppPitcherStats, propOdds.line, {
        expAB, xwOBA, xSLG, sampleAB: batterStats?.atBats ?? null,
        recentSlg: recent15?.slg ?? null, recentAB: recent15?.atBats ?? null,
        parkFactor: game.parkHRFactor ?? null, weather: gameWeather,
        batterSplits: batterSplitsTb, pitcherHand: pitcherHandTb, batterKPct: batterKPctTb,
      });
      if (proj == null) continue;
      const modelOver = proj.overProb;
      const edgeOverShadow = fairOver != null ? round3(modelOver - fairOver) : null;
      const rec = {
        gameId: game.id,
        playerId: batter.id,
        player: propOdds.player,
        team: onAwayTeam ? game.awayAbbr : game.homeAbbr,
        game: `${game.awayAbbr} @ ${game.homeAbbr}`,
        line: propOdds.line,
        expTB: proj.expTB,
        slgTrue: proj.slgTrue,
        expAB: proj.expAB,
        overProb: modelOver,
        odds: propOdds.overOdds ?? null,
        marketFairOver: fairOver,
        edgeOverShadow,
        seasonSlg: batterStats?.slg ?? null,
        xSLG: xSLG ?? null,
        slgSource: xSLG != null ? "xSLG_blend" : "season_only",
        parkFactor: game.parkHRFactor ?? null,
        weatherApplied: !!(gameWeather && !gameWeather.indoor && (gameWeather.windEffect === "out" || gameWeather.windEffect === "in" || gameWeather.tempEffect === "hot" || gameWeather.tempEffect === "cold")),
        platoonApplied: !!(batterSplitsTb && pitcherHandTb),
        pitcherHand: pitcherHandTb ?? null,
        book: propOdds.book,
      };
      out.push(rec);
      console.log(`[TB-SHADOW] ${rec.game} | ${rec.player} O/U ${rec.line} TB | expTB=${rec.expTB} (SLG~${rec.slgTrue}, AB~${rec.expAB}) modelOver=${rec.overProb} fairOver=${fairOver ?? "—"} edge=${edgeOverShadow ?? "—"}`);
    }
  }
  console.log(`[TB-SHADOW] computed ${out.length} total-bases projections (logged only — not priced)`);
  return out;
}

// ── DOUBLES / TRIPLES rare-hit prop boards (2026-06-15) ──────────────────────
// Both are rare per-AB events → modeled as Poisson on expected count. Ranked by
// likelihood (P(>=line)), NOT priced as edges (uncalibrated; the board shows the
// model's chance, like the HR tab). `kind` is "doubles" or "triples".
const LEAGUE_2B_RATE = 0.046;   // league doubles per AB (~4.6%)
const LEAGUE_3B_RATE = 0.005;   // league triples per AB (~0.5%)
const RARE_REGRESS_AB = 200;    // regress the per-AB rate toward league by this sample
function rareHitExpectedAndOverProb(batterStats, line, kind, opts = {}) {
  if (line == null || !batterStats) return null;
  const ab = batterStats.atBats;
  if (ab == null || ab <= 0) return null;
  const made = kind === "triples" ? batterStats.triples : batterStats.doubles;
  if (made == null) return null;
  const leagueRate = kind === "triples" ? LEAGUE_3B_RATE : LEAGUE_2B_RATE;
  // Per-AB rate, regressed toward league by sample size (rare events are noisy).
  const rawRate = made / ab;
  const rate = (rawRate * ab + leagueRate * RARE_REGRESS_AB) / (ab + RARE_REGRESS_AB);
  const expAB = opts.expAB != null && opts.expAB > 0 ? opts.expAB : DEFAULT_AB_PER_GAME;
  // Park nudge (extra-base hits are park-sensitive; mild). Triples especially favor
  // big outfields, but we only have an HR park factor — use it gently as a proxy.
  let lambda = rate * expAB;
  const park = opts.parkFactor;
  if (park != null && park > 0) lambda *= Math.max(0.94, Math.min(1.06, 1 + (park - 1) * 0.4));
  if (!(lambda > 0)) return null;
  // P(count > floor(line)) via Poisson. For the standard 0.5 line → P(>=1)=1-e^-λ.
  const k = Math.floor(line);
  const pOver = 1 - poissonCdf(k, lambda);
  if (!(pOver >= 0)) return null;
  return { expCount: round3(lambda), rate: round3(rate), expAB: round2(expAB), overProb: round3(Math.max(0.001, Math.min(0.99, pOver))) };
}

// Shared orchestrator for the doubles & triples boards. Ranked by likelihood.
async function calculateRareHitBoard(games, oddsByEvent, kind) {
  const targetGames = games.slice(0, MAX_HITS_GAMES);
  const out = [];
  for (const game of targetGames) {
    const eventId = findEventIdForGame(game, oddsByEvent);
    const odds = eventId ? oddsByEvent[eventId] : null;
    if (!odds || odds.length === 0) continue;
    const [awayLineupRes, homeLineupRes] = await Promise.all([
      getTeamLineup(game.awayId, game.id),
      getTeamLineup(game.homeId, game.id),
    ]);
    for (const propOdds of odds) {
      const batter = await findPlayerByName(propOdds.player, [game.awayId, game.homeId]);
      if (!batter) continue;
      const onAwayTeam = batter.teamId === game.awayId;
      const batterStats = await getBatterSeasonStats(batter.id);
      const lineupRes = onAwayTeam ? awayLineupRes : homeLineupRes;
      const myLineup = (lineupRes && lineupRes.lineup) || [];
      const spotIdx = myLineup.findIndex(p => p.id === batter.id);
      const expAB = expABForSpot(spotIdx >= 0 ? spotIdx + 1 : null);
      const proj = rareHitExpectedAndOverProb(batterStats, propOdds.line, kind, {
        expAB, parkFactor: game.parkHRFactor ?? null,
      });
      if (proj == null) continue;
      const fairOver = devigTwoWay(propOdds.overOdds, propOdds.underOdds);
      out.push({
        gameId: game.id,
        playerId: batter.id,
        player: propOdds.player,
        team: onAwayTeam ? game.awayAbbr : game.homeAbbr,
        game: `${game.awayAbbr} @ ${game.homeAbbr}`,
        line: propOdds.line,
        expCount: proj.expCount,
        rate: proj.rate,
        expAB: proj.expAB,
        overProb: proj.overProb,        // the board ranks on this (likelihood)
        marketFairOver: fairOver,       // shown for reference only, not as an edge
        odds: propOdds.overOdds,
        seasonRate: batterStats && batterStats.atBats > 0
          ? round3((kind === "triples" ? batterStats.triples : batterStats.doubles) / batterStats.atBats) : null,
        book: propOdds.book,
        kind,
      });
    }
  }
  out.sort((a, b) => (b.overProb ?? 0) - (a.overProb ?? 0));
  console.log(`[RARE-${kind.toUpperCase()}] computed ${out.length} ${kind} projections (board only — not priced)`);
  return out;
}

async function calculateDoublesBoard(games, oddsByEvent) { return calculateRareHitBoard(games, oddsByEvent, "doubles"); }
async function calculateTriplesBoard(games, oddsByEvent) { return calculateRareHitBoard(games, oddsByEvent, "triples"); }

module.exports = {
  calculateGameEdges,
  calculateHRPropEdges,
  calculateStrikeoutPropEdges,
  calculateStrikeoutShadow,
  calculateHitsPropEdges,
  calculateTotalBasesShadow,
  calculateDoublesBoard,
  calculateTriplesBoard,
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
