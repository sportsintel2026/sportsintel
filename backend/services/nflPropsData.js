// WZ-NFLPROPSDATA-V2-2026-07-05
// nflPropsData.js  —  WizePicks NFL Player Props projection engine (Phase 3, v1.1).
//
// Turns ESPN's 2025 core-API athlete statistics into per-game projections for the
// core prop markets (pass yds / rush yds / receptions / receiving yds), plus a
// helper to convert a projected mean + a book line into an Over probability.
//
// v1.1 fixes (from eyeballing the first live run):
//   - MARKET-PARTICIPANT GATES: only project a market when the player has real
//     volume in it (a passer needs pass attempts, a receiver targets, a runner
//     carries). Books only post props for real participants; so do we. This kills
//     the "backup QB who threw 2 passes projects 143 yds" nonsense at the source.
//   - HONEST NULLS: a missing underlying stat yields a NULL projection, never a
//     league-average prior. No fabricated numbers under a real player's name.
//   - THIN-SAMPLE-ONLY REGRESSION: full-season workhorses reflect their real per-game
//     production; only genuinely small samples get pulled toward the positional prior.
//   - FETCH BACKOFF: capped concurrency + one retry, so we stop dropping ~60 players
//     to ESPN throttling.
//
// HONESTY: still a 2025 SEASON-AVERAGE seed. Props are dominated by snap/target share,
// injuries, game script and the defense faced — none of which a season average knows —
// so this is a COARSE baseline that publishes NOTHING. It feeds a shadow logger that
// grades silently in-season; the parametric dispersion below is replaced by a fit from
// real graded actuals. No fabricated edges.
//
// The pure functions (extractSeasonStats / projectPlayer / overProb / marketEligible)
// are unit-tested offline against a real athlete payload; buildPlayerProjections does
// the live roster->stats orchestration and is validated by running the diagnostic route.
//
// CommonJS. Requires Node 18+.

const axios = require("axios");

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const TIMEOUT_MS = 9000;

// Thin-sample regression: blend a player's own per-game rate with a positional prior,
// weighting the prior as K "pseudo-games". K is SMALL for established samples so a
// 17-game workhorse barely moves; larger for thin samples so a 3-game fluke is tamed.
const REGRESSION_K_THIN = 4;   // < THIN_GP games: protect against small-sample noise
const REGRESSION_K_FULL = 1.5; // >= THIN_GP games: reflect real production
const THIN_GP = 8;
const MIN_GAMES = 1;

// Per-game positional priors (league-typical). ANCHORS for thin samples only, never a
// standalone published value — a market with no real volume is skipped, not priored.
const POSITION_PRIORS = {
  QB: { passYds: 215, rushYds: 12, receptions: 0, recYds: 0 },
  RB: { passYds: 0, rushYds: 48, receptions: 2.4, recYds: 18 },
  WR: { passYds: 0, rushYds: 2, receptions: 3.8, recYds: 46 },
  TE: { passYds: 0, rushYds: 0, receptions: 3.2, recYds: 32 },
};
const DEFAULT_PRIOR = POSITION_PRIORS.WR;

// Which markets a position is eligible for (never project a QB's receptions).
const POSITION_MARKETS = {
  QB: ["pass_yds"],
  RB: ["rush_yds", "receptions", "rec_yds"],
  WR: ["receptions", "rec_yds"],
  TE: ["receptions", "rec_yds"],
};
const PROJECTED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

// MARKET-PARTICIPANT gates: minimum SEASON volume (on a ~17-game basis) for the
// player to count as a real participant in that market. Below this, props are not
// realistically posted and the sample is too thin to seed — skip the market entirely.
const MARKET_MIN_VOLUME = {
  pass_yds:   { field: "passAtt", min: 100 },  // a real passer, not a clipboard QB
  rush_yds:   { field: "rushAtt", min: 40 },   // a real ball-carrier
  receptions: { field: "targets", min: 25 },   // a real pass-catcher
  rec_yds:    { field: "targets", min: 25 },
};

// v1 parametric dispersion (SD = CV * mean, with a floor). Placeholder pending a fit
// from shadow-graded actuals; used only when a book line arrives to make an Over prob.
const MARKET_DISPERSION = {
  pass_yds: { cv: 0.28, minSd: 35 },
  rush_yds: { cv: 0.55, minSd: 18 },
  receptions: { cv: 0.45, minSd: 1.4 },
  rec_yds: { cv: 0.60, minSd: 15 },
};

// which raw season field feeds each market
const MARKET_SRC = { pass_yds: "passYds", rush_yds: "rushYds", receptions: "receptions", rec_yds: "recYds" };
const MARKET_PRIOR = { pass_yds: "passYds", rush_yds: "rushYds", receptions: "receptions", rec_yds: "recYds" };

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

