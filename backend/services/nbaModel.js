/**
 * nbaModel.js — SportsIntel NBA model v0.1 (team markets: ML / spread / total)
 * --------------------------------------------------------------------------
 * Pure, dependency-free. Takes one game context from nbaDataSource + matched
 * book lines, returns predictions + edges.
 *
 * v0.1.1 adds GUARDRAILS so bad inputs can never surface as a confident pick:
 *  - Inputs validated (points/game must be in a sane NBA range).
 *  - Outputs sanity-checked: a v0.1 points model projecting an 18+ margin or a
 *    >92% win is almost always bad data, so picks are suppressed and the game
 *    is flagged dataQuality:'suspect' rather than published as a huge "edge".
 *  - dataQuality + ratingsLoaded fields make the data state explicit.
 *
 * v0.2 (in progress) — porting MLB's discipline, tuned for basketball:
 *  - MARKET BLEND: anchor the model's win prob toward the de-vigged line so a
 *    young model can't manufacture a fake edge by disagreeing wildly with a sharp
 *    price. NBA starts MORE humble than MLB (55% model / 45% market vs MLB’s
 *    70/30) because this model is less proven; dial toward the model as it earns
 *    trust over a real sample of games.
 *
 * Method: expected points = team offense vs opponent defense vs league avg;
 * home court ~2.5 pts (0 at neutral site); win prob from margin (SD ~12).
 * Injuries are surfaced but not yet weighted into the line (v0.2).
 * -------------------------------------------------------------------------- */

const LG_PPG = 114;
const HCA_POINTS = 2.5;
const SIGMA = 12;
const EDGE_ML = 0.03;
const EDGE_SPREAD = 1.5;
// Totals: books are very sharp here, and a v0.1 points model has wide error.
// Require a large disagreement (after playoff adjustment) before claiming value.
const EDGE_TOTAL = 7.0;
// Playoff games score lower than the regular season (tighter defense, slower,
// more deliberate). Deflate projected scoring so totals aren't systematically high.
const PLAYOFF_TOTAL_FACTOR = 0.95;

// ── MARKET BLEND (v0.2) ────────────────────────────────────────────────────
// The de-vigged line is the single sharpest predictor in sports betting. We
// anchor the model's win probability partway toward the market's fair prob, so
// (1) the number is better calibrated and (2) a young model can't fabricate an
// edge by sitting stubbornly far from a sharp price. The reported edge is then
// (blended view − fair market): agreeing with the market is correctly ~0 edge.
//
// NBA is intentionally MORE humble than MLB (which uses 0.70). This model is
// v0.1-grade, so we lean harder on the market until it proves itself. To revert
// to pure-model behavior, set NBA_BLEND_ENABLED = false (or NBA_W_MODEL = 1.0).
const NBA_BLEND_ENABLED = true;
const NBA_W_MODEL = 0.55; // 55% model / 45% market — humble start for a young model

// ── MARKET OVERREACTION FLAG (v0.2) ────────────────────────────────────────
// Neutral CONTEXT, never a bet directive. When the de-vigged market rates a side
// HIGHER than our model by >= this gap, the price may be carrying public/streak
// hype the fundamentals don't support (the classic "public over-betting a side").
// We surface a neutral note and let the user apply their own read. NBA starts a
// touch wider than MLB's 8% because (a) the blend already shrinks gaps and (b) a
// young model's smaller disagreements are more likely noise than signal — we only
// want to flag a real, sizable gap. Tunable as we watch it over real games.
const NBA_INFLATION_THRESHOLD = 0.09; // market fair prob exceeds model prob by 9%+

// guardrails
const PPG_MIN = 90;
const PPG_MAX = 135;
const MAX_TRUSTED_MARGIN = 18;   // bigger than this from a points model = suspect
const MAX_TRUSTED_WINPROB = 0.92;

function r(n, d = 1) {
  if (n == null || !isFinite(n)) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}
