// Edges route — the main endpoint powering the analytics dashboard
//
// GET /api/edges/mlb
//   Returns today's MLB games with model projections, sportsbook odds, and edges
//   Caches results in memory for 15 minutes

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

// In-memory cache
let edgesCache = null;
let edgesCacheAt = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Team name normalization — Odds API uses full names, MLB uses full names too,
// but minor formatting diffs exist (e.g. "Athletics" vs "Oakland Athletics")
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

// ── Main endpoint ─────────────────────────────────────────────────────────────

router.get("/mlb", async (req, res) => {
  try {
    // Check cache
    if (edgesCache && (Date.now() - edgesCacheAt) < CACHE_TTL_MS) {
      console.log("[Edges] Returning cached results");
      return res.json({ ...edgesCache, cached: true });
    }

    const today = getEasternDate(0);
    console.log(`[Edges] Computing edges for ${today}`);

    // 1. Fetch today's slate from MLB Stats API
    const allGames = await getScheduleForDate(today);
    const games = allGames.filter(g => g.status !== "postponed" && g.status !== "cancelled");
    console.log(`[Edges] Found ${games.length} MLB games`);

    if (games.length === 0) {
      const empty = { date: today, games: [], moneylineEdges: [], totalsEdges: [], hrPropEdges: [], computedAt: new Date().toISOString() };
      edgesCache = empty;
      edgesCacheAt = Date.now();
      return res.json(empty);
    }

    // 2. Fetch sportsbook odds
    let oddsEvents = [];
    try {
      oddsEvents = await getMLBMainOdds();
      console.log(`[Edges] Got odds for ${oddsEvents.length} events`);
    } catch (e) {
      console.error("[Edges] Odds fetch failed, proceeding without odds:", e.message);
    }

    // 3. Match odds to games
    const gamesWithOdds = games.map(g => {
      const oddsMatch = matchOddsToGame(g, oddsEvents);
      return { ...g, _oddsMatch: oddsMatch, _oddsEventId: oddsMatch?.eventId };
    });

    // 4. Run model for each game (parallel — MLB Stats API can handle it)
    const allEdges = await Promise.all(
      gamesWithOdds.map(g => calculateGameEdges(g, g._oddsMatch).catch(err => {
        console.error(`[Edges] Game ${g.id} failed:`, err.message);
        return null;
      }))
    );
    const gameEdges = allEdges.filter(Boolean);

    // 5. Extract top moneyline edges
    const moneylineEdges = [];
    for (const ge of gameEdges) {
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
        });
      }
    }
    moneylineEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));

    // 6. Extract top totals edges
    const totalsEdges = [];
    for (const ge of gameEdges) {
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
        });
      }
    }
    totalsEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));

    // 7. HR Props — only for top 5 games to limit quota
    let hrPropEdges = [];
    try {
      const topGamesForHR = gamesWithOdds.slice(0, 5).filter(g => g._oddsEventId);
      const eventIds = topGamesForHR.map(g => g._oddsEventId);
      if (eventIds.length > 0) {
        const hrOddsByEvent = await getMLBHRPropsForAllEvents(eventIds, 5);
        hrPropEdges = await calculateHRPropEdges(topGamesForHR, hrOddsByEvent);
      }
    } catch (e) {
      console.error("[Edges] HR props failed:", e.message);
    }

    const result = {
      date: today,
      games: gameEdges.map(ge => ({
        ...ge.game,
        moneyline: ge.moneyline,
        totals: ge.totals,
        pitchers: ge.pitchers,
      })),
      moneylineEdges: moneylineEdges.slice(0, 10),
      totalsEdges: totalsEdges.slice(0, 10),
      hrPropEdges: hrPropEdges.slice(0, 10),
      computedAt: new Date().toISOString(),
      cached: false,
    };

    edgesCache = result;
    edgesCacheAt = Date.now();
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
  res.json({ cleared: true });
});

module.exports = router;
