/**
 * routes/nba.js — SportsIntel NBA API route
 * --------------------------------------------------------------------------
 * GET /api/nba/predictions          -> today's NBA predictions + edges
 * GET /api/nba/predictions?date=YYYY-MM-DD -> a specific date
 * GET /api/nba/matchup/:gameId      -> rich single-game matchup detail
 *
 * Mount in your main backend file next to your other routes:
 *   app.use('/api/nba', require('./routes/nba'));
 * (adjust the relative path if your entry file isn't in backend/)
 * -------------------------------------------------------------------------- */

const express = require('express');
const router = express.Router();
const { generateNbaPredictions } = require('../services/nbaService');
const { getNbaMatchup } = require('../services/nbaMatchup');

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

// Rich single-game matchup: team stats, player leaders, injuries, series, line
router.get('/matchup/:gameId', async (req, res) => {
  try {
    const data = await getNbaMatchup(req.params.gameId);
    res.json(data);
  } catch (err) {
    console.error('[nba route] matchup failed:', err);
    res.status(502).json({ error: 'Failed to load NBA matchup' });
  }
});

module.exports = router;
