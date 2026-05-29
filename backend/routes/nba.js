/**
 * routes/nba.js — SportsIntel NBA API route
 * --------------------------------------------------------------------------
 * GET /api/nba/predictions                  -> today's NBA predictions + edges
 * GET /api/nba/predictions?date=YYYY-MM-DD  -> a specific date
 * GET /api/nba/matchup/:gameId              -> rich single-game matchup detail
 * GET /api/nba/props/:gameId                -> player prop LINES (points/reb/ast)
 * GET /api/nba/props/:gameId/projections    -> Stage 2 projections + edges (experimental)
 *
 * Mount in your main backend file next to your other routes:
 *   app.use('/api/nba', require('./routes/nba'));
 * (adjust the relative path if your entry file isn't in backend/)
 * -------------------------------------------------------------------------- */
const express = require('express');
const router = express.Router();
const { generateNbaPredictions } = require('../services/nbaService');
const { getNbaMatchup } = require('../services/nbaMatchup');
const { getNbaProps } = require('../services/nbaProps');
const { getNbaPropProjections } = require('../services/nbaProjectionService');

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

// Player prop LINES for a game (Stage 1 — lines only, no projections)
router.get('/props/:gameId', async (req, res) => {
  try {
    const data = await getNbaProps(req.params.gameId);
    res.json(data);
  } catch (err) {
    console.error('[nba route] props failed:', err);
    res.status(502).json({ error: 'Failed to load NBA props' });
  }
});

// Player prop PROJECTIONS + edges (Stage 2 — experimental, informational only)
router.get('/props/:gameId/projections', async (req, res) => {
  try {
    const data = await getNbaPropProjections(req.params.gameId);
    res.json(data);
  } catch (err) {
    console.error('[nba route] projections failed:', err);
    res.status(502).json({ error: 'Failed to build NBA prop projections' });
  }
});

module.exports = router;
