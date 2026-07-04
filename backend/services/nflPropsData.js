// WZ-NFLPROPSDATA-2026-07-05
// nflPropsData.js  —  WizePicks NFL Player Props projection engine (Phase 3).
//
// Turns ESPN's 2025 core-API athlete statistics into per-game projections for the
// core prop markets (pass yds / rush yds / receptions / receiving yds), plus a
// helper to convert a projected mean + a book line into an Over probability.
//
// HONESTY (read before "why are the edges tiny"): this seeds off 2025 SEASON
// AVERAGES. Props are dominated by snap share, target share, injuries, game script
// and the specific defense — none of which a season average captures — so a raw
// projection is a COARSE prior, not a sharp number. Nothing here publishes: it feeds
// a shadow logger that grades silently in-season, and the parametric dispersion below
// gets replaced by a dispersion fit from real graded actuals. No fabricated edges.
//
// The pure functions (extractSeasonStats / projectPlayer / overProb) are unit-tested
// offline against a real athlete payload; buildPlayerProjections does the live
// roster->stats orchestration and is validated by running the diagnostic route.
//
// CommonJS. Requires Node 18+ (global fetch not used here; axios like the probe).

const axios = require("axios");

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const TIMEOUT_MS = 9000;

// Small-sample regression: blend a player's own per-game rate with a positional
// prior, weighting the prior as K "pseudo-games". A full 2025 season (17 GP) is
// dominated by the player; a 2-game rookie leans on the prior. Recalibrate later.
const REGRESSION_PSEUDO_GAMES = 4;
const MIN_GAMES = 1;

// Coarse per-game positional priors (league-typical 2025-ish). These are ANCHORS
// for thin samples only, NOT published values — flagged as rough on purpose.
const POSITION_PRIORS = {
  QB: { passYds: 215, passAtt: 32, completions: 21, passTds: 1.3, rushYds: 12, rushAtt: 3, receptions: 0, recYds: 0 },
  RB: { passYds: 0, passAtt: 0, completions: 0, passTds: 0, rushYds: 48, rushAtt: 11, receptions: 2.4, recYds: 18 },
  WR: { passYds: 0, passAtt: 0, completions: 0, passTds: 0, rushYds: 2, rushAtt: 0.4, receptions: 3.8, recYds: 46 },
  TE: { passYds: 0, passAtt: 0, completions: 0, passTds: 0, rushYds: 0, rushAtt: 0, receptions: 3.2, recYds: 32 },
};
const DEFAULT_PRIOR = POSITION_PRIORS.WR;

// v1 parametric dispersion: coefficient of variation per market (SD = CV * mean),
// with a floor so a tiny mean does not collapse SD to ~0. These are placeholders
// tuned to typical game-to-game spread; the shadow harness replaces them with a fit.
const MARKET_DISPERSION = {
  pass_yds: { cv: 0.28, minSd: 35 },
  rush_yds: { cv: 0.55, minSd: 18 },
  receptions: { cv: 0.45, minSd: 1.4 },
  rec_yds: { cv: 0.60, minSd: 15 },
};