function sanePpg(p) {
  return p != null && isFinite(p) && p >= PPG_MIN && p <= PPG_MAX;
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
      0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
function normalCDF(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
function expectedPoints(off, oppDef) {
  if (off != null && oppDef != null) return (off * oppDef) / LG_PPG;
  if (off != null) return off;
  return LG_PPG;
}

function predictGame(ctx, lines, opts = {}) {
  const h = ctx.home;
  const a = ctx.away;

  if (!h || !a || h.isTBD || a.isTBD) {
    return { gameId: ctx.gameId, date: ctx.date, pending: true, matchup: 'TBD' };
  }

  const neutral = !!ctx.neutralSite;
  const hca = neutral ? 0 : HCA_POINTS;

  // Playoff scoring deflation (applied to base scoring, home-court kept intact)
  const pf = opts.playoff ? PLAYOFF_TOTAL_FACTOR : 1;
  const baseHome = expectedPoints(h.ppg, a.papg) * pf;
  const baseAway = expectedPoints(a.ppg, h.papg) * pf;
  // v0.2 injury weighting: subtract each team's conservative injury haircut (points
  // lost to OUT players, already discounted + capped upstream in nbaInjuryImpact).
  // Flows into margin, win prob, AND total since all derive from expHome/expAway.
  const homeHaircut = Math.max(0, Number(opts.homeInjuryHaircut) || 0);
  const awayHaircut = Math.max(0, Number(opts.awayInjuryHaircut) || 0);
  const expHome = baseHome + hca / 2 - homeHaircut;
  const expAway = baseAway - hca / 2 - awayHaircut;
  const projTotal = expHome + expAway;
  const projMargin = expHome - expAway; // + = home favored
  const modelHomeWinProb = normalCDF(projMargin / SIGMA);

  // ── data-quality gate ──────────────────────────────────────────────────────
  const ratingsLoaded = h.papg != null && a.papg != null;
  let dataQuality = 'ok';
  let dataNote = null;
  if (!sanePpg(h.ppg) || !sanePpg(a.ppg)) {
    dataQuality = 'insufficient';
    dataNote = 'Team scoring data missing or out of range — no pick issued.';
  } else if (
    Math.abs(projMargin) > MAX_TRUSTED_MARGIN ||
    modelHomeWinProb > MAX_TRUSTED_WINPROB ||
    modelHomeWinProb < 1 - MAX_TRUSTED_WINPROB
  ) {
    dataQuality = 'suspect';
    dataNote =
      'Projection too extreme for a v0.1 points model — likely a data issue; pick suppressed.';
  } else if (!ratingsLoaded) {
    dataQuality = 'offense-only';
    dataNote = 'Defensive ratings did not load; running on offense only — lower confidence.';
  }
  const trustworthy = dataQuality === 'ok' || dataQuality === 'offense-only';

  // ── MARKET BLEND ───────────────────────────────────────────────────────────
  // When we have both moneyline prices, de-vig to the market's fair home prob and
  // blend the model toward it. The blended prob is what we compare to the market,
  // so the edge reflects how far our (market-respecting) view still sits from the
  // line. Without both prices we can't de-vig → fall back to the raw model prob.
  let fairHomeProb = null;
  if (lines && lines.home.ml != null && lines.away.ml != null) {
    const ih = amToProb(lines.home.ml);
    const ia = amToProb(lines.away.ml);
    if (ih != null && ia != null && ih + ia > 0) fairHomeProb = ih / (ih + ia);
  }
  let homeWinProb = modelHomeWinProb;
  if (NBA_BLEND_ENABLED && fairHomeProb != null) {
    homeWinProb = NBA_W_MODEL * modelHomeWinProb + (1 - NBA_W_MODEL) * fairHomeProb;
  }
  const awayWinProb = 1 - homeWinProb;

  /* ---- moneyline ---- */
  const ml = {
    homeWinProb: r(homeWinProb * 100),
    awayWinProb: r(awayWinProb * 100),
    modelHomeWinProb: r(modelHomeWinProb * 100), // pre-blend, for transparency
    pick: null,
    pickTeam: null,
    edge: null,
    value: false,
    fair: null,
    book: null,
    inflation: null,
  };
  if (lines && lines.home.ml != null && lines.away.ml != null && fairHomeProb != null) {
    const edgeHome = homeWinProb - fairHomeProb;
    const edgeAway = awayWinProb - (1 - fairHomeProb);
    const pickHome = edgeHome >= edgeAway;
    const edge = pickHome ? edgeHome : edgeAway;
    ml.fair = { home: r(fairHomeProb * 100), away: r((1 - fairHomeProb) * 100) };
    ml.book = { home: lines.home.ml, away: lines.away.ml };
    ml.edge = r(edge * 100);
    ml.value = trustworthy && edge >= EDGE_ML;
    ml.pick = ml.value ? (pickHome ? 'home' : 'away') : null;
    ml.pickTeam = ml.value ? (pickHome ? h.displayName : a.displayName) : null;

    // Market overreaction flag — compare the PRE-BLEND model fundamentals against
    // the market fair prob. If the market rates a side >= threshold higher than the
    // raw model, flag it as possible public/streak inflation on THAT side. Neutral
    // context only; we never tell the user to bet it. Only surfaced on trustworthy
    // data so a suspect projection can't trigger a misleading flag.
    if (trustworthy) {
      const fairAwayProb = 1 - fairHomeProb;
      const modelAwayWinProb = 1 - modelHomeWinProb;
      const homeGap = fairHomeProb - modelHomeWinProb; // + => market high on home
      const awayGap = fairAwayProb - modelAwayWinProb;  // + => market high on away
      if (homeGap >= NBA_INFLATION_THRESHOLD) {
        ml.inflation = {
          side: 'home', team: h.displayName, inflated: true, gap: r(homeGap * 100),
          note: 'Market rates ' + h.displayName + ' higher than our model — possible public/streak inflation.',
        };
      } else if (awayGap >= NBA_INFLATION_THRESHOLD) {
        ml.inflation = {
          side: 'away', team: a.displayName, inflated: true, gap: r(awayGap * 100),
          note: 'Market rates ' + a.displayName + ' higher than our model — possible public/streak inflation.',
        };
      }
    }
  }

  /* ---- spread (book "line" = home spread point) ---- */
  const spread = {
    projectedMargin: r(projMargin),
    line: null,
    pick: null,
    pickTeam: null,
    pickLine: null,
    edge: null,
    value: false,
    book: null,
  };
  if (lines && lines.home.spread && lines.home.spread.point != null) {
    const pt = lines.home.spread.point;
    const cover = projMargin + pt;
    const pickHome = cover >= 0;
    spread.line = pt;
    spread.book = {
      homePrice: lines.home.spread.price,
      awayPrice: lines.away.spread ? lines.away.spread.price : null,
    };
    spread.edge = r(Math.abs(cover));
    spread.value = trustworthy && Math.abs(cover) >= EDGE_SPREAD;
    spread.pick = spread.value ? (pickHome ? 'home' : 'away') : null;
    spread.pickTeam = spread.value ? (pickHome ? h.displayName : a.displayName) : null;
    spread.pickLine = spread.value ? (pickHome ? pt : -pt) : null;
  }

  /* ---- total ---- */
  const total = {
    projectedTotal: r(projTotal),
    line: null,
    pick: null,
    edge: null,
    value: false,
    book: null,
  };
  if (lines && lines.total && lines.total.point != null) {
    const T = lines.total.point;
    const diff = projTotal - T;
    total.line = T;
    total.book = { over: lines.total.overPrice, under: lines.total.underPrice };
    total.edge = r(Math.abs(diff));
    total.value = trustworthy && Math.abs(diff) >= EDGE_TOTAL;
    total.pick = total.value ? (diff >= 0 ? 'over' : 'under') : null;
  }

  return {
    gameId: ctx.gameId,
    date: ctx.date,
    state: ctx.state,
    matchup: `${a.displayName} @ ${h.displayName}`,
    home: h.displayName,
    away: a.displayName,
    neutralSite: neutral,
    hasLines: !!lines,
    dataQuality,
    ratingsLoaded,
    dataNote,
    expected: { home: r(expHome), away: r(expAway) },
    injuryAdjustment: {
      home: r(homeHaircut),
      away: r(awayHaircut),
      homeDetails: opts.homeInjuryDetails || [],
      awayDetails: opts.awayInjuryDetails || [],
    },
    predictions: { moneyline: ml, spread, total },
    factors: {
      homeNetRtg: h.netRtg,
      awayNetRtg: a.netRtg,
      homePace: h.pace,
      awayPace: a.pace,
      homeRecord: h.record,
      awayRecord: a.record,
      hcaPoints: hca,
      homeInjuries: h.injuries,
      awayInjuries: a.injuries,
    },
    modelVersion: 'nba-v0.2.1',
    note: opts.playoff
      ? 'Playoff scoring adjustment applied; model blended toward the market line (55/45); OUT injuries weighted (conservative). Day-to-day shown but not weighted.'
      : 'Ratings/pace computed from ESPN; model blended toward the market line (55/45); OUT injuries weighted (conservative). Day-to-day shown but not weighted.',
  };
}

module.exports = {
  predictGame,
  EDGE_ML, EDGE_SPREAD, EDGE_TOTAL,
  // exported for the self-test (guardrail verification)
  NBA_W_MODEL, NBA_INFLATION_THRESHOLD, NBA_BLEND_ENABLED,
};
