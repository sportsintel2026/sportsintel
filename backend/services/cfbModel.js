/**
 * cfbModel.js — WizePicks CFB (college football) edge model (Phase 2).
 *
 * Same engine as nflModel (de-vig → blend → edge → gate), re-tuned for college:
 *   - WIDER margin SD: CFB outcomes swing far more than the NFL (blowouts, talent
 *     gaps, FBS-vs-FCS), so a rating edge converts to a softer win prob.
 *   - BIGGER home-field: college home edge runs ~3 pts (crowd, travel, altitude).
 *   - HIGHER trust ceiling: 35-point spreads are legitimately common in CFB, so the
 *     "this margin is suspect" guardrail sits much higher than the NFL's.
 *
 * HONESTY MODEL is identical to NFL: an edge only exists where the model's OWN
 * probability (seeded from 2025 points-differential ratings) disagrees with the
 * de-vig market. Ratings are a 2025 seed with NO strength-of-schedule layer yet, so
 * Group-of-Five teams that ran up scores on weak schedules are overrated — every
 * pick ships PROVISIONAL behind an "IN TRAINING" fence until shadow-graded in-season.
 * A `value:true` pick requires real ratings on BOTH teams AND a meaningful edge; an
 * unrated side (e.g. an FCS opponent) keeps the game market-only.
 *
 * CommonJS.
 */

// ── College football constants ────────────────────────────────────────────────
const { spreadCover } = require("./footballMargin"); // WZ-FBALL-KEYNUM-2026-07-17
// Margin SD vs the spread. CFB game margins are far noisier than the NFL's ~13.5;
// ~16 is a standard working value for converting a spread to a cover/win prob.
const CFB_SIGMA = 16.0;
// WZ-FBALL-KEYNUM-2026-07-17 :: key-number weighting strength for CFB spread cover. CFB's 3/7
// spikes are milder than the NFL's (more blowouts / 2-pt conversions), so its comb is flatter.
// 1.0 = full physical mass; 0 = plain Normal. Reversible dial. Per the playbook this shared
// transform calibrates on CFB's faster-filling Saturday sample and carries to the NFL.
const CFB_KEY_STRENGTH = 1.0;
// Total SD — college totals swing more than the NFL's ~10.
const CFB_TOTAL_SIGMA = 13.0;
// Home-field advantage in points. College HFA runs higher than the pros (~3).
const CFB_HFA_POINTS = 3.0;

// ── THE LAUNCH DIAL ───────────────────────────────────────────────────────────
// WZ-FBALL-BLEND-2026-07-17 :: how much the model's own opinion counts vs the sharp market, across
// all three markets. 0.30 = 30% model / 70% market = LAUNCH value (young model hugs the sharp line);
// raise toward 0.55 as CFB proves calibrated. Same knob and meaning as NFL_W_MODEL.
const CFB_W_MODEL = 0.30;
const CFB_BLEND_ENABLED = true;

// Edge thresholds (probability points) before a pick is published. Conservative.
const EDGE_ML = 0.03;
const EDGE_SPREAD = 0.03;
const EDGE_TOTAL = 0.03;

// Guardrails: CFB blowouts are real, so the "suspect" ceiling sits well above NFL's.
const MAX_TRUSTED_MARGIN = 35;     // points
const MAX_TRUSTED_WINPROB = 0.97;

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

// ── PLUGGABLE FACTOR SLOTS (same shape as NFL) ─────────────────────────────────
// Power ratings + strength of schedule + conference strength all live here: once
// ctx.home.rating / ctx.away.rating exist, the model's independent margin = diff.
function ratingMargin(ctx) {
  const hr = ctx?.home?.rating, ar = ctx?.away?.rating;
  if (hr == null || ar == null) return null; // no rating layer → null (not 0)
  return hr - ar;
}
function historyAdj(ctx) {
  const h = ctx?.history;
  if (!h || h.margin == null) return 0;
  return Math.max(-3, Math.min(3, h.margin));
}
function factorAdj(ctx) {
  let adj = 0;
  if (ctx?.coaching?.margin != null) adj += Math.max(-2, Math.min(2, ctx.coaching.margin));
  if (ctx?.crowd?.margin != null)    adj += Math.max(-1.5, Math.min(1.5, ctx.crowd.margin));
  return adj;
}

