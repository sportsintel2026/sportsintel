// routes/scores.js — live scores + game detail + standings for MLB and NBA.
//
//   GET /api/scores/:league             -> { league, live, upcoming, final }
//   GET /api/scores/:league/standings   -> { teamId: {record, streak, lastTen, runDiff} }
//   GET /api/scores/:league/:gameId     -> { lineScore, players, ... }
//
// Mount in server.js:  app.use("/api/scores", require("./routes/scores"));
const express = require("express");
const router = express.Router();
const { getScores, getGameDetail, getStandings } = require("../services/liveScores");

const ALLOWED = new Set(["mlb", "nba", "nfl", "cfb"]);

router.get("/:league", async (req, res) => {
  const league = String(req.params.league || "").toLowerCase();
  if (!ALLOWED.has(league)) return res.status(400).json({ error: "Unsupported league" });
  try {
    res.json(await getScores(league));
  } catch (err) {
    console.error("[scores] list failed:", err.message);
    res.status(502).json({ error: "Failed to load scores" });
  }
});

// NOTE: this must come BEFORE "/:league/:gameId" so "standings" isn't treated as a gameId.
router.get("/:league/standings", async (req, res) => {
  const league = String(req.params.league || "").toLowerCase();
  if (!ALLOWED.has(league)) return res.status(400).json({ error: "Unsupported league" });
  try {
    res.json(await getStandings(league));
  } catch (err) {
    console.error("[scores] standings failed:", err.message);
    res.status(502).json({ error: "Failed to load standings" });
  }
});

router.get("/:league/:gameId", async (req, res) => {
  const league = String(req.params.league || "").toLowerCase();
  if (!ALLOWED.has(league)) return res.status(400).json({ error: "Unsupported league" });
  try {
    res.json(await getGameDetail(league, req.params.gameId));
  } catch (err) {
    console.error("[scores] detail failed:", err.message);
    res.status(502).json({ error: "Failed to load game detail" });
  }
});

module.exports = router;
