// routes/dailyCard.js — GET /api/daily-card → today's locked card.
// Optional ?scope=mix|mlb|nba selects which sport(s) the card draws from.
const express = require("express");
const router = express.Router();
const { getOrGenerateDailyCard, getDailyCardRecord, getAlternatePick, getAlternatePlay } = require("../services/dailyCard");

router.get("/alternate", async (req, res) => {
  try {
    const alt = await getAlternatePick(req.query.scope);
    res.json(alt);
  } catch (err) {
    console.error("[DailyCard] alternate error:", err);
    res.status(500).json({ error: "Failed to load alternate", details: err.message });
  }
});

// The free-spin bonus play: a fresh single + a fresh parlay, both different from
// the tracked card. Untracked — never written, locked, or graded.
router.get("/alternate-play", async (req, res) => {
  try {
    const play = await getAlternatePlay(req.query.scope);
    res.json(play);
  } catch (err) {
    console.error("[DailyCard] alternate-play error:", err);
    res.status(500).json({ error: "Failed to load alternate play", details: err.message });
  }
});

router.get("/record", async (req, res) => {
  try {
    const record = await getDailyCardRecord(req.query.scope);
    res.json(record);
  } catch (err) {
    console.error("[DailyCard] record error:", err);
    res.status(500).json({ error: "Failed to load record", details: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const card = await getOrGenerateDailyCard(req.query.scope);
    res.json(card);
  } catch (err) {
    console.error("[DailyCard] error:", err);
    res.status(500).json({ error: "Failed to load daily card", details: err.message });
  }
});

module.exports = router;