// ── PURE: is a player a real participant in this market? (volume gate) ───────────
function marketEligible(season, market) {
  const g = MARKET_MIN_VOLUME[market];
  if (!g || !season) return false;
  const v = season[g.field];
  return v != null && v >= g.min;
}

// ── PURE: project one stat's per-game mean, regressed only for thin samples ──────
// Returns null if the underlying total is missing (NO prior fabrication) or the
// sample is empty. A real total (even small/negative) is trusted, shrunk by sample.
function projectStat(total, gp, prior) {
  if (total == null || gp == null || gp < MIN_GAMES) return null;
  const rate = total / gp;
  if (prior == null) return rate;
  const K = gp >= THIN_GP ? REGRESSION_K_FULL : REGRESSION_K_THIN;
  return (gp * rate + K * prior) / (gp + K);
}

// ── PURE: full per-market projection for one player (gated) ──────────────────────
function projectPlayer(season, position) {
  const prior = POSITION_PRIORS[position] || DEFAULT_PRIOR;
  const gp = season.gamesPlayed;
  const posMarkets = POSITION_MARKETS[position] || [];
  const projected = { pass_yds: null, rush_yds: null, receptions: null, rec_yds: null };
  const eligibleMarkets = [];
  for (const mkt of posMarkets) {
    if (!marketEligible(season, mkt)) continue;
    const val = projectStat(season[MARKET_SRC[mkt]], gp, prior[MARKET_PRIOR[mkt]]);
    if (val == null) continue;
    projected[mkt] = round(val, mkt === "receptions" ? 2 : 1);
    eligibleMarkets.push(mkt);
  }
  return { gamesPlayed: gp, eligibleMarkets, projected };
}

// ── PURE: projected mean + book line -> Over probability (v1 parametric) ─────────
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
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function espnGet(url, retries = 1) {
  try {
    const res = await axios.get(url, { timeout: TIMEOUT_MS, headers: { "User-Agent": UA, Accept: "application/json" } });
    return res.data;
  } catch (e) {
    if (retries > 0) { await sleep(300); return espnGet(url, retries - 1); }
    throw e;
  }
}

const _cache = new Map();
function cacheGet(k) { const h = _cache.get(k); if (h && h.exp > Date.now()) return h.v; _cache.delete(k); return null; }
function cacheSet(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

const FETCH_CONCURRENCY = 4;

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
  let skippedNoMarket = 0;

  for (const tm of teams) {
    let roster = [];
    try {
      const data = await espnGet(`${ESPN_SITE}/teams/${tm.id}/roster`);
      for (const g of data.athletes || []) {
        const items = Array.isArray(g.items) ? g.items : (g.id ? [g] : []);
        for (const a of items) {
          const pos = a.position && a.position.abbreviation;
          if (a.id && PROJECTED_POSITIONS.has(pos)) roster.push({ id: a.id, name: a.fullName || a.displayName, pos, team: tm.abbreviation });
        }
      }
    } catch (_) { continue; }

    for (let i = 0; i < roster.length; i += FETCH_CONCURRENCY) {
      const batch = roster.slice(i, i + FETCH_CONCURRENCY);
      await Promise.all(batch.map(async (pl) => {
        try {
          const stats = await espnGet(`${ESPN_CORE}/seasons/${season}/types/2/athletes/${pl.id}/statistics`);
          const season2025 = extractSeasonStats(stats);
          if (season2025.gamesPlayed == null || season2025.gamesPlayed < MIN_GAMES) return;
          const proj = projectPlayer(season2025, pl.pos);
          if (proj.eligibleMarkets.length === 0) { skippedNoMarket++; return; } // not a real market participant
          players.push({
            id: pl.id, name: pl.name, team: pl.team, pos: pl.pos,
            gamesPlayed: season2025.gamesPlayed,
            markets: proj.eligibleMarkets,
            projected: proj.projected,
            season2025,
          });
        } catch (_) { statErrors++; }
      }));
      await sleep(120); // gentle pacing to avoid ESPN throttling
    }
  }

  const result = {
    season,
    teamsProbed: teams.length,
    playersProjected: players.length,
    statErrors,
    skippedNoMarket,
    note: "v1.1: market-participant gated, honest nulls, thin-sample-only regression. 2025 season-average seed, shadow-only — publishes nothing. Over/Under dispersion is parametric pending a shadow-graded fit.",
    players: players.sort((a, b) =>
      (b.projected.pass_yds || b.projected.rush_yds || b.projected.rec_yds || 0) -
      (a.projected.pass_yds || a.projected.rush_yds || a.projected.rec_yds || 0)),
  };
  cacheSet(key, result, 30 * 60 * 1000);
  return result;
}

module.exports = {
  extractSeasonStats,
  marketEligible,
  projectStat,
  projectPlayer,
  overProb,
  buildPlayerProjections,
  POSITION_PRIORS,
  POSITION_MARKETS,
  MARKET_MIN_VOLUME,
  MARKET_DISPERSION,
  _internal: { normalCDF, num },
};
