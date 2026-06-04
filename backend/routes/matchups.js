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

module.exports = router;
