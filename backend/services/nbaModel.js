/**
 * nbaModel.js — SportsIntel NBA model v0.1 (team markets: ML / spread / total)
 * --------------------------------------------------------------------------
 * Pure, dependency-free. Takes one game context from nbaDataSource + the
 * matched book lines, returns predictions + edges.
 *
 * Method (v0.1):
 *  - Expected points = team offense vs. opponent defense, relative to league
 *    average (per-game scoring already embeds pace, so we don't double-count it).
 *  - Home court worth ~2.5 pts (0 at a neutral site).
 *  - Win prob from projected margin via a normal model (NBA margin SD ~12).
 *  - Edges: model vs. de-vigged book probability (ML), model margin vs. spread,
 *    model total vs. book total. A pick is flagged "value" only past a threshold.
 *  - Injuries are surfaced for transparency but NOT yet weighted into the line
 *    (that needs player minutes/value — a v0.2 item).
 * -------------------------------------------------------------------------- */

const LG_PPG = 114;        // league avg points/game (fallback + scaling anchor)
const HCA_POINTS = 2.5;    // total home-court points edge; 0 at a neutral site
const SIGMA = 12;          // std dev of NBA final margins, for prob mapping
const EDGE_ML = 0.03;      // flag ML value at >= 3% probability edge
const EDGE_SPREAD = 1.5;   // flag spread value at >= 1.5 projected points
const EDGE_TOTAL = 2.0;    // flag total value at >= 2.0 projected points

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
      0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
function normalCDF(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// team offense (off) vs opponent defense (oppDef), both per-game, vs league avg
function expectedPoints(off, oppDef) {
  if (off != null && oppDef != null) return (off * oppDef) / LG_PPG;
  if (off != null) return off;
  return LG_PPG;
}

function predictGame(ctx, lines) {
  const h = ctx.home;
  const a = ctx.away;

  if (!h || !a || h.isTBD || a.isTBD) {
    return { gameId: ctx.gameId, date: ctx.date, pending: true, matchup: 'TBD' };
  }

  const neutral = !!ctx.neutralSite;
  const hca = neutral ? 0 : HCA_POINTS;

  const expHome = expectedPoints(h.ppg, a.papg) + hca / 2;
  const expAway = expectedPoints(a.ppg, h.papg) - hca / 2;

  const projTotal = expHome + expAway;
  const projMargin = expHome - expAway; // + = home favored
  const homeWinProb = normalCDF(projMargin / SIGMA);
  const awayWinProb = 1 - homeWinProb;

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
    const fairHome = ih / (ih + ia); // de-vigged
    const edgeHome = homeWinProb - fairHome;
    const edgeAway = awayWinProb - (1 - fairHome);
    const pickHome = edgeHome >= edgeAway;
    const edge = pickHome ? edgeHome : edgeAway;
    ml.fair = { home: r(fairHome * 100), away: r((1 - fairHome) * 100) };
    ml.book = { home: lines.home.ml, away: lines.away.ml };
    ml.edge = r(edge * 100);
    ml.value = edge >= EDGE_ML;
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
    const cover = projMargin + pt; // >0 => home covers
    const pickHome = cover >= 0;
    spread.line = pt;
    spread.book = {
      homePrice: lines.home.spread.price,
      awayPrice: lines.away.spread ? lines.away.spread.price : null,
    };
    spread.edge = r(Math.abs(cover));
    spread.value = Math.abs(cover) >= EDGE_SPREAD;
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
    total.value = Math.abs(diff) >= EDGE_TOTAL;
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
    modelVersion: 'nba-v0.1',
    note: 'Ratings/pace computed from ESPN; injuries shown but not yet weighted into the line (v0.2).',
  };
}

module.exports = { predictGame, EDGE_ML, EDGE_SPREAD, EDGE_TOTAL };
