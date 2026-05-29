/**
 * nbaModel.js — SportsIntel NBA model v0.1.1 (team markets: ML / spread / total)
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
  const expHome = baseHome + hca / 2;
  const expAway = baseAway - hca / 2;
  const projTotal = expHome + expAway;
  const projMargin = expHome - expAway; // + = home favored
  const homeWinProb = normalCDF(projMargin / SIGMA);
  const awayWinProb = 1 - homeWinProb;

  // ── data-quality gate ──────────────────────────────────────────────────────
  const ratingsLoaded = h.papg != null && a.papg != null;
  let dataQuality = 'ok';
  let dataNote = null;
  if (!sanePpg(h.ppg) || !sanePpg(a.ppg)) {
    dataQuality = 'insufficient';
    dataNote = 'Team scoring data missing or out of range — no pick issued.';
  } else if (
    Math.abs(projMargin) > MAX_TRUSTED_MARGIN ||
    homeWinProb > MAX_TRUSTED_WINPROB ||
    homeWinProb < 1 - MAX_TRUSTED_WINPROB
  ) {
    dataQuality = 'suspect';
    dataNote =
      'Projection too extreme for a v0.1 points model — likely a data issue; pick suppressed.';
  } else if (!ratingsLoaded) {
    dataQuality = 'offense-only';
    dataNote = 'Defensive ratings did not load; running on offense only — lower confidence.';
  }
  const trustworthy = dataQuality === 'ok' || dataQuality === 'offense-only';

  /* ---- moneyline ---- */
  const ml = {
    homeWinProb: r(homeWinProb * 100),
    awayWinProb: r(awayWinProb * 100),
    pick: null,
    pickTeam: null,
    edge: null,
    value: false,
    fair: null,
    book: null,
  };
  if (lines && lines.home.ml != null && lines.away.ml != null) {
    const ih = amToProb(lines.home.ml);
    const ia = amToProb(lines.away.ml);
    const fairHome = ih / (ih + ia);
    const edgeHome = homeWinProb - fairHome;
    const edgeAway = awayWinProb - (1 - fairHome);
    const pickHome = edgeHome >= edgeAway;
    const edge = pickHome ? edgeHome : edgeAway;
    ml.fair = { home: r(fairHome * 100), away: r((1 - fairHome) * 100) };
    ml.book = { home: lines.home.ml, away: lines.away.ml };
    ml.edge = r(edge * 100);
    ml.value = trustworthy && edge >= EDGE_ML;
    ml.pick = ml.value ? (pickHome ? 'home' : 'away') : null;
    ml.pickTeam = ml.value ? (pickHome ? h.displayName : a.displayName) : null;
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
    modelVersion: 'nba-v0.1.2',
    note: opts.playoff
      ? 'Playoff scoring adjustment applied; totals flagged only on large gaps. Injuries shown but not yet weighted (v0.2).'
      : 'Ratings/pace computed from ESPN; injuries shown but not yet weighted into the line (v0.2).',
  };
}

module.exports = { predictGame, EDGE_ML, EDGE_SPREAD, EDGE_TOTAL };
