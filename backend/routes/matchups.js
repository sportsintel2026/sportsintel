// Matchups route — lazy-loaded batter-vs-pitcher history for a single game
//
// GET /api/matchups/mlb/:gameId
//   Returns, for both starting pitchers, the opposing team's batters
//   who have career history against that pitcher (AVG / PA / H / HR).
//   Computed on-demand (one game at a time) and cached 30 min.

const express = require("express");
const router = express.Router();
const axios = require("axios");

const {
  getEasternDate,
  getScheduleForDate,
  getTeamRoster,
  getBatterSeasonStats,
  getTeamHittingAsOf,
  getPitcherEraAsOf,
  getTeamPitchingAsOf,
} = require("../services/mlbStatsApi");

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

// In-memory cache: gameId -> { data, fetchedAt }
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function parseIntSafe(v) {
  if (v == null || v === "") return 0;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

async function mlbGet(path, params = {}) {
  const res = await axios.get(`${MLB_BASE}${path}`, { params, timeout: 10000 });
  return res.data;
}

// For one batter vs one pitcher — career totals
async function batterVsPitcher(batterId, pitcherId) {
  try {
    const data = await mlbGet(`/people/${batterId}/stats`, {
      stats: "vsPlayer",
      group: "hitting",
      opposingPlayerId: pitcherId,
      sportId: 1,
    });
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;

    let t = { atBats: 0, plateAppearances: 0, hits: 0, homeRuns: 0, doubles: 0, triples: 0, walks: 0, rbi: 0, strikeouts: 0 };
    for (const sp of splits) {
      const s = sp.stat || {};
      t.atBats += parseIntSafe(s.atBats);
      t.plateAppearances += parseIntSafe(s.plateAppearances);
      t.hits += parseIntSafe(s.hits);
      t.homeRuns += parseIntSafe(s.homeRuns);
      t.doubles += parseIntSafe(s.doubles);
      t.triples += parseIntSafe(s.triples);
      t.walks += parseIntSafe(s.baseOnBalls);
      t.rbi += parseIntSafe(s.rbi);
      t.strikeouts += parseIntSafe(s.strikeOuts);
    }
    // Only include batters who have actually faced this pitcher
    if (t.plateAppearances === 0 && t.atBats === 0) return null;

    const avg = t.atBats > 0 ? t.hits / t.atBats : 0;
    const obp = (t.atBats + t.walks) > 0
      ? (t.hits + t.walks) / (t.atBats + t.walks)
      : 0;
    const slg = t.atBats > 0
      ? (t.hits + t.doubles + 2 * t.triples + 3 * t.homeRuns) / t.atBats
      : 0;

    return {
      atBats: t.atBats,
      plateAppearances: t.plateAppearances || t.atBats,
      hits: t.hits,
      homeRuns: t.homeRuns,
      rbi: t.rbi,
      walks: t.walks,
      strikeouts: t.strikeouts,
      avg,
      ops: obp + slg,
    };
  } catch (e) {
    return null;
  }
}

// Roster (batters) vs one pitcher — returns those with history, sorted by PA
async function rosterVsPitcher(teamId, pitcherId) {
  if (!teamId || !pitcherId) return [];
  const roster = await getTeamRoster(teamId); // hitters only

  // Run in small batches to avoid hammering the API
  const results = [];
  const BATCH = 5;
  for (let i = 0; i < roster.length; i += BATCH) {
    const batch = roster.slice(i, i + BATCH);
    const settled = await Promise.all(
      batch.map(async (b) => {
        const bvp = await batterVsPitcher(b.id, pitcherId);
        if (!bvp) return null;
        // Season line for context (the BvP sample is tiny). Only fetched for
        // batters who actually have history vs this pitcher. MLB free API.
        const season = await getBatterSeasonStats(b.id).catch(() => null);
        return { batterName: b.name, position: b.position, ...bvp, season };
      })
    );
    for (const r of settled) if (r) results.push(r);
  }

  // Sort by plate appearances desc (most history first)
  results.sort((a, b) => b.plateAppearances - a.plateAppearances);
  return results;
}

// GET /api/matchups/mlb/:gameId
router.get("/mlb/:gameId", async (req, res) => {
  const { gameId } = req.params;

  // Cache check
  const cached = cache.get(gameId);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    // Find the game in today's schedule to get team IDs + pitcher IDs
    const today = getEasternDate(0);
    const games = await getScheduleForDate(today);
    const game = games.find(g => String(g.id) === String(gameId));

    if (!game) {
      return res.status(404).json({ error: "Game not found in today's slate" });
    }

    const awayPitcher = game.awayProbable; // faces home batters
    const homePitcher = game.homeProbable; // faces away batters

    // Away batters vs home pitcher; home batters vs away pitcher
    const [awayBattersVsHomeP, homeBattersVsAwayP] = await Promise.all([
      homePitcher ? rosterVsPitcher(game.awayId, homePitcher.id) : Promise.resolve([]),
      awayPitcher ? rosterVsPitcher(game.homeId, awayPitcher.id) : Promise.resolve([]),
    ]);

    const result = {
      gameId,
      awayAbbr: game.awayAbbr,
      homeAbbr: game.homeAbbr,
      homePitcher: homePitcher ? { id: homePitcher.id, name: homePitcher.name } : null,
      awayPitcher: awayPitcher ? { id: awayPitcher.id, name: awayPitcher.name } : null,
      // batters from away team who have faced the home starter
      awayBattersVsHomePitcher: awayBattersVsHomeP,
      // batters from home team who have faced the away starter
      homeBattersVsAwayPitcher: homeBattersVsAwayP,
      computedAt: new Date().toISOString(),
      cached: false,
    };

    cache.set(gameId, { data: result, fetchedAt: Date.now() });
    res.json(result);
  } catch (err) {
    console.error("[matchups] error:", err.message);
    res.status(500).json({ error: "Failed to compute matchups", details: err.message });
  }
});

