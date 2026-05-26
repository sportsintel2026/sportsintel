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

const { refreshDailyGames } = require("./services/sportsData");

const app = express();
const PORT = process.env.PORT || 4000;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
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

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 SportsIntel API running on port ${PORT}`);
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
