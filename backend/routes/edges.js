// Edges route — the main endpoint powering the analytics dashboard
//
// GET /api/edges/mlb
//   Returns today's MLB games with model projections, sportsbook odds, and edges.
//   ROLLOVER: once all of today's games are final (or there are none), it serves
//   TOMORROW's slate instead, so the page stays useful late at night.
//   Caches results in memory for 15 minutes (keyed by the date actually served).
const express = require("express");
const router = express.Router();
const {
  getEasternDate,
  getScheduleForDate,
} = require("../services/mlbStatsApi");
const {
  getMLBMainOdds,
  getMLBHRPropsForAllEvents,
} = require("../services/oddsApi");
const {
  calculateGameEdges,
  calculateHRPropEdges,
} = require("../services/edgesModel");
const { recordPredictions } = require("../services/predictionTracker");
// In-memory cache
let edgesCache = null;
let edgesCacheAt = 0;
let edgesCacheDate = null; // which ET date the cached payload is for
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// Team name normalization
function normalizeTeam(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/^(los angeles|new york|san francisco|san diego|st\.? louis|tampa bay|chicago|kansas city|washington|cleveland|cincinnati|colorado|arizona|atlanta|baltimore|boston|detroit|houston|miami|milwaukee|minnesota|oakland|philadelphia|pittsburgh|seattle|texas|toronto)\s+/i, "")
    .trim();
}
function matchOddsToGame(game, oddsEvents) {
  const awayN = normalizeTeam(game.away);
  const homeN = normalizeTeam(game.home);
  for (const ev of oddsEvents) {
    const evAwayN = normalizeTeam(ev.awayTeam);
    const evHomeN = normalizeTeam(ev.homeTeam);
    if (
      (awayN === evAwayN && homeN === evHomeN) ||
      (awayN.includes(evAwayN) || evAwayN.includes(awayN)) &&
      (homeN.includes(evHomeN) || evHomeN.includes(homeN))
    ) {
      return ev;
    }
  }
  return null;
}

// Decide which date to serve. If every one of today's games is final (or there
// are no games today), roll over to tomorrow. Postponed/cancelled don't count
// as "live/upcoming", so they don't block rollover.
async function resolveSlateDate() {
  const today = getEasternDate(0);
  let todayGames = [];
  try { todayGames = await getScheduleForDate(today); } catch (e) { todayGames = []; }

  const playable = todayGames.filter(g => g.status !== "postponed" && g.status !== "cancelled");
  const anyNotFinal = playable.some(g => g.status !== "final");

  // If there are playable games today and at least one isn't final yet, stay on today.
  if (playable.length > 0 && anyNotFinal) {
    return { date: today, rolled: false };
  }
  // Otherwise (all final, or nothing playable today) → roll to tomorrow.
  const tomorrow = getEasternDate(1);
  return { date: tomorrow, rolled: true };
}