// TEMP backtest diagnostic — STEP 2: A/B test of the OFFENSE weight. READ-ONLY.
// Re-runs the moneyline win-prob model on PAST finished games using point-in-time
// stats (no lookahead) under two weightings and compares prediction accuracy:
//   Arm A (current):       offense^0.40 · pitcher^0.40 · bullpen^0.20
//   Arm B (offense-heavy): offense^0.55 · pitcher^0.30 · bullpen^0.15
// Only the offense exponent differs; pitcher/bullpen inputs are identical across
// arms, so the comparison isolates "does weighting season hitting more improve
// predictions?" Metric = log-loss (lower = better) + favorite accuracy. Each game
// also returns its raw point-in-time inputs so the data can be sanity-checked.
// NOTE: a real verdict needs ~150+ games — run several dates and aggregate.
// Usage: GET /api/matchups/backtest/2026-05-28  (optional ?days=3, max 3)
const BT_LG = { era: 4.30, ops: 0.720 };
const BT_WEIGHTS = { O: 0.40, P: 0.40, B: 0.20 }; // current weights (offense test settled: tied)
const BT_BOOSTS = [1.04, 1.10, 1.15];             // home-field boost candidates (current = 1.04)
function btHomeWinProb(g, w, homeBoost) {
  const pf = (era) => (era ? BT_LG.era / Math.max(era, 1.5) : 1.0);
  const of = (ops) => (ops ? ops / BT_LG.ops : 1.0);
  const bf = (era) => (era ? BT_LG.era / Math.max(era, 2.5) : 1.0);
  const aStr = Math.pow(pf(g.awayEra), w.P) * Math.pow(of(g.awayOps), w.O) * Math.pow(bf(g.awayPen), w.B);
  const hStr = Math.pow(pf(g.homeEra), w.P) * Math.pow(of(g.homeOps), w.O) * Math.pow(bf(g.homePen), w.B);
  const adjH = hStr * homeBoost;
  return adjH / (adjH + aStr);
}
function btLogLoss(p, homeWon) {
  const q = Math.max(1e-6, Math.min(1 - 1e-6, p));
  return homeWon ? -Math.log(q) : -Math.log(1 - q);
}
function newCalib() {
  const e = [0, 0.4, 0.45, 0.5, 0.55, 0.6, 1.01];
  return e.slice(0, -1).map((lo, i) => ({ lo, hi: e[i + 1], n: 0, predSum: 0, homeWins: 0 }));
}
router.get("/backtest/:date", async (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  const days = Math.max(1, Math.min(3, parseInt(req.query.days, 10) || 1));
  try {
    const dates = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(date + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      dates.push(d.toISOString().split("T")[0]);
    }
    const games = [];
    // One accumulator per HOME_BOOST candidate: log-loss, accuracy, calibration.
    const arms = BT_BOOSTS.map((hb) => ({ hb, ll: 0, correct: 0, n: 0, calib: newCalib() }));
    for (const gd of dates) {
      const sched = await getScheduleForDate(gd);
      const finished = (sched || []).filter((x) => x.homeScore != null && x.awayScore != null && x.homeScore !== x.awayScore);
      const ad = new Date(gd + "T12:00:00Z");
      ad.setUTCDate(ad.getUTCDate() - 1);
      const asOf = ad.toISOString().split("T")[0];
      for (const x of finished) {
        const [awayHit, homeHit, awayP, homeP, awayPen, homePen] = await Promise.all([
          getTeamHittingAsOf(x.awayId, asOf).catch(() => null),
          getTeamHittingAsOf(x.homeId, asOf).catch(() => null),
          x.awayProbable?.id ? getPitcherEraAsOf(x.awayProbable.id, asOf).catch(() => null) : null,
          x.homeProbable?.id ? getPitcherEraAsOf(x.homeProbable.id, asOf).catch(() => null) : null,
          getTeamPitchingAsOf(x.awayId, asOf).catch(() => null),
          getTeamPitchingAsOf(x.homeId, asOf).catch(() => null),
        ]);
        const inputs = {
          awayOps: awayHit?.ops ?? null, homeOps: homeHit?.ops ?? null,
          awayEra: awayP?.era ?? null, homeEra: homeP?.era ?? null,
          awayPen: awayPen?.era ?? null, homePen: homePen?.era ?? null,
        };
        const homeWon = x.homeScore > x.awayScore;
        const usable = inputs.awayOps != null && inputs.homeOps != null && inputs.awayEra != null && inputs.homeEra != null;
        let pCurrent = null;
        if (usable) {
          for (const arm of arms) {
            const p = btHomeWinProb(inputs, BT_WEIGHTS, arm.hb);
            arm.ll += btLogLoss(p, homeWon); arm.n++; if ((p > 0.5) === homeWon) arm.correct++;
            const cb = arm.calib.find((b) => p >= b.lo && p < b.hi);
            if (cb) { cb.n++; cb.predSum += p; cb.homeWins += homeWon ? 1 : 0; }
            if (arm.hb === 1.04) pCurrent = p;
          }
        }
        games.push({
          date: gd, matchup: `${x.awayAbbr} @ ${x.homeAbbr}`, final: `${x.awayScore}-${x.homeScore}`,
          winner: homeWon ? "home" : "away", usable, ...inputs,
          probHome_current: pCurrent != null ? +pCurrent.toFixed(3) : null,
        });
      }
    }
    const fmtCalib = (calib) => calib.filter((b) => b.n > 0).map((b) => ({
      bucket: `${b.lo.toFixed(2)}-${(b.hi > 1 ? 1 : b.hi).toFixed(2)}`,
      n: b.n,
      predictedHome: +((b.predSum / b.n) * 100).toFixed(0),
      actualHomeWin: +((b.homeWins / b.n) * 100).toFixed(0),
    }));
    const results = arms.map((a) => {
      const predSum = a.calib.reduce((s, b) => s + b.predSum, 0);
      const winSum = a.calib.reduce((s, b) => s + b.homeWins, 0);
      return {
        homeBoost: a.hb,
        label: a.hb === 1.04 ? "current" : "candidate",
        games: a.n,
        logLoss: a.n ? +(a.ll / a.n).toFixed(4) : null,
        accuracy: a.n ? +((a.correct / a.n) * 100).toFixed(1) : null,
        overallPredictedHome: a.n ? +((predSum / a.n) * 100).toFixed(1) : null,
        overallActualHome: a.n ? +((winSum / a.n) * 100).toFixed(1) : null,
        calibration: fmtCalib(a.calib),
      };
    });
    res.json({
      note: "TEMP backtest — HOME_BOOST A/B. Tests 1.04 (current) vs 1.10 vs 1.15. Best boost should (1) make overallPredictedHome ≈ overallActualHome, and (2) have the LOWEST logLoss. One run is NOT a verdict; aggregate ~250+ games. Raw point-in-time inputs (no thin-sample regression), so noisier than the live model.",
      datesCovered: dates,
      weightsUsed: BT_WEIGHTS,
      results,
      games,
    });
  } catch (err) {
    console.error("[matchups backtest] failed:", err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
