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
  getMLBStrikeoutPropsForAllEvents,
  getMLBHitsPropsForAllEvents,
  getMLBTotalBasesPropsForAllEvents,
  getMLBDoublesPropsForAllEvents,
  getMLBTriplesPropsForAllEvents,
  probeOddsCoverage,
  getNFLMainOdds,
  getCFBMainOdds,
} = require("../services/oddsApi");
const {
  calculateGameEdges,
  calculateHRPropEdges,
  calculateStrikeoutPropEdges,
  calculateStrikeoutShadow,
  calculateHitsPropEdges,
  calculateTotalBasesShadow,
  calculateDoublesBoard,
  calculateTriplesBoard,
  debugHitsProps,
} = require("../services/edgesModel");
const { recordPredictions, recordTotalBasesShadow, recordStrikeoutShadow } = require("../services/predictionTracker");
// In-memory cache
let edgesCache = null;
let edgesCacheAt = 0;
let edgesCacheDate = null; // which ET date the cached payload is for
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// Coalescing: true while a full board recompute is in progress, so concurrent cold
// requests wait for that single build instead of each launching their own (stampede +
// duplicate Odds API calls). Released in the handler's finally, so it can never get
// stuck set (no deadlock) even if the build throws.
let edgesBuilding = false;
// Team name normalization
function normalizeTeam(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/^(los angeles|new york|san francisco|san diego|st\.? louis|tampa bay|chicago|kansas city|washington|cleveland|cincinnati|colorado|arizona|atlanta|baltimore|boston|detroit|houston|miami|milwaukee|minnesota|oakland|philadelphia|pittsburgh|seattle|texas|toronto)\s+/i, "")
    .trim();
}
// Match a schedule game to its Odds API event. ORDER MATTERS: try an exact
// normalized match on BOTH teams first, and only fall back to loose substring
// matching if that loose match is UNIQUE. A non-unique or cross-day loose match
// is REJECTED (returns null) — assigning the wrong event silently staples another
// game's players onto this game's id, which then never grades. No odds beats wrong
// odds. Same-day is required; doubleheaders are split by closest start time.
function sameEtDay(ev, game) {
  const day = game.date || null;
  if (!day || !ev.commenceTime) return true; // can't compare → don't exclude
  try {
    const evDay = new Date(ev.commenceTime).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return evDay === day;
  } catch { return true; }
}
function closestByStart(events, game) {
  const t = game.startTimeUTC ? new Date(game.startTimeUTC).getTime() : null;
  if (t == null) return events[0];
  let best = events[0], bestDiff = Infinity;
  for (const ev of events) {
    if (!ev.commenceTime) continue;
    const diff = Math.abs(new Date(ev.commenceTime).getTime() - t);
    if (diff < bestDiff) { bestDiff = diff; best = ev; }
  }
  return best;
}
function matchOddsToGame(game, oddsEvents) {
  const awayN = normalizeTeam(game.away);
  const homeN = normalizeTeam(game.home);

  // Pass 1: exact normalized match on both teams, same ET day.
  const exact = oddsEvents.filter(ev =>
    normalizeTeam(ev.awayTeam) === awayN &&
    normalizeTeam(ev.homeTeam) === homeN &&
    sameEtDay(ev, game)
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return closestByStart(exact, game); // doubleheader

  // Pass 2: loose substring match on both teams, same ET day — ONLY if it resolves
  // to a single event (or a doubleheader of the same matchup). Guards against ""
  // (every string includes "") which would match everything.
  const loose = oddsEvents.filter(ev => {
    const ea = normalizeTeam(ev.awayTeam), eh = normalizeTeam(ev.homeTeam);
    const awayOk = !!ea && (awayN.includes(ea) || ea.includes(awayN));
    const homeOk = !!eh && (homeN.includes(eh) || eh.includes(homeN));
    return awayOk && homeOk && sameEtDay(ev, game);
  });
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) {
    // Accept only if all loose matches are the SAME matchup (a doubleheader);
    // if they disagree on teams, it's ambiguous → refuse rather than mis-assign.
    const sig = (ev) => normalizeTeam(ev.awayTeam) + "@" + normalizeTeam(ev.homeTeam);
    const allSame = loose.every(ev => sig(ev) === sig(loose[0]));
    if (allSame) return closestByStart(loose, game);
  }

  return null; // ambiguous or no match → no odds, never WRONG odds
}

// Decide which date to serve. If every one of today's games is final (or there
// are no games today), roll over to tomorrow. Postponed/cancelled don't count
// as "live/upcoming", so they don't block rollover.
async function resolveSlateDate() {
  const today = getEasternDate(0);
  let todayGames = [];
  try { todayGames = await getScheduleForDate(today); } catch (e) { todayGames = []; }

  const playable = todayGames.filter(g => g.status !== "postponed" && g.status !== "cancelled");

  // This board shows PRE-GAME edges/props, which only exist for not-yet-started
  // ("scheduled") games. So stay on today only while today still has a game that
  // hasn't started. The moment today's last game first-pitches, there are no
  // pre-game plays left today — roll forward to tomorrow's slate so the board,
  // the top edge, and the prop board keep showing upcoming opportunities instead
  // of sitting empty until the last out. Today's live/finished games are handled
  // separately by the in-game Live Edges section, so rolling here doesn't hide them.
  const anyPreGameToday = playable.some(g => g.status === "scheduled");

  if (anyPreGameToday) {
    return { date: today, rolled: false };
  }
  // No more pre-game games today (all started or finished) → roll to tomorrow.
  const tomorrow = getEasternDate(1);
  return { date: tomorrow, rolled: true };
}

