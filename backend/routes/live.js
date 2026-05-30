// live.js — in-game (live) win probability + moneyline edge
//
// GET /api/live/mlb
//   For each MLB game currently in progress, computes our live win probability
//   (win-expectancy engine + current-pitcher nudge) and compares it to the
//   de-vigged live moneyline to surface a live edge.
//
// STAGE 1: moneyline only.
//
// Credit awareness: live odds are fetched ONCE per request (one getMLBMainOdds
// call covers all games, ~2 credits) and the whole response is cached 60s, so a
// page polling every 60s costs ~2 credits/min only while games are live.

const express = require("express");
const router = express.Router();
const {
  getEasternDate,
  getScheduleForDate,
  getLiveGameState,
} = require("../services/mlbStatsApi");
const { getMLBMainOdds, americanToImpliedProb } = require("../services/oddsApi");
const { devigTwoWay } = require("../services/edgesModel");
const { computeLiveWinProb } = require("../services/liveModel");

let liveCache = null;
let liveCacheAt = 0;
const CACHE_TTL_MS = 60 * 1000; // 60s — live state changes fast but not every second

function normalizeTeam(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/^(los angeles|new york|san francisco|san diego|st\.? louis|tampa bay|chicago|kansas city|washington|cleveland|cincinnati|colorado|arizona|atlanta|baltimore|boston|detroit|houston|miami|milwaukee|minnesota|oakland|philadelphia|pittsburgh|seattle|texas|toronto)\s+/i, "")
    .trim();
}
function matchOdds(game, oddsEvents) {
  const awayN = normalizeTeam(game.away), homeN = normalizeTeam(game.home);
  for (const ev of oddsEvents) {
    const a = normalizeTeam(ev.awayTeam), h = normalizeTeam(ev.homeTeam);
    if ((awayN === a && homeN === h) ||
        ((awayN.includes(a) || a.includes(awayN)) && (homeN.includes(h) || h.includes(homeN)))) {
      return ev;
    }
  }
  return null;
}

