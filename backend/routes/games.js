const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const { fetchMLBSchedule, fetchNBASchedule, getCachedGames, cacheGames } = require("../services/sportsData");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

router.get("/:league/today", async (req, res) => {
  try {
    const { league } = req.params;
    const today = new Date().toISOString().split("T")[0];

    let games = await getCachedGames(league, today);

    if (!games) {
      if (league === "mlb") {
        games = await fetchMLBSchedule(today);
      } else if (league === "nba") {
        games = await fetchNBASchedule(today);
      } else if (league === "nfl") {
        return res.json({ games: [], message: "NFL season starts September 2026" });
      } else {
        return res.status(400).json({ error: "Invalid league" });
      }
      await cacheGames(league, today, games);
    }

    res.json({ games, date: today, league });
  } catch (err) {
    console.error("GET /games error:", err.message);
    res.status(500).json({ error: "Failed to fetch games", details: err.message });
  }
});

module.exports = router;