// ── CORE: predict one game ─────────────────────────────────────────────────────
function predictGame(ev, ctx = {}) {
  const out = {
    eventId: ev.eventId,
    commenceTime: ev.commenceTime,
    matchup: `${ev.awayTeam} @ ${ev.homeTeam}`,
    homeTeam: ev.homeTeam,
    awayTeam: ev.awayTeam,
    neutralSite: !!ctx.neutralSite,
    dataQuality: "market-only",   // becomes "rated" once ratings load on BOTH teams
    moneyline: null,
    spread: null,
    total: null,
  };

  const hca = out.neutralSite ? 0 : CFB_HFA_POINTS;

  const rm = ratingMargin(ctx);
  const hasRatings = rm != null;
  if (hasRatings) out.dataQuality = "rated";

  // ── MONEYLINE ────────────────────────────────────────────────────────────────
  const mlHome = ev.h2h?.home, mlAway = ev.h2h?.away;
  let fairHomeProb = null;
  if (mlHome != null && mlAway != null) fairHomeProb = devigPair(mlHome, mlAway);

  // Market-implied neutral margin. With a moneyline, anchor to the de-vig ML prob so
  // market-only mode reports ~0 ML edge. Fall back to the spread line when no ML
  // exists (common in CFB blowouts where books only post a spread).
  let marketMargin = null;
  if (fairHomeProb != null) {
    marketMargin = CFB_SIGMA * probitApprox(fairHomeProb);
  } else if (ev.spreads?.homeLine != null) {
    marketMargin = -ev.spreads.homeLine;
  }

  const baseMargin = hasRatings ? rm : (marketMargin != null ? marketMargin - hca : 0);
  const modelMargin = baseMargin + hca + historyAdj(ctx) + factorAdj(ctx);
  const modelHomeWinProb = normalCDF(modelMargin / CFB_SIGMA);

  // data-quality gate
  let trustworthy = true;
  if (hasRatings && (Math.abs(modelMargin) > MAX_TRUSTED_MARGIN
      || modelHomeWinProb > MAX_TRUSTED_WINPROB
      || modelHomeWinProb < 1 - MAX_TRUSTED_WINPROB)) {
    trustworthy = false;
    out.dataQuality = "suspect";
  }

  let homeWinProb = modelHomeWinProb;
  if (CFB_BLEND_ENABLED && fairHomeProb != null) {
    homeWinProb = CFB_W_MODEL * modelHomeWinProb + (1 - CFB_W_MODEL) * fairHomeProb;
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
    out.moneyline.value = hasRatings && trustworthy && edge >= EDGE_ML;
    out.moneyline.pick = out.moneyline.value ? (pickHome ? "home" : "away") : null;
    out.moneyline.pickTeam = out.moneyline.value ? (pickHome ? ev.homeTeam : ev.awayTeam) : null;
  }

  // ── SPREAD ─────────────────────────────────────────────────────────────────
  const sLine = ev.spreads?.homeLine;
  if (sLine != null && ev.spreads?.home != null && ev.spreads?.away != null) {
    // WZ-FBALL-KEYNUM-2026-07-17 :: key-number-aware cover (3/7 mass + push), not a plain Normal.
    // WZ-FBALL-BLEND-2026-07-17 :: anchor the margin toward the market (-sLine) via the launch dial.
    const sprMargin = CFB_BLEND_ENABLED ? (CFB_W_MODEL * modelMargin + (1 - CFB_W_MODEL) * (-sLine)) : modelMargin;
    const { homeCoverProb, push: homePushProb } = spreadCover(sprMargin, CFB_SIGMA, sLine, "cfb", CFB_KEY_STRENGTH);
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
    // Model total needs a pace/scoring opinion (comes with a future scoring model).
    // Without it, anchor to the market line so over/under prob ~ fair (no fake edge).
    const projTotal = (ctx?.home?.projPoints != null && ctx?.away?.projPoints != null)
      ? ctx.home.projPoints + ctx.away.projPoints
      : tLine;
    const refAdj = (ctx?.referees?.totalAdj != null)
      ? Math.max(-3, Math.min(3, ctx.referees.totalAdj)) : 0;
    // WZ-FBALL-BLEND-2026-07-17 :: anchor the projected total toward the market line via the same dial.
    const blendedTotal = CFB_BLEND_ENABLED ? (CFB_W_MODEL * (projTotal + refAdj) + (1 - CFB_W_MODEL) * tLine) : (projTotal + refAdj);
    const overProb = normalCDF((blendedTotal - tLine) / CFB_TOTAL_SIGMA);
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

// Φ⁻¹ approximation (Acklam-lite) — invert a probability to a z-score.
function probitApprox(p) {
  if (p <= 0) return -5; if (p >= 1) return 5;
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

function predictSlate(events, ctxByEvent = {}) {
  if (!Array.isArray(events)) return [];
  return events.map(ev => predictGame(ev, ctxByEvent[ev.eventId] || {}));
}

module.exports = {
  predictGame,
  predictSlate,
  CFB_SIGMA, CFB_TOTAL_SIGMA, CFB_HFA_POINTS, CFB_W_MODEL,
  EDGE_ML, EDGE_SPREAD, EDGE_TOTAL,
  _internal: { devigPair, normalCDF, probitApprox, ratingMargin },
};
