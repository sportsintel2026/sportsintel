const axios = require("axios");
const { supabase } = require("../middleware/auth");

const SR_BASE = "https://api.sportradar.com";
const SR_KEY = process.env.SPORTRADAR_API_KEY;

// ── Sportradar API helpers ─────────────────────────────────────────────────────
async function srGet(path) {
  const url = `${SR_BASE}${path}`;
  const res = await axios.get(url, {
    params: { api_key: SR_KEY },
    timeout: 10000,
  });
  return res.data;
}

// ── MLB ────────────────────────────────────────────────────────────────────────
async function fetchMLBSchedule(date) {
  // date format: YYYY/MM/DD
  const [year, month, day] = date.split("-");
  const data = await srGet(`/mlb/trial/v7/en/games/${year}/${month}/${day}/schedule.json`);
  return data.games || [];
}

async function fetchMLBBoxScore(gameId) {
  const data = await srGet(`/mlb/trial/v7/en/games/${gameId}/boxscore.json`);
  return data;
}

async function fetchMLBH2H(homeTeamId, awayTeamId) {
  const data = await srGet(`/mlb/trial/v7/en/teams/${homeTeamId}/versus/${awayTeamId}/statistics.json`);
  return data;
}

// ── NBA ────────────────────────────────────────────────────────────────────────
async function fetchNBASchedule(date) {
  const [year, month, day] = date.split("-");
  const data = await srGet(`/nba/trial/v8/en/games/${year}/${month}/${day}/schedule.json`);
  return data.games || [];
}

async function fetchNBABoxScore(gameId) {
  const data = await srGet(`/nba/trial/v8/en/games/${gameId}/boxscore.json`);
  return data;
}

// ── NFL ────────────────────────────────────────────────────────────────────────
async function fetchNFLSchedule(season, week) {
  const data = await srGet(`/nfl/official/trial/v7/en/games/${season}/REG/${week}/schedule.json`);
  return data.week?.games || [];
}

// ── Cache helpers (store in Supabase) ─────────────────────────────────────────
async function cacheGames(league, date, games) {
  const { error } = await supabase.from("games_cache").upsert({
    league,
    date,
    games: JSON.stringify(games),
    updated_at: new Date().toISOString(),
  }, { onConflict: "league,date" });

  if (error) console.error("Cache write error:", error.message);
}

async function getCachedGames(league, date) {
  const { data, error } = await supabase
    .from("games_cache")
    .select("games, updated_at")
    .eq("league", league)
    .eq("date", date)
    .single();

  if (error || !data) return null;

  // Cache is stale if older than 5 minutes
  const age = Date.now() - new Date(data.updated_at).getTime();
  if (age > 5 * 60 * 1000) return null;

  return JSON.parse(data.games);
}

// ── Main refresh function (called by cron) ────────────────────────────────────
async function refreshDailyGames() {
  const today = new Date().toISOString().split("T")[0];

  try {
    const [mlbGames, nbaGames] = await Promise.allSettled([
      fetchMLBSchedule(today),
      fetchNBASchedule(today),
    ]);

    if (mlbGames.status === "fulfilled") {
      await cacheGames("mlb", today, mlbGames.value);
    }
    if (nbaGames.status === "fulfilled") {
      await cacheGames("nba", today, nbaGames.value);
    }
  } catch (err) {
    console.error("refreshDailyGames error:", err.message);
    throw err;
  }
}

// ── Normalize game data to our format ─────────────────────────────────────────
function normalizeMLBGame(g) {
  return {
    id: g.id,
    league: "mlb",
    away: g.away?.name || g.away?.market + " " + g.away?.name,
    home: g.home?.name || g.home?.market + " " + g.home?.name,
    awayId: g.away?.id,
    homeId: g.home?.id,
    awayScore: g.away_team?.runs ?? null,
    homeScore: g.home_team?.runs ?? null,
    status: g.status,
    scheduledTime: g.scheduled,
    venue: g.venue?.name,
    city: g.venue?.city + ", " + g.venue?.state,
    inning: g.inning ? `${g.inning_half === "T" ? "Top" : "Bot"} ${g.inning}` : null,
  };
}

function normalizeNBAGame(g) {
  return {
    id: g.id,
    league: "nba",
    away: g.away?.name,
    home: g.home?.name,
    awayId: g.away?.id,
    homeId: g.home?.id,
    awayScore: g.away_points ?? null,
    homeScore: g.home_points ?? null,
    status: g.status,
    scheduledTime: g.scheduled,
    venue: g.venue?.name,
    city: g.venue?.city + ", " + g.venue?.state,
    quarter: g.quarter ?? null,
    clock: g.clock ?? null,
    seriesInfo: g.title || null,
  };
}

module.exports = {
  fetchMLBSchedule,
  fetchMLBBoxScore,
  fetchMLBH2H,
  fetchNBASchedule,
  fetchNBABoxScore,
  fetchNFLSchedule,
  refreshDailyGames,
  getCachedGames,
  cacheGames,
  normalizeMLBGame,
  normalizeNBAGame,
};
