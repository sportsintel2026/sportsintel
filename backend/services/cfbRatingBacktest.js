/**
 * cfbRatingBacktest.js — does SP+ beat a plain SRS as a PRIOR for next season?
 * WZ-CFBDBACKTEST-2026-08-03
 *
 * ── THE QUESTION ──────────────────────────────────────────────────────────────
 * Our live CFB rating is a 2025 points-differential SRS off ESPN, used to price 2026
 * games. The proposal is to replace it with CFBD's SP+. Both are built from LAST
 * season, so neither knows this year's roster -- the honest question is not "is SP+
 * nicer" but "does last season's SP+ predict next season's games against the CLOSING
 * LINE better than last season's SRS does."
 *
 * That is exactly our 2025 -> 2026 use case and it needs ZERO 2026 data, so it can be
 * answered before Week 0 instead of discovered in October.
 *
 * CFBD's own /ratings/srs is the CONTROL. It is the same family as ours (margin-based,
 * schedule-adjusted) and costs one request per season instead of ~292 ESPN calls. If
 * SP+ cannot beat a plain SRS here, the thesis dies cheap and we keep what we have.
 *
 * ── WHAT IS MEASURED ──────────────────────────────────────────────────────────
 * For every FBS-vs-FBS game with a closing spread:
 *   predicted home margin = rating(home) - rating(away) + HFA
 *   market's implied home margin = -spread          (CFBD: negative spread = home fav)
 *
 *   mae        mean |predicted - ACTUAL margin|   -- raw accuracy
 *   atsPct     take the side the rating disagrees with the market on; did it cover?
 *              THIS is the money number. 50% is noise. Break-even at -110 is ~52.4%,
 *              but per CLAUDE.md we never assume -110, so atsPct is reported raw and
 *              priced separately -- it is a signal check, not a profit claim.
 *   vsMarket   mae of the CLOSING LINE against actual margin, on the SAME games.
 *              The market's own error is the bar. A rating system that cannot get
 *              near it has no business overriding it.
 *
 * HFA is FIT from the sample (mean actual home margin), not assumed, and reported.
 *
 * ── DISCIPLINE ────────────────────────────────────────────────────────────────
 *   - Rating rows that are not teams are dropped. CFBD ships a "nationalAverages"
 *     aggregate row in the SP+ payload -- the /cfbdprobe join surfaced it. Anything
 *     consuming this blind would rate it as a school.
 *   - A game counts only when BOTH teams are rated in BOTH systems, so SP+ and SRS
 *     are always scored on the identical game set. Different denominators would make
 *     the comparison meaningless.
 *   - Pushes are excluded from atsPct and counted separately, never scored as wins.
 *   - Everything here is PURE. No fetch, no env, no clock. The orchestrator passes
 *     data in. That is what makes it testable without a key or a network.
 *
 * CommonJS. No dependency.
 */

// Rating rows that are aggregates, not schools. CFBD ships these inline.
const NON_TEAM_ROWS = new Set(["nationalaverages", "national averages", "fbs", "fcs"]);

function isTeamRow(row) {
  if (!row || typeof row.team !== "string") return false;
  return !NON_TEAM_ROWS.has(row.team.trim().toLowerCase());
}

// Array<{team, rating}> -> Map(team -> rating), aggregates dropped, last write wins.
function ratingMap(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (!isTeamRow(r)) continue;
    if (typeof r.rating !== "number" || !isFinite(r.rating)) continue;
    m.set(r.team, r.rating);
  }
  return m;
}

// Join CFBD games to CFBD closing lines by game id. Both come from CFBD, so this is an
// ID join -- no name matching, nothing to collide.
function joinGamesToLines(games, lines, provider) {
  const byId = new Map();
  for (const g of games || []) {
    const hp = g && (g.homePoints != null ? g.homePoints : g.home_points);
    const ap = g && (g.awayPoints != null ? g.awayPoints : g.away_points);
    if (hp == null || ap == null) continue;
    const home = g.homeTeam != null ? g.homeTeam : g.home_team;
    const away = g.awayTeam != null ? g.awayTeam : g.away_team;
    if (!home || !away) continue;
    byId.set(String(g.id), { home, away, homeMargin: Number(hp) - Number(ap) });
  }
  const out = [];
  for (const row of lines || []) {
    const g = byId.get(String(row && row.id));
    if (!g) continue;
    const ls = (row.lines || []);
    if (!ls.length) continue;
    const pick = ls.find(l => String(l.provider || "").toLowerCase() === String(provider || "").toLowerCase()) || ls[0];
    const spread = pick && pick.spread != null ? Number(pick.spread) : null;
    if (spread == null || !isFinite(spread)) continue;
    out.push({ ...g, spread });
  }
  return out;
}

