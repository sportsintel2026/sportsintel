require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");

const authRoutes = require("./routes/auth");
const gamesRoutes = require("./routes/games");
const statsRoutes = require("./routes/stats");
const subscriptionRoutes = require("./routes/subscriptions");
const webhookRoutes = require("./routes/webhooks");
const edgesRoutes = require("./routes/edges");
const matchupsRoutes = require("./routes/matchups");
const performanceRoutes = require("./routes/performance");
const nbaRoutes = require("./routes/nba");
const scoresRoutes = require("./routes/scores");
const liveRoutes = require("./routes/live");
const expertGradeRoutes = require("./routes/expertGrade");
const dailyCardRoutes = require("./routes/dailyCard");
const gradeNowRoutes = require("./routes/gradeNow");
const consensusRoutes = require("./routes/consensus");
const oddsRoutes = require("./routes/odds");

const { refreshDailyGames } = require("./services/sportsData");
const { gradeFinishedGames, captureClosingLines, captureNbaClosingLines, captureOddsTicks } = require("./services/predictionTracker");
const { gradeExpertPicks } = require("./services/expertPicksGrader");
const { gradeDailyCard } = require("./services/dailyCard");

const app = express();
const PORT = process.env.PORT || 4000;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
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
app.use("/api/edges", edgesRoutes);
app.use("/api/matchups", matchupsRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/nba", nbaRoutes);
app.use("/api/scores", scoresRoutes);
app.use("/api/live", liveRoutes);
app.use("/api/expert-grade", expertGradeRoutes);
app.use("/api/daily-card", dailyCardRoutes);
app.use("/api/grade-now", gradeNowRoutes);
app.use("/api/consensus", consensusRoutes);
app.use("/api/odds", oddsRoutes);

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
  try {
    await captureClosingLines();
  } catch (err) {
    console.error("[CRON] Closing-line capture failed:", err.message);
  }
  try {
    await captureNbaClosingLines();
  } catch (err) {
    console.error("[CRON] NBA closing-line capture failed:", err.message);
  }
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

// Grade finished-game predictions — runs hourly, and a final sweep at 3am ET
cron.schedule("0 * * * *", async () => {
  console.log("[CRON] Grading finished-game predictions...");
  try {
    await gradeFinishedGames();
    await gradeExpertPicks({ dryRun: false });
    await gradeDailyCard();
    console.log("[CRON] Expert picks graded.");
  } catch (err) {
    console.error("[CRON] Grading failed:", err.message);
  }
}, { timezone: "America/New_York" });

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 WizePicks API running on port ${PORT}`);
});

module.exports = app;

// Clear cache endpoint
app.delete('/api/cache', async (req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase.from('games_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    res.json({ success: true, message: 'Cache cleared' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
