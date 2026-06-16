// Player Card route — enrichment data for the expand-on-tap batting card under
// each prop player in the Props board. READ-ONLY and isolated (its own router) so
// a bug here can never destabilize the main edges feed — same pattern as Market Read.
//
// v1 (skeleton): hand-vs-hand splits + batter handedness for one MLBAM player id.
// The board already has the player's name/team/matchup/line/odds/model% — the
// frontend reuses those; this endpoint serves only the EXTRA data the row lacks.
// Later phases layer on: measured factors (barrel%/xwOBA/recent), model adjustments
// (platoon/park/weather), model-vs-market history, and batted-ball (pull/spray).
const express = require("express");
const router = express.Router();

const { getBatterHandednessSplits, getBatterHand } = require("../services/mlbStatsApi");

const THIN_AB = 40; // below this, a vs-hand split is too small a sample to trust — flag it

// Reshape one split (vsLHP/vsRHP) into the card's field names; add a "thin" flag.
function shapeSplit(s) {
  if (!s) return null;
  const ab = (s.atBats ?? null);
  return {
    avg: s.avg ?? null,
    obp: s.obp ?? null,
    slg: s.slg ?? null,
    ops: s.ops ?? null,
    ab,
    hr: s.homeRuns ?? null,
    thin: ab != null ? ab < THIN_AB : true,
  };
}

// GET /api/player-card/mlb/:playerId
//   :playerId = MLBAM id (the same id the row's headshot already resolves).
//   Returns { ok, player:{id,bats,headshot}, splits:{season,vsLHP,vsRHP}, dataHealth }.
router.get("/mlb/:playerId", async (req, res) => {
  const playerId = String(req.params.playerId || "").trim();
  if (!/^\d+$/.test(playerId)) {
    return res.status(400).json({ ok: false, error: "playerId must be a numeric MLBAM id" });
  }
  try {
    const [splits, bats] = await Promise.all([
      getBatterHandednessSplits(playerId),
      getBatterHand(playerId),
    ]);

    res.json({
      ok: true,
      player: {
        id: Number(playerId),
        bats: bats || null, // "L" | "R" | "S"
        headshot: `https://midfield.mlbstatic.com/v1/people/${playerId}/spots/120`,
      },
      splits: splits
        ? {
            season: new Date().getFullYear(),
            vsLHP: shapeSplit(splits.vsLHP),
            vsRHP: shapeSplit(splits.vsRHP),
          }
        : null,
      dataHealth: { splits: !!splits },
    });
  } catch (e) {
    console.error("[player-card] mlb error:", e.message);
    res.status(500).json({ ok: false, error: "Failed to load player card" });
  }
});

module.exports = router;
