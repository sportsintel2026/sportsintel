const express = require("express");
const router = express.Router();
const axios = require("axios");

const SR_KEY = process.env.SPORTRADAR_API_KEY;
const SR_BASE = "https://api.sportradar.com";

async function srGet(path) {
  const res = await axios.get(`${SR_BASE}${path}`, {
    params: { api_key: SR_KEY },
    timeout: 10000,
  });
  return res.data;
}

// Get MLB injuries
router.get("/mlb/injuries", async (req, res) => {
  try {
    const data = await srGet("/mlb/trial/v7/en/league/injuries.json");
    const injuries = (data.teams||[]).flatMap(team =>
      (team.players||[]).map(p => ({
        team: `${team.market} ${team.name}`,
        teamId: team.id,
        player: `${p.preferred_name||p.first_name} ${p.last_name}`,
        position: p.primary_position,
        status: p.injuries?.[0]?.status||"",
        description: p.injuries?.[0]?.desc||"",
        startDate: p.injuries?.[0]?.start_date||"",
      }))
    ).filter(p => p.status);
    res.json({ injuries });
  } catch(err) {
    console.error("Injuries error:", err.message);
    res.status(500).json({ error: "Failed to fetch injuries" });
  }
});

// Get NBA injuries
router.get("/nba/injuries", async (req, res) => {
  try {
    const data = await srGet("/nba/trial/v8/en/league/injuries.json");
    const injuries = (data.teams||[]).flatMap(team =>
      (team.players||[]).map(p => ({
        team: team.name,
        teamId: team.id,
        player: p.full_name||`${p.first_name} ${p.last_name}`,
        position: p.position,
        status: p.injuries?.[0]?.status||"",
        description: p.injuries?.[0]?.desc||"",
        startDate: p.injuries?.[0]?.start_date||"",
      }))
    ).filter(p => p.status);
    res.json({ injuries });
  } catch(err) {
    console.error("NBA Injuries error:", err.message);
    res.status(500).json({ error: "Failed to fetch NBA injuries" });
  }
});

// Get sports news from ESPN RSS
router.get("/headlines/:sport", async (req, res) => {
  try {
    const { sport } = req.params;
    const feeds = {
      mlb: "https://www.espn.com/espn/rss/mlb/news",
      nba: "https://www.espn.com/espn/rss/nba/news",
      nfl: "https://www.espn.com/espn/rss/nfl/news",
      nhl: "https://www.espn.com/espn/rss/nhl/news",
      soccer: "https://www.espn.com/espn/rss/soccer/news",
      all: "https://www.espn.com/espn/rss/news",
    };
    const url = feeds[sport] || feeds.all;
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    
    // Parse RSS
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(response.data)) !== null && items.length < 8) {
      const item = match[1];
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1]||"";
      const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/))?.[1]||"";
      const link = item.match(/<link>(.*?)<\/link>/)?.[1]||"";
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]||"";
      if (title) items.push({
        title: title.replace(/<[^>]*>/g,"").trim(),
        description: desc.replace(/<[^>]*>/g,"").trim().slice(0,120)+"...",
        link,
        pubDate,
        timeAgo: getTimeAgo(new Date(pubDate)),
      });
    }
    res.json({ headlines: items, sport });
  } catch(err) {
    console.error("News error:", err.message);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

function getTimeAgo(date) {
  const mins = Math.floor((Date.now() - date) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
}

module.exports = router;
