// WZ-UFC-CARD-2026-07-09 :: read-only UFC/MMA card endpoint for the new UFC page.
// Wraps the existing fetchMMASchedule (SportRadar MMA feed) with a short cache and a
// fail-safe shape so the page always renders. There are NO odds and NO win model yet --
// those get wired next; this serves the REAL upcoming fights (fighter names, time, venue)
// so the page is live now. Every model field is returned null with modelPending:true so
// the frontend shows a clean "model pending" state instead of fake numbers.
// Endpoint: GET /api/ufc/card
const express = require("express");
const router = express.Router();
const { fetchMMASchedule } = require("../services/sportsData");

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min -- SportRadar trial feed is rate-limited
let cache = { at: 0, data: null };
let inflight = null;

async function loadCard() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const raw = await fetchMMASchedule();
      const fights = (Array.isArray(raw) ? raw : []).map((f) => ({
        id: f.id,
        fighterA: f.away || "Fighter 1", // red corner
        fighterB: f.home || "Fighter 2", // blue corner
        time: f.time || "",
        venue: f.venue || "",
        city: f.city || "",
        status: f.status || "scheduled",
        // model fields stay null until odds + a fighter model are wired:
        pick: null,
        winPct: null,
        edgePct: null,
        odds: null,
        method: null,
        weightClass: null,
      }));
      cache = { at: Date.now(), data: fights };
      return fights;
    } catch (_) {
      return cache.data || []; // degrade gracefully, never throw
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

router.get("/card", async (_req, res) => {
  try {
    const fights = await loadCard();
    res.json({ ok: true, modelPending: true, fights });
  } catch (_) {
    res.json({ ok: true, modelPending: true, fights: [] });
  }
});

module.exports = router;