// ── math helpers ──────────────────────────────────────────────────────────────
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
function normalCDF(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
function num(v) {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : null;
}
function round(n, d = 1) {
  if (n == null || !isFinite(n)) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// ── PURE: extract clean season totals from a core-API athlete statistics payload ─
// Reads ONLY category-native named fields, so ESPN's cross-category pollution
// (avgGain / netTotalYards / netYardsPerGame duplicated into rushing/receiving) is
// ignored by construction. Returns nulls for anything absent (never guesses).
function extractSeasonStats(statsJson) {
  const cats = (statsJson && statsJson.splits && statsJson.splits.categories) || [];
  const byCat = {};
  for (const c of cats) {
    if (!c || !c.name) continue;
    const o = {};
    for (const s of c.stats || []) {
      if (s && s.name != null) o[s.name] = num(s.value != null ? s.value : s.displayValue);
    }
    byCat[c.name] = o;
  }
  const P = byCat.passing || {};
  const R = byCat.rushing || {};
  const C = byCat.receiving || {};
  const G = byCat.general || {};
  const S = byCat.scoring || {};
  const pick = (...vals) => { for (const v of vals) if (v != null) return v; return null; };
  return {
    gamesPlayed: pick(G.gamesPlayed),
    // gross passing yards for prop settlement; fall back to net if gross absent.
    passYds: pick(P.passingYards, P.netPassingYards),
    passAtt: pick(P.passingAttempts),
    completions: pick(P.completions),
    passTds: pick(P.passingTouchdowns, S.passingTouchdowns),
    interceptions: pick(P.interceptions),
    rushYds: pick(R.rushingYards),
    rushAtt: pick(R.rushingAttempts),
    rushTds: pick(R.rushingTouchdowns, S.rushingTouchdowns),
    receptions: pick(C.receptions),
    targets: pick(C.receivingTargets),
    recYds: pick(C.receivingYards),
    recTds: pick(C.receivingTouchdowns, S.receivingTouchdowns),
  };
}

// ── PURE: per-game projection with small-sample regression toward a position prior ─
function regressRate(total, gp, prior) {
  if (gp == null || gp < MIN_GAMES || total == null) return prior != null ? prior : null;
  const rate = total / gp;
  if (prior == null) return rate;
  return (gp * rate + REGRESSION_PSEUDO_GAMES * prior) / (gp + REGRESSION_PSEUDO_GAMES);
}

function projectPlayer(season, position) {
  const prior = POSITION_PRIORS[position] || DEFAULT_PRIOR;
  const gp = season.gamesPlayed;
  return {
    gamesPlayed: gp,
    passYds: round(regressRate(season.passYds, gp, prior.passYds)),
    passAtt: round(regressRate(season.passAtt, gp, prior.passAtt)),
    completions: round(regressRate(season.completions, gp, prior.completions)),
    passTds: round(regressRate(season.passTds, gp, prior.passTds), 2),
    rushYds: round(regressRate(season.rushYds, gp, prior.rushYds)),
    rushAtt: round(regressRate(season.rushAtt, gp, prior.rushAtt)),
    receptions: round(regressRate(season.receptions, gp, prior.receptions), 2),
    recYds: round(regressRate(season.recYds, gp, prior.recYds)),
  };
}

// ── PURE: projected mean + book line -> Over probability (v1 parametric) ─────────
// P(stat > line) using a normal approx with market-specific dispersion. Returns null
// if inputs are missing. Dispersion is a placeholder pending the shadow-fit.
function overProb(mean, line, market) {
  const m = num(mean), l = num(line);
  const disp = MARKET_DISPERSION[market];
  if (m == null || l == null || !disp) return null;
  const sd = Math.max(disp.minSd, disp.cv * m);
  if (!(sd > 0)) return null;
  const z = (l - m) / sd;
  return round(1 - normalCDF(z), 4);
}

// ── LIVE: fetch + assemble player projections across teams (validated via route) ─
async function espnGet(url) {
  const res = await axios.get(url, { timeout: TIMEOUT_MS, headers: { "User-Agent": UA, Accept: "application/json" } });
  return res.data;
}

const _cache = new Map();
function cacheGet(k) { const h = _cache.get(k); if (h && h.exp > Date.now()) return h.v; _cache.delete(k); return null; }
function cacheSet(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

// Which markets a position is eligible for (so we never project a QB's receptions).
const POSITION_MARKETS = {
  QB: ["pass_yds"],
  RB: ["rush_yds", "receptions", "rec_yds"],
  WR: ["receptions", "rec_yds"],
  TE: ["receptions", "rec_yds"],
};
const PROJECTED_MARKETS = new Set(["QB", "RB", "WR", "TE"]);

// buildPlayerProjections: enumerate teams -> rosters -> per-athlete 2025 stats ->
// projections. `teamLimit` caps teams (keep the diagnostic cheap); 0 = all 32.
async function buildPlayerProjections({ season = 2025, teamLimit = 3 } = {}) {
  const key = `nflProj:${season}:${teamLimit}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  let teams = [];
  try {
    const data = await espnGet(`${ESPN_SITE}/teams`);
    teams = ((data.sports && data.sports[0] && data.sports[0].leagues && data.sports[0].leagues[0] && data.sports[0].leagues[0].teams) || [])
      .map((x) => x.team).filter((t) => t && t.id);
  } catch (e) {
    return { season, error: `teams fetch failed: ${e.message}`, players: [] };
  }
  if (teamLimit > 0) teams = teams.slice(0, teamLimit);

  const players = [];
  let statErrors = 0;
  for (const tm of teams) {
    let roster = [];
    try {
      const data = await espnGet(`${ESPN_SITE}/teams/${tm.id}/roster`);
      for (const g of data.athletes || []) {
        const items = Array.isArray(g.items) ? g.items : (g.id ? [g] : []);
        for (const a of items) {
          const pos = a.position && a.position.abbreviation;
          if (a.id && PROJECTED_MARKETS.has(pos)) roster.push({ id: a.id, name: a.fullName || a.displayName, pos, team: tm.abbreviation });
        }
      }
    } catch (_) { continue; }

    // fetch each skill player's season stats (concurrency-capped)
    for (let i = 0; i < roster.length; i += 6) {
      const batch = roster.slice(i, i + 6);
      await Promise.all(batch.map(async (pl) => {
        try {
          const stats = await espnGet(`${ESPN_CORE}/seasons/${season}/types/2/athletes/${pl.id}/statistics`);
          const season2025 = extractSeasonStats(stats);
          if (season2025.gamesPlayed == null || season2025.gamesPlayed < MIN_GAMES) return; // no 2025 sample
          const proj = projectPlayer(season2025, pl.pos);
          players.push({
            id: pl.id, name: pl.name, team: pl.team, pos: pl.pos,
            gamesPlayed: season2025.gamesPlayed,
            markets: POSITION_MARKETS[pl.pos] || [],
            projected: {
              pass_yds: proj.passYds, rush_yds: proj.rushYds,
              receptions: proj.receptions, rec_yds: proj.recYds,
            },
            season2025,
          });
        } catch (_) { statErrors++; }
      }));
    }
  }

  const result = {
    season,
    teamsProbed: teams.length,
    playersProjected: players.length,
    statErrors,
    note: "2025 season-average seed, regressed for thin samples. COARSE prior, shadow-only — not published. Dispersion for Over/Under is parametric pending a shadow-graded fit.",
    players: players.sort((a, b) => (b.projected.pass_yds || b.projected.rec_yds || 0) - (a.projected.pass_yds || a.projected.rec_yds || 0)),
  };
  cacheSet(key, result, 30 * 60 * 1000);
  return result;
}

module.exports = {
  extractSeasonStats,
  projectPlayer,
  overProb,
  buildPlayerProjections,
  POSITION_PRIORS,
  POSITION_MARKETS,
  MARKET_DISPERSION,
  _internal: { normalCDF, regressRate, num },
};
