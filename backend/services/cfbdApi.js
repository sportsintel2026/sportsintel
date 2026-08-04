/**
 * cfbdApi.js — WizePicks CollegeFootballData (CFBD) client.
 * WZ-CFBD-2026-08-03
 *
 * ── WHY ───────────────────────────────────────────────────────────────────────
 * The live CFB rating layer (cfbDataSource.buildTeamRatings) is a 2025 season
 * points-differential SRS off ESPN. It is schedule-adjusted and it is ROSTER-BLIND.
 * In a sport where the transfer portal turns over a third of a two-deep every spring,
 * last year's scoreboard is a weak prior for this year's team.
 *
 * CFBD publishes what actually predicts: SP+ (an explicitly predictive, tempo- and
 * opponent-adjusted efficiency rating built from returning production, recent history,
 * recruiting and coaching change) and returning-production PPA share. We already pay
 * for the key -- CFBD_API_KEY has lived in Railway env since WZ-CFB-BACKTEST-2026-07-17
 * and is used by exactly one backtest route. The live model has never touched it.
 *
 * Call cost is trivial: ONE request returns all 138 FBS teams. The current ESPN ratings
 * refresh spends ~292 requests to do a worse job.
 *
 * ── SHAPES ────────────────────────────────────────────────────────────────────
 * Field names below are taken from the OFFICIAL generated client (npm `cfbd` v5.21.0,
 * dist/types.gen.d.ts), not from documentation prose or memory:
 *
 *   GET /ratings/sp?year=YYYY        -> Array<TeamSP>
 *     { year, team, conference, rating, ranking, secondOrderWins, sos,
 *       offense: { rating, ranking, pace, success, explosiveness, ... },
 *       defense: { rating, ranking, havoc: { total, db, frontSeven }, ... },
 *       specialTeams: { rating } }
 *
 *   GET /player/returning?year=YYYY  -> Array<ReturningProduction>
 *     { season, team, conference, totalPPA, percentPPA, usage,
 *       percentPassingPPA, percentReceivingPPA, percentRushingPPA, ... }
 *
 * SP+ `rating` is already expressed in POINTS vs an average team -- the same unit as
 * cfbModel's ratingMargin() -- so it drops into ctx.home/away.rating without rescaling.
 * That is a claim to VERIFY against the live payload before any wiring, not to assume.
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────────
 *   - The key travels in an Authorization header. It is NEVER placed in a URL, a query
 *     string, a log line, or a returned payload. Nothing here can put it in a browser
 *     address bar.
 *   - Every call is timeout-bounded and throws on a non-2xx; callers decide the fallback.
 *   - No caching here on purpose: the only current consumer is a read-only probe, and a
 *     stale cache would hide exactly the shape questions the probe exists to answer.
 *
 * CommonJS. No new dependency -- global fetch, Node 18+.
 */

const BASE = "https://api.collegefootballdata.com";
const REQUEST_TIMEOUT_MS = 12000;

function apiKey() {
  const k = process.env.CFBD_API_KEY;
  return (typeof k === "string" && k.trim()) ? k.trim() : null;
}

// Low-level GET. `path` must already include its query string; the key goes in the
// header only. Throws on timeout or non-2xx so the caller owns the failure policy.
async function cfbdGet(path) {
  const key = apiKey();
  if (!key) throw new Error("CFBD_API_KEY is not set in the environment");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CFBD ${path} -> ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// All FBS SP+ ratings for a season. One request, ~138 rows.
async function getSpRatings(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y)) throw new Error(`getSpRatings: bad year ${year}`);
  const rows = await cfbdGet(`/ratings/sp?year=${y}`);
  return Array.isArray(rows) ? rows : [];
}

// Returning production for a season. One request, ~138 rows.
async function getReturningProduction(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y)) throw new Error(`getReturningProduction: bad year ${year}`);
  const rows = await cfbdGet(`/player/returning?year=${y}`);
  return Array.isArray(rows) ? rows : [];
}

// WZ-CFBDBACKTEST-2026-08-03 :: the three feeds the rating-system backtest needs.
//
// GET /ratings/srs?year=YYYY -> Array<TeamSRS> { year, team, conference, division,
// rating, ranking }. This is CFBD's OWN margin-based schedule-adjusted rating --
// structurally the same family as cfbDataSource.buildTeamRatings (capped MOV + SoS
// fixpoint). It stands in as the CONTROL so the comparison costs one request instead of
// ~292 ESPN calls per historical season. If SP+ cannot beat a plain SRS at this task,
// the whole "SP+ is a better prior" thesis dies cheap and we stop.
async function getSrsRatings(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y)) throw new Error(`getSrsRatings: bad year ${year}`);
  const rows = await cfbdGet(`/ratings/srs?year=${y}`);
  return Array.isArray(rows) ? rows : [];
}

// FBS-vs-FBS regular season results. Same filters routes/backtest.js already proved.
async function getGames(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y)) throw new Error(`getGames: bad year ${year}`);
  const rows = await cfbdGet(`/games?year=${y}&seasonType=regular&division=fbs`);
  return Array.isArray(rows) ? rows : [];
}

// Closing spreads/totals by game. CFBD convention: `spread` NEGATIVE = home favoured.
async function getLines(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y)) throw new Error(`getLines: bad year ${year}`);
  const rows = await cfbdGet(`/lines?year=${y}&seasonType=regular`);
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  getSpRatings,
  getReturningProduction,
  getSrsRatings,
  getGames,
  getLines,
  _internal: { cfbdGet, apiKey, BASE, REQUEST_TIMEOUT_MS },
};
