/**
 * routes/nba.js — SportsIntel NBA API route
 * --------------------------------------------------------------------------
 * GET /api/nba/predictions          -> today's NBA predictions + edges
 * GET /api/nba/predictions?date=YYYY-MM-DD -> a specific date
 *
 * Mount in your main backend file next to your other routes:
 *   app.use('/api/nba', require('./routes/nba'));
 * (adjust the relative path if your entry file isn't in backend/)
 * -------------------------------------------------------------------------- */

const express = require('express');
const router = express.Router();
const { generateNbaPredictions } = require('../services/nbaService');

router.get('/predictions', async (req, res) => {
  try {
    const opts = req.query.date ? { dateStr: req.query.date } : {};
    const predictions = await generateNbaPredictions(opts);
    res.json({ league: 'NBA', count: predictions.length, predictions });
  } catch (err) {
    console.error('[nba route] failed:', err);
    res.status(500).json({ error: 'Failed to generate NBA predictions' });
  }
});

module.exports = router;
