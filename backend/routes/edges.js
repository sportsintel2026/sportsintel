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
      const empty = { date: slateDate, rolledToNextDay: rolled, games: [], moneylineEdges: [], totalsEdges: [], runLineEdges: [], hrPropEdges: [], computedAt: new Date().toISOString() };
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
          conviction: ge.moneyline.awayConviction,
          convictionScore: ge.moneyline.awayConvictionScore,
          reason: ge.moneyline.awayReason || null,
          trust: ge.moneyline.awayTrust || null,
          inflation: ge.moneyline.awayInflation || null,
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
          conviction: ge.moneyline.homeConviction,
          convictionScore: ge.moneyline.homeConvictionScore,
          reason: ge.moneyline.homeReason || null,
          trust: ge.moneyline.homeTrust || null,
          inflation: ge.moneyline.homeInflation || null,
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
          conviction: ge.totals.overConviction,
          convictionScore: ge.totals.overConvictionScore,
          reason: ge.totals.overReason || null,
          trust: ge.totals.overTrust || null,
          inflation: ge.totals.overInflation || null,
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
          conviction: ge.totals.underConviction,
          convictionScore: ge.totals.underConvictionScore,
          reason: ge.totals.underReason || null,
          trust: ge.totals.underTrust || null,
          inflation: ge.totals.underInflation || null,
          venue: ge.game.venue,
          time: ge.game.time,
          status: sourceGame?.status,
          inning: sourceGame?.inning,
        });
      }
    }
    totalsEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
    const runLineEdges = [];
    for (const ge of gameEdges) {
      const sourceGame = gamesWithOdds.find(g => g.id === ge.game.id);
      if (!isPreGame(sourceGame?.status)) continue;
      const rl = ge.runLine;
      if (rl?.awayEdge != null) {
        runLineEdges.push({
          gameId: ge.game.id,
          matchup: `${ge.game.awayAbbr} @ ${ge.game.homeAbbr}`,
          fullMatchup: `${ge.game.away} @ ${ge.game.home}`,
          side: "away",
          team: ge.game.away,
          teamAbbr: ge.game.awayAbbr,
          modelProb: rl.awayCoverProb,
          odds: rl.awayOdds,
          line: rl.awayLine,
          edge: rl.awayEdge,
          confidence: rl.awayConfidence,
          conviction: rl.awayConviction,
          convictionScore: rl.awayConvictionScore,
          time: ge.game.time,
          status: sourceGame?.status,
          inning: sourceGame?.inning,
        });
      }
      if (rl?.homeEdge != null) {
        runLineEdges.push({
          gameId: ge.game.id,
          matchup: `${ge.game.awayAbbr} @ ${ge.game.homeAbbr}`,
          fullMatchup: `${ge.game.away} @ ${ge.game.home}`,
          side: "home",
          team: ge.game.home,
          teamAbbr: ge.game.homeAbbr,
          modelProb: rl.homeCoverProb,
          odds: rl.homeOdds,
          line: rl.homeLine,
          edge: rl.homeEdge,
          confidence: rl.homeConfidence,
          conviction: rl.homeConviction,
          convictionScore: rl.homeConvictionScore,
          time: ge.game.time,
          status: sourceGame?.status,
          inning: sourceGame?.inning,
        });
      }
    }
    runLineEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
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
          runLine: ge.runLine,
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
      runLineEdges: runLineEdges.slice(0, 10),
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
// ── TEMP DIAGNOSTIC: blend-weight backtest (read-only) ──────────────────────
// GET /api/edges/blenddiag
// Pulls graded MLB picks (moneyline + total) that have a captured closing line,
// buckets them by edge size, and simulates lower blend weights. Because the
// reported edge = W_MODEL * (model - fairMarket), lowering W just scales every
// edge down — it never flips a pick — so a lower weight only DROPS the smallest
// edges. This shows whether those small-edge picks beat the close (keep the
// weight) or not (lower it). REMOVE after we've read it.
router.get("/blenddiag", async (req, res) => {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: "Supabase env not set" });
    }
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const W_CURRENT = 0.70;     // live MLB blend weight
    const LOW_FLOOR = 0.005;    // edge below this is not flagged at all (LOW tier floor)

    const { data, error } = await sb
      .from("model_predictions")
      .select("edge, clv, beat_close, result, market, model_prob, odds, confidence, game_date, description")
      .eq("league", "mlb")
      .in("market", ["moneyline", "total"])
      .not("result", "eq", "pending")
      .not("clv", "is", null)
      .gt("edge", 0)
      .order("game_date", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    const rows = (data || []).filter(r => r.edge != null && r.clv != null);

    const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
    const summarize = (set) => {
      const n = set.length;
      if (n === 0) return { n: 0, wins: 0, losses: 0, pushes: 0, winPct: null, avgClvPct: null, beatCloseN: 0, beatClosePct: null };
      let wins = 0, losses = 0, pushes = 0, beat = 0, clvSum = 0;
      for (const r of set) {
        if (r.result === "win") wins++;
        else if (r.result === "loss") losses++;
        else if (r.result === "push") pushes++;
        if (r.beat_close === true) beat++;
        clvSum += Number(r.clv) || 0;
      }
      const decided = wins + losses;
      return {
        n,
        wins, losses, pushes,
        winPct: decided ? r2((wins / decided) * 100) : null,
        avgClvPct: r2((clvSum / n) * 100),
        beatCloseN: beat,
        beatClosePct: r2((beat / n) * 100),
      };
    };

    // Edge buckets (match the confidence tiers).
    const buckets = {
      "HIGH (edge >= 5%)":        rows.filter(r => r.edge >= 0.05),
      "MEDIUM (2.5% - 5%)":       rows.filter(r => r.edge >= 0.025 && r.edge < 0.05),
      "LOW (0.5% - 2.5%)":        rows.filter(r => r.edge >= 0.005 && r.edge < 0.025),
      "BELOW FLOOR (< 0.5%)":     rows.filter(r => r.edge < 0.005),
    };
    const byBucket = {};
    for (const k of Object.keys(buckets)) byBucket[k] = summarize(buckets[k]);

    // Weight simulation: at weight W, a pick is still flagged iff
    // edge * (W / W_CURRENT) >= LOW_FLOOR  ->  edge >= LOW_FLOOR * W_CURRENT / W.
    const weightSim = {};
    for (const W of [0.70, 0.65, 0.60, 0.55, 0.50]) {
      const keepThreshold = LOW_FLOOR * (W_CURRENT / W); // min ORIGINAL edge retained
      const kept = rows.filter(r => r.edge >= keepThreshold);
      const dropped = rows.filter(r => r.edge < keepThreshold);
      weightSim[`W=${W.toFixed(2)} (${Math.round(W * 100)}/${Math.round((1 - W) * 100)})`] = {
        keepEdgeThresholdPct: r2(keepThreshold * 100),
        retained: summarize(kept),
        dropped_vs_current: summarize(dropped),
      };
    }

    const dates = rows.map(r => r.game_date).filter(Boolean).sort();
    res.json({
      note: "Read-only blend-weight backtest. Edge scales linearly with weight, so lower W only drops the smallest edges. Compare 'dropped' CLV: if negative, those picks hurt you and a lower weight is better; if positive, keep the weight.",
      liveWeight: `${W_CURRENT} (70/30)`,
      sampleSize: rows.length,
      dateRange: dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null,
      overall: summarize(rows),
      byMarket: {
        moneyline: summarize(rows.filter(r => r.market === "moneyline")),
        total: summarize(rows.filter(r => r.market === "total")),
      },
      byEdgeBucket: byBucket,
      weightSimulation: weightSim,
    });
  } catch (err) {
    console.error("[blenddiag] error:", err);
    res.status(500).json({ error: "blenddiag failed", details: err.message });
  }
});

module.exports = router;
