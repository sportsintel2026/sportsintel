require("dotenv").config();

// ── Error tracking (Sentry) — initialise BEFORE other imports ──────────────────
// Completely inert until SENTRY_DSN is set. Error tracking only (no perf tracing),
// so it stays light and well within the free tier.
const Sentry = require("@sentry/node");
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0,
  });
}

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");
const axios = require("axios");

const authRoutes = require("./routes/auth");
const gamesRoutes = require("./routes/games");
const statsRoutes = require("./routes/stats");
const subscriptionRoutes = require("./routes/subscriptions");
const webhookRoutes = require("./routes/webhooks");
const edgesRoutes = require("./routes/edges");
const edgesNbaRoutes = require("./routes/edgesNba");
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

// Capture CLOSING LINES every 30 min
