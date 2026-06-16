// Player Card route — enrichment data for the expand-on-tap batting card under
// each prop player in the Props board. READ-ONLY and isolated (its own router) so
// a bug here can never destabilize the main edges feed — same pattern as Market Read.
//
// v2: hand-vs-hand splits + tonight's matchup (pitcher + hand → which split applies)
// + measured factors (barrel%/xwOBA/recent L15) + park factor + model-vs-market
// history. All sourced directly from the same feeds the HR model uses — the card
// never reaches into the model's internals, so it can't drift or destabilize it.
// PHASE 2 (separate): batted-ball pull/spray (needs a verified Savant feed first).
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

const {
  getBatterHandednessSplits, getBatterHand, getScheduleForDate, getPitcherHand,
  getEasternDate, getBatterRecentStats, normPlayerName,
} = require("../services/mlbStatsApi");
const { getBatterBarrels, getBatterExpectedStats } = require("../services/savantApi");

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const THIN_AB = 40; // below this, a vs-hand split is too small a sample to trust

function shapeSplit(s) {
  if (!s) return null;
  const ab = s.atBats ?? null;
  return {
    avg: s.avg ?? null, obp: s.obp ?? null, slg: s.slg ?? null, ops: s.ops ?? null,
    ab, hr: s.homeRuns ?? null, thin: ab != null ? ab < THIN_AB : true,
  };
}

// Raw implied probability from an American price (what the quoted line implies).
function impliedFromOdds(o) {
  const n = Number(o);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

// A plain-English tier for a barrel rate (league avg ~7-8%, elite ~16%+).
function barrelTier(rate) {
  if (rate == null) return null;
  if (rate >= 0.16) return "elite";
  if (rate >= 0.11) return "strong";
  if (rate >= 0.08) return "above avg";
  if (rate >= 0.05) return "average";
  return "low";
}

// Find a game by id across today (and tomorrow, since the board can roll forward).
async function findGame(gameId) {
  if (!gameId) return null;
  for (const off of [0, 1, -1]) {
    try {
      const sched = await getScheduleForDate(getEasternDate(off));
      const g = (sched || []).find((x) => String(x.id) === String(gameId));
      if (g) return g;
    } catch (_) { /* keep trying */ }
  }
  return null;
}

// Resolve tonight's matchup for this batter: opposing probable pitcher + hand,
// which split applies, platoon advantage, and the park HR factor.
async function resolveMatchup(game, teamAbbr) {
  if (!game) return null;
  const t = String(teamAbbr || "").toUpperCase();
  let oppProbable = null, opponent = null;
  if (t && t === String(game.awayAbbr || "").toUpperCase()) {
    oppProbable = game.homeProbable; opponent = game.homeAbbr;
  } else if (t && t === String(game.homeAbbr || "").toUpperCase()) {
    oppProbable = game.awayProbable; opponent = game.awayAbbr;
  }
  let pitcherHand = null;
  if (oppProbable?.id) { try { pitcherHand = await getPitcherHand(oppProbable.id); } catch (_) {} }
  return {
    gameId: String(game.id),
    opponent: opponent || null,
    pitcher: oppProbable?.name || null,
    pitcherHand: pitcherHand || null,
    appliesSplit: pitcherHand === "L" ? "vsLHP" : pitcherHand === "R" ? "vsRHP" : null,
    parkHRFactor: game.parkHRFactor ?? null,
    venue: game.venue || null,
  };
}

// GET /api/player-card/mlb/:playerId?gameId=&team=&name=
router.get("/mlb/:playerId", async (req, res) => {
  const playerId = String(req.params.playerId || "").trim();
  if (!/^\d+$/.test(playerId)) {
    return res.status(400).json({ ok: false, error: "playerId must be a numeric MLBAM id" });
  }
  const idNum = Number(playerId);
  const { gameId, team, name } = req.query;

  try {
    // Fire the independent reads in parallel.
    const [splits, bats, recent, barrelMap, xMap, game] = await Promise.all([
      getBatterHandednessSplits(playerId).catch(() => null),
      getBatterHand(playerId).catch(() => null),
      getBatterRecentStats(playerId, 15).catch(() => null),
      getBatterBarrels().catch(() => null),
      getBatterExpectedStats().catch(() => null),
      findGame(gameId),
    ]);

    const matchup = game ? await resolveMatchup(game, team) : null;
    const bx = barrelMap ? barrelMap.get(idNum) : null;
    const xs = xMap ? xMap.get(idNum) : null;

    const barrelPct = bx?.barrelRate ?? null;
    const xwoba = xs?.xwOBA ?? null;

    // bats vs opposing hand → platoon advantage (switch hitters always have it)
    let platoonAdvantage = null;
    if (matchup?.pitcherHand && bats) {
      platoonAdvantage =
        bats === "S" ||
        (bats === "L" && matchup.pitcherHand === "R") ||
        (bats === "R" && matchup.pitcherHand === "L");
    }

    // model-vs-market history: this player's past HR-prop rows (matched by name).
    let modelVsMarket = [];
    if (name) {
      try {
        const supabase = db();
        const { data } = await supabase
          .from("model_predictions")
          .select("game_date,model_prob,odds,result,selection")
          .eq("league", "mlb").eq("market", "hr_prop")
          .ilike("selection", String(name))
          .order("game_date", { ascending: false })
          .limit(40);
        const want = normPlayerName(String(name));
        modelVsMarket = (data || [])
          .filter((r) => normPlayerName(r.selection || "") === want)
          .slice(0, 10)
          .map((r) => ({
            date: r.game_date,
            modelProb: r.model_prob ?? null,
            marketImplied: impliedFromOdds(r.odds),
            homered: r.result === "pending" ? null : r.result === "win",
          }))
          .reverse(); // oldest → newest for the chart
      } catch (_) { modelVsMarket = []; }
    }

    res.json({
      ok: true,
      player: {
        id: idNum,
        bats: bats || null,
        headshot: `https://midfield.mlbstatic.com/v1/people/${playerId}/spots/120`,
      },
      matchup: matchup
        ? { ...matchup, platoonAdvantage }
        : null,
      splits: splits
        ? { season: new Date().getFullYear(), vsLHP: shapeSplit(splits.vsLHP), vsRHP: shapeSplit(splits.vsRHP) }
        : null,
      factors: {
        measured: {
          barrelPct,
          barrelTier: barrelTier(barrelPct),
          xwoba,
          recent15: recent
            ? { games: recent.days, hr: recent.homeRuns ?? null, avg: recent.avg ?? null, slg: recent.slg ?? null, ab: recent.atBats ?? null }
            : null,
        },
        park: matchup?.parkHRFactor != null
          ? { factor: matchup.parkHRFactor, venue: matchup.venue }
          : null,
        platoonAdvantage,
      },
      modelVsMarket,
      battedBall: null, // PHASE 2
      dataHealth: {
        splits: !!splits,
        savant: barrelPct != null || xwoba != null,
        gamelog: !!recent,
        matchup: !!matchup,
        history: modelVsMarket.length,
      },
    });
  } catch (e) {
    console.error("[player-card] mlb error:", e.message);
    res.status(500).json({ ok: false, error: "Failed to load player card" });
  }
});

module.exports = router;
