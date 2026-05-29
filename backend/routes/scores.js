// routes/scores.js — live scores + game detail for MLB and NBA.
//
//   GET /api/scores/:league          -> { league, live, upcoming, final }
//   GET /api/scores/:league/:gameId  -> { lineScore, players, ... }
//
// Mount in server.js:  app.use("/api/scores", require("./routes/scores"));
const express = require("express");
const router = express.Router();
const { getScores, getGameDetail } = require("../services/liveScores");

const ALLOWED = new Set(["mlb", "nba"]);

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
