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

function parseMLBGame(g) {
  const awayScore = g.away_team?.runs ?? g.away?.runs ?? null;
  const homeScore = g.home_team?.runs ?? g.home?.runs ?? null;
  const status = g.status;
  let displayStatus = status;
  if (status === "inprogress") displayStatus = "live";
  if (status === "closed") displayStatus = "final";
  if (status === "scheduled") displayStatus = "scheduled";

  return {
    id: g.id,
    league: "mlb",
    away: `${g.away?.market||""} ${g.away?.name||""}`.trim(),
    home: `${g.home?.market||""} ${g.home?.name||""}`.trim(),
    awayId: g.away?.id,
    homeId: g.home?.id,
    awayScore,
    homeScore,
    status: displayStatus,
    inning: g.inning ? `${g.inning_half==="T"?"Top":"Bot"} ${g.inning}` : null,
    time: new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue: g.venue?.name||"",
    city: `${g.venue?.city||""}, ${g.venue?.state||""}`,
  };
}

function parseNBAGame(g) {
  return {
    id: g.id,
    league: "nba",
    away: g.away?.name||"",
    home: g.home?.name||"",
    awayId: g.away?.id,
    homeId: g.home?.id,
    awayScore: g.away_points ?? null,
    homeScore: g.home_points ?? null,
    status: g.status==="inprogress"?"live":g.status==="closed"?"final":g.status,
    quarter: g.quarter??null,
    clock: g.clock??null,
    time: new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
    venue: g.venue?.name||"",
    city: `${g.venue?.city||""}, ${g.venue?.state||""}`,
  };
}

async function fetchMLBSchedule(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/mlb/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games||[]).map(parseMLBGame);
}

async function fetchMLBBoxScore(gameId) {
  const data = await srGet(`/mlb/trial/v7/en/games/${gameId}/boxscore.json`);
  const away = (data.game?.away?.players||[]).filter(p=>p.statistics).slice(0,9).map(p=>({
    name: `${p.preferred_name||p.first_name} ${p.last_name}`,
    pos: p.primary_position||"",
    ab: p.statistics?.hitting?.ab??"-",
    h: p.statistics?.hitting?.hits??"-",
    r: p.statistics?.hitting?.runs??"-",
    rbi: p.statistics?.hitting?.rbi??"-",
    hr: p.statistics?.hitting?.hr??"-",
    avg: p.statistics?.hitting?.avg??"-",
  }));
  const home = (data.game?.home?.players||[]).filter(p=>p.statistics).slice(0,9).map(p=>({
    name: `${p.preferred_name||p.first_name} ${p.last_name}`,
    pos: p.primary_position||"",
    ab: p.statistics?.hitting?.ab??"-",
    h: p.statistics?.hitting?.hits??"-",
    r: p.statistics?.hitting?.runs??"-",
    rbi: p.statistics?.hitting?.rbi??"-",
    hr: p.statistics?.hitting?.hr??"-",
    avg: p.statistics?.hitting?.avg??"-",
  }));
  return {
    away,
    home,
    awayScore: data.game?.away?.runs??null,
    homeScore: data.game?.home?.runs??null,
    inning: data.game?.inning,
    inningHalf: data.game?.inning_half,
  };
}

async function fetchNBASchedule(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/nba/trial/v8/en/games/${y}/${m}/${d}/schedule.json`);
  return (data.games||[]).map(parseNBAGame);
}

async function fetchNBABoxScore(gameId) {
  const data = await srGet(`/nba/trial/v8/en/games/${gameId}/boxscore.json`);
  const fmt = (players=[]) => players.slice(0,8).map(p=>({
    name: `${p.full_name||p.last_name}`,
    pos: p.position||"",
    min: p.statistics?.minutes||"-",
    pts: p.statistics?.points??"-",
    reb: p.statistics?.rebounds??"-",
    ast: p.statistics?.assists??"-",
    stl: p.statistics?.steals??"-",
    blk: p.statistics?.blocks??"-",
  }));
  return {
    away: fmt(data.game?.away?.players),
    home: fmt(data.game?.home?.players),
    awayScore: data.game?.away_points??null,
    homeScore: data.game?.home_points??null,
  };
}

async function fetchNHLSchedule(date) {
  const [y,m,d] = date.split("-");
  try {
    const data = await srGet(`/nhl/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
    return (data.games||[]).map(g=>({
      id:g.id, league:"nhl",
      away:`${g.away?.market||""} ${g.away?.name||""}`.trim(),
      home:`${g.home?.market||""} ${g.home?.name||""}`.trim(),
      awayScore:g.away_team?.points??null,
      homeScore:g.home_team?.points??null,
      status:g.status==="inprogress"?"live":g.status==="closed"?"final":g.status,
      time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
      venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
    }));
  } catch { return []; }
}