// ── Main endpoint ─────────────────────────────────────────────────────────────
router.get("/mlb", async (req, res) => {
  try {
    const { date: slateDate, rolled } = await resolveSlateDate();

    // Cache is valid only if it's fresh AND for the same date we now want to serve.
    if (edgesCache && edgesCacheDate === slateDate && (Date.now() - edgesCacheAt) < CACHE_TTL_MS) {
      console.log(`[Edges] Returning cached results for ${slateDate}`);
      return res.json({ ...edgesCache, cached: true });
    }

    console.log(`[Edges] Computing edges for ${slateDate}${rolled ? " (rolled over to next day)" : ""}`);
    const allGames = await getScheduleForDate(slateDate);
    const games = allGames.filter(g => g.status !== "postponed" && g.status !== "cancelled");
    console.log(`[Edges] Found ${games.length} MLB games for ${slateDate}`);
    if (games.length === 0) {
      const empty = { date: slateDate, rolledToNextDay: rolled, games: [], moneylineEdges: [], totalsEdges: [], hrPropEdges: [], computedAt: new Date().toISOString() };
      edgesCache = empty;
      edgesCacheAt = Date.now();
      edgesCacheDate = slateDate;
      return res.json(empty);
    }
    let oddsEvents = [];
    try {
      oddsEvents = await getMLBMainOdds();
      console.log(`[Edges] Got odds for ${oddsEvents.length} events`);
    } catch (e) {
      console.error("[Edges] Odds fetch failed, proceeding without odds:", e.message);
    }
    const gamesWithOdds = games.map(g => {
      const oddsMatch = matchOddsToGame(g, oddsEvents);
      return { ...g, _oddsMatch: oddsMatch, _oddsEventId: oddsMatch?.eventId };
    });
    const allEdges = await Promise.all(
      gamesWithOdds.map(g => calculateGameEdges(g, g._oddsMatch).catch(err => {
        console.error(`[Edges] Game ${g.id} failed:`, err.message);
        return null;
      }))
    );
    const gameEdges = allEdges.filter(Boolean);
    // The pre-game model is only valid for games that HAVEN'T STARTED. Once a game
    // is live, the sportsbook re-prices to live odds (and live totals), but our
    // projection is still the full-game pre-game number — comparing the two
    // produces wildly inflated, meaningless "edges". So edge recommendations are
    // built ONLY from games whose status is "scheduled" (not started). We keep a
    // strict allow-list rather than a block-list so live/in-progress/delayed/final
    // can never slip into the rankings, whatever the exact status word is.
    // (Live games still get accurate LIVE edges on their own detail page.)
    const isPreGame = (status) => status === "scheduled";
    const moneylineEdges = [];
    for (const ge of gameEdges) {
      const sourceGame = gamesWithOdds.find(g => g.id === ge.game.id);
      // Only rank edges for not-yet-started games.
      if (!isPreGame(sourceGame?.status)) continue;
      if (ge.moneyline.awayEdge != null) {
        moneylineEdges.push({
          gameId: ge.game.id,
          matchup: `${ge.game.awayAbbr} @ ${ge.game.homeAbbr}`,
          fullMatchup: `${ge.game.away} @ ${ge.game.home}`,
          side: "away",
          team: ge.game.away,
          teamAbbr: ge.game.awayAbbr,
          modelProb: ge.moneyline.awayWinProb,
          odds: ge.moneyline.awayOdds,
          edge: ge.moneyline.awayEdge,
          confidence: ge.moneyline.awayConfidence,
          time: ge.game.time,
          status: sourceGame?.status,
          inning: sourceGame?.inning,
        });
      }
      if (ge.moneyline.homeEdge != null) {
        moneylineEdges.push({
          gameId: ge.game.id,
          matchup: `${ge.game.awayAbbr} @ ${ge.game.homeAbbr}`,
          fullMatchup: `${ge.game.away} @ ${ge.game.home}`,
          side: "home",
          team: ge.game.home,
          teamAbbr: ge.game.homeAbbr,
          modelProb: ge.moneyline.homeWinProb,
          odds: ge.moneyline.homeOdds,
          edge: ge.moneyline.homeEdge,
          confidence: ge.moneyline.homeConfidence,
          time: ge.game.time,
          status: sourceGame?.status,
          inning: sourceGame?.inning,
        });
      }
    }
    moneylineEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
    const totalsEdges = [];
    for (const ge of gameEdges) {
      const sourceGame = gamesWithOdds.find(g => g.id === ge.game.id);
      if (!isPreGame(sourceGame?.status)) continue;
      if (ge.totals.line == null) continue;
      if (ge.totals.overEdge != null) {
        totalsEdges.push({
          gameId: ge.game.id,
          matchup: `${ge.game.awayAbbr} @ ${ge.game.homeAbbr}`,
          fullMatchup: `${ge.game.away} @ ${ge.game.home}`,
          side: "over",
          line: ge.totals.line,
          projected: ge.totals.projected,
          odds: ge.totals.overOdds,
          modelProb: ge.totals.overProb,
          edge: ge.totals.overEdge,
          confidence: ge.totals.overConfidence,
          venue: ge.game.venue,
          time: ge.game.time,
          status: sourceGame?.status,
          inning: sourceGame?.inning,
        });
      }
      if (ge.totals.underEdge != null) {
        totalsEdges.push({
          gameId: ge.game.id,
          matchup: `${ge.game.awayAbbr} @ ${ge.game.homeAbbr}`,
          fullMatchup: `${ge.game.away} @ ${ge.game.home}`,
          side: "under",
          line: ge.totals.line,
          projected: ge.totals.projected,
          odds: ge.totals.underOdds,
          modelProb: ge.totals.underProb,
          edge: ge.totals.underEdge,
          confidence: ge.totals.underConfidence,
          venue: ge.game.venue,
          time: ge.game.time,
          status: sourceGame?.status,
          inning: sourceGame?.inning,
        });
      }
    }
    totalsEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
    let hrPropEdges = [];
    try {
      // Take the first 5 not-yet-started games WITH ODDS for HR props.
      // Skip live/final games (sportsbooks pull or re-price HR props once underway).
      const eligibleGamesForHR = gamesWithOdds
        .filter(g => g._oddsEventId)
        .filter(g => isPreGame(g.status));
      const topGamesForHR = eligibleGamesForHR.slice(0, 5);
      const eventIds = topGamesForHR.map(g => g._oddsEventId);
      console.log(`[Edges-HR] eligibleGames=${eligibleGamesForHR.length}, topGamesForHR=${topGamesForHR.length}, eventIds=${JSON.stringify(eventIds)}`);
      if (eventIds.length > 0) {
        const hrOddsByEvent = await getMLBHRPropsForAllEvents(eventIds, 5);
        hrPropEdges = await calculateHRPropEdges(topGamesForHR, hrOddsByEvent);
      } else {
        console.log("[Edges-HR] NO eventIds — HR props skipped");
      }
    } catch (e) {
      console.error("[Edges] HR props failed:", e.message);
      console.error(e.stack);
    }
    const result = {
      date: slateDate,
      rolledToNextDay: rolled,
      games: gameEdges.map(ge => {
        const sourceGame = gamesWithOdds.find(g => g.id === ge.game.id);
        return {
          ...ge.game,
          moneyline: ge.moneyline,
          totals: ge.totals,
          pitchers: ge.pitchers,
          weather: ge.weather,
          status: sourceGame?.status,
          inning: sourceGame?.inning,
          awayScore: sourceGame?.awayScore,
          homeScore: sourceGame?.homeScore,
        };
      }),
      moneylineEdges: moneylineEdges.slice(0, 10),
      totalsEdges: totalsEdges.slice(0, 10),
      hrPropEdges: hrPropEdges.slice(0, 25),
      computedAt: new Date().toISOString(),
      cached: false,
    };
    edgesCache = result;
    edgesCacheAt = Date.now();
    edgesCacheDate = slateDate;

    // Snapshot predictions for performance tracking (fire-and-forget; deduped by
    // unique constraint so repeated computes during the day are no-ops).
    recordPredictions(result).catch(e => console.error("[Edges] recordPredictions failed:", e.message));

    res.json(result);
  } catch (err) {
    console.error("[Edges] Error:", err);
    res.status(500).json({ error: "Failed to compute edges", details: err.message });
  }
});
// Debug endpoint — clear cache
router.delete("/cache", (req, res) => {
  edgesCache = null;
  edgesCacheAt = 0;
  edgesCacheDate = null;
  res.json({ cleared: true });
});
module.exports = router;
