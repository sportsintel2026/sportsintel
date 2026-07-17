/**
 * nflModel.js — WizePicks NFL edge model (Phase 2).
 *
 * Built on the NBA model template (predictGame: de-vig → blend → edge → gate),
 * adapted to football. Consumes the parsed odds shape from oddsApi.getNFLMainOdds
 * ({ h2h, totals, spreads, marketRead }) and returns predictions + edges for
 * moneyline, spread, and total.
 *
 * ── HONESTY MODEL (read this before "why are there no edges yet") ──────────────
 * An edge only exists where the model's OWN probability disagrees with the de-vig
 * market. The model's own opinion needs team strength data. It is the offseason:
 * there is no 2026 NFL performance data, and the historical-seed fetch is not
 * built yet. So RIGHT NOW the model's independent margin contribution is zero —
 * its "opinion" is the market's fair line adjusted only by home-field advantage,
 * which means it (correctly) agrees with the market and surfaces ~no edges. This
 * is the truthful state, not a bug: we ship zero fabricated picks until a real
 * rating layer is seeded and validated in shadow mode during the season.
 *
 * Everything is wired so each real factor drops in WITHOUT restructuring:
 *   - teamRating (power ratings, seeded from 2025 finals)         → ratingMargin()
 *   - strengthOfSchedule / conferenceStrength                     → ratingMargin()
 *   - headToHeadHistory                                           → historyAdj()
 *   - coaching / crowd / referees (deferred; need data sources)   → factorAdj()
 * Until a factor's data exists, its function returns 0 and the model leans fully
 * on market + HFA. Flip each on by feeding it real data — no shape change needed.
 *
 * CommonJS.
 */

// ── Football constants ────────────────────────────────────────────────────────
const { spreadCover } = require("./footballMargin"); // WZ-FBALL-KEYNUM-2026-07-17
// Margin SD for an NFL game outcome vs the spread. Empirically ~13.0–13.9; 13.5
// is the standard value used to convert a point spread to a cover/win probability.
const NFL_SIGMA = 13.5;
// WZ-FBALL-KEYNUM-2026-07-17 :: strength of the 3/7 key-number weighting in the spread cover
// model. 1.0 = full physical mass (push-calibrated to real NFL push rates); 0 = plain Normal.
// A reversible dial — drop toward 0 if a backtest ever says the market keys differently than 2003-24.
const NFL_KEY_STRENGTH = 1.0;
// Total SD — game totals swing more than margins; ~10 is a common working value.
const NFL_TOTAL_SIGMA = 10.0;
// Home-field advantage in points. League-wide long-run ~2.5 (post-2020 it has
// drifted toward ~2.0; 2.5 is a defensible baseline, tunable once we grade games).
const NFL_HFA_POINTS = 2.5;

// Market blend: weight on the MODEL vs the de-vig market. Matches the NBA 55/45.
// With no rating layer yet the model margin == market-implied margin, so the
// blend is a no-op today; it becomes meaningful the moment ratings are real.
const NFL_W_MODEL = 0.55;
const NFL_BLEND_ENABLED = true;

// Edge thresholds (probability points) before a pick is published. Conservative —
// a young model's small disagreements are more likely noise than signal.
const EDGE_ML = 0.03;     // 3.0% over the fair price
const EDGE_SPREAD = 0.03;
const EDGE_TOTAL = 0.03;

// Guardrails: a margin/total this far from the market from a v0 model = suspect.
const MAX_TRUSTED_MARGIN = 24;     // points
const MAX_TRUSTED_WINPROB = 0.95;

function r(n, d = 1) {
  if (n == null || !isFinite(n)) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}
