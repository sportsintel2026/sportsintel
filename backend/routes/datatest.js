// Temporary diagnostic route — verifies whether MLB API exposes
// bullpen splits and handedness splits before we build them into the model.
//
// GET /api/datatest/mlb  → probes a couple teams and reports what's available.
// DELETE this file once we've confirmed the data shape.

const express = require("express");
const router = express.Router();
const axios = require("axios");

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

async function mlbGet(path, params = {}) {
  const res = await axios.get(`${MLB_BASE}${path}`, { params, timeout: 10000 });
  return res.data;
}

router.get("/mlb", async (req, res) => {
  const yr = new Date().getFullYear();
  const NYY = 147; // Yankees team id — good test subject (well-documented roster)
  const report = {};

  // ── TEST 1: Handedness splits (team hitting vs LHP / vs RHP) ──────────────
  // We try the "vsLHP" / "vsRHP" stat splits the API supports.
  try {
    const data = await mlbGet(`/teams/${NYY}/stats`, {
      stats: "statSplits",
      group: "hitting",
      season: yr,
      sitCodes: "vl,vr", // vl = vs lefties, vr = vs righties
    });
    const splits = data.stats?.[0]?.splits || [];
    report.handedness = {
      ok: splits.length > 0,
      splitCount: splits.length,
      sample: splits.slice(0, 2).map(sp => ({
        split: sp.split?.description || sp.split?.code,
        avg: sp.stat?.avg,
        ops: sp.stat?.ops,
        ab: sp.stat?.atBats,
        hr: sp.stat?.homeRuns,
      })),
    };
  } catch (e) {
    report.handedness = { ok: false, error: e.message };
  }

  // ── TEST 2: Bullpen — relievers' recent stats ─────────────────────────────
  // Approach: get the roster, find pitchers, check if we can pull
  // "gameLog" pitching for a reliever and sum recent innings.
  try {
    const rosterData = await mlbGet(`/teams/${NYY}/roster`, { rosterType: "active" });
    const pitchers = (rosterData.roster || []).filter(p => p.position?.code === "1");
    report.bullpen = {
      rosterOk: pitchers.length > 0,
      pitcherCount: pitchers.length,
    };

    // Try pulling a season pitching split that separates starting vs relief
    if (pitchers.length > 0) {
      // Test team-level pitching with statSplits to see if relief is isolable
      const teamPitch = await mlbGet(`/teams/${NYY}/stats`, {
        stats: "statSplits",
        group: "pitching",
        season: yr,
        sitCodes: "sp,rp", // sp = as starter, rp = as reliever
      });
      const psplits = teamPitch.stats?.[0]?.splits || [];
      report.bullpen.reliefSplit = {
        ok: psplits.length > 0,
        splitCount: psplits.length,
        sample: psplits.slice(0, 3).map(sp => ({
          split: sp.split?.description || sp.split?.code,
          era: sp.stat?.era,
          whip: sp.stat?.whip,
          ip: sp.stat?.inningsPitched,
        })),
      };
    }
  } catch (e) {
    report.bullpen = { ok: false, error: e.message };
  }

  // ── TEST 3: Pitcher handedness (which hand does a starter throw?) ──────────
  // We need this to match a lineup's split to the opposing starter.
  try {
    // Gerrit Cole id 543037 — known righty
    const personData = await mlbGet(`/people/543037`);
    const person = personData.people?.[0] || {};
    report.pitcherHand = {
      ok: !!person.pitchHand,
      name: person.fullName,
      throws: person.pitchHand?.code, // "R" or "L"
    };
  } catch (e) {
    report.pitcherHand = { ok: false, error: e.message };
  }

  console.log("[DataTest] Report:", JSON.stringify(report, null, 2));
  res.json({ probedAt: new Date().toISOString(), report });
});

module.exports = router;
