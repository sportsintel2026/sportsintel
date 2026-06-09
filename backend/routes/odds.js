// Odds route — multi-book line-shopping comparison for subscribers.
// Serves every US book's price per game so people can shop for the best number.
// Rides on getMLBOddsComparison's own 90s cache, so this endpoint is cheap even
// under traffic (one ~2-credit Odds API call only when the cache window lapses).
const express = require("express");
const router = express.Router();

const { getMLBOddsComparison } = require("../services/oddsApi");

// GET /api/odds/mlb — per-game, per-book moneyline + total prices with the best
// price flagged in each market.
router.get("/mlb", async (req, res) => {
  try {
    const data = await getMLBOddsComparison();
    res.json(data);
  } catch (e) {
    console.error("[odds] mlb comparison error:", e.message);
    res.status(500).json({ error: "Failed to load odds comparison" });
  }
});

module.exports = router;
