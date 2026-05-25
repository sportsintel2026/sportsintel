const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SR_KEY = process.env.SPORTRADAR_API_KEY;
const SR_BASE = "https://api.sportradar.com";

async function srGet(path) {
  const res = await axios.get(`${SR_BASE}${path}`, {
    params: { api_key: SR_KEY },
    timeout: 10000,
  });
  return res.data;
}

async function fetchMLBSchedule(date) {
  const [y, m, d] = date.split("-");
  const data = await srGet(`/mlb/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games || []).map(g => ({
    id: g.id,
    league: "mlb",
    away: `${g.away.market} ${g.away.name}`,
    home: `${g.home.market} ${g.home.name}`,
    awayId: g.away.id,
    homeId: g.home.id,
    awayScore: g.away_team?.runs ?? null,
    homeScore: g.home_team?.runs ?? null,
    status: g.status,
    time: new Date(g.scheduled).toLocaleTimeString("en-US", {hour:"numeric",minute:"2-digit",timeZone:"America/New_York"}) + " ET",
    venue: g.venue?.name || "",
    city: `${g.venue?.city || ""}, ${g.venue?.state || ""}`,
  }));
}

async function fetchNBASchedule(date) {
  const [y, m, d] = date.split("-");
  const data = await srGet(`/nba/trial/v8/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games || []).map(g => ({
    id: g.id,
    league: "nba",
    away: g.away.name,
    home: g.home.name,
    awayId: g.away.id,
    homeId: g.home.id,
    awayScore: g.away_points ?? null,
    homeScore: g.home_points ?? null,
    status: g.status,
    time: new Date(g.scheduled).toLocaleTimeString("en-US", {hour:"numeric",minute:"2-digit",timeZone:"America/New_York"}) + " ET",
    venue: g.venue?.name || "",
    city: `${g.venue?.city || ""}, ${g.venue?.state || ""}`,
  }));
}

async function fetchMLBBoxScore(gameId) {
  return await srGet(`/mlb/trial/v7/en/games/${gameId}/boxscore.json`);
}

async function fetchNBABoxScore(gameId) {
  return await srGet(`/nba/trial/v8/en/games/${gameId}/boxscore.json`);
}

async function fetchMLBPitcherVsBatter(pitcherId, batterId) {
  return await srGet(`/mlb/trial/v7/en/players/${pitcherId}/versus/${batterId}/statistics.json`);
}

async function fetchMLBRoster(teamId) {
  return await srGet(`/mlb/trial/v7/en/teams/${teamId}/roster.json`);
}

async function fetchNBARoster(teamId) {
  return await srGet(`/nba/trial/v8/en/teams/${teamId}/roster.json`);
}

async function cacheGames(league, date, games) {
  await supabase.from("games_cache").upsert({
    league, date,
    games: JSON.stringify(games),
    updated_at: new Date().toISOString(),
  }, { onConflict: "league,date" });
}

async function getCachedGames(league, date) {
  const { data } = await supabase
    .from("games_cache")
    .select("games, updated_at")
    .eq("league", league)
    .eq("date", date)
    .single();
  if (!data) return null;
  const age = Date.now() - new Date(data.updated_at).getTime();
  if (age > 5 * 60 * 1000) return null;
  return JSON.parse(data.games);
}

async function refreshDailyGames() {
  const today = new Date().toISOString().split("T")[0];
  try {
    const [mlb, nba] = await Promise.allSettled([
      fetchMLBSchedule(today),
      fetchNBASchedule(today),
    ]);
    if (mlb.status === "fulfilled") await cacheGames("mlb", today, mlb.value);
    if (nba.status === "fulfilled") await cacheGames("nba", today, nba.value);
    console.log("[Sports] Daily games refreshed successfully");
  } catch (err) {
    console.error("[Sports] Refresh failed:", err.message);
  }
}

module.exports = {
  fetchMLBSchedule,
  fetchNBASchedule,
  fetchMLBBoxScore,
  fetchNBABoxScore,
  fetchMLBPitcherVsBatter,
  fetchMLBRoster,
  fetchNBARoster,
  refreshDailyGames,
  getCachedGames,
  cacheGames,
};
