// LIVE-PROBE route — READ-ONLY diagnostic, isolated (own router), zero writes,
// never touches the model/picks. Same safety pattern as playerCard/marketRead.
// Purpose: answer three questions before we build the in-game win-probability graph:
//   (1) Does MLB StatsAPI expose per-play WIN PROBABILITY (and what's the shape)?
//   (2) Does The Odds API return LIVE / in-play MLB moneyline odds on our plan?
//   (3) What's the credit burn if we poll live odds?
// Hit it once at GET /api/live-probe (ideally while an MLB game is in progress).
const express = require("express");
const router = express.Router();
const axios = require("axios");

const SA = "https://statsapi.mlb.com/api";
const etDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const j = async (url, opts = {}) => (await axios.get(url, { timeout: 12000, ...opts })).data;

// ---- Section 1: MLB StatsAPI — live state + WIN PROBABILITY shape ----
async function probeStatsApi() {
  const out = { ok: false };
  try {
    const date = etDate();
    const sched = await j(`${SA}/v1/schedule?sportId=1&date=${date}`);
    const games = (sched.dates && sched.dates[0] && sched.dates[0].games) || [];
    out.date = date;
    out.gamesToday = games.length;
    if (!games.length) { out.note = "no MLB games scheduled today"; return out; }

    // prefer a LIVE game; else a FINAL one (still proves the WP field shape); else first
    const pick =
      games.find(g => g.status && g.status.abstractGameState === "Live") ||
      games.find(g => g.status && g.status.abstractGameState === "Final") ||
      games[0];
    const gamePk = pick.gamePk;
    out.sampleGamePk = gamePk;
    out.sampleState = pick.status && pick.status.detailedState;
    out.usedLiveGame = !!(pick.status && pick.status.abstractGameState === "Live");
    out.matchup = `${pick.teams.away.team.name} @ ${pick.teams.home.team.name}`;

    // live feed: the in-game inputs Master G listed (score/hits/inning/outs/count)
    try {
      const feed = await j(`${SA}/v1.1/game/${gamePk}/feed/live`);
      const ls = (feed.liveData && feed.liveData.linescore) || {};
      const t = ls.teams || {};
      out.live = {
        inning: ls.currentInning, half: ls.inningHalf, outs: ls.outs,
        balls: ls.balls, strikes: ls.strikes,
        home: { runs: t.home && t.home.runs, hits: t.home && t.home.hits },
        away: { runs: t.away && t.away.runs, hits: t.away && t.away.hits },
      };
    } catch (e) { out.liveFeedError = String(e.message || e); }

    // THE KEY PROBE — per-play win probability
    try {
      const wp = await j(`${SA}/v1/game/${gamePk}/winProbability`);
      if (Array.isArray(wp) && wp.length) {
        const last = wp[wp.length - 1];
        out.winProb = {
          available: true,
          plays: wp.length,
          fieldsOnEachPlay: Object.keys(last),
          lastHomeWinProb: last.homeTeamWinProbability,
          lastAwayWinProb: last.awayTeamWinProbability,
          lastLeverageIndex: last.leverageIndex,
          sampleFirst: { home: wp[0].homeTeamWinProbability, away: wp[0].awayTeamWinProbability },
        };
      } else {
        out.winProb = { available: false, note: "winProbability endpoint returned empty (game may not have started)" };
      }
    } catch (e) {
      out.winProb = { available: false, error: String(e.message || e) };
    }
    out.ok = true;
  } catch (e) {
    out.error = String(e.message || e);
  }
  return out;
}

// ---- Section 2: The Odds API — is there LIVE / in-play MLB moneyline odds? ----
async function probeOddsApi() {
  const out = { ok: false };
  const key = process.env.ODDS_API_KEY;
  if (!key) { out.note = "ODDS_API_KEY not set in this environment"; return out; }
  try {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds?apiKey=${key}&regions=us&markets=h2h&oddsFormat=american`;
    const resp = await axios.get(url, { timeout: 12000 });
    const games = resp.data || [];
    const now = Date.now();
    const started = games.filter(g => new Date(g.commence_time).getTime() < now &&
      (g.bookmakers || []).some(b => (b.markets || []).some(m => m.key === "h2h" && (m.outcomes || []).length)));
    out.totalGamesInFeed = games.length;
    out.startedGamesWithPrices = started.length; // >0 ⇒ in-play odds ARE returned on our plan
    out.liveOddsAvailable = started.length > 0;
    if (started.length) {
      const s = started[0];
      const bk = (s.bookmakers || [])[0];
      const mk = bk && (bk.markets || []).find(m => m.key === "h2h");
      out.sampleLiveGame = {
        matchup: `${s.away_team} @ ${s.home_team}`,
        startedAgoMin: Math.round((now - new Date(s.commence_time).getTime()) / 60000),
        book: bk && bk.title,
        prices: mk && mk.outcomes.map(o => `${o.name} ${o.price > 0 ? "+" : ""}${o.price}`),
      };
    } else {
      out.note = "No started-but-still-priced MLB games in the feed right now. If a game IS live and this is 0, our plan likely strips in-play odds (would need The Odds API in-play add-on).";
    }
    // credit accounting straight from the response headers
    out.credits = {
      thisCall: resp.headers["x-requests-last"],
      usedTotal: resp.headers["x-requests-used"],
      remaining: resp.headers["x-requests-remaining"],
    };
    out.ok = true;
  } catch (e) {
    out.error = String((e.response && e.response.status) || "") + " " + String(e.message || e);
  }
  return out;
}

router.get("/", async (req, res) => {
  const [statsApi, oddsApi] = await Promise.all([probeStatsApi(), probeOddsApi()]);

  // rough credit burn for polling live odds (one call covers ALL live games at once)
  const perCall = Number(oddsApi.credits && oddsApi.credits.thisCall) || 1;
  const creditMath = {
    note: "One odds call returns ALL live MLB games, so cost scales with POLL FREQUENCY, not game count. The WP graph itself uses MLB StatsAPI only = 0 Odds credits.",
    creditsPerPoll: perCall,
    every30s_perLiveHour: perCall * 120,
    every60s_perLiveHour: perCall * 60,
    every60s_6hrSlate: perCall * 360,
    monthlyCap: 20000,
  };

  const verdict = {
    winProbGraph_feasible: !!(statsApi.winProb && statsApi.winProb.available),
    liveEdges_feasible: !!oddsApi.liveOddsAvailable,
    headline:
      (statsApi.winProb && statsApi.winProb.available
        ? "✓ MLB win-probability IS available → the crossing-lines graph is buildable for free. "
        : "✗ MLB win-probability not confirmed from this sample (try again during a live game). ") +
      (oddsApi.liveOddsAvailable
        ? "✓ Live in-play MLB odds ARE returned → live edges feasible (watch credit burn)."
        : "⚠ Live in-play odds not seen in this sample → confirm during a live game; may need an in-play add-on."),
  };

  res.json({ probedAt: new Date().toISOString(), verdict, statsApi, oddsApi, creditMath });
});

module.exports = router;
