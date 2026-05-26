const express = require("express");
const router = express.Router();
const axios = require("axios");
const { getCachedGames, cacheGames } = require("../services/sportsData");

const SR_KEY = process.env.SPORTRADAR_API_KEY;
const SR_BASE = "https://api.sportradar.com";

async function srGet(path) {
  const res = await axios.get(`${SR_BASE}${path}`, {
    params: { api_key: SR_KEY },
    timeout: 15000,
  });
  return res.data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Get US Eastern date string
function getEasternDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function getMLBGamesWithScores(date) {
  const [y,m,d] = date.split("-");
  
  // Use summary endpoint - returns ALL games with scores in one call!
  const data = await srGet(`/mlb/trial/v7/en/games/${y}/${m}/${d}/summary.json`);
  const games = data.league?.games || [];
  
  return games.map(item => {
    const g = item.game || item;
    const away = g.away || {};
    const home = g.home || {};
    
    let inning = null;
    if (g.status === "inprogress" && g.outcome) {
      inning = `${g.outcome.current_inning_half==="T"?"Top":"Bot"} ${g.outcome.current_inning}`;
    }

    return {
      id: g.id, league: "mlb",
      away: `${away.market||""} ${away.name||""}`.trim(),
      home: `${home.market||""} ${home.name||""}`.trim(),
      awayId: away.id, homeId: home.id,
      awayScore: away.runs ?? null,
      homeScore: home.runs ?? null,
      weather: null,
      status: g.status==="inprogress"?"live":g.status==="closed"?"final":"scheduled",
      inning,
      date,
      time: new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
      venue: g.venue?.name||"",
      city: `${g.venue?.city||""}, ${g.venue?.state||""}`,
    };
  });
}

async function getNBAGamesWithScores(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/nba/trial/v8/en/games/${y}/${m}/${d}/schedule.json`);
  const games = data.games || [];
  const results = [];

  for (const g of games) {
    let awayScore = g.away_points ?? null;
    let homeScore = g.home_points ?? null;

    if ((g.status === "closed" || g.status === "inprogress") && awayScore === null) {
      try {
        await sleep(300);
        const box = await srGet(`/nba/trial/v8/en/games/${g.id}/boxscore.json`);
        awayScore = box.game?.away_points ?? null;
        homeScore = box.game?.home_points ?? null;
      } catch(e) {}
    }

    results.push({
      id: g.id, league: "nba",
      away: g.away?.name||"", home: g.home?.name||"",
      awayId: g.away?.id, homeId: g.home?.id,
      awayScore, homeScore,
      status: g.status==="inprogress"?"live":g.status==="closed"?"final":"scheduled",
      quarter: g.quarter??null, clock: g.clock??null,
      date,
      time: new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
      venue: g.venue?.name||"",
      city: `${g.venue?.city||""}, ${g.venue?.state||""}`,
    });
  }
  return results;
}

router.get("/:league/today", async (req, res) => {
  try {
    const { league } = req.params;
    const today = getEasternDate(0);
    const tomorrow = getEasternDate(1);
    let games = [];

    if (league === "mlb") {
      // Fetch today and tomorrow
      const [todayGames, tomorrowGames] = await Promise.all([
        getMLBGamesWithScores(today),
        getMLBGamesWithScores(tomorrow),
      ]);
      // Combine — today's games first, then tomorrow's scheduled
      games = [
        ...todayGames,
        ...tomorrowGames.filter(g => g.status === "scheduled"),
      ];
      await cacheGames(league, today, games);
    } else if (league === "nba") {
      const [todayGames, tomorrowGames] = await Promise.all([
        getNBAGamesWithScores(today),
        getNBAGamesWithScores(tomorrow),
      ]);
      games = [
        ...todayGames,
        ...tomorrowGames.filter(g => g.status === "scheduled"),
      ];
      await cacheGames(league, today, games);
    } else if (league === "nfl") {
      return res.json({ games: [], message: "NFL season starts September 2026" });
    } else {
      const cached = await getCachedGames(league, today);
      if (cached) return res.json({ games: cached, date: today, league });
      return res.json({ games: [], message: `No ${league} games available` });
    }

    res.json({ games, date: today, league });
  } catch (err) {
    console.error("GET /games error:", err.message);
    res.status(500).json({ error: "Failed to fetch games", details: err.message });
  }
});

router.get("/:league/:gameId/boxscore", async (req, res) => {
  try {
    const { league, gameId } = req.params;
    let result;

    if (league === "mlb") {
      const data = await srGet(`/mlb/trial/v7/en/games/${gameId}/boxscore.json`);
      const game = data.game;
      const away = game?.away;
      const home = game?.home;

      const parseInnings = (scoring=[]) => scoring
        .filter(s=>s.type==="inning")
        .map(s=>({ inning:s.number, runs:s.runs, hits:s.hits, errors:s.errors }));

      const parsePitcher = (p) => p ? {
        name: p.full_name||`${p.preferred_name||""} ${p.last_name||""}`.trim(),
        win: p.win??"-", loss: p.loss??"-", era: p.era??"-",
      } : null;

      let weather = null;
      if (game?.weather) {
        const w = game.weather.current_conditions || game.weather.forecast;
        weather = {
          temp: w?.temp_f ? `${w.temp_f}°F` : null,
          condition: w?.condition||null,
          humidity: w?.humidity ? `${w.humidity}%` : null,
          wind: w?.wind ? `${w.wind.speed_mph} mph ${w.wind.direction}` : null,
          cloudCover: w?.cloud_cover ? `${w.cloud_cover}%` : null,
        };
      }

      let inning = null;
      let count = null;
      if (game?.outcome) {
        const o = game.outcome;
        inning = `${o.current_inning_half==="T"?"Top":"Bot"} ${o.current_inning}`;
        if (o.count) count = `${o.count.balls}-${o.count.strikes}, ${o.count.outs} out`;
      }

      result = {
        awayScore: away?.runs??null,
        homeScore: home?.runs??null,
        awayHits: away?.hits??null,
        homeHits: home?.hits??null,
        awayErrors: away?.errors??null,
        homeErrors: home?.errors??null,
        awayRecord: away?.win!=null ? `${away.win}-${away.loss}` : null,
        homeRecord: home?.win!=null ? `${home.win}-${home.loss}` : null,
        awayStarter: parsePitcher(away?.starting_pitcher),
        homeStarter: parsePitcher(home?.starting_pitcher),
        awayCurrent: parsePitcher(away?.current_pitcher),
        homeCurrent: parsePitcher(home?.current_pitcher),
        awayLinescore: parseInnings(away?.scoring),
        homeLinescore: parseInnings(home?.scoring),
        inning, count,
        status: game?.status,
        weather,
      };
    } else if (league === "nba") {
      const data = await srGet(`/nba/trial/v8/en/games/${gameId}/boxscore.json`);
      const fmt = (players=[]) => players.slice(0,10).map(p=>({
        name: p.full_name||`${p.first_name||""} ${p.last_name||""}`.trim(),
        pos: p.position||"",
        min: p.statistics?.minutes||"-",
        pts: p.statistics?.points??"-",
        reb: p.statistics?.rebounds??"-",
        ast: p.statistics?.assists??"-",
        stl: p.statistics?.steals??"-",
        blk: p.statistics?.blocks??"-",
        fg: p.statistics?.field_goals_made!=null?`${p.statistics.field_goals_made}/${p.statistics.field_goals_att}`:"-",
      }));
      result = {
        away: fmt(data.game?.away?.players||[]),
        home: fmt(data.game?.home?.players||[]),
        awayScore: data.game?.away_points??null,
        homeScore: data.game?.home_points??null,
        status: data.game?.status,
      };
    } else {
      return res.status(400).json({ error: "Boxscore not available for this league yet" });
    }

    res.json({ boxScore: result });
  } catch (err) {
    console.error("Boxscore error:", err.message);
    res.status(500).json({ error: "Failed to fetch boxscore", details: err.message });
  }
});

module.exports = router;