// ── Main endpoint ─────────────────────────────────────────────────────────────
// ── TEMP read-only diagnostic (added 6/8) — REMOVE in the next cleanup ──────────
// The totals/ML twin of hits_debug. Lays bare HOW each team-market pick was
// assembled — base → adjustments → projected → gap-vs-line → prob → edge → pick —
// plus a live/defaulted flag on every input feed. Answers "how did it ever come
// up with that number." Built ENTIRELY from the model's existing return object;
// runs no new model calls and writes nothing. W_MODEL is 0.55 in edgesModel.js,
// so edge = 0.55 * (modelProb - marketFairProb); a tiny projection gap therefore
// yields a tiny "LOW" edge whose SIDE is essentially noise — that's the tell.
const NOISE_GAP_RUNS = 0.75;   // totals: |projected - line| under this ≈ noise pick
const THIN_EDGE = 0.025;       // ML: best edge under this ≈ noise pick
function buildEdgesDebug(gameEdges, gamesWithOdds, slateDate) {
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const rows = gameEdges.map((ge) => {
    const src = gamesWithOdds.find(g => g.id === ge.game.id);
    const t = ge.totals || {};
    const m = ge.moneyline || {};
    const bd = t.breakdown || {};
    const gap = (t.projected != null && t.line != null) ? r2(t.projected - t.line) : null;
    const totPick = (t.overEdge != null && t.underEdge != null)
      ? (t.overEdge >= t.underEdge ? "over" : "under") : null;
    const totEdge = totPick === "over" ? t.overEdge : totPick === "under" ? t.underEdge : null;
    const mlPick = (m.awayEdge != null && m.homeEdge != null)
      ? (m.awayEdge >= m.homeEdge ? "away" : "home") : null;
    const mlEdge = mlPick === "away" ? m.awayEdge : mlPick === "home" ? m.homeEdge : null;
    return {
      matchup: `${ge.game.awayAbbr}@${ge.game.homeAbbr}`,
      status: src?.status ?? null,
      feeds: {
        awayPitcher: ge.pitchers?.away?.stats ? "live" : "MISSING",
        homePitcher: ge.pitchers?.home?.stats ? "live" : "MISSING",
        weather: ge.weather ? (ge.weather.indoor ? "indoor" : "live") : "MISSING",
        bullpenAway: ge.bullpen?.away?.era != null ? "live" : "MISSING",
        bullpenHome: ge.bullpen?.home?.era != null ? "live" : "MISSING",
        lineupAway: ge.game?.lineups?.away?.source ?? "none",
        lineupHome: ge.game?.lineups?.home?.source ?? "none",
      },
      totals: {
        line: t.line, projected: t.projected,
        chain: {
          base: bd.base, pitcherAdj: bd.pitcherAdj, parkAdj: bd.parkAdj,
          weatherAdj: bd.weatherAdj, bullpenAdj: bd.bullpenAdj, fatigueAdj: bd.fatigueAdj,
        },
        gapVsLine: gap,
        overProb: t.overProb, overEdge: t.overEdge, underEdge: t.underEdge,
        pick: totPick, pickEdge: totEdge, confidence: totPick === "over" ? t.overConfidence : t.underConfidence,
        conviction: totPick === "over" ? t.overConviction : t.underConviction,
        noiseFlag: gap != null && Math.abs(gap) < NOISE_GAP_RUNS,
      },
      moneyline: {
        awayWinProb: m.awayWinProb, homeWinProb: m.homeWinProb,
        awayOdds: m.awayOdds, homeOdds: m.homeOdds,
        awayEdge: m.awayEdge, homeEdge: m.homeEdge,
        pick: mlPick, pickEdge: mlEdge, confidence: mlPick === "away" ? m.awayConfidence : m.homeConfidence,
        conviction: mlPick === "away" ? m.awayConviction : m.homeConviction,
        thinEdgeFlag: mlEdge != null && Math.abs(mlEdge) < THIN_EDGE,
      },
    };
  });
  const noiseTotals = rows.filter(r => r.totals.noiseFlag).length;
  const thinML = rows.filter(r => r.moneyline.thinEdgeFlag).length;
  const feedTally = (key) => rows.reduce((acc, r) => { const v = r.feeds[key]; acc[v] = (acc[v] || 0) + 1; return acc; }, {});
  return {
    ok: true, slateDate, games: rows.length,
    note: "edge = 0.55*(modelProb - marketFairProb); W_MODEL=0.55. noiseFlag = totals pick off a <0.75-run gap. thinEdgeFlag = ML edge <2.5%.",
    summary: {
      totalsPicksOnNoiseGap: `${noiseTotals}/${rows.length}`,
      mlPicksOnThinEdge: `${thinML}/${rows.length}`,
      feedHealth: {
        weather: feedTally("weather"), bullpenAway: feedTally("bullpenAway"),
        lineupAway: feedTally("lineupAway"), awayPitcher: feedTally("awayPitcher"),
      },
    },
    rows,
  };
}

// READ-ONLY HR FEED AUDIT (?hr_audit=1). Traces every input that feeds the HR
// prediction for today's actual picks and reports which are LIVE vs falling back —
// the standing "is everything still flowing?" check. The power factor silently
// reverts to ISO when Savant xwOBA/barrel are missing (the failure mode that ran
// dead for weeks), so feedHealth.powerFactor.savantPct is the number to watch: it
// should be ~100%. Builds purely from the already-computed edge objects (zero extra
// Odds-API cost). Each HR edge carries statcast.{xwobaSource,barrelSource,bbe},
// recent15, bvp, parkHRFactor, opposingPitcherHR9, weatherEffect, hrProb.
function summarizeHrFeeds(edges) {
  const list = edges || [];
  const n = list.length;
  const pct = (c) => n ? +(100 * c / n).toFixed(1) : null;
  let xwSavant = 0, xwStatcast = 0, xwNull = 0, brSavant = 0, brStatcast = 0, brNull = 0;
  let savantPower = 0, isoFallback = 0;
  let hasRecent = 0, hasBvp = 0, hasPark = 0, hasPitcherHR9 = 0, hasWeather = 0;
  const probs = [], rows = [];
  for (const e of list) {
    const sc = e.statcast || {};
    const xs = sc.xwobaSource || null;
    const bs = sc.barrelSource || null;
    if (xs === "savant") xwSavant++; else if (xs === "statcast") xwStatcast++; else xwNull++;
    if (bs === "savant") brSavant++; else if (bs === "statcast") brStatcast++; else brNull++;
    const powered = (xs === "savant" || xs === "statcast" || bs === "savant" || bs === "statcast");
    if (powered) savantPower++; else isoFallback++;
    if (e.recent15 && e.recent15.atBats) hasRecent++;
    if (e.bvp && e.bvp.atBats) hasBvp++;
    if (e.parkHRFactor != null && e.parkHRFactor !== 1) hasPark++;
    if (e.opposingPitcherHR9 != null) hasPitcherHR9++;
    if (e.weatherEffect != null) hasWeather++;
    if (e.hrProb != null) probs.push(e.hrProb);
    rows.push({
      player: e.player, hrProb: e.hrProb, edge: e.edge,
      xwOBA: sc.xwOBA ?? null, xwobaSource: xs,
      barrelRate: sc.barrelRate ?? null, barrelSource: bs, bbe: sc.bbe ?? null,
      power: powered ? "statcast/savant" : "ISO fallback",
      recent15AB: e.recent15 ? e.recent15.atBats : null,
      bvpAB: e.bvp ? e.bvp.atBats : null,
      parkHRFactor: e.parkHRFactor ?? null,
      oppPitcherHR9: e.opposingPitcherHR9 ?? null,
      weather: e.weatherEffect ?? null,
    });
  }
  probs.sort((a, b) => a - b);
  const mean = probs.length ? +(probs.reduce((a, b) => a + b, 0) / probs.length).toFixed(3) : null;
  return {
    n,
    feedHealth: {
      powerFactor: { savantOrStatcast: savantPower, isoFallback, savantPct: pct(savantPower) }, // KEY — want ~100%
      xwOBA: { savant: xwSavant, statcast: xwStatcast, missing: xwNull, savantPct: pct(xwSavant) },
      barrel: { savant: brSavant, statcast: brStatcast, missingOrThin: brNull, savantPct: pct(brSavant) },
      recent15: { present: hasRecent, pct: pct(hasRecent) },
      bvp: { present: hasBvp, pct: pct(hasBvp) },
      parkFactor: { nonNeutral: hasPark, pct: pct(hasPark) },
      pitcherHR9: { present: hasPitcherHR9, pct: pct(hasPitcherHR9) },
      weather: { present: hasWeather, pct: pct(hasWeather) },
    },
    hrProbDist: { n: probs.length, min: probs[0] ?? null, mean, max: probs[probs.length - 1] ?? null },
    rows: rows.slice(0, 30),
    note: "feedHealth.powerFactor.savantPct should be ~100%. If many rows show power:'ISO fallback', the Savant batter xwOBA/barrel feed is NOT reaching the HR power factor (silent-null failure). recent15/bvp/parkFactor/pitcherHR9/weather show whether each secondary feed reaches the projection.",
  };
}

