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
const { getNbaPropProjections, getIdDebug } = require('../services/nbaProjectionService');
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
// TEMP diagnostic — where does ESPN keep player ids for this game? (safe to remove later)
router.get('/props/:gameId/idcheck', async (req, res) => {
  try {
    res.json(await getIdDebug(req.params.gameId));
  } catch (err) {
    console.error('[nba route] idcheck failed:', err);
    res.status(502).json({ error: 'idcheck failed' });
  }
});
// TEMP diagnostic — dumps ESPN's LIVE game state for an in-progress NBA game so
// we can see exactly what live fields are available (score, clock, period,
// possession) before building the live win-probability model. Pass a gameId that
// is CURRENTLY LIVE: /api/nba/livediag/:gameId  — read-only, safe to remove later.
router.get('/livediag/:gameId', async (req, res) => {
  const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';
  try {
    const r = await fetch(`${SUMMARY}?event=${req.params.gameId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    if (!r.ok) return res.status(502).json({ error: 'espn summary ' + r.status });
    const j = await r.json();
    const comp = (j.header && j.header.competitions && j.header.competitions[0]) || {};
    const status = comp.status || {};
    const competitors = (comp.competitors || []).map((c) => ({
      homeAway: c.homeAway,
      team: c.team && (c.team.abbreviation || c.team.displayName),
      score: c.score,
      linescores: Array.isArray(c.linescores) ? c.linescores.map((l) => l.value) : null,
    }));
    // situation (possession / last play) sometimes lives at the top level
    const situation = j.situation || comp.situation || null;
    res.json({
      note: 'TEMP live diagnostic. Shows ESPN in-game state fields available for the live win-prob model.',
      gameId: String(req.params.gameId),
      state: status.type && status.type.state,        // 'pre' | 'in' | 'post'
      statusDetail: status.type && status.type.detail,
      clock: status.displayClock,                       // e.g. "5:23"
      clockSeconds: status.clock,                       // raw seconds remaining in period
      period: status.period,                            // quarter number
      competitors,
      situationKeys: situation ? Object.keys(situation) : null,
      situationSample: situation || null,
      topLevelKeys: Object.keys(j),
      headerStatusKeys: Object.keys(status),
    });
  } catch (err) {
    console.error('[nba route] livediag failed:', err);
    res.status(502).json({ error: err.message });
  }
});
module.exports = router;
