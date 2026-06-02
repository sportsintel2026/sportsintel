// routes/dailyCard.js — GET /api/daily-card → today's locked card.
const express = require("express");
const router = express.Router();
const { getOrGenerateDailyCard, getDailyCardRecord, getAlternatePick } = require("../services/dailyCard");

router.get("/alternate", async (req, res) => {
  try {
    const alt = await getAlternatePick();
    res.json(alt);
  } catch (err) {
    console.error("[DailyCard] alternate error:", err);
    res.status(500).json({ error: "Failed to load alternate", details: err.message });
  }
});

router.get("/record", async (req, res) => {
  try {
    const record = await getDailyCardRecord();
    res.json(record);
  } catch (err) {
    console.error("[DailyCard] record error:", err);
    res.status(500).json({ error: "Failed to load record", details: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const card = await getOrGenerateDailyCard();
    res.json(card);
  } catch (err) {
    console.error("[DailyCard] error:", err);
    res.status(500).json({ error: "Failed to load daily card", details: err.message });
  }
});

module.exports = router;