async function fetchSoccerSchedule(date) {
  try {
    const data = await srGet(`/soccer/trial/v4/en/schedules/${date}/schedule.json`);
    return (data.sport_events||[]).slice(0,20).map(g=>({
      id:g.id, league:"soccer",
      away:g.competitors?.find(c=>c.qualifier==="away")?.name||"Away",
      home:g.competitors?.find(c=>c.qualifier==="home")?.name||"Home",
      awayScore:g.sport_event_status?.away_score??null,
      homeScore:g.sport_event_status?.home_score??null,
      status:g.sport_event_status?.status||"scheduled",
      time:new Date(g.start_time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
      venue:g.venue?.name||"", city:g.venue?.city_name||"",
    }));
  } catch { return []; }
}

async function fetchMMASchedule() {
  try {
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
  } catch { return []; }
}

async function fetchGolfSchedule() {
  try {
    const data = await srGet(`/golf/trial/v3/en/schedules/current_season/schedule.json`);
    return (data.tournaments||[]).slice(0,5).map(g=>({
      id:g.id, league:"golf",
      away:"View Leaderboard", home:g.name||"Tournament",
      awayScore:null, homeScore:null,
      status:g.status||"scheduled",
      time:new Date(g.start_date).toLocaleDateString("en-US"),
      venue:g.venue?.name||"", city:g.venue?.city||"",
    }));
  } catch { return []; }
}

async function fetchNCAAMBSchedule(date) {
  try {
    const [y,m,d] = date.split("-");
    const data = await srGet(`/ncaamb/trial/v8/en/games/${y}/${m}/${d}/schedule.json`);
    return (data.games||[]).map(g=>({
      id:g.id, league:"ncaamb",
      away:`${g.away?.market||""} ${g.away?.name||""}`.trim(),
      home:`${g.home?.market||""} ${g.home?.name||""}`.trim(),
      awayScore:g.away_points??null, homeScore:g.home_points??null,
      status:g.status==="inprogress"?"live":g.status==="closed"?"final":g.status,
      time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
      venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
    }));
  } catch { return []; }
}

async function fetchNCAAWBSchedule(date) {
  try {
    const [y,m,d] = date.split("-");
    const data = await srGet(`/ncaawb/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
    return (data.games||[]).map(g=>({
      id:g.id, league:"ncaawb",
      away:`${g.away?.market||""} ${g.away?.name||""}`.trim(),
      home:`${g.home?.market||""} ${g.home?.name||""}`.trim(),
      awayScore:g.away_points??null, homeScore:g.home_points??null,
      status:g.status==="inprogress"?"live":g.status==="closed"?"final":g.status,
      time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
      venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
    }));
  } catch { return []; }
}

async function fetchNCAAFBSchedule(date) {
  try {
    const [y,m,d] = date.split("-");
    const data = await srGet(`/ncaafb/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
    return (data.games||[]).map(g=>({
      id:g.id, league:"ncaafb",
      away:`${g.away?.market||""} ${g.away?.name||""}`.trim(),
      home:`${g.home?.market||""} ${g.home?.name||""}`.trim(),
      awayScore:g.away_points??null, homeScore:g.home_points??null,
      status:g.status==="inprogress"?"live":g.status==="closed"?"final":g.status,
      time:new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
      venue:g.venue?.name||"", city:`${g.venue?.city||""}, ${g.venue?.state||""}`,
    }));
  } catch { return []; }
}

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
  if (Date.now()-new Date(data.updated_at).getTime() > 3*60*1000) return null;
  return JSON.parse(data.games);
}

async function refreshDailyGames() {
  // Anchor "today" to Eastern time, NOT UTC. toISOString() is always UTC, so
  // after ~8pm ET (= midnight UTC) it rolls to TOMORROW's date and we'd query
  // the wrong day's schedule — e.g. a live NBA game at 8:34pm ET returned
  // "0 games" because UTC had already flipped to the next day. en-CA gives
  // YYYY-MM-DD; the whole app is ET-anchored (cron tz, game times, grading).
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const fetchers = [
    {league:"mlb",fn:()=>fetchMLBSchedule(today)},
    {league:"nba",fn:()=>fetchNBASchedule(today)},
    {league:"nhl",fn:()=>fetchNHLSchedule(today)},
    {league:"soccer",fn:()=>fetchSoccerSchedule(today)},
    {league:"ncaamb",fn:()=>fetchNCAAMBSchedule(today)},
    {league:"ncaawb",fn:()=>fetchNCAAWBSchedule(today)},
    {league:"ncaafb",fn:()=>fetchNCAAFBSchedule(today)},
    {league:"mma",fn:fetchMMASchedule},
    {league:"golf",fn:fetchGolfSchedule},
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
  fetchMLBSchedule, fetchNBASchedule, fetchNHLSchedule,
  fetchSoccerSchedule, fetchMMASchedule, fetchGolfSchedule,
  fetchNCAAMBSchedule, fetchNCAAWBSchedule, fetchNCAAFBSchedule,
  fetchMLBBoxScore, fetchNBABoxScore,
  refreshDailyGames, getCachedGames, cacheGames,
};
