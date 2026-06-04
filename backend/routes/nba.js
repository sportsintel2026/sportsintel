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
const { recordNbaTeamPredictions } = require('../services/predictionTracker');
router.get('/predictions', async (req, res) => {
  try {
    const opts = req.query.date ? { dateStr: req.query.date } : {};
    const predictions = await generateNbaPredictions(opts);
    // Snapshot today's pre-game team edges so Quick Picks can use them (fire-and-forget).
    if (!req.query.date) recordNbaTeamPredictions(predictions).catch(() => {});
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
    // Peek at the betting + win-prob blocks so we can see what's actually
    // available LIVE before building the model. Sample shapes only, not full dumps.
    const odds = Array.isArray(j.odds) ? j.odds : (j.odds ? [j.odds] : []);
    const oddsSample = odds.slice(0, 2).map((o) => ({
      provider: o.provider && o.provider.name,
      details: o.details,
      overUnder: o.overUnder,
      spread: o.spread,
      homeML: o.homeTeamOdds && (o.homeTeamOdds.moneyLine ?? o.homeTeamOdds.current?.moneyLine),
      awayML: o.awayTeamOdds && (o.awayTeamOdds.moneyLine ?? o.awayTeamOdds.current?.moneyLine),
      keys: Object.keys(o),
    }));
    const pickcenter = Array.isArray(j.pickcenter) ? j.pickcenter : [];
    const pickcenterSample = pickcenter.slice(0, 2).map((p) => ({
      provider: p.provider && p.provider.name,
      details: p.details,
      overUnder: p.overUnder,
      spread: p.spread,
      homeML: p.homeTeamOdds && (p.homeTeamOdds.moneyLine ?? p.homeTeamOdds.current?.moneyLine),
      awayML: p.awayTeamOdds && (p.awayTeamOdds.moneyLine ?? p.awayTeamOdds.current?.moneyLine),
      keys: Object.keys(p),
    }));
    const wp = j.winprobability;
    const wpInfo = Array.isArray(wp)
      ? { count: wp.length, lastTick: wp[wp.length - 1] || null, keys: wp[0] ? Object.keys(wp[0]) : null }
      : (wp ? { shape: 'object', keys: Object.keys(wp) } : null);
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
      oddsCount: odds.length,
      oddsSample,                                       // live betting line(s), if present
      pickcenterCount: pickcenter.length,
      pickcenterSample,
      winprobability: wpInfo,                            // ESPN's own live win-prob block
      topLevelKeys: Object.keys(j),
      headerStatusKeys: Object.keys(status),
    });
  } catch (err) {
    console.error('[nba route] livediag failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// TEMP diagnostic — LIVE odds pipeline test. Polls The Odds API for NBA h2h,
// de-vigs each book's two-way moneyline, and returns the CONSENSUS (median)
// no-vig market probability per team. READ-ONLY and NOT wired to any page —
// this only proves the live-odds -> de-vig -> consensus pipeline against real
// live data before we build the public live edge. Key via ?key= (temp) or the
// ODDS_API_KEY env var. Safe to remove later.
router.get('/liveoddsdiag', async (req, res) => {
  const key = req.query.key || process.env.ODDS_API_KEY;
  if (!key) return res.status(400).json({ error: 'no api key — pass ?key= or set ODDS_API_KEY' });
  const ODDS_URL = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${key}&regions=us&markets=h2h&oddsFormat=american`;
  const imp = (o) => (o == null ? null : o > 0 ? 100 / (o + 100) : -o / (-o + 100)); // American -> raw implied
  const median = (vals) => {
    const a = vals.filter((x) => x != null).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  try {
    const r = await fetch(ODDS_URL, { headers: { Accept: 'application/json' } });
    const quota = { remaining: r.headers.get('x-requests-remaining'), used: r.headers.get('x-requests-used') };
    if (!r.ok) {
      const body = await r.text();
      return res.status(502).json({ error: 'odds api ' + r.status, body: body.slice(0, 300), quota });
    }
    const games = await r.json();
    const out = (games || []).map((g) => {
      const books = (g.bookmakers || []).map((b) => {
        const mkt = (b.markets || []).find((x) => x.key === 'h2h');
        const oc = (mkt && mkt.outcomes) || [];
        const homeP = (oc.find((o) => o.name === g.home_team) || {}).price;
        const awayP = (oc.find((o) => o.name === g.away_team) || {}).price;
        const rh = imp(homeP), ra = imp(awayP);
        const s = rh != null && ra != null ? rh + ra : null;
        return {
          book: b.title,
          homeML: homeP, awayML: awayP,
          homeNoVig: s ? +((rh / s) * 100).toFixed(1) : null,
          awayNoVig: s ? +((ra / s) * 100).toFixed(1) : null,
          vigPct: s ? +(((s - 1) * 100).toFixed(2)) : null,
          lastUpdate: b.last_update,
        };
      });
      const homeVals = books.map((b) => b.homeNoVig).filter((x) => x != null);
      return {
        away: g.away_team, home: g.home_team, commence: g.commence_time,
        nBooks: books.length,
        consensusNoVig: { home: median(books.map((b) => b.homeNoVig)), away: median(books.map((b) => b.awayNoVig)) },
        bookSpread: homeVals.length ? { homeMin: Math.min(...homeVals), homeMax: Math.max(...homeVals) } : null,
        books,
      };
    });
    res.json({ note: 'TEMP live-odds pipeline diagnostic. Read-only; not wired to any page.', quota, gameCount: out.length, games: out });
  } catch (err) {
    console.error('[nba route] liveoddsdiag failed:', err);
    res.status(502).json({ error: err.message });
  }
});
module.exports = router;
