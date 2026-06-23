// LIVE-WINPROB route — READ-ONLY, isolated (own router), zero writes, never
// touches the model/picks. Same safety pattern as liveProbe/playerCard/marketRead.
// Powers the in-game WIN-PROBABILITY crossing-lines graph in the Live Edges card.
// Data source: MLB StatsAPI only (winProbability + feed/live) = 0 Odds credits.
//
// GET /api/live-winprob/:gamePk   -> full series for one game
// GET /api/live-winprob            -> { games:[...] } list of today's live/recent games
//                                      (so the frontend can pick which to chart)
//
// CMDF-TOKEN: LIVE-WINPROB-ROUTE-2026-06-23
const express = require("express");
const router = express.Router();
const axios = require("axios");

const SA = "https://statsapi.mlb.com/api";
const etDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const j = async (url, opts = {}) => (await axios.get(url, { timeout: 12000, ...opts })).data;

// round helper (keep payload small; WP comes as 0-100 floats)
const r1 = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : null);

// ---- build the full WP series + live state for a single gamePk ----
async function buildGame(gamePk) {
  const out = { gamePk: Number(gamePk), ok: false };

  // teams / status / live linescore from feed/live (one call gives us everything)
  let feed;
  try {
    feed = await j(`${SA}/v1.1/game/${gamePk}/feed/live`);
  } catch (e) {
    out.error = "feed/live failed: " + String(e.message || e);
    return out;
  }

  const gameData = feed.gameData || {};
  const liveData = feed.liveData || {};
  const teams = gameData.teams || {};
  const status = gameData.status || {};
  const ls = liveData.linescore || {};
  const lt = ls.teams || {};

  out.state = status.abstractGameState || null;       // Preview | Live | Final
  out.detailedState = status.detailedState || null;
  out.isLive = out.state === "Live";
  out.isFinal = out.state === "Final";
  out.home = {
    id: teams.home && teams.home.id,
    name: teams.home && teams.home.name,
    abbr: teams.home && teams.home.abbreviation,
  };
  out.away = {
    id: teams.away && teams.away.id,
    name: teams.away && teams.away.name,
    abbr: teams.away && teams.away.abbreviation,
  };
  out.live = {
    inning: ls.currentInning || null,
    half: ls.inningHalf || null,
    outs: typeof ls.outs === "number" ? ls.outs : null,
    balls: typeof ls.balls === "number" ? ls.balls : null,
    strikes: typeof ls.strikes === "number" ? ls.strikes : null,
    home: { runs: (lt.home && lt.home.runs) ?? null, hits: (lt.home && lt.home.hits) ?? null, errors: (lt.home && lt.home.errors) ?? null },
    away: { runs: (lt.away && lt.away.runs) ?? null, hits: (lt.away && lt.away.hits) ?? null, errors: (lt.away && lt.away.errors) ?? null },
  };

  // THE GRAPH — per-play win probability series
  try {
    const wp = await j(`${SA}/v1/game/${gamePk}/winProbability`);
    if (Array.isArray(wp) && wp.length) {
      // full crossing-lines series: one point per play
      const series = wp.map((p, i) => {
        const ab = p.about || {};
        const homeWP = r1(p.homeTeamWinProbability);
        const awayWP = r1(p.awayTeamWinProbability);
        return {
          i,                                        // play index (x-axis)
          atBatIndex: p.atBatIndex,
          inning: ab.inning,
          half: ab.halfInning,                      // "top" | "bottom"
          outs: ab.outs,
          homeWP,                                   // crossing line A (0-100)
          awayWP,                                   // crossing line B (0-100, ~mirror)
          leverage: r1(p.leverageIndex),            // tension/importance of the moment
          wpAdded: r1(p.homeTeamWinProbabilityAdded), // how much THIS play swung it (home-positive)
          desc: (p.result && p.result.description) || null, // play text for tooltips
        };
      });

      // biggest swings (|wpAdded| desc) — key moments to mark on the graph
      const swings = series
        .filter((s) => typeof s.wpAdded === "number")
        .map((s) => ({ i: s.i, inning: s.inning, half: s.half, wpAdded: s.wpAdded, desc: s.desc }))
        .sort((a, b) => Math.abs(b.wpAdded) - Math.abs(a.wpAdded))
        .slice(0, 5);

      const last = series[series.length - 1];
      out.winProb = {
        available: true,
        plays: series.length,
        current: { homeWP: last.homeWP, awayWP: last.awayWP, leverage: last.leverage },
        first: { homeWP: series[0].homeWP, awayWP: series[0].awayWP },
        topSwings: swings,
        series,
      };
      out.ok = true;
    } else {
      out.winProb = { available: false, note: "winProbability empty (game may not have started)" };
      out.ok = true; // still a valid (pre-game) response
    }
  } catch (e) {
    out.winProb = { available: false, error: String(e.message || e) };
  }

  return out;
}

// ---- GET /api/live-winprob/:gamePk — full series for one game ----
router.get("/:gamePk", async (req, res) => {
  const gamePk = String(req.params.gamePk || "").replace(/[^0-9]/g, "");
  if (!gamePk) return res.status(400).json({ ok: false, error: "missing/invalid gamePk" });
  try {
    const game = await buildGame(gamePk);
    res.json({ fetchedAt: new Date().toISOString(), ...game });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---- GET /api/live-winprob — list today's games (live first) for the picker ----
router.get("/", async (req, res) => {
  try {
    const date = etDate();
    const sched = await j(`${SA}/v1/schedule?sportId=1&date=${date}`);
    const games = (sched.dates && sched.dates[0] && sched.dates[0].games) || [];
    const list = games.map((g) => ({
      gamePk: g.gamePk,
      state: g.status && g.status.abstractGameState,
      detailedState: g.status && g.status.detailedState,
      isLive: !!(g.status && g.status.abstractGameState === "Live"),
      away: g.teams && g.teams.away && g.teams.away.team && g.teams.away.team.name,
      home: g.teams && g.teams.home && g.teams.home.team && g.teams.home.team.name,
      awayId: g.teams && g.teams.away && g.teams.away.team && g.teams.away.team.id,
      homeId: g.teams && g.teams.home && g.teams.home.team && g.teams.home.team.id,
    }));
    // live games first, then scheduled, then final
    const rank = (s) => (s === "Live" ? 0 : s === "Preview" ? 1 : 2);
    list.sort((a, b) => rank(a.state) - rank(b.state));
    res.json({ fetchedAt: new Date().toISOString(), date, count: list.length, liveCount: list.filter((g) => g.isLive).length, games: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

module.exports = router;