router.get("/mlb", async (req, res) => {
  try {
    if (liveCache && (Date.now() - liveCacheAt) < CACHE_TTL_MS) {
      return res.json({ ...liveCache, cached: true });
    }

    // Gather candidate games from today AND yesterday (covers the ET day boundary
    // — a game that started late can roll past midnight into the next ET date).
    const today = getEasternDate(0);
    const yesterday = getEasternDate(-1);
    let schedule = [];
    try {
      const [t, y] = await Promise.all([
        getScheduleForDate(today).catch(() => []),
        getScheduleForDate(yesterday).catch(() => []),
      ]);
      // dedupe by game id
      const seen = new Set();
      for (const g of [...t, ...y]) {
        if (!seen.has(g.id)) { seen.add(g.id); schedule.push(g); }
      }
    } catch (e) { schedule = []; }

    // Consider anything not clearly final/upcoming as a live candidate. We then
    // confirm via the live feed (which has the authoritative abstract state).
    const candidates = schedule.filter(g =>
      g.status === "live" || g.status === "in_progress" ||
      (g.status !== "final" && g.status !== "scheduled" &&
       g.status !== "postponed" && g.status !== "cancelled")
    );

    const debug = { today, yesterday, scheduleCount: schedule.length, candidateCount: candidates.length };

    if (candidates.length === 0) {
      const empty = { date: today, games: [], debug, computedAt: new Date().toISOString(), cached: false };
      liveCache = empty; liveCacheAt = Date.now();
      return res.json(empty);
    }

    // One odds fetch covers all games (live odds included on this endpoint).
    let oddsEvents = [];
    try { oddsEvents = await getMLBMainOdds(); } catch (e) { /* proceed without */ }

    const games = [];
    let feedNull = 0, notLive = 0;
    for (const g of candidates) {
      const state = await getLiveGameState(g.id);
      if (!state) { feedNull++; continue; }
      // Confirm it's actually live via the feed's abstract state (most reliable).
      if (state.abstractState && state.abstractState !== "Live") { notLive++; continue; }

      // Live total line from the book (for the over/under edge), if available.
      const odds = matchOdds(g, oddsEvents);
      const liveTotalLine = odds?.totals?.line ?? null;

      // Our live probabilities for all three markets.
      const homeEra = state.pitchingSide === "home" ? state.currentPitcherEra : null;
      const awayEra = state.pitchingSide === "away" ? state.currentPitcherEra : null;
      const wp = computeLiveWinProb(state, homeEra, awayEra, liveTotalLine);

      // ── Moneyline edge (de-vigged) ──
      let awayEdge = null, homeEdge = null, awayOdds = null, homeOdds = null;
      if (odds?.h2h?.away != null && odds?.h2h?.home != null) {
        awayOdds = odds.h2h.away; homeOdds = odds.h2h.home;
        const fairAway = devigTwoWay(awayOdds, homeOdds);
        const fairHome = devigTwoWay(homeOdds, awayOdds);
        if (fairAway != null) awayEdge = round3(wp.awayWinProb - fairAway);
        if (fairHome != null) homeEdge = round3(wp.homeWinProb - fairHome);
      }

      // ── Over/Under edge (de-vigged) ──
      let overEdge = null, underEdge = null, overOdds = null, underOdds = null;
      if (odds?.totals?.over != null && odds?.totals?.under != null && wp.overProb != null) {
        overOdds = odds.totals.over; underOdds = odds.totals.under;
        const fairOver = devigTwoWay(overOdds, underOdds);
        const fairUnder = devigTwoWay(underOdds, overOdds);
        if (fairOver != null) overEdge = round3(wp.overProb - fairOver);
        if (fairUnder != null) underEdge = round3(wp.underProb - fairUnder);
      }

      // ── Run line edge (±1.5) ──
      // Live run-line odds aren't on the main odds call (h2h/totals only), so we
      // can't de-vig against a book price yet. We surface our model run-line
      // PROBABILITY (home/away to cover -1.5); the edge vs book is left null until
      // we add a run-line (spreads) odds fetch. Honest: prob shown, edge pending.
      const homeRunLineProb = wp.homeRunLineProb;
      const awayRunLineProb = wp.awayRunLineProb;

      games.push({
        gameId: g.id,
        away: g.away, home: g.home,
        awayAbbr: g.awayAbbr, homeAbbr: g.homeAbbr,
        inning: state.inning, half: state.half, outs: state.outs,
        baseState: state.baseState,
        awayScore: state.awayScore, homeScore: state.homeScore,
        // moneyline
        awayWinProb: wp.awayWinProb, homeWinProb: wp.homeWinProb,
        awayOdds, homeOdds, awayEdge, homeEdge,
        // totals
        totalLine: liveTotalLine, projectedTotal: wp.projectedTotal,
        overProb: wp.overProb, underProb: wp.underProb,
        overOdds, underOdds, overEdge, underEdge,
        // run line (probability only for now)
        homeRunLineProb, awayRunLineProb,
        pitcherAdj: wp.pitcherAdj,
      });
    }

    // Sort by biggest absolute edge first (most interesting on top).
    games.sort((a, b) => {
      const ea = Math.max(Math.abs(a.awayEdge ?? 0), Math.abs(a.homeEdge ?? 0));
      const eb = Math.max(Math.abs(b.awayEdge ?? 0), Math.abs(b.homeEdge ?? 0));
      return eb - ea;
    });

    const result = { date: today, games, debug: { ...debug, feedNull, notLive, processed: games.length }, computedAt: new Date().toISOString(), cached: false };
    liveCache = result; liveCacheAt = Date.now();
    res.json(result);
  } catch (err) {
    console.error("[Live] error:", err.message);
    res.status(500).json({ error: "live compute failed", details: err.message });
  }
});

function round3(n) { return Math.round(n * 1000) / 1000; }

module.exports = router;