// Mean home margin over the sample = the home-field advantage, FIT not assumed.
function fitHfa(rows) {
  if (!rows.length) return 0;
  const s = rows.reduce((a, r) => a + r.homeMargin, 0);
  return s / rows.length;
}

/**
 * Score one rating system over a joined game set.
 * @param {Array} rows      from joinGamesToLines
 * @param {Map}   ratings   team -> rating (points vs average)
 * @param {Number} hfa      home-field advantage in points
 * @param {Set}   eligible  game keys both systems can rate (keeps denominators equal)
 */
function scoreSystem(rows, ratings, hfa, eligible) {
  let n = 0, absErr = 0, atsWin = 0, atsLoss = 0, push = 0, agree = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // WZ-CFBDBACKTEST-2026-08-03 :: eligibility is keyed by ROW INDEX, not by game
    // content. A content key (home|away|margin|spread) silently collapses repeated
    // matchups into one Set entry, which undercounted scoredGames while the loop
    // still scored every duplicate. Caught by n > scoredGames on the rigged test.
    if (eligible && !eligible.has(i)) continue;
    const rh = ratings.get(r.home), ra = ratings.get(r.away);
    if (rh == null || ra == null) continue;
    const predicted = rh - ra + hfa;
    const marketMargin = -r.spread;          // CFBD: negative spread = home favoured
    n++;
    absErr += Math.abs(predicted - r.homeMargin);
    if (predicted === marketMargin) { agree++; continue; }   // no side to take
    const takeHome = predicted > marketMargin;
    const cover = r.homeMargin - marketMargin;               // >0 home covered
    if (cover === 0) { push++; continue; }
    const won = takeHome ? cover > 0 : cover < 0;
    if (won) atsWin++; else atsLoss++;
  }
  const graded = atsWin + atsLoss;
  return {
    n,
    mae: n ? Math.round((absErr / n) * 1000) / 1000 : null,
    atsWin, atsLoss, push, noSide: agree,
    atsN: graded,
    atsPct: graded ? Math.round((atsWin / graded) * 1000) / 10 : null,
  };
}

// The market's own error on the same games — the bar any rating must be judged against.
function scoreMarket(rows, eligible) {
  let n = 0, absErr = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (eligible && !eligible.has(i)) continue;
    n++;
    absErr += Math.abs((-r.spread) - r.homeMargin);
  }
  return { n, mae: n ? Math.round((absErr / n) * 1000) / 1000 : null };
}

// Games both systems can price — identical denominator for a fair comparison.
function eligibleKeys(rows, a, b) {
  const s = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (a.get(r.home) == null || a.get(r.away) == null) continue;
    if (b.get(r.home) == null || b.get(r.away) == null) continue;
    s.add(i);
  }
  return s;
}

/**
 * Evaluate one season pair: ratings from `priorYear`, games from `priorYear + 1`.
 * Pure — all data is passed in.
 */
function evaluatePair({ games, lines, spRows, srsRows, provider = "consensus" }) {
  const rows = joinGamesToLines(games, lines, provider);
  const sp = ratingMap(spRows);
  const srs = ratingMap(srsRows);
  const eligible = eligibleKeys(rows, sp, srs);
  const hfa = fitHfa(rows.filter((_, i) => eligible.has(i)));
  return {
    joinedGames: rows.length,
    scoredGames: eligible.size,
    spTeams: sp.size,
    srsTeams: srs.size,
    hfaFitted: Math.round(hfa * 100) / 100,
    sp: scoreSystem(rows, sp, hfa, eligible),
    srs: scoreSystem(rows, srs, hfa, eligible),
    market: scoreMarket(rows, eligible),
  };
}

module.exports = {
  evaluatePair,
  _internal: { isTeamRow, ratingMap, joinGamesToLines, fitHfa, scoreSystem, scoreMarket, eligibleKeys },
};
