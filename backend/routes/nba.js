/**
 * routes/nba.js — SportsIntel NBA API route
 * --------------------------------------------------------------------------
 * GET /api/nba/predictions                  -> today's NBA predictions + edges
 * GET /api/nba/predictions?date=YYYY-MM-DD  -> a specific date
 * GET /api/nba/matchup/:gameId              -> rich single-game matchup detail
 * GET /api/nba/props/:gameId                -> player prop LINES (points/reb/ast)
 * GET /api/nba/props/:gameId/projections    -> Stage 2 projections + edges (experimental)
 * GET /api/nba/diag                         -> TEMP data diagnostic (raw ESPN fields)
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
const { getUpcomingGamesWithContext } = require('../services/nbaDataSource');
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
// TEMP data diagnostic — dumps the RAW ESPN scoreboard + standings stat fields so
// we can see exactly where points-per-game / points-allowed-per-game live versus
// where nbaDataSource.js currently looks. Read-only; touches nothing else. Safe to
// remove once the NBA data layer is fixed.
router.get('/diag', async (req, res) => {
  const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
  const STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
  const espnGet = async (url) => {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    });
    if (!r.ok) throw new Error(`ESPN ${r.status} for ${url}`);
    return r.json();
  };
  try {
    const dateStr = req.query.date;
    const sbUrl = dateStr
      ? `${BASE}/scoreboard?dates=${String(dateStr).replace(/-/g, '')}`
      : `${BASE}/scoreboard`;
    const [sb, st] = await Promise.all([
      espnGet(sbUrl),
      espnGet(STANDINGS_URL).catch((e) => ({ _error: e.message })),
    ]);

    // SCOREBOARD: dump the first game's competitors + their raw statistics arrays
    const ev = (sb.events || [])[0] || {};
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const scoreboardSample = {
      eventName: ev.name || null,
      state: (comp.status || ev.status || {}).type?.state || null,
      competitors: (comp.competitors || []).map((c) => ({
        team: c.team?.displayName || c.team?.abbreviation || null,
        teamId: c.team?.id || null,
        homeAway: c.homeAway,
        rawStatistics: (c.statistics || []).map((s) => ({
          name: s.name, abbreviation: s.abbreviation, value: s.value, displayValue: s.displayValue,
        })),
        rawRecords: (c.records || []).map((r) => ({ type: r.type, name: r.name, summary: r.summary })),
      })),
    };

    // STANDINGS: dump the first team entry's raw stat fields
    let standingsSample = null;
    if (st && !st._error) {
      const children = st.children || (st.standings ? [st] : []);
      const firstChild = children[0];
      const firstEntry = (firstChild?.standings?.entries || firstChild?.entries || [])[0];
      if (firstEntry) {
        standingsSample = {
          team: firstEntry.team?.displayName || null,
          teamId: firstEntry.team?.id || null,
          rawStats: (firstEntry.stats || []).map((s) => ({
            name: s.name, abbreviation: s.abbreviation, displayName: s.displayName, value: s.value, displayValue: s.displayValue,
          })),
        };
      } else {
        standingsSample = { _note: 'No entries in expected standings shape', topLevelKeys: Object.keys(st) };
      }
    } else {
      standingsSample = { _error: st?._error || 'standings fetch failed' };
    }

    res.json({
      note: 'TEMP diagnostic. rawStatistics/rawStats show the EXACT field names ESPN uses.',
      gameCount: (sb.events || []).length,
      scoreboardSample,
      standingsSample,
    });
  } catch (err) {
    console.error('[nba route] diag failed:', err);
    res.status(502).json({ error: err.message });
  }
});
// TEMP diagnostic #2 — runs the REAL data source and shows the built per-team
// context for each upcoming game (ppg, papg, pace, etc.). This is what the model
// actually receives. If ppg/papg are null here, the data layer is the bug; if
// they're populated and varied, the bug is downstream. Read-only. Safe to remove.
router.get('/diag2', async (req, res) => {
  try {
    const dateStr = req.query.date;
    const ctx = await getUpcomingGamesWithContext(dateStr ? { dateStr, includePending: true } : { includePending: true });
    const summary = (ctx || []).map((g) => ({
      gameId: g.gameId,
      date: g.date,
      state: g.state,
      pending: g.pending,
      home: g.home ? { name: g.home.displayName, id: g.home.id, ppg: g.home.ppg, papg: g.home.papg, pace: g.home.pace, netRtg: g.home.netRtg } : null,
      away: g.away ? { name: g.away.displayName, id: g.away.id, ppg: g.away.ppg, papg: g.away.papg, pace: g.away.pace, netRtg: g.away.netRtg } : null,
    }));
    res.json({
      note: 'TEMP diagnostic #2. Shows the REAL context the model receives per game. Null ppg/papg = data-layer bug.',
      gameCount: summary.length,
      games: summary,
    });
  } catch (err) {
    console.error('[nba route] diag2 failed:', err);
    res.status(502).json({ error: err.message });
  }
});
module.exports = router;
