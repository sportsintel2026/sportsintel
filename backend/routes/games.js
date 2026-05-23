const express = require("express");
const router = express.Router();
const { requireAuth, requirePro } = require("../middleware/auth");
const {
  fetchMLBSchedule, fetchNBASchedule,
  fetchMLBBoxScore, fetchNBABoxScore,
  fetchMLBH2H,
  getCachedGames, cacheGames,
  normalizeMLBGame, normalizeNBAGame,
} = require("../services/sportsData");

// GET /api/games/:league/today
// Free: returns basic scores
// Pro+: returns full game details
router.get("/:league/today", requireAuth, async (req, res) => {
  try {
    const { league } = req.params;
    const today = new Date().toISOString().split("T")[0];

    // Check cache first
    let games = await getCachedGames(league, today);

    if (!games) {
      // Fetch fresh from Sportradar
      if (league === "mlb") {
        const raw = await fetchMLBSchedule(today);
        games = raw.map(normalizeMLBGame);
      } else if (league === "nba") {
        const raw = await fetchNBASchedule(today);
        games = raw.map(normalizeNBAGame);
      } else if (league === "nfl") {
        // NFL is off-season in May — return empty with message
        return res.json({ games: [], message: "NFL season starts September 2026" });
      } else {
        return res.status(400).json({ error: "Invalid league. Use mlb, nba, or nfl" });
      }

      // Cache the results
      await cacheGames(league, today, games);
    }

    // Free users get basic info only
    const { data: sub } = await req.supabase
      ?.from("subscriptions").select("tier").eq("user_id", req.user.id).single()
      || { data: { tier: "free" } };

    const tier = sub?.tier || "free";

    if (tier === "free") {
      games = games.map(g => ({
        id: g.id,
        league: g.league,
        away: g.away,
        home: g.home,
        awayScore: g.awayScore,
        homeScore: g.homeScore,
        status: g.status,
        scheduledTime: g.scheduledTime,
        venue: g.venue,
        city: g.city,
      }));
    }

    res.json({ games, date: today, league, tier });
  } catch (err) {
    console.error("GET /games error:", err.message);
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

// GET /api/games/:league/:gameId/boxscore  [Pro+]
router.get("/:league/:gameId/boxscore", requireAuth, requirePro, async (req, res) => {
  try {
    const { league, gameId } = req.params;
    let boxScore;

    if (league === "mlb") {
      boxScore = await fetchMLBBoxScore(gameId);
    } else if (league === "nba") {
      boxScore = await fetchNBABoxScore(gameId);
    } else {
      return res.status(400).json({ error: "Invalid league" });
    }

    res.json({ boxScore });
  } catch (err) {
    console.error("GET /boxscore error:", err.message);
    res.status(500).json({ error: "Failed to fetch box score" });
  }
});

// GET /api/games/:league/:gameId/h2h  [Pro+]
router.get("/:league/:gameId/h2h", requireAuth, requirePro, async (req, res) => {
  try {
    const { league, gameId } = req.params;
    const { homeTeamId, awayTeamId } = req.query;

    let h2h;
    if (league === "mlb") {
      h2h = await fetchMLBH2H(homeTeamId, awayTeamId);
    } else {
      return res.status(400).json({ error: "H2H not yet supported for this league" });
    }

    res.json({ h2h });
  } catch (err) {
    console.error("GET /h2h error:", err.message);
    res.status(500).json({ error: "Failed to fetch H2H data" });
  }
});

module.exports = router;
