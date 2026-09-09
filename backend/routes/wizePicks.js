const express = require("express");
const { requireAuth, supabase } = require("../middleware/auth");

const router = express.Router();
const OWNER_EMAIL = "r7002g@gmail.com";
const SPORT_IDS = {
  mlb: "mlb",
  nba: "nba",
  nfl: "nfl",
  nhl: "nhl",
  cfb: "ncaafb",
};

function americanToDecimal(odds) {
  const n = Number(odds);
  if (!n || Number.isNaN(n)) return null;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}

function parlayDecimal(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return null;
  let decimal = 1;
  for (const leg of legs) {
    const legDecimal = americanToDecimal(leg && leg.odds);
    if (legDecimal == null) return null;
    decimal *= legDecimal;
  }
  return decimal;
}

function parsePicks(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeResult(value) {
  const result = String(value == null ? "" : value).trim().toLowerCase();
  if (result === "won") return "win";
  if (result === "lost") return "loss";
  return result;
}

function riskUnits(pick) {
  const value = Number(pick && pick.units);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function storedUnitPnl(pick) {
  if (!pick || pick.unitPnl == null || pick.unitPnl === "") return null;
  const value = Number(pick.unitPnl);
  return Number.isFinite(value) ? value : null;
}

function computeRecord(rows, pickFilter = () => true) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let voids = 0;
  let pending = 0;
  let units = 0;
  let riskedUnits = 0;

  for (const row of rows || []) {
    for (const pick of parsePicks(row && row.picks)) {
      if (!pickFilter(pick)) continue;
      const result = normalizeResult(pick && pick.result);
      const stake = riskUnits(pick);
      if (result === "win") {
        wins += 1;
        riskedUnits += stake;
        const storedPnl = storedUnitPnl(pick);
        if (storedPnl != null) {
          units += storedPnl;
          continue;
        }
        let decimal;
        if (pick && pick.type === "parlay") {
          decimal = (pick.combinedOdds != null ? americanToDecimal(pick.combinedOdds) : null)
            || parlayDecimal(pick.legs);
        } else {
          decimal = americanToDecimal(pick && pick.odds);
        }
        units += decimal ? (decimal - 1) * stake : 0;
      } else if (result === "loss") {
        losses += 1;
        riskedUnits += stake;
        const storedPnl = storedUnitPnl(pick);
        units += storedPnl != null ? storedPnl : -stake;
      } else if (result === "push") {
        pushes += 1;
        riskedUnits += stake;
      } else if (result === "void") {
        voids += 1;
      } else {
        pending += 1;
      }
    }
  }

  const graded = wins + losses;
  return {
    wins,
    losses,
    pushes,
    voids,
    pending,
    units: Math.round(units * 1000) / 1000,
    riskedUnits: Math.round(riskedUnits * 1000) / 1000,
    roi: riskedUnits > 0 ? Math.round((units / riskedUnits) * 1000) / 10 : 0,
    winRate: graded > 0 ? Math.round((wins / graded) * 100) : 0,
  };
}

function pickMatchesSport(pick, storedSport) {
  if (!pick) return false;
  if (pick.type === "parlay") {
    return Array.isArray(pick.legs)
      && pick.legs.some((leg) => String((leg && leg.sport) || "").toLowerCase() === storedSport);
  }
  return String(pick.sport || "").toLowerCase() === storedSport;
}

function buildProof(rows) {
  const bySport = {};
  for (const [publicSport, storedSport] of Object.entries(SPORT_IDS)) {
    bySport[publicSport] = computeRecord(rows, (pick) => pickMatchesSport(pick, storedSport));
  }
  const propFilter = (pick) => pick && pick.kind === "prop";
  const propRows = [];
  for (const row of rows || []) {
    const picks = parsePicks(row && row.picks).filter(propFilter);
    if (picks.length) propRows.push({ ...row, picks });
  }
  const propBySport = {
    nfl: computeRecord(propRows, (pick) => String(pick.sport || "").toLowerCase() === "nfl"),
    cfb: computeRecord(propRows, (pick) => ["ncaafb", "cfb"].includes(String(pick.sport || "").toLowerCase())),
    mlb: computeRecord(propRows, (pick) => String(pick.sport || "").toLowerCase() === "mlb"),
  };
  const propByCategory = {};
  for (const row of propRows) {
    for (const pick of parsePicks(row.picks)) {
      const category = String(pick.propCategory || "unknown").toLowerCase();
      if (!propByCategory[category]) propByCategory[category] = [];
      propByCategory[category].push({ date: row.date, picks: [pick] });
    }
  }
  for (const [category, categoryRows] of Object.entries(propByCategory)) {
    propByCategory[category] = computeRecord(categoryRows);
  }
  return {
    overall: computeRecord(rows),
    bySport,
    props: { overall: computeRecord(propRows), bySport: propBySport, byCategory: propByCategory },
  };
}

async function hasFullAccess(user, client) {
  if (!user) return false;
  if (user.email === OWNER_EMAIL) return true;

  try {
    const [subscriptionResult, profileResult] = await Promise.all([
      client.from("subscriptions").select("tier").eq("user_id", user.id).single(),
      client.from("profiles").select("is_admin").eq("id", user.id).single(),
    ]);
    let tier = subscriptionResult.data && subscriptionResult.data.tier;
    if (typeof tier === "string") tier = tier.trim().toLowerCase();
    const isAdmin = profileResult.data && profileResult.data.is_admin === true;
    return isAdmin || tier === "pro" || tier === "elite";
  } catch (_) {
    return false;
  }
}

function buildPayload(rows, full) {
  const proof = buildProof(rows);
  if (!full) return { access: "proof", proof };
  return {
    access: "full",
    rows: (rows || []).map((row) => ({ date: row.date, picks: row.picks })),
    proof,
  };
}

function createHandler(client) {
  return async function getWizePicks(req, res) {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    try {
      const full = await hasFullAccess(req.user, client);
      const { data, error } = await client
        .from("expert_picks")
        .select("date, picks")
        .order("date", { ascending: false });
      if (error) throw error;
      return res.json(buildPayload(data || [], full));
    } catch (err) {
      console.error("[wize-picks] error:", err.message);
      return res.status(500).json({ error: "Failed to load WizePicks" });
    }
  };
}

router.get("/", requireAuth, createHandler(supabase));

module.exports = router;
module.exports._test = { buildPayload, buildProof, computeRecord, createHandler, hasFullAccess };
