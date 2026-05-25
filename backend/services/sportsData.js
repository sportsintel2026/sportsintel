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

// ── MLB ──────────────────────────────────────────────────────────────────────
async function fetchMLBSchedule(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/mlb/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games||[]).map(g=>({
    id:g.id, league:"mlb",
    away:`${g.away.market} ${g.away.name}`,
    home:`${g.home.market} ${g.home.name}`,
    awayId:g.away.id, homeId:g.home.id,
    awayScore:g.away_team?.runs??null,
    homeScore:g.home_team?.runs??null,
    status:g.status,
    time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
  }));
}

// ── NBA ──────────────────────────────────────────────────────────────────────
async function fetchNBASchedule(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/nba/trial/v8/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games||[]).map(g=>({
    id:g.id, league:"nba",
    away:g.away.name, home:g.home.name,
    awayId:g.away.id, homeId:g.home.id,
    awayScore:g.away_points??null, homeScore:g.home_points??null,
    status:g.status,
    time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
  }));
}

// ── NFL ──────────────────────────────────────────────────────────────────────
async function fetchNFLSchedule(date) {
  const data = await srGet(`/nfl/official/trial/v7/en/games/${date}/schedule.json`);
  return (data.games||[]).map(g=>({
    id:g.id, league:"nfl",
    away:`${g.away.market} ${g.away.name}`,
    home:`${g.home.market} ${g.home.name}`,
    awayScore:g.away_points??null, homeScore:g.home_points??null,
    status:g.status,
    time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
  }));
}

// ── NHL ──────────────────────────────────────────────────────────────────────
async function fetchNHLSchedule(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/nhl/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games||[]).map(g=>({
    id:g.id, league:"nhl",
    away:`${g.away.market} ${g.away.name}`,
    home:`${g.home.market} ${g.home.name}`,
    awayScore:g.away_points??null, homeScore:g.home_points??null,
    status:g.status,
    time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
  }));
}

// ── Soccer/MLS ───────────────────────────────────────────────────────────────
async function fetchSoccerSchedule(date) {
  const data = await srGet(`/soccer/trial/v4/en/schedules/${date}/schedule.json`);
  return (data.sport_events||[]).map(g=>({
    id:g.id, league:"soccer",
    away:g.competitors?.find(c=>c.qualifier==="away")?.name||"Away",
    home:g.competitors?.find(c=>c.qualifier==="home")?.name||"Home",
    awayScore:g.sport_event_status?.away_score??null,
    homeScore:g.sport_event_status?.home_score??null,
    status:g.sport_event_status?.status||"scheduled",
    time:new Date(g.start_time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue:g.venue?.name||"", city:g.venue?.city_name||"",
  }));
}

// ── MMA ──────────────────────────────────────────────────────────────────────
async function fetchMMASchedule() {
  const data = await srGet(`/mma/trial/v2/en/schedules/upcoming/schedule.json`);
  return (data.sport_events||[]).slice(0,10).map(g=>({
    id:g.id, league:"mma",
    away:g.competitors?.[0]?.name||"Fighter 1",
    home:g.competitors?.[1]?.name||"Fighter 2",
    awayScore:null, homeScore:null,
    status:g.sport_event_status?.status||"scheduled",
    time:new Date(g.start_time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue:g.venue?.name||"", city:g.venue?.city_name||"",
  }));
}

// ── Golf/PGA ─────────────────────────────────────────────────────────────────
async function fetchGolfSchedule() {
  const data = await srGet(`/golf/trial/v3/en/schedules/current_season/schedule.json`);
  return (data.tournaments||[]).slice(0,5).map(g=>({
    id:g.id, league:"golf",
    away:"View Leaderboard", home:g.name||"Tournament",
    awayScore:null, homeScore:null,
    status:g.status||"scheduled",
    time:new Date(g.start_date).toLocaleDateString("en-US"),
    venue:g.venue?.name||"", city:g.venue?.city||"",
  }));
}

// ── College Basketball ────────────────────────────────────────────────────────
async function fetchNCAAMBSchedule(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/ncaamb/trial/v8/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games||[]).map(g=>({
    id:g.id, league:"ncaamb",
    away:`${g.away.market} ${g.away.name}`,
    home:`${g.home.market} ${g.home.name}`,
    awayScore:g.away_points??null, homeScore:g.home_points??null,
    status:g.status,
    time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
  }));
}

async function fetchNCAAWBSchedule(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/ncaawb/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games||[]).map(g=>({
    id:g.id, league:"ncaawb",
    away:`${g.away.market} ${g.away.name}`,
    home:`${g.home.market} ${g.home.name}`,
    awayScore:g.away_points??null, homeScore:g.home_points??null,
    status:g.status,
    time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
  }));
}

// ── College Football ─────────────────────────────────────────────────────────
async function fetchNCAAFBSchedule(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/ncaafb/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games||[]).map(g=>({
    id:g.id, league:"ncaafb",
    away:`${g.away.market} ${g.away.name}`,
    home:`${g.home.market} ${g.home.name}`,
    awayScore:g.away_points??null, homeScore:g.home_points??null,
    status:g.status,
    time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
  }));
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
async function cacheGames(league, date, games) {
  await supabase.from("games_cache").upsert({
    league, date, games:JSON.stringify(games),
    updated_at:new Date().toISOString(),
  },{onConflict:"league,date"});
}

async function getCachedGames(league, date) {
  const {data} = await supabase
    .from("games_cache").select("games,updated_at")
    .eq("league",league).eq("date",date).single();
  if (!data) return null;
  if (Date.now()-new Date(data.updated_at).getTime() > 5*60*1000) return null;
  return JSON.parse(data.games);
}

async function refreshDailyGames() {
  const today = new Date().toISOString().split("T")[0];
  const fetchers = [
    {league:"mlb", fn:()=>fetchMLBSchedule(today)},
    {league:"nba", fn:()=>fetchNBASchedule(today)},
    {league:"nhl", fn:()=>fetchNHLSchedule(today)},
    {league:"soccer", fn:()=>fetchSoccerSchedule(today)},
    {league:"ncaamb", fn:()=>fetchNCAAMBSchedule(today)},
    {league:"ncaawb", fn:()=>fetchNCAAWBSchedule(today)},
    {league:"ncaafb", fn:()=>fetchNCAAFBSchedule(today)},
    {league:"mma", fn:fetchMMASchedule},
    {league:"golf", fn:fetchGolfSchedule},
  ];
  for (const {league,fn} of fetchers) {
    try {
      const games = await fn();
      await cacheGames(league, today, games);
      console.log(`[Sports] ${league} refreshed - ${games.length} games`);
    } catch(err) {
      console.error(`[Sports] ${league} failed:`, err.message);
    }
  }
}

module.exports = {
  fetchMLBSchedule, fetchNBASchedule, fetchNFLSchedule, fetchNHLSchedule,
  fetchSoccerSchedule, fetchMMASchedule, fetchGolfSchedule,
  fetchNCAAMBSchedule, fetchNCAAWBSchedule, fetchNCAAFBSchedule,
  refreshDailyGames, getCachedGames, cacheGames,
};