router.get("/mlb", async (req, res) => {
  let weBuild = false;
  try {
    const { date: slateDate, rolled } = await resolveSlateDate();

    // Cache is valid only if it's fresh AND for the same date we now want to serve.
    if (!req.query.hits_debug && !req.query.edges_debug && !req.query.hr_audit && !req.query.tb_shadow && edgesCache && edgesCacheDate === slateDate && (Date.now() - edgesCacheAt) < CACHE_TTL_MS) {
      console.log(`[Edges] Returning cached results for ${slateDate}`);
      return res.json({ ...edgesCache, cached: true });
    }

    // Request coalescing — normal board requests only (debug modes bypass and compute
    // their own output). If another request is already rebuilding this slate, wait for
    // it to fill the cache instead of starting a duplicate recompute (which would also
    // duplicate Odds API calls). Bounded wait + finally-released flag => never stampedes
    // and never deadlocks.
    const isDebugQ = !!(req.query.hits_debug || req.query.edges_debug || req.query.hr_audit || req.query.tb_shadow);
    if (!isDebugQ) {
      if (edgesBuilding) {
        const t0 = Date.now();
        while (edgesBuilding && (Date.now() - t0) < 45000) {
          await new Promise((r) => setTimeout(r, 200));
          if (edgesCache && edgesCacheDate === slateDate && (Date.now() - edgesCacheAt) < CACHE_TTL_MS) {
            console.log(`[Edges] Coalesced onto in-flight build for ${slateDate}`);
            return res.json({ ...edgesCache, cached: true, coalesced: true });
          }
        }
        // Builder finished — serve its cache if present; else fall through and build.
        if (edgesCache && edgesCacheDate === slateDate && (Date.now() - edgesCacheAt) < CACHE_TTL_MS) {
          return res.json({ ...edgesCache, cached: true, coalesced: true });
        }
      }
      if (!edgesBuilding) { edgesBuilding = true; weBuild = true; }
    }

    console.log(`[Edges] Computing edges for ${slateDate}${rolled ? " (rolled over to next day)" : ""}`);
    const allGames = await getScheduleForDate(slateDate);
    const games = allGames.filter(g => g.status !== "postponed" && g.status !== "cancelled");
    console.log(`[Edges] Found ${games.length} MLB games for ${slateDate}`);
    if (games.length === 0) {
      const empty = { date: slateDate, rolledToNextDay: rolled, games: [], moneylineEdges: [], totalsEdges: [], runLineEdges: [], hrPropEdges: [], kPropEdges: [], hitsPropEdges: [], computedAt: new Date().toISOString() };
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
    if (req.query.edges_debug) {
      return res.json(buildEdgesDebug(gameEdges, gamesWithOdds, slateDate));
    }
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
    let kPropEdges = [];
    let hitsPropEdges = [];
    let tbPropEdges = [];
    let doublesPropEdges = [];
    let triplesPropEdges = [];
    let tbAutoEventIds = [];
    let tbAutoGames = [];
    let tbBoardResult = null; // computed TB shadow rows, reused by persistence below
    let kShadowResult = null; // computed K shadow rows, reused by persistence below
    try {
      // Take the first 5 not-yet-started games WITH ODDS for HR props.
      // Skip live/final games (sportsbooks pull or re-price HR props once underway).
      const eligibleGamesForHR = gamesWithOdds
        .filter(g => g._oddsEventId)
        .filter(g => isPreGame(g.status));
      const topGamesForHR = eligibleGamesForHR.slice(0, 5);
      const eventIds = topGamesForHR.map(g => g._oddsEventId);
      tbAutoEventIds = eventIds;
      tbAutoGames = topGamesForHR;
      console.log(`[Edges-HR] eligibleGames=${eligibleGamesForHR.length}, topGamesForHR=${topGamesForHR.length}, eventIds=${JSON.stringify(eventIds)}`);
      if (eventIds.length > 0) {
        const hrOddsByEvent = await getMLBHRPropsForAllEvents(eventIds, 10);
        hrPropEdges = await calculateHRPropEdges(topGamesForHR, hrOddsByEvent);
        if (req.query.hr_audit) {
          return res.json({ ok: true, slateDate, gamesUsed: topGamesForHR.map(g => `${g.awayAbbr}@${g.homeAbbr}`), ...summarizeHrFeeds(hrPropEdges) });
        }
        const kOddsByEvent = await getMLBStrikeoutPropsForAllEvents(eventIds, 10);
        kPropEdges = await calculateStrikeoutPropEdges(topGamesForHR, kOddsByEvent);
        // K projection SHADOW (log-only): reuse the SAME K odds (no extra fetch) to
        // project every starter's Ks regardless of side/edge, for the overprojection
        // diagnostic. Never blocks the response; persisted fire-and-forget below.
        try { kShadowResult = await calculateStrikeoutShadow(topGamesForHR, kOddsByEvent); }
        catch (e) { console.error("[Edges] K-shadow compute failed:", e.message); kShadowResult = null; }
        const hitsOddsByEvent = await getMLBHitsPropsForAllEvents(eventIds, 10);
        if (req.query.hits_debug) {
          const dbg = await debugHitsProps(topGamesForHR, hitsOddsByEvent);
          return res.json({ ok: true, slateDate, gamesUsed: topGamesForHR.map(g => `${g.awayAbbr}@${g.homeAbbr}`), count: dbg.length, hits_debug: dbg });
        }
        hitsPropEdges = await calculateHitsPropEdges(topGamesForHR, hitsOddsByEvent);
        // ── EXPERIMENTAL rare-hit boards: TB / Doubles / Triples ─────────────
        // Same pre-game feed as TB shadow. Ranked by likelihood (uncalibrated —
        // shown like the HR board, no edge claims). Fully wrapped; never blocks
        // or breaks the normal response. The TB result is reused below for the
        // shadow persistence so TB odds aren't fetched twice.
        try {
          const tbOddsByEvent = await getMLBTotalBasesPropsForAllEvents(eventIds, 10);
          tbBoardResult = await calculateTotalBasesShadow(topGamesForHR, tbOddsByEvent);
          tbPropEdges = [...tbBoardResult].sort((a, b) => (b.overProb ?? 0) - (a.overProb ?? 0));
          const dblOddsByEvent = await getMLBDoublesPropsForAllEvents(eventIds, 10);
          doublesPropEdges = await calculateDoublesBoard(topGamesForHR, dblOddsByEvent);
          const triOddsByEvent = await getMLBTriplesPropsForAllEvents(eventIds, 10);
          triplesPropEdges = await calculateTriplesBoard(topGamesForHR, triOddsByEvent);
        } catch (e) {
          console.error("[Edges] rare-hit boards (TB/2B/3B) failed:", e.message);
        }
        // ── TOTAL BASES SHADOW (read-only, opt-in via ?tb_shadow=1) ──────────
        // Fetches TB odds + runs the logged-only projection model. Returns the
        // projections as JSON and does NOT alter the normal edges response. Safe
        // to run on a live slate — prices nothing.
        if (req.query.tb_shadow) {
          const tbOddsByEvent = await getMLBTotalBasesPropsForAllEvents(eventIds, 10);
          const tbShadow = await calculateTotalBasesShadow(topGamesForHR, tbOddsByEvent);
          return res.json({
            ok: true, slateDate, mode: "tb_shadow_readonly",
            gamesUsed: topGamesForHR.map(g => `${g.awayAbbr}@${g.homeAbbr}`),
            count: tbShadow.length, tb_shadow: tbShadow,
          });
        }
      } else {
        console.log("[Edges-HR] NO eventIds — HR props skipped");
        if (req.query.hits_debug) return res.json({ ok: true, slateDate, note: "no pre-game games with odds right now — try when tonight's slate is upcoming", hits_debug: [] });
        if (req.query.hr_audit) return res.json({ ok: true, slateDate, note: "no pre-game games with odds right now — run when tonight's slate is upcoming", n: 0 });
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
      kPropEdges: kPropEdges.slice(0, 25),
      hitsPropEdges: hitsPropEdges.slice(0, 25),
      tbPropEdges: tbPropEdges.slice(0, 25),
      doublesPropEdges: doublesPropEdges.slice(0, 25),
      triplesPropEdges: triplesPropEdges.slice(0, 25),
      computedAt: new Date().toISOString(),
      cached: false,
    };
    edgesCache = result;
    edgesCacheAt = Date.now();
    edgesCacheDate = slateDate;

    // Snapshot predictions for performance tracking (fire-and-forget; deduped by
    // unique constraint so repeated computes during the day are no-ops).
    recordPredictions(result).catch(e => console.error("[Edges] recordPredictions failed:", e.message));

    // Total Bases SHADOW (log-only): auto-compute + persist once per fresh slate
    // so projections accumulate for grading without manually hitting ?tb_shadow=1.
    // Fully fire-and-forget and self-contained — never blocks or breaks the
    // response, and prices nothing. Deduped by the unique constraint.
    if (typeof tbAutoEventIds !== "undefined" && tbAutoEventIds.length > 0) {
      (async () => {
        try {
          // Reuse the TB rows already computed for the board above; only recompute
          // if the board path didn't run (e.g. errored) so grading never starves.
          let tbShadow = tbBoardResult;
          if (!tbShadow) {
            const tbOddsByEvent = await getMLBTotalBasesPropsForAllEvents(tbAutoEventIds, 10);
            tbShadow = await calculateTotalBasesShadow(tbAutoGames, tbOddsByEvent);
          }
          await recordTotalBasesShadow(tbShadow, slateDate);
        } catch (e) {
          console.error("[Edges] TB-shadow auto-run failed:", e.message);
        }
      })();
    }

    // K projection SHADOW (log-only): persist every starter's K projection so the
    // strikeout overprojection accumulates for grading vs actual Ks AND IP. Reuses
    // the rows computed above (same K odds, no extra fetch); recomputes only if that
    // path didn't run, so grading never starves. Fire-and-forget; prices nothing.
    if (typeof tbAutoEventIds !== "undefined" && tbAutoEventIds.length > 0) {
      (async () => {
        try {
          let kShadow = kShadowResult;
          if (!kShadow) {
            const kOddsByEvent2 = await getMLBStrikeoutPropsForAllEvents(tbAutoEventIds, 10);
            kShadow = await calculateStrikeoutShadow(tbAutoGames, kOddsByEvent2);
          }
          await recordStrikeoutShadow(kShadow, slateDate);
        } catch (e) {
          console.error("[Edges] K-shadow auto-run failed:", e.message);
        }
      })();
    }

    res.json(result);
  } catch (err) {
    console.error("[Edges] Error:", err);
    res.status(500).json({ error: "Failed to compute edges", details: err.message });
  } finally {
    if (weBuild) edgesBuilding = false;
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

// Intraday odds tick series for today's MLB games → powers the Home line-movement
// chart + real Market Movers. Reads the odds_ticks table the cron writes (last ~20h).
router.get("/odds-history/mlb", async (req, res) => {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return res.json({ ok: false, games: [] });
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const sinceIso = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
    // Supabase/PostgREST caps a single .select() at 1000 rows and silently
    // returns only that many. A busy slate puts well over 1000 tick rows in a
    // 20h window, and because we order ASCENDING (oldest first), the cap drops
    // the NEWEST ticks — which freezes Market Movers and the line chart at
    // whatever time the 1000th-oldest row landed. (It looks like the capture
    // died, but the recent rows just never get returned.) Page through the whole
    // window so every recent tick is included.
    const PAGE = 1000;
    let rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("odds_ticks")
        .select("away_team,home_team,market,side,line,odds,captured_at")
        .gte("captured_at", sinceIso)
        .order("captured_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return res.json({ ok: false, games: [], error: error.message });
      if (!data || data.length === 0) break;
      rows = rows.concat(data);
      if (data.length < PAGE) break;
    }
    const games = {};
    for (const r of rows) {
      const key = r.away_team + "|" + r.home_team;
      if (!games[key]) games[key] = { away_team: r.away_team, home_team: r.home_team, ml: { away: [], home: [] }, total: { line: null, over: [], under: [] } };
      const g = games[key];
      const pt = { o: r.odds, t: r.captured_at };
      if (r.market === "ml" && (r.side === "away" || r.side === "home")) g.ml[r.side].push(pt);
      else if (r.market === "total" && (r.side === "over" || r.side === "under")) { g.total[r.side].push(pt); if (r.line != null) g.total.line = r.line; }
    }
    res.json({ ok: true, games: Object.values(games) });
  } catch (e) {
    res.json({ ok: false, games: [], error: e.message });
  }
});

// ── Data health check ─────────────────────────────────────────────────────────
// Read-only. Unlike /api/health (which only says "the process is up"), this says
// "the data PIPELINES are actually producing fresh data." Point a second
// UptimeRobot monitor at /api/edges/health-data; it returns HTTP 503 the moment
// a pipeline goes stale, so you get an email instead of finding it days later.
//
//   • oddsTicks  — newest odds_ticks row must be recent during the capture
//                  window (this is the exact signal that went dark this session).
//   • edgeBoard  — resolveSlateDate + schedule fetch must run without erroring;
//                  reports which slate is being served and the game count so the
//                  board state is visible at a glance (does NOT hard-fail on a
//                  legitimate no-games day — only on an actual pipeline error).
const TICK_STALE_MIN = 45; // ~3 missed 15-min capture cycles before we alarm
router.get("/health-data", async (req, res) => {
  const checks = {};
  let healthy = true;

  // Are we inside the odds-tick capture window (11:00–02:59 ET)? Stale ticks
  // outside the window are expected and must NOT trigger a false alarm.
  const etHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false })
  );
  const inCaptureWindow = etHour >= 11 || etHour <= 2;

  // 1) Odds-tick freshness.
  try {
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await sb
      .from("odds_ticks")
      .select("captured_at")
      .order("captured_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const newestMs = data && data[0] ? new Date(data[0].captured_at).getTime() : null;
    const ageMin = newestMs != null ? Math.round((Date.now() - newestMs) / 60000) : null;
    const stale = ageMin == null || ageMin > TICK_STALE_MIN;
    const ok = !(inCaptureWindow && stale); // only a failure if stale DURING the window
    checks.oddsTicks = {
      ok,
      newest: newestMs != null ? new Date(newestMs).toISOString() : null,
      ageMinutes: ageMin,
      inCaptureWindow,
      staleThresholdMin: TICK_STALE_MIN,
    };
    if (!ok) healthy = false;
  } catch (e) {
    checks.oddsTicks = { ok: false, error: e.message };
    healthy = false;
  }

  // 2) Edge-board pipeline. Hard-fail only if it ERRORS; a real no-games day
  //    (e.g. All-Star break) legitimately returns 0 and must not alarm.
  try {
    const { date, rolled } = await resolveSlateDate();
    const games = await getScheduleForDate(date);
    const gameCount = Array.isArray(games) ? games.length : 0;
    checks.edgeBoard = { ok: true, slateDate: date, rolledToTomorrow: rolled, gameCount };
  } catch (e) {
    checks.edgeBoard = { ok: false, error: e.message };
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({ ok: healthy, checkedAt: new Date().toISOString(), checks });
});

// ── Market Read ───────────────────────────────────────────────────────────────
// A read on what the BOOKS are collectively saying per game: who they favor, how
// likely (de-vigged implied %), and how CONFIDENT the market is (price agreement
// across books → Strong/Soft/Split). Adds the model as a second opinion and an
// honest line-move read. Its own endpoint so it can never destabilize /mlb.
//
// The move read is honest about our data: we log the BEST line over time (not each
// book), so we say "the market moved +N¢ toward X today" — never "N books moved"
// until per-book history (now being captured) has accumulated.
function mrAmCents(a) { if (a == null || isNaN(a)) return null; const n = Number(a); return n >= 100 ? n - 100 : n <= -100 ? n + 100 : 0; }
function mrMoveFromSeries(series) {
  // series: [{o,t}...] best-line ticks for one side. Returns signed cent move
  // open→now, or null if not enough ticks. Positive = price lengthened (drifting),
  // negative = shortened (money coming in). We invert to "toward favorite" later.
  if (!Array.isArray(series) || series.length < 2) return null;
  const open = mrAmCents(series[0].o), now = mrAmCents(series[series.length - 1].o);
  if (open == null || now == null) return null;
  return now - open;
}

router.get("/market-read/mlb", async (req, res) => {
  try {
    const { date: slateDate, rolled } = await resolveSlateDate();
    const allGames = await getScheduleForDate(slateDate);
    const games = allGames.filter(g => g.status !== "postponed" && g.status !== "cancelled");
    if (games.length === 0) {
      return res.json({ ok: true, date: slateDate, rolledToNextDay: rolled, games: [], computedAt: new Date().toISOString() });
    }

    let oddsEvents = [];
    try { oddsEvents = await getMLBMainOdds(); }
    catch (e) { console.error("[MarketRead] odds fetch failed:", e.message); }

    const gamesWithOdds = games.map(g => {
      const oddsMatch = matchOddsToGame(g, oddsEvents);
      return { ...g, _oddsMatch: oddsMatch, _oddsEventId: oddsMatch?.eventId };
    });

    const allEdges = await Promise.all(
      gamesWithOdds.map(g => calculateGameEdges(g, g._oddsMatch).catch(() => null))
    );
    const gameEdges = allEdges.filter(Boolean);

    // Best-line history for the honest market-move read (last ~20h of ticks).
    const histByKey = {};
    try {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
        const { createClient } = require("@supabase/supabase-js");
        const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const sinceIso = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
        const PAGE = 1000; let rows = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await sb.from("odds_ticks")
            .select("away_team,home_team,market,side,odds,captured_at")
            .gte("captured_at", sinceIso).eq("market", "ml")
            .order("captured_at", { ascending: true }).range(from, from + PAGE - 1);
          if (error || !data || data.length === 0) break;
          rows = rows.concat(data);
          if (data.length < PAGE) break;
        }
        for (const r of rows) {
          const key = r.away_team + "|" + r.home_team;
          if (!histByKey[key]) histByKey[key] = { away: [], home: [] };
          if (r.side === "away" || r.side === "home") histByKey[key][r.side].push({ o: r.odds, t: r.captured_at });
        }
      }
    } catch (_) { /* move read just goes quiet if history is unavailable */ }

    const MOVE_MIN_CENTS = 12; // a move must clear this to be "convincing"
    const isPreGame = (status) => status === "scheduled";

    const out = [];
    for (const ge of gameEdges) {
      const sourceGame = gamesWithOdds.find(g => g.id === ge.game.id);
      if (!isPreGame(sourceGame?.status)) continue;
      const odds = sourceGame?._oddsMatch;
      const mr = odds?.marketRead;
      if (!mr) continue;

      // Model second-opinion per market (which side the model leans + its prob).
      const m = ge.moneyline || {};
      const t = ge.totals || {};
      const rl = ge.runLine || {};

      // Honest market-move read for the WIN market (best-line series).
      let move = null;
      const hk = histByKey[(ge.game.away) + "|" + (ge.game.home)];
      if (hk && mr.win) {
        const favSeries = mr.win.favSide === "home" ? hk.home : hk.away;
        const d = mrMoveFromSeries(favSeries); // + = drifted (off fav), − = shortened (toward fav)
        if (d != null && Math.abs(d) >= MOVE_MIN_CENTS) {
          move = { towardFav: d < 0, cents: Math.abs(d) };
        }
      }

      out.push({
        gameId: ge.game.id,
        away: ge.game.away, home: ge.game.home,
        awayAbbr: ge.game.awayAbbr, homeAbbr: ge.game.homeAbbr,
        time: ge.game.time,
        win: mr.win ? {
          ...mr.win,
          bestPrice: mr.win.favSide === "home" ? odds.h2h?.home : odds.h2h?.away,
          bestBook: mr.win.favSide === "home" ? odds.h2h?.homeBook : odds.h2h?.awayBook,
          model: {
            favSide: (m.homeWinProb ?? 0) >= (m.awayWinProb ?? 0) ? "home" : "away",
            favTeam: (m.homeWinProb ?? 0) >= (m.awayWinProb ?? 0) ? ge.game.home : ge.game.away,
            prob: Math.round(Math.max(m.awayWinProb ?? 0, m.homeWinProb ?? 0) * 100),
            agrees: ((m.homeWinProb ?? 0) >= (m.awayWinProb ?? 0) ? "home" : "away") === mr.win.favSide,
          },
          move,
        } : null,
        total: mr.total ? {
          ...mr.total,
          bestOver: odds.totals?.over, bestOverBook: odds.totals?.overBook,
          bestUnder: odds.totals?.under, bestUnderBook: odds.totals?.underBook,
          model: (t.overProb != null || t.underProb != null) ? {
            favSide: (t.overProb ?? 0) >= (t.underProb ?? 0) ? "over" : "under",
            prob: Math.round(Math.max(t.overProb ?? 0, t.underProb ?? 0) * 100),
            agrees: ((t.overProb ?? 0) >= (t.underProb ?? 0) ? "over" : "under") === mr.total.favSide,
          } : null,
        } : null,
        cover: mr.cover ? {
          ...mr.cover,
          bestPrice: mr.cover.favSide === "home" ? odds.spreads?.home : odds.spreads?.away,
          bestBook: mr.cover.favSide === "home" ? odds.spreads?.homeBook : odds.spreads?.awayBook,
          model: (rl.awayCoverProb != null || rl.homeCoverProb != null) ? {
            favSide: (rl.homeCoverProb ?? 0) >= (rl.awayCoverProb ?? 0) ? "home" : "away",
            prob: Math.round(Math.max(rl.awayCoverProb ?? 0, rl.homeCoverProb ?? 0) * 100),
            agrees: ((rl.homeCoverProb ?? 0) >= (rl.awayCoverProb ?? 0) ? "home" : "away") === mr.cover.favSide,
          } : null,
        } : null,
      });
    }

    res.json({ ok: true, date: slateDate, rolledToNextDay: rolled, games: out, computedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[MarketRead] error:", e.message);
    res.status(500).json({ ok: false, games: [], error: e.message });
  }
});

// ── TEMP DIAGNOSTIC: K-prop + TB-shadow grade backtests (read-only) ──────────
// These re-measure the 2026-06-17 model tuning against GRADED history in
// model_predictions. Read-only: they query, bucket, and summarize — they write
// nothing and price nothing. REMOVE once we've read what we need.
//
// ROI convention: 1 unit staked per resolved pick; pushes are excluded from both
// the numerator and the denominator (stake refunded). Profit on a win uses the
// pick's stored American odds. calibrationGap = mean(model_prob of the picked
// side) − actual win rate; POSITIVE = the model was overconfident.

// Local rounder (predictionTracker has its own; edges.js needs its own copy).
function _round4(n) { return n == null ? null : Math.round(n * 10000) / 10000; }

// American odds → decimal profit returned on a 1-unit win (e.g. -110 → 0.909).
function _winProfit(odds) {
  const n = Number(odds);
  if (!isFinite(n) || n === 0) return null;
  return n > 0 ? n / 100 : 100 / Math.abs(n);
}

// Summarize a set of graded rows into n / W-L-P / win% / ROI / mean-prob / gap.
function _summarizeGraded(rows) {
  let w = 0, l = 0, p = 0, profit = 0, probSum = 0, probN = 0;
  for (const r of rows) {
    if (r.result === "push") { p++; continue; }
    if (r.result === "win") {
      w++;
      const wp = _winProfit(r.odds);
      if (wp != null) profit += wp;
    } else if (r.result === "loss") {
      l++;
      profit -= 1;
    } else {
      continue; // pending/other — ignore
    }
    if (r.model_prob != null) { probSum += Number(r.model_prob); probN++; }
  }
  const decided = w + l;
  const winRate = decided ? w / decided : null;
  const meanProb = probN ? probSum / probN : null;
  return {
    n: decided, wins: w, losses: l, pushes: p,
    winRate: winRate != null ? _round4(winRate) : null,
    roi: decided ? _round4(profit / decided) : null,
    meanModelProb: meanProb != null ? _round4(meanProb) : null,
    calibrationGap: (meanProb != null && winRate != null) ? _round4(meanProb - winRate) : null,
  };
}

// Pull ALL graded rows for a market (paginated; Supabase caps at 1000/req).
async function _fetchGraded(sb, market, since) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("model_predictions")
      .select("market,selection,line,edge,odds,model_prob,result,actual_value,game_date,confidence")
      .eq("league", "mlb")
      .eq("market", market)
      .in("result", ["win", "loss", "push"])
      .order("game_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) q = q.gte("game_date", since);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

// GET /api/edges/kgrade[?since=YYYY-MM-DD]
// Strikeout-prop backtest. Overall + by edge band + by side. The 2026-06-17
// K_MIN_EDGE=0.10 gate should leave the [0.05,0.10) band EMPTY for picks recorded
// after the deploy — pass ?since=2026-06-17 to confirm, and watch ROI move toward
// break-even and calibrationGap shrink from its prior +0.121.
router.get("/kgrade", async (req, res) => {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: "Supabase env not set" });
    }
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const since = req.query.since || null;
    const rows = await _fetchGraded(sb, "player_strikeouts", since);

    const BANDS = [[0.05, 0.10], [0.10, 0.15], [0.15, 0.20], [0.20, Infinity]];
    const byBand = BANDS.map(([lo, hi]) => ({
      band: hi === Infinity ? `>=${lo}` : `${lo}-${hi}`,
      ...(_summarizeGraded(rows.filter(r => r.edge != null && r.edge >= lo && r.edge < hi))),
    }));
    const sideOf = (r) => { const c = String(r.selection || "").lastIndexOf(":"); return c >= 0 ? r.selection.slice(c + 1).toUpperCase() : "OVER"; };

    res.json({
      ok: true, market: "player_strikeouts", since: since || "all",
      dateRange: rows.length ? { first: rows[0].game_date, last: rows[rows.length - 1].game_date } : null,
      overall: _summarizeGraded(rows),
      bySide: {
        OVER: _summarizeGraded(rows.filter(r => sideOf(r) === "OVER")),
        UNDER: _summarizeGraded(rows.filter(r => sideOf(r) === "UNDER")),
      },
      byEdgeBand: byBand,
      note: "ROI per resolved pick (pushes excluded). calibrationGap = meanModelProb - winRate; positive = overconfident. Want ROI toward 0 and the 0.05-0.10 band empty for post-deploy picks.",
    });
  } catch (e) {
    console.error("[kgrade] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/edges/tbgrade[?since=YYYY-MM-DD]
// Total-bases shadow backtest, split by line (0.5 vs 1.5). All TB-shadow rows are
// the OVER side, so winRate = how often the claimed over actually cashed, and
// calibrationGap = claimed overProb − that rate (the overconfidence we're hunting).
// NOTE: TB-shadow logs odds at a flat -110, so its ROI is purely a win-rate proxy.
// After the 2026-06-17 haircut, the 1.5-line overconfidence gap should shrink.
router.get("/tbgrade", async (req, res) => {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: "Supabase env not set" });
    }
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const since = req.query.since || null;
    const rows = await _fetchGraded(sb, "player_total_bases_shadow", since);

    const lineBucket = (v) => (v === 0.5 ? "0.5" : v === 1.5 ? "1.5" : `other(${v})`);
    const buckets = {};
    for (const r of rows) { (buckets[lineBucket(r.line)] ||= []).push(r); }
    const byLine = {};
    for (const k of Object.keys(buckets)) byLine[k] = _summarizeGraded(buckets[k]);

    res.json({
      ok: true, market: "player_total_bases_shadow", since: since || "all",
      dateRange: rows.length ? { first: rows[0].game_date, last: rows[rows.length - 1].game_date } : null,
      overall: _summarizeGraded(rows),
      byLine,
      note: "All rows are the OVER side, so winRate = actual over-hit rate and calibrationGap = claimed overProb - that rate (positive = overconfident). Odds are a flat -110, so ROI here is a win-rate proxy. Watch the 1.5-line gap shrink after the haircut.",
    });
  } catch (e) {
    console.error("[tbgrade] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── TEMP DIAGNOSTIC: odds coverage probe (read-only) ─────────────────────────
// Answers ONE question before any football build starts: does The Odds API
// actually return lines for a given sport through THIS key/plan right now?
// Calls the existing probeOddsCoverage() — reads once, writes nothing, prices
// nothing. Defaults to NFL since that's the Phase-2 question on the table.
//   /api/edges/oddsprobe                         → NFL (americanfootball_nfl)
//   /api/edges/oddsprobe?sport=americanfootball_ncaaf   → CFB
//   /api/edges/oddsprobe?sport=icehockey_nhl            → NHL
//   /api/edges/oddsprobe?sport=baseball_mlb             → MLB (sanity check)
//   &regions=us,us2,eu &markets=h2h,totals,spreads      → widen coverage
// A 422 in the response = that sport isn't enabled on the current plan.
router.get("/oddsprobe", async (req, res) => {
  try {
    const sport = req.query.sport || "americanfootball_nfl";
    const regions = req.query.regions || "us";
    const markets = req.query.markets || "h2h,totals,spreads";
    const result = await probeOddsCoverage({ sport, regions, markets });
    res.json(result);
  } catch (e) {
    console.error("[oddsprobe] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── TEMP DIAGNOSTIC: parsed football odds (read-only) ────────────────────────
// Shows what getNFLMainOdds/getCFBMainOdds actually produce through the full
// parser (best-price line shop + consensus lines + Market Read) — the exact shape
// the football edge model will consume. Confirms the parser works on LIVE data,
// not just the unit test. Read-only; uses the 30-min cache like the board does.
//   /api/edges/fballodds            → NFL, first 5 parsed games
//   /api/edges/fballodds?league=cfb → CFB
//   &n=10                           → show more games
router.get("/fballodds", async (req, res) => {
  try {
    const league = (req.query.league || "nfl").toLowerCase();
    const n = Math.min(Math.max(parseInt(req.query.n, 10) || 5, 1), 30);
    const games = league === "cfb" ? await getCFBMainOdds() : await getNFLMainOdds();
    // Summarize: how many games have each market priced (the "is it flowing" signal).
    const withMl = games.filter(g => g.h2h.away != null && g.h2h.home != null).length;
    const withTot = games.filter(g => g.totals.line != null).length;
    const withSpr = games.filter(g => g.spreads.awayLine != null).length;
    res.json({
      ok: true, league, totalGames: games.length,
      priced: { moneyline: withMl, totals: withTot, spreads: withSpr },
      sample: games.slice(0, n),
      note: "READ-ONLY parsed odds via the same parser the football edge model will use. priced.* = how many games have a usable line for that market (the flowing check). h2h/totals/spreads carry best price + book; marketRead = the books' consensus lean per market.",
    });
  } catch (e) {
    console.error("[fballodds] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── TEMP DIAGNOSTIC: NFL 2025 season-stats shape probe (read-only) ───────────
// Reveals the REAL ESPN field names for 2025 team strength data (standings PF/PA,
// per-team offensive/defensive stat categories) so the power-rating seed is built
// on confirmed fields, not guesses. Read-only inspection; writes nothing.
//   /api/edges/nflseasonprobe            → 2025
//   /api/edges/nflseasonprobe?season=2024
router.get("/nflseasonprobe", async (req, res) => {
  try {
    const season = parseInt(req.query.season, 10) || 2025;
    const { fetchSeasonProbe } = require("../services/nflDataSource");
    const result = await fetchSeasonProbe(season);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("[nflseasonprobe] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── TEMP DIAGNOSTIC: CFB 2025 season-stats shape probe (read-only) ───────────
// The college-football ratings seed needs real per-team PF/PA, but CFB has ~134 FBS
// teams across ~11 conferences. This reveals ESPN's college standings shape and —
// crucially — whether ONE standings call carries PF/PA for every FBS team (cheap
// seed) vs needing a 134-team loop. Read-only inspection; writes nothing.
//   /api/edges/cfbseasonprobe            → 2025
//   /api/edges/cfbseasonprobe?season=2024
router.get("/cfbseasonprobe", async (req, res) => {
  try {
    const season = parseInt(req.query.season, 10) || 2025;
    const { fetchSeasonProbe } = require("../services/cfbDataSource");
    const result = await fetchSeasonProbe(season);
    res.json({ ok: true, league: "cfb", ...result });
  } catch (e) {
    console.error("[cfbseasonprobe] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── TEMP DIAGNOSTIC: CFB FBS-list + PF/PA source probe (read-only) ───────────
// Probe #1 showed site standings empty + /teams?groups=80 unfiltered, so this
// confirms the real FBS membership (core group-80 teams ~134) and a clean per-team
// points-for/against (core record endpoint) before the ratings seed is built.
//   /api/edges/cfbpointsprobe[?season=2025]
router.get("/cfbpointsprobe", async (req, res) => {
  try {
    const season = parseInt(req.query.season, 10) || 2025;
    const { fetchPointsProbe } = require("../services/cfbDataSource");
    const result = await fetchPointsProbe(season);
    res.json({ ok: true, league: "cfb", ...result });
  } catch (e) {
    console.error("[cfbpointsprobe] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── CFB POWER RATINGS (read-only) ───────────────────────────────────────────
// Runs buildTeamRatings over the ~146 FBS teams and returns the seeded ratings,
// ranked best→worst, so the loop + PF/PA seed can be sanity-checked (do the real
// powers land on top?) BEFORE the model consumes them. 2025 seed, FBS only.
//   /api/edges/cfbratings[?season=2025]
router.get("/cfbratings", async (req, res) => {
  try {
    const season = parseInt(req.query.season, 10) || 2025;
    const { buildTeamRatings } = require("../services/cfbDataSource");
    const result = await buildTeamRatings(season);
    const ranked = Object.values(result.teams || {})
      .sort((a, b) => (b.rating ?? -99) - (a.rating ?? -99))
      .map(t => ({ abbr: t.abbr, name: t.name, rating: t.rating, rawRating: Math.round(t.rawRating * 100) / 100, record: `${t.wins}-${t.losses}`, pf: t.pf, pa: t.pa, diff: t.diff }));
    res.json({ ok: true, season: result.season, fbsListed: result.fbsListed, rated: result.rated, meanRawDiffPerGame: result.meanRawDiffPerGame, regression: result.regression, note: result.note, ranked });
  } catch (e) {
    console.error("[cfbratings] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── TEMP DIAGNOSTIC: NFL points-for/against source probe (read-only) ─────────
// Finds a clean PF/PA source (core-API record + core standings) since the site
// standings came back empty. Read-only inspection.
//   /api/edges/nflpointsprobe[?season=2025]
router.get("/nflpointsprobe", async (req, res) => {
  try {
    const season = parseInt(req.query.season, 10) || 2025;
    const { fetchPointsProbe } = require("../services/nflDataSource");
    const result = await fetchPointsProbe(season);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("[nflpointsprobe] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── TEMP DIAGNOSTIC: NFL power ratings (read-only) ───────────────────────────
// Runs buildTeamRatings over all 32 teams and returns the seeded power ratings
// (league-centered, regressed points differential from 2025). Confirms the
// 32-team loop flows cleanly before ratings are wired into the model. Read-only.
//   /api/edges/nflratings[?season=2025]
router.get("/nflratings", async (req, res) => {
  try {
    const season = parseInt(req.query.season, 10) || 2025;
    const { buildTeamRatings } = require("../services/nflDataSource");
    const result = await buildTeamRatings(season);
    // Sort teams by rating (best → worst) for an at-a-glance sanity check.
    const ranked = Object.values(result.teams || {})
      .sort((a, b) => (b.rating ?? -99) - (a.rating ?? -99))
      .map(t => ({ abbr: t.abbr, name: t.name, rating: t.rating, rawRating: Math.round(t.rawRating * 100) / 100, record: `${t.wins}-${t.losses}`, pf: t.pf, pa: t.pa, diff: t.diff }));
    res.json({ ok: true, season: result.season, rated: result.rated, meanRawDiffPerGame: result.meanRawDiffPerGame, regression: result.regression, note: result.note, ranked });
  } catch (e) {
    console.error("[nflratings] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── NFL EDGES (Phase 2 — runs the full slate through the model) ──────────────
// Ties odds (F2) + power ratings (F3c) + model (F3a) into a predicted slate with
// edges. GATED FOR HONESTY: ratings are a 2025 seed against (currently) preseason
// 2026 lines, so nothing here is calibrated — the response carries calibrated:false
// and preseason flags, and the model only marks value:true on a rated, trustworthy,
// meaningful edge. This is the data the NFL dashboard will render (F4b), behind a
// clear "preseason / uncalibrated" label. Read-only.
//   /api/edges/nfl[?season=2025]
router.get("/nfl", async (req, res) => {
  try {
    const season = parseInt(req.query.season, 10) || 2025;
    // weeks: default 1 (show only the next NFL week so each team appears once,
    // like the MLB board). ?weeks=0 returns the full multi-week lookahead slate.
    const weeksParam = req.query.weeks != null ? parseInt(req.query.weeks, 10) : 1;
    const weeks = Number.isFinite(weeksParam) && weeksParam >= 0 ? weeksParam : 1;
    const phase = (req.query.phase === "preseason" || req.query.phase === "regular") ? req.query.phase : null;
    const { runNFLSlate } = require("../services/nflEdges");
    const slate = await runNFLSlate({ season, weeks, phase });

    // Surface only games that produced at least one model edge value, plus the
    // full board for transparency. Sort published edges by size (desc).
    const allGames = slate.games || [];
    const edges = [];
    for (const g of allGames) {
      for (const mkt of ["moneyline", "spread", "total"]) {
        const m = g[mkt];
        if (m && m.value && m.edge != null) {
          edges.push({
            matchup: g.matchup, market: mkt, edge: m.edge,
            pick: m.pickTeam || m.pick, dataQuality: g.dataQuality,
            commenceTime: g.commenceTime,
          });
        }
      }
    }
    edges.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));

    // ── Dashboard-compatible shape ───────────────────────────────────────────
    // The Home board consumes moneylineEdges/spreadEdges/totalsEdges arrays with
    // { gameId, side, matchup, edge, odds, modelProb, line, convictionScore, ... }
    // (same contract as the NBA feed: edge is already a % number for non-MLB).
    // We flatten the per-game model output into those arrays so the existing board
    // renders NFL with no frontend special-casing. value:false rows are included
    // so the board isn't empty, but every edge is provisional (calibrated:false).
    const moneylineEdges = [], spreadEdges = [], totalsEdges = [];
    const teamsOf = (matchup) => { const p = String(matchup || "").split(" @ "); return { away: p[0] || "", home: p[1] || "" }; };
    for (const g of allGames) {
      const { away, home } = teamsOf(g.matchup);
      const ml = g.moneyline;
      if (ml && ml.edge != null && ml.fair) {
        const pickHome = (ml.homeWinProb ?? 0) - (ml.fair.home ?? 0) >= (ml.awayWinProb ?? 0) - (ml.fair.away ?? 0);
        moneylineEdges.push({
          gameId: g.eventId, side: pickHome ? "home" : "away",
          matchup: g.matchup, teamAbbr: pickHome ? home : away,
          edge: ml.edge, odds: pickHome ? ml.book?.home : ml.book?.away,
          modelProb: (pickHome ? ml.homeWinProb : ml.awayWinProb) / 100,
          line: null, convictionScore: null, conviction: null,
          provisional: true,
        });
      }
      const sp = g.spread;
      if (sp && sp.edge != null && sp.fair) {
        const pickHome = (sp.homeCoverProb ?? 0) >= 50;
        spreadEdges.push({
          gameId: g.eventId, side: pickHome ? "home" : "away",
          matchup: g.matchup, teamAbbr: pickHome ? home : away,
          edge: sp.edge, odds: pickHome ? sp.book?.home : sp.book?.away,
          modelProb: (pickHome ? sp.homeCoverProb : (100 - sp.homeCoverProb)) / 100,
          line: pickHome ? sp.line : -sp.line, convictionScore: null, conviction: null,
          provisional: true,
        });
      }
      const tot = g.total;
      if (tot && tot.edge != null && tot.fair) {
        const pickOver = (tot.overProb ?? 50) >= 50;
        totalsEdges.push({
          gameId: g.eventId, side: pickOver ? "over" : "under",
          matchup: g.matchup,
          edge: tot.edge, odds: pickOver ? tot.book?.over : tot.book?.under,
          modelProb: (pickOver ? tot.overProb : (100 - tot.overProb)) / 100,
          line: tot.line, convictionScore: null, conviction: null,
          provisional: true,
        });
      }
    }
    moneylineEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
    spreadEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
    totalsEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));

    // ── Market Read + best prices per game (already parsed; surface for the board) ─
    // marketRead = the books' consensus lean (win/cover/total) per game; bestPrices
    // = the best available number + which book, for line shopping. Both are live data
    // from parseFballOddsEvent — no extra fetch. Keyed by eventId for the UI to join.
    const marketByGame = {};
    for (const g of allGames) {
      marketByGame[g.eventId] = {
        matchup: g.matchup,
        marketRead: g.marketRead || null,
        bestPrices: {
          ml: g.moneyline?.book || null,
          total: g.total?.book || null,
          spread: g.spread?.book || null,
        },
      };
    }

    // ── Market movers (line movement history; empty until ticks accumulate) ──────
    let movers = [];
    try {
      const { getNFLMarketMovers } = require("../services/nflEdges");
      movers = await getNFLMarketMovers({ limit: 12 });
    } catch (e) { console.error("[edges/nfl] movers read failed:", e.message); }

    res.json({
      ok: true,
      league: "nfl",
      season,
      calibrated: false,          // ← no graded results yet; do NOT treat as live advice
      preseason: true,            // ← lines are lookahead/preseason; ratings are a 2025 seed
      provisional: true,          // ← dashboard reads this to show the "in training" banner
      ratingsSeed: slate.ratingsMeta,
      weekWindow: slate.weekWindow,   // the slate window the board is filtered to
      phase: slate.phase,             // { selected, available } → drives Preseason|Regular sub-tabs
      marketByGame,                   // per-game Market Read + best prices (line shopping)
      marketMovers: movers,           // line-movement history (fills in as ticks accumulate)
      teamMatch: slate.match,     // coverage of odds-team → rating resolution
      edgeCount: edges.length,
      edges,
      // dashboard board contract:
      games: allGames,
      moneylineEdges, spreadEdges, totalsEdges,
      runLineEdges: [], hrPropEdges: [], kPropEdges: [], hitsPropEdges: [],
      computedAt: new Date().toISOString(),
      disclaimer: "PROVISIONAL: 2025-seeded ratings vs preseason lines. Not calibrated — no graded NFL results yet. For build/validation only; not betting advice until shadow-graded in-season.",
    });
  } catch (e) {
    console.error("[edges/nfl] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
