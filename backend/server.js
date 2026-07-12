require("dotenv").config();
// CFB-ODDS-TICKS-CRON-WIRED-2026-06-23

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");
const axios = require("axios");

// gzip compression — OPTIONAL require so a missing/uninstalled module can never
// crash startup. It's added to package.json (Railway installs it on deploy); if for
// any reason it isn't present yet, the server still boots and just skips gzip.
let compression = null;
try { compression = require("compression"); }
catch (_) { console.warn("[startup] compression not installed yet — running without gzip"); }

const authRoutes = require("./routes/auth");
const gamesRoutes = require("./routes/games");
const statsRoutes = require("./routes/stats");
const subscriptionRoutes = require("./routes/subscriptions");
const webhookRoutes = require("./routes/webhooks");
const edgesRoutes = require("./routes/edges");
const edgesNbaRoutes = require("./routes/edgesNba");
const matchupsRoutes = require("./routes/matchups");
const performanceRoutes = require("./routes/performance");
const backtestRoutes = require("./routes/backtest");
const nbaRoutes = require("./routes/nba");
const scoresRoutes = require("./routes/scores");
const liveRoutes = require("./routes/live");
const expertGradeRoutes = require("./routes/expertGrade");
const dailyCardRoutes = require("./routes/dailyCard");
const gradeNowRoutes = require("./routes/gradeNow");
const consensusRoutes = require("./routes/consensus");
const oddsRoutes = require("./routes/odds");
const playerCardRoutes = require("./routes/playerCard");
const umpiresRoutes = require("./routes/umpires");
const liveProbeRoutes = require("./routes/liveProbe");
const liveWinProbRoutes = require("./routes/liveWinProb");
const newsRoutes = require("./routes/news"); // WZ-NEWS-MOUNT-2026-06-26
const nflPropsProbeRoutes = require("./routes/nflPropsProbe"); // WZ-NFLPROPS-MOUNT-2026-07-05
const ufcRoutes = require("./routes/ufc"); // WZ-UFC-CARD-2026-07-09 :: UFC/MMA card endpoint (read-only)
const aiReadRoutes = require("./routes/aiRead"); // WZ-AI-READ-2026-07-12 :: on-demand AI read (B), fail-safe

const { refreshDailyGames } = require("./services/sportsData");
const { gradeFinishedGames, captureClosingLines, captureNbaClosingLines, captureOddsTicks, voidUnmatchedProps } = require("./services/predictionTracker");
const { captureNFLOddsTicks } = require("./services/nflEdges");
const { captureCFBOddsTicks } = require("./services/cfbEdges");
const { backfillUmpireGames } = require("./services/umpireStore");
const { getEasternDate } = require("./services/mlbStatsApi");
const { gradeExpertPicks } = require("./services/expertPicksGrader");
const { gradeDailyCard } = require("./services/dailyCard");

// ── Crash guards ────────────────────────────────────────────────────────────────
// A single unhandled error must NOT take the whole backend down. Log loudly so it's
// visible in Railway logs, but keep the process alive so the site stays up for
// everyone else. (If we later add a fast auto-restart process manager, an
// uncaughtException could instead exit(1) for a clean restart — for now, staying
// alive beats a total outage.)
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION] keeping server alive. Reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION] keeping server alive. Error:", (err && err.stack) || err);
});

// ── Cron heartbeat monitoring (Healthchecks.io) ────────────────────────────────
// Fire-and-forget ping so we get alerted the instant a cron silently stops.
// Completely inert until the matching env var is set, and can never throw into
// or slow down the job it monitors (all errors are swallowed).
async function pingHC(baseUrl, ok = true) {
  if (!baseUrl) return;
  try {
    const clean = baseUrl.replace(/\/+$/, "");
    await axios.get(ok ? clean : clean + "/fail", { timeout: 8000 });
  } catch (_) {
    // monitoring must never break the job
  }
}