function amToProb(a) {
  if (a == null || !isFinite(a)) return null;
  return a < 0 ? -a / (-a + 100) : 100 / (a + 100);
}
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
function normalCDF(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

// De-vig a two-way market to the fair probability of the FIRST side.
function devigPair(thisOdds, otherOdds) {
  const a = amToProb(thisOdds), b = amToProb(otherOdds);
  if (a == null || b == null || a + b <= 0) return null;
  return a / (a + b);
}

// ── PLUGGABLE FACTOR SLOTS ─────────────────────────────────────────────────────
// Each returns a POINTS adjustment to the home team's projected margin (+ favors
// home). They return 0 until their data source is wired, so the model stays
// honest in the offseason. `ctx` will carry ratings/history/etc. once available.

// Power ratings + strength of schedule + conference strength all live here: once
// ctx.home.rating / ctx.away.rating exist (seeded from 2025 finals, SoS- and
// conference-adjusted upstream), the model's independent margin = ratingDiff.
function ratingMargin(ctx) {
  const hr = ctx?.home?.rating, ar = ctx?.away?.rating;
  if (hr == null || ar == null) return null; // no rating layer yet → null (not 0)
  // ratings are expressed in points vs a league-average team; diff = expected
  // neutral-field margin. SoS/conference already baked into each team's rating.
  return hr - ar;
}

// Head-to-head / recent-history nudge (bounded). Real once a past-results fetch
// feeds ctx.history. History matters but must be bounded so it can't dominate.
function historyAdj(ctx) {
  const h = ctx?.history;
  if (!h || h.margin == null) return 0;
  // clamp to ±3 pts so a small sample can't swamp ratings/market.
  return Math.max(-3, Math.min(3, h.margin));
}

// Deferred factors (coaching / crowd / referees) — no data source yet, return 0.
// Wire each by populating ctx.coaching / ctx.crowd / ctx.referees upstream.
function factorAdj(ctx) {
  let adj = 0;
  if (ctx?.coaching?.margin != null) adj += Math.max(-2, Math.min(2, ctx.coaching.margin));
  if (ctx?.crowd?.margin != null)    adj += Math.max(-1.5, Math.min(1.5, ctx.crowd.margin));
  // referees affect totals, not margin — handled in the total block via ctx.referees.
  return adj;
}

// ── CORE: predict one game ─────────────────────────────────────────────────────
// `ev` is a parsed odds event from oddsApi (h2h/totals/spreads/marketRead).
// `ctx` is optional team context (ratings/history/etc.); absent today.
function predictGame(ev, ctx = {}) {
  const out = {
    eventId: ev.eventId,
    commenceTime: ev.commenceTime,
    matchup: `${ev.awayTeam} @ ${ev.homeTeam}`,
    homeTeam: ev.homeTeam,
    awayTeam: ev.awayTeam,
    neutralSite: !!ctx.neutralSite,
    dataQuality: "market-only",   // becomes "rated" once ratings load
    moneyline: null,
    spread: null,
    total: null,
  };

  const hca = out.neutralSite ? 0 : NFL_HFA_POINTS;

  // ── The model's independent margin opinion (home − away, + favors home) ──────
  // Today: ratingMargin() is null (no rating layer), so the model has no
  // independent margin and falls back to the market-implied margin + HFA. That
  // makes blended == market → edge ~0. When ratings seed, rm becomes real.
  const rm = ratingMargin(ctx);
  const hasRatings = rm != null;
  if (hasRatings) out.dataQuality = "rated";

  // ── MONEYLINE ────────────────────────────────────────────────────────────────
  const mlHome = ev.h2h?.home, mlAway = ev.h2h?.away;
  let fairHomeProb = null;
  if (mlHome != null && mlAway != null) fairHomeProb = devigPair(mlHome, mlAway);

  // Market-implied neutral margin. In MARKET-ONLY mode the model has no opinion of
  // its own, so it must anchor to the market and report ~0 edge — NOT surface the
  // small spread-vs-moneyline disagreement as a fake edge. So when we have a
  // moneyline, derive the anchor from the de-vig moneyline prob (so the ML edge is
  // ~0 by construction). Fall back to the spread line only when no moneyline exists
  // (e.g. CFB blowouts). Once ratings load, this anchor is unused (rm drives margin).
  let marketMargin = null;
  if (fairHomeProb != null) {
    // invert normalCDF: margin = SIGMA * Φ⁻¹(p) — agrees with the ML fair prob.
    marketMargin = NFL_SIGMA * probitApprox(fairHomeProb);
  } else if (ev.spreads?.homeLine != null) {
    marketMargin = -ev.spreads.homeLine; // home -3.5 → market favors home by 3.5
  }

  // Model margin = ratings (independent) + HFA + history + soft factors. Without
  // ratings, anchor to the market margin so we don't invent an opinion.
  const baseMargin = hasRatings ? rm : (marketMargin != null ? marketMargin - hca : 0);
  const modelMargin = baseMargin + hca + historyAdj(ctx) + factorAdj(ctx);
  const modelHomeWinProb = normalCDF(modelMargin / NFL_SIGMA);

  // data-quality gate
  let trustworthy = true;
  if (hasRatings && (Math.abs(modelMargin) > MAX_TRUSTED_MARGIN
      || modelHomeWinProb > MAX_TRUSTED_WINPROB
      || modelHomeWinProb < 1 - MAX_TRUSTED_WINPROB)) {
    trustworthy = false;
    out.dataQuality = "suspect";
  }

  // blend toward de-vig market
  let homeWinProb = modelHomeWinProb;
  if (NFL_BLEND_ENABLED && fairHomeProb != null) {
    homeWinProb = NFL_W_MODEL * modelHomeWinProb + (1 - NFL_W_MODEL) * fairHomeProb;
  }
  const awayWinProb = 1 - homeWinProb;

  out.moneyline = {
    homeWinProb: r(homeWinProb * 100),
    awayWinProb: r(awayWinProb * 100),
    modelHomeWinProb: r(modelHomeWinProb * 100),
    modelMargin: r(modelMargin),
    pick: null, pickTeam: null, edge: null, value: false, fair: null, book: null,
  };
  if (fairHomeProb != null) {
    const edgeHome = homeWinProb - fairHomeProb;
    const edgeAway = awayWinProb - (1 - fairHomeProb);
    const pickHome = edgeHome >= edgeAway;
    const edge = pickHome ? edgeHome : edgeAway;
    out.moneyline.fair = { home: r(fairHomeProb * 100), away: r((1 - fairHomeProb) * 100) };
    out.moneyline.book = { home: mlHome, away: mlAway };
    out.moneyline.edge = r(edge * 100);
    // only a RATED, trustworthy model can publish a moneyline pick — market-only
    // mode never manufactures one (edge is ~0 by construction anyway).
    out.moneyline.value = hasRatings && trustworthy && edge >= EDGE_ML;
    out.moneyline.pick = out.moneyline.value ? (pickHome ? "home" : "away") : null;
    out.moneyline.pickTeam = out.moneyline.value ? (pickHome ? ev.homeTeam : ev.awayTeam) : null;
  }

  // ── SPREAD ─────────────────────────────────────────────────────────────────
  const sLine = ev.spreads?.homeLine; // home's signed spread (e.g. -3.5)
  if (sLine != null && ev.spreads?.home != null && ev.spreads?.away != null) {
    // home covers if (actual home margin + homeLine) > 0. Cover prob from the key-number-aware
    // margin distribution (WZ-FBALL-KEYNUM-2026-07-17): real 3/7 mass + push handling, so it doesn't
    // manufacture phantom edges on/near the key numbers the way a plain Normal did. homeCoverProb is
    // the two-way (push-excluded) cover prob — directly comparable to the de-vigged book price below.
    const { homeCoverProb, push: homePushProb } = spreadCover(modelMargin, NFL_SIGMA, sLine, "nfl", NFL_KEY_STRENGTH);
    const fairHomeCover = devigPair(ev.spreads.home, ev.spreads.away);
    out.spread = {
      line: sLine,
      homeCoverProb: r(homeCoverProb * 100),
      pushProb: r(homePushProb * 100), // WZ-FBALL-KEYNUM-2026-07-17 :: real push mass at the line
      pick: null, pickTeam: null, edge: null, value: false,
      fair: fairHomeCover != null ? { home: r(fairHomeCover * 100), away: r((1 - fairHomeCover) * 100) } : null,
      book: { home: ev.spreads.home, away: ev.spreads.away, homeLine: sLine, awayLine: ev.spreads.awayLine },
    };
    if (fairHomeCover != null) {
      const eHome = homeCoverProb - fairHomeCover;
      const eAway = (1 - homeCoverProb) - (1 - fairHomeCover);
      const pickHome = eHome >= eAway;
      const edge = pickHome ? eHome : eAway;
      out.spread.edge = r(edge * 100);
      out.spread.value = hasRatings && trustworthy && edge >= EDGE_SPREAD;
      out.spread.pick = out.spread.value ? (pickHome ? "home" : "away") : null;
      out.spread.pickTeam = out.spread.value ? (pickHome ? ev.homeTeam : ev.awayTeam) : null;
    }
  }

  // ── TOTAL ──────────────────────────────────────────────────────────────────
  const tLine = ev.totals?.line;
  if (tLine != null && ev.totals?.over != null && ev.totals?.under != null) {
    // Model total needs a pace/scoring opinion → comes with ratings. Without it,
    // anchor to the market line (projTotal = line) so over/under prob ~ fair.
    const projTotal = (ctx?.home?.projPoints != null && ctx?.away?.projPoints != null)
      ? ctx.home.projPoints + ctx.away.projPoints
      : tLine;
    // referee over/under lean (deferred) nudges projTotal once ctx.referees exists.
    const refAdj = (ctx?.referees?.totalAdj != null)
      ? Math.max(-3, Math.min(3, ctx.referees.totalAdj)) : 0;
    const overProb = normalCDF(((projTotal + refAdj) - tLine) / NFL_TOTAL_SIGMA);
    const fairOver = devigPair(ev.totals.over, ev.totals.under);
    const hasTotalOpinion = (ctx?.home?.projPoints != null && ctx?.away?.projPoints != null) || refAdj !== 0;
    out.total = {
      line: tLine,
      overProb: r(overProb * 100),
      projTotal: r(projTotal),
      pick: null, edge: null, value: false,
      fair: fairOver != null ? { over: r(fairOver * 100), under: r((1 - fairOver) * 100) } : null,
      book: { over: ev.totals.over, under: ev.totals.under },
    };
    if (fairOver != null) {
      const eOver = overProb - fairOver;
      const eUnder = (1 - overProb) - (1 - fairOver);
      const pickOver = eOver >= eUnder;
      const edge = pickOver ? eOver : eUnder;
      out.total.edge = r(edge * 100);
      out.total.value = hasTotalOpinion && trustworthy && edge >= EDGE_TOTAL;
      out.total.pick = out.total.value ? (pickOver ? "over" : "under") : null;
    }
  }

  return out;
}

// Φ⁻¹ approximation (Acklam-lite) — invert a probability to a z-score so we can
// derive a market margin from a moneyline prob when no spread line is present.
function probitApprox(p) {
  if (p <= 0) return -5; if (p >= 1) return 5;
  // Beasley-Springer/Moro short form, accurate enough for margin anchoring.
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow; let q, x;
  if (p < plow) { q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= phigh) { q = p - 0.5; const rr = q*q;
    x = (((((a[0]*rr+a[1])*rr+a[2])*rr+a[3])*rr+a[4])*rr+a[5])*q / (((((b[0]*rr+b[1])*rr+b[2])*rr+b[3])*rr+b[4])*rr+1);
  } else { q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  return x;
}

// Predict a full slate of parsed odds events.
function predictSlate(events, ctxByEvent = {}) {
  if (!Array.isArray(events)) return [];
  return events.map(ev => predictGame(ev, ctxByEvent[ev.eventId] || {}));
}

module.exports = {
  predictGame,
  predictSlate,
  // exported for tests / future tuning
  NFL_SIGMA, NFL_TOTAL_SIGMA, NFL_HFA_POINTS, NFL_W_MODEL,
  EDGE_ML, EDGE_SPREAD, EDGE_TOTAL,
  _internal: { devigPair, normalCDF, probitApprox, ratingMargin },
};
