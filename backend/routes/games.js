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

async function getMLBGamesWithScores(date) {
  const [y,m,d] = date.split("-");
  const data = await srGet(`/mlb/trial/v7/en/games/${y}/${m}/${d}/schedule.json`);
  const games = data.games || [];
  const results = [];

  for (const g of games) {
    let awayScore = null;
    let homeScore = null;
    let inning = null;
    let weather = null;

    if (g.status === "closed" || g.status === "inprogress") {
      try {
        await sleep(300);
        const box = await srGet(`/mlb/trial/v7/en/games/${g.id}/boxscore.json`);
        awayScore = box.game?.away?.runs ?? null;
        homeScore = box.game?.home?.runs ?? null;
        
        if (box.game?.outcome) {
          const o = box.game.outcome;
          inning = `${o.current_inning_half==="T"?"Top":"Bot"} ${o.current_inning}`;
        }
        
        if (box.game?.weather) {
          const w = box.game.weather.current_conditions || box.game.weather.forecast;
          weather = {
            temp: w?.temp_f ? `${w.temp_f}°F` : null,
            condition: w?.condition || null,
            humidity: w?.humidity ? `${w.humidity}%` : null,
            wind: w?.wind ? `${w.wind.speed_mph} mph ${w.wind.direction}` : null,
            cloudCover: w?.cloud_cover ? `${w.cloud_cover}%` : null,
          };
        }
      } catch(e) {
        console.error(`Boxscore error ${g.id}:`, e.message);
      }
    }

    results.push({
      id: g.id, league: "mlb",
      away: `${g.away?.market||""} ${g.away?.name||""}`.trim(),
      home: `${g.home?.market||""} ${g.home?.name||""}`.trim(),
      awayId: g.away?.id, homeId: g.home?.id,
      awayScore, homeScore, weather,
      status: g.status==="inprogress"?"live":g.status==="closed"?"final":"scheduled",
      inning,
      time: new Date(g.scheduled).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET",
      venue: g.venue?.name||"",
      city: `${g.venue?.city||""}, ${g.venue?.state||""}`,
    });
  }
  return results;
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
    const today = new Date().toISOString().split("T")[0];
    let games;

    if (league === "mlb") {
      games = await getMLBGamesWithScores(today);
      await cacheGames(league, today, games);
    } else if (league === "nba") {
      games = await getNBAGamesWithScores(today);
      await cacheGames(league, today, games);
    } else if (league === "nfl") {
      return res.json({ games: [], message: "NFL season starts September 2026" });
    } else {
      const cached = await getCachedGames(league, today);
      if (cached) return res.json({ games: cached, date: today, league });
      return res.json({ games: [], message: `No ${league} games available today` });
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
      
      // Parse lineup from batters array
      const fmtTeam = (team) => {
        if (!team) return [];
        const batters = team.batters || team.lineup || [];
        return batters.slice(0,9).map(p => ({
          name: `${p.preferred_name||p.first_name||""} ${p.last_name||""}`.trim(),
          pos: p.primary_position||p.position||"",
          ab: p.ab??p.at_bats??"-",
          h: p.hits??"-",
          r: p.runs??"-",
          rbi: p.rbi??"-",
          hr: p.home_runs??p.hr??"-",
          bb: p.walks??p.bb??"-",
          avg: p.avg??"-",
        }));
      };

      // Get weather
      let weather = null;
      if (game?.weather) {
        const w = game.weather.current_conditions || game.weather.forecast;
        weather = {
          temp: w?.temp_f ? `${w.temp_f}°F` : null,
          condition: w?.condition || null,
          humidity: w?.humidity ? `${w.humidity}%` : null,
          wind: w?.wind ? `${w.wind.speed_mph} mph ${w.wind.direction}` : null,
          cloudCover: w?.cloud_cover ? `${w.cloud_cover}%` : null,
        };
      }

      // Get inning info
      let inning = null;
      if (game?.outcome) {
        const o = game.outcome;
        inning = `${o.current_inning_half==="T"?"Top":"Bot"} ${o.current_inning}`;
      }

      // Get linescore (runs per inning)
      const awayLinescore = game?.away?.linescore||[];
      const homeLinescore = game?.home?.linescore||[];

      result = {
        away: fmtTeam(game?.away),
        home: fmtTeam(game?.home),
        awayScore: game?.away?.runs??null,
        homeScore: game?.home?.runs??null,
        awayHits: game?.away?.hits??null,
        homeHits: game?.home?.hits??null,
        awayErrors: game?.away?.errors??null,
        homeErrors: game?.home?.errors??null,
        awayLinescore,
        homeLinescore,
        inning,
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