const app = express();
const PORT = process.env.PORT || 4000;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
// gzip all responses — faster board loads + less bandwidth under launch traffic.
// Guarded: only mounts if the optional compression module loaded above.
if (compression) app.use(compression());
// Allowed front-end origins. Includes the new WizePicks domain (with and without
// www), the original Vercel domain (kept so it keeps working during the transition),
// local dev, and an optional FRONTEND_URL env override. Requests with no origin
// (server-to-server, health checks) are allowed through.
const allowedOrigins = [
  "https://wizepicks.com",
  "https://www.wizepicks.com",
  "https://sportsintel.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];
if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

// Stripe webhooks need raw body — mount BEFORE json parser
app.use("/api/webhooks", express.raw({ type: "application/json" }), webhookRoutes);

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/edges/nba", edgesNbaRoutes);
app.use("/api/edges", edgesRoutes);
app.use("/api/matchups", matchupsRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/backtest", backtestRoutes);
app.use("/api/nba", nbaRoutes);
app.use("/api/scores", scoresRoutes);
app.use("/api/live", liveRoutes);
app.use("/api/expert-grade", expertGradeRoutes);
app.use("/api/daily-card", dailyCardRoutes);
app.use("/api/grade-now", gradeNowRoutes);
app.use("/api/consensus", consensusRoutes);
app.use("/api/odds", oddsRoutes);
app.use("/api/player-card", playerCardRoutes);
app.use("/api/umpires", umpiresRoutes);
app.use("/api/live-probe", liveProbeRoutes);
app.use("/api/live-winprob", liveWinProbRoutes);
app.use("/api/news", newsRoutes); // WZ-NEWS-MOUNT-2026-06-26 :: blended ESPN+RotoWire feed
app.use("/api/nfl-props-probe", nflPropsProbeRoutes); // WZ-NFLPROPS-MOUNT-2026-07-05 :: Phase 3 recon (read-only, temp)
app.use("/api/ufc", ufcRoutes); // WZ-UFC-CARD-2026-07-09 :: UFC/MMA card (read-only, additive)
app.use("/api/ai-read", aiReadRoutes); // WZ-AI-READ-2026-07-12 :: on-demand AI read (B), env-gated + fail-safe

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Scheduled Jobs ────────────────────────────────────────────────────────────
// Refresh game data every 5 minutes during peak hours (noon–midnight ET)
cron.schedule("*/5 12-23 * * *", async () => {
  console.log("[CRON] Refreshing live game data...");
  try {
    await refreshDailyGames();
    console.log("[CRON] Game data refreshed");
  } catch (err) {
    console.error("[CRON] Error refreshing games:", err.message);
  }
}, { timezone: "America/New_York" });

// Full daily refresh at 8am ET
cron.schedule("0 8 * * *", async () => {
  console.log("[CRON] Running daily full refresh...");
  try {
    await refreshDailyGames();
  } catch (err) {
    console.error("[CRON] Daily refresh failed:", err.message);
  }
}, { timezone: "America/New_York" });

// Capture CLOSING LINES every 30 min during game hours (noon–2am ET). Each run
// snapshots the closing price for any pending MLB ML/totals pick whose game has
// just started, then computes CLV. One odds fetch per run (~2 credits) covers
// all of today's games, so this is cheap on the API budget.
cron.schedule("*/15 11-23,0-2 * * *", async () => {
  console.log("[CRON] Capturing closing lines (CLV)...");
  let clvOk = true;
  try {
    await captureClosingLines();
  } catch (err) {
    clvOk = false;
    console.error("[CRON] Closing-line capture failed:", err.message);
  }
  try {
    await captureNbaClosingLines();
  } catch (err) {
    clvOk = false;
    console.error("[CRON] NBA closing-line capture failed:", err.message);
  }
  pingHC(process.env.HC_PING_CLV, clvOk);
}, { timezone: "America/New_York" });

// Snapshot every MLB ML/total price every 15 min during game hours → powers the
// Home line-movement chart + real Market Movers. Cache-respecting fetch (shares
// the 30-min odds cache), so it adds ~no extra API credits, and runs all day.
cron.schedule("*/15 11-23,0-2 * * *", async () => {
  try {
    await captureOddsTicks();
  } catch (err) {
    console.error("[CRON] Odds tick capture failed:", err.message);
  }
}, { timezone: "America/New_York" });

// NFL odds-tick capture — banks line-movement history for NFL Market Movers. Runs
// less often than MLB (twice an hour is plenty for weekly games) and on its own
// table (nfl_odds_ticks) so it never touches the MLB pipeline. Cheap: shares the
// 30-min odds cache. Sparse in the offseason; comes alive as the season nears.
cron.schedule("5,35 11-23,0-2 * * *", async () => {
  try {
    await captureNFLOddsTicks();
  } catch (err) {
    console.error("[CRON] NFL odds tick capture failed:", err.message);
  }
}, { timezone: "America/New_York" });

// CFB odds-tick capture — banks line-movement history for CFB Market Movers. Writes
// to its own table (cfb_odds_ticks) so it never touches MLB/NFL. Hourly (lighter than
// NFL's twice-hourly) because CFB lines crawl in the offseason and to stay easy on the
// Odds API credit budget; staggered to :25 to avoid colliding with the MLB/NFL ticks.
// Graceful no-op until the cfb_odds_ticks table exists; sparse now, alive as games near.
cron.schedule("25 11-23,0-2 * * *", async () => {
  try {
    await captureCFBOddsTicks();
  } catch (err) {
    console.error("[CRON] CFB odds tick capture failed:", err.message);
  }
}, { timezone: "America/New_York" });

// NFL model-pick recorder (Phase-2 F5 calibration harness) — once daily, runs the
// NFL slate and snapshots the model's picks to model_predictions (league:"nfl") so
// they auto-grade once games finish, building the graded sample we calibrate against.
// Self-gating: recordNFLPredictions only logs games kicking off within ~7 days, so
// this is a no-op all offseason and quietly comes alive the week before games. Daily
// is plenty for a weekly sport; idempotent (dups ignored).
cron.schedule("20 9 * * *", async () => {
  try {
    const { runNFLSlate } = require("./services/nflEdges");
    const { recordNFLPredictions } = require("./services/predictionTracker");
    const slate = await runNFLSlate({ weeks: 1 });
    await recordNFLPredictions(slate);
    // WZ-NFLPROPSSHADOW-CRON-2026-07-05 :: props shadow logger, same imminence gate;
    // no-op all offseason (bails before the roster crawl when no lines are posted).
    const { recordNflPropShadow } = require("./services/nflPropsShadow");
    const propShadow = await recordNflPropShadow({});
    if (propShadow && propShadow.logged) console.log(`[CRON] NFL prop-shadow logged ${propShadow.logged} rows`);
  } catch (err) {
    console.error("[CRON] NFL model-pick record failed:", err.message);
  }
}, { timezone: "America/New_York" });

// WZ-FASTGRADE-2026-07-09 :: grade finished MLB games every 15 min (was hourly) so results
// post within ~15 min of the final out instead of up to ~59 min. gradeFinishedGames only flips
// pending->win/loss and is idempotent, so frequent runs are cheap (a no-op query when nothing
// new is final). The heavier hourly block below keeps NFL props / expert picks / daily card /
// DNP void on their hourly cadence -- only MLB game grading was moved to the fast lane.
cron.schedule("*/15 * * * *", async () => {
  try {
    await gradeFinishedGames();
  } catch (err) {
    console.error("[CRON] Fast grade (MLB) failed:", err.message);
  }
}, { timezone: "America/New_York" });

// WZ-UFC-GRADE-CRON-2026-07-09 :: grade recorded UFC picks (ufc_picks) as fights decide.
// Every 30 min. Budget-safe on the Cito free tier: the grader only force-fetches a card's
// bouts for events that have STARTED or already dropped off the upcoming list, so between
// events this is a near-zero no-op (one cached upcoming-events read, no per-event calls) and
// it comes alive automatically on fight night. Lazy require so a load error can't crash boot;
// idempotent (only flips pending -> win/loss/push), so frequent runs are cheap and harmless.
cron.schedule("*/30 * * * *", async () => {
  try {
    const { gradeUFCPicks } = require("./services/ufcGrader");
    await gradeUFCPicks();
  } catch (err) {
    console.error("[CRON] UFC grade failed:", err.message);
  }
}, { timezone: "America/New_York" });

// Hourly sweep: NFL prop shadows / expert picks / daily card / DNP void.
// (MLB finished-game grading moved to the every-15-min fast lane above.)
cron.schedule("0 * * * *", async () => {
  console.log("[CRON] Hourly grading sweep...");
  try {
    // WZ-NFLPROPSGRADER-CRON-2026-07-05 :: grade NFL player-prop shadow rows from box
    // scores (own resolver: matchup+date). No-op until shadow rows exist in-season.
    try {
      const { gradeNflPropShadows } = require("./services/nflPropsGrader");
      await gradeNflPropShadows();
    } catch (e) { console.error("[CRON] NFL prop-shadow grading failed:", e.message); }
    // Retire DNP/scratched props (player never batted/pitched → can't grade) as
    // no-action push. Runs every hour right after grading so "stuck pending" props
    // clear themselves instead of accumulating until a manual ?void_unmatched=1.
    try {
      const v = await voidUnmatchedProps();
      if (v && v.voided) console.log(`[CRON] Auto-voided ${v.voided} DNP prop(s) (no action).`);
    } catch (ve) {
      console.error("[CRON] Auto-void failed:", ve.message);
    }
    await gradeExpertPicks({ dryRun: false });
    await gradeDailyCard();
    console.log("[CRON] Expert picks graded.");
    pingHC(process.env.HC_PING_GRADE, true);
  } catch (err) {
    console.error("[CRON] Grading failed:", err.message);
    pingHC(process.env.HC_PING_GRADE, false);
  }
}, { timezone: "America/New_York" });

// ── Nightly umpire-games logger ─────────────────────────────────────────────────
// Auto-populates umpire_games so the tendency table stays current with zero manual
// work. Runs at 7am ET (after even West-Coast extra-inning games are final) and
// re-logs the last two ET days. Idempotent (keyed on game_pk), so the overlap is a
// no-op that also self-heals any day a run was missed. Fully fire-and-forget.
cron.schedule("0 7 * * *", async () => {
  console.log("[CRON] Logging umpire games (last 2 days)...");
  try {
    const out = await backfillUmpireGames(getEasternDate(-2), getEasternDate(-1), 400);
    console.log(`[CRON] Umpire games logged: ${out.logged} (skipped ${out.skipped})`);
  } catch (err) {
    console.error("[CRON] Umpire game logging failed:", err.message);
  }
}, { timezone: "America/New_York" });

// ── Warm-cache cron ─────────────────────────────────────────────────────────────
// /api/edges/mlb does a full slate recompute (main odds + 6 prop markets) on every
// cache miss, so the first user after the 15-min TTL expires waits for all of it.
// This keeps the cache hot by rebuilding it every 12 min during active hours (under
// the TTL), so real users always hit the instant cached path. Self-pings the live
// endpoint in-process; its side effects (recordPredictions + TB shadow) are deduped
// by unique constraints, so repeats are harmless no-ops. Fully fire-and-forget — a
// timeout + swallowed errors mean it can never hang or crash the server.
async function warmEdgesCache() {
  try {
    await axios.get(`http://127.0.0.1:${PORT}/api/edges/mlb`, { timeout: 90000 });
    console.log("[WARM] edges cache refreshed");
  } catch (e) {
    console.error("[WARM] edges cache warm failed:", e.message);
  }
}
// Every 12 min during active hours (11am–2am ET), comfortably under the 15-min TTL.
cron.schedule("*/12 11-23,0-2 * * *", warmEdgesCache, { timezone: "America/New_York" });

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 WizePicks API running on port ${PORT}`);
  // Warm the board cache ~15s after boot so the first post-deploy load is fast, not
  // cold. Delayed so the server is fully ready to serve its own warm request.
  setTimeout(warmEdgesCache, 15000);
});

module.exports = app;

// Clear cache endpoint — destructive (wipes games_cache), so it's locked behind a
// shared secret. Set ADMIN_TOKEN in the Railway env to a long random string, then
// call with header `x-admin-token: <that value>`. Fails CLOSED: if ADMIN_TOKEN isn't
// configured, or the header is missing/wrong, the request is rejected — it can never
// be left accidentally open.
app.delete('/api/cache', async (req, res) => {
  const token = req.get('x-admin-token');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase.from('games_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    res.json({ success: true, message: 'Cache cleared' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
