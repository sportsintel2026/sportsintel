// WZ-NFLPROPS-PROBE-2026-07-05
// nflPropsProbe.js  —  WizePicks NFL Player Props, Phase 3 recon (READ-ONLY).
//
// Isolated router (its own express.Router, own fetches, writes NOTHING) so a bug
// here can never destabilize the live edges feed — the same containment pattern as
// playerCard.js / Market Read. Its only job is to confirm two data sources BEFORE a
// single line of projection math is written, so the model is built on verified
// shapes, not guesses:
//
//   GET /api/nfl-props-probe/stats[?season=2025]
//       ESPN 2025 player-stat shapes. Chains leaders -> one athlete's season
//       statistics -> that athlete's gamelog, and reports the raw category / stat
//       field names + one sample value each. This tells us exactly what keys a
//       projection (pass yds / rush yds / receptions, plus a per-game variance
//       source) can read. No field names are assumed.
//
//   GET /api/nfl-props-probe/odds
//       Odds API NFL player-prop availability. Lists upcoming NFL events (free
//       call), then asks the nearest event for the core player-prop markets and
//       reports HTTP status, which markets returned, a sample outcome, and the
//       credit-usage headers. A 422 (markets not on this plan) or an empty result
//       (props not posted this far from kickoff) is itself a valid, informative
//       answer — it tells us whether the $59 plan upgrade is required and confirms
//       the "shadow-first from the first preseason snap" timing.
//
// Delete this file (and its mount) once the projection seed + prop fetcher are built
// on the confirmed shapes.

const express = require("express");
const router = express.Router();
const axios = require("axios");

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const TIMEOUT_MS = 9000;

// The core player-prop markets a Phase 3 projection would price. Kept short on
// purpose: each market on an event-odds call costs credits, and a probe should be
// cheap. QB pass yds, rushing yds, receptions, receiving yds (+ pass TDs as a bonus).
const CORE_PROP_MARKETS = [
  "player_pass_yds",
  "player_rush_yds",
  "player_receptions",
  "player_reception_yds",
  "player_pass_tds",
];

async function espnGet(url) {
  const res = await axios.get(url, {
    timeout: TIMEOUT_MS,
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  return res.data;
}

// Pull an athlete id out of a core-API $ref like ".../athletes/3139477?lang=en".
function athleteIdFromRef(ref) {
  const m = String(ref || "").match(/athletes\/(\d+)/);
  return m ? m[1] : null;
}

// ── Probe A: ESPN 2025 player-stat shapes ─────────────────────────────────────
async function probePlayerStats(season) {
  const out = { season, endpoints: {} };
  let sampleAthleteId = null;
  let sampleAthleteName = null;

  // 1) League leaders — one call. Gives category keys (passingYards / rushingYards /
  //    receptions ...) plus each leader's athlete $ref, from which we grab an id to
  //    chain the next two probes. Cheapest confirmation of category names.
  const leadersUrl = `${ESPN_SITE}/leaders?season=${season}&seasontype=2`;
  try {
    const data = await espnGet(leadersUrl);
    const cats =
      (data && data.leaders && data.leaders.categories) ||
      (data && data.categories) ||
      [];
    out.endpoints.leaders = {
      url: leadersUrl,
      ok: true,
      categoryNames: cats.map((c) => c.name || c.abbreviation).filter(Boolean),
      sample: cats.slice(0, 4).map((c) => {
        const top = (c.leaders && c.leaders[0]) || null;
        if (top && !sampleAthleteId) {
          sampleAthleteId = athleteIdFromRef(top.athlete && top.athlete.$ref);
          sampleAthleteName =
            (top.athlete && (top.athlete.displayName || top.athlete.fullName)) || null;
        }
        return {
          name: c.name,
          displayName: c.displayName,
          topLeader: top
            ? { value: top.value, displayValue: top.displayValue }
            : null,
        };
      }),
    };
  } catch (e) {
    out.endpoints.leaders = {
      url: leadersUrl,
      ok: false,
      status: (e.response && e.response.status) || null,
      error: e.message,
    };
  }

  // 2) One athlete's SEASON statistics (core API) — the per-player aggregate source
  //    a projection reads (attempts, yards, receptions, games). Report the category
  //    + stat field names and a couple of sample values so the seed math targets
  //    real keys. Uses the athlete resolved from the leaders call above.
  if (sampleAthleteId) {
    const statUrl = `${ESPN_CORE}/seasons/${season}/types/2/athletes/${sampleAthleteId}/statistics`;
    try {
      const data = await espnGet(statUrl);
      const cats = (data && data.splits && data.splits.categories) || [];
      out.endpoints.athleteSeasonStats = {
        url: statUrl,
        ok: true,
        athleteId: sampleAthleteId,
        athleteName: sampleAthleteName,
        categories: cats.map((c) => ({
          name: c.name,
          displayName: c.displayName,
          statSample: (c.stats || []).slice(0, 10).map((s) => ({
            name: s.name,
            abbr: s.abbreviation,
            value: s.value,
            display: s.displayValue,
          })),
        })),
      };
    } catch (e) {
      out.endpoints.athleteSeasonStats = {
        url: statUrl,
        ok: false,
        athleteId: sampleAthleteId,
        status: (e.response && e.response.status) || null,
        error: e.message,
      };
    }

    // 3) That athlete's GAMELOG — the per-game variance source (a projection needs a
    //    spread, not just a mean). Confirm per-game rows carry stat values + opponent.
    const gamelogUrl = `${ESPN_SITE}/athletes/${sampleAthleteId}/gamelog?season=${season}`;
    try {
      const data = await espnGet(gamelogUrl);
      const names = (data && data.names) || (data && data.labels) || null;
      const seasonTypes = (data && data.seasonTypes) || [];
      let firstRow = null;
      const st0 = seasonTypes[0];
      const cat0 = st0 && st0.categories && st0.categories[0];
      const ev0 = cat0 && cat0.events && cat0.events[0];
      if (ev0) firstRow = { eventId: ev0.eventId, stats: ev0.stats };
      out.endpoints.athleteGamelog = {
        url: gamelogUrl,
        ok: true,
        athleteId: sampleAthleteId,
        statLabels: names,
        seasonTypeCount: seasonTypes.length,
        sampleGameRow: firstRow,
      };
    } catch (e) {
      out.endpoints.athleteGamelog = {
        url: gamelogUrl,
        ok: false,
        athleteId: sampleAthleteId,
        status: (e.response && e.response.status) || null,
        error: e.message,
      };
    }
  } else {
    out.endpoints.athleteSeasonStats = { ok: false, error: "no athlete id resolved from leaders" };
    out.endpoints.athleteGamelog = { ok: false, error: "no athlete id resolved from leaders" };
  }

  out.note =
    "Read-only. leaders.categoryNames = the stat categories that exist for 2025. " +
    "athleteSeasonStats.categories[].statSample = the exact field names a projection " +
    "seed reads (target pass yds / rush yds / receptions + attempts + games). " +
    "athleteGamelog.sampleGameRow = the per-game shape for a variance/dispersion fit. " +
    "If season stats look empty, try ?season=2024 to confirm the shape on a closed season.";
  return out;
}

// ── Probe B: Odds API NFL player-prop availability + cost ──────────────────────
async function probePropOdds() {
  if (!ODDS_API_KEY) return { ok: false, error: "ODDS_API_KEY not configured" };
  const out = { ok: true, markets: CORE_PROP_MARKETS };

  // 1) List upcoming NFL events — this endpoint is FREE (0 credits) and confirms
  //    what NFL games the feed currently carries and how far out they are.
  const eventsUrl = `${ODDS_BASE}/sports/americanfootball_nfl/events`;
  let nearest = null;
  try {
    const res = await axios.get(eventsUrl, {
      timeout: TIMEOUT_MS,
      params: { apiKey: ODDS_API_KEY, dateFormat: "iso" },
    });
    const events = Array.isArray(res.data) ? res.data : [];
    const now = Date.now();
    const upcoming = events
      .map((e) => ({
        id: e.id,
        commence: e.commence_time,
        home: e.home_team,
        away: e.away_team,
        t: e.commence_time ? new Date(e.commence_time).getTime() : null,
      }))
      .filter((e) => e.t != null);
    upcoming.sort((a, b) => a.t - b.t);
    const future = upcoming.filter((e) => e.t >= now);
    nearest = future[0] || upcoming[0] || null;
    out.events = {
      url: eventsUrl,
      ok: true,
      total: events.length,
      soonest: nearest
        ? { commence: nearest.commence, matchup: `${nearest.away} @ ${nearest.home}`, daysOut: nearest.t ? Math.round((nearest.t - now) / 864e5) : null }
        : null,
      requestsRemaining: res.headers["x-requests-remaining"] || null,
    };
  } catch (e) {
    out.events = {
      url: eventsUrl,
      ok: false,
      status: (e.response && e.response.status) || null,
      error: e.message,
    };
  }

  // 2) Ask the NEAREST event for the core player-prop markets. This is the real
  //    question: does the plan return them (200) or reject them (422 = not on plan),
  //    and if 200, are any actually posted this far out? Report the raw shape of the
  //    first market found + credit headers so the cost of a live poll is visible.
  if (nearest && nearest.id) {
    const oddsUrl = `${ODDS_BASE}/sports/americanfootball_nfl/events/${nearest.id}/odds`;
    try {
      const res = await axios.get(oddsUrl, {
        timeout: TIMEOUT_MS,
        params: {
          apiKey: ODDS_API_KEY,
          regions: "us",
          markets: CORE_PROP_MARKETS.join(","),
          oddsFormat: "american",
        },
      });
      const books = (res.data && res.data.bookmakers) || [];
      const marketsSeen = new Set();
      let sampleOutcome = null;
      for (const b of books) {
        for (const m of b.markets || []) {
          marketsSeen.add(m.key);
          if (!sampleOutcome && (m.outcomes || []).length) {
            const o = m.outcomes[0];
            sampleOutcome = {
              book: b.key,
              market: m.key,
              player: o.description || o.name || null,
              name: o.name,
              line: o.point != null ? o.point : null,
              price: o.price,
            };
          }
        }
      }
      out.propOdds = {
        url: oddsUrl,
        eventSampled: `${nearest.away} @ ${nearest.home}`,
        httpStatus: res.status,
        bookmakersReturned: books.length,
        marketsReturned: [...marketsSeen],
        sampleOutcome,
        requestsRemaining: res.headers["x-requests-remaining"] || null,
        requestsUsed: res.headers["x-requests-used"] || null,
      };
    } catch (e) {
      const status = (e.response && e.response.status) || null;
      out.propOdds = {
        url: oddsUrl,
        eventSampled: `${nearest.away} @ ${nearest.home}`,
        ok: false,
        httpStatus: status,
        error: e.message,
        interpretation:
          status === 422
            ? "422 = these player-prop markets are not enabled on the current Odds API plan (relevant to the $59 upgrade decision)."
            : status === 404
            ? "404 = the event has no odds posted yet (expected this far from kickoff)."
            : "non-200 — see error; empty/absent props this far out is expected pre-preseason.",
        requestsRemaining: (e.response && e.response.headers && e.response.headers["x-requests-remaining"]) || null,
      };
    }
  } else {
    out.propOdds = { ok: false, error: "no NFL event available to sample" };
  }

  out.note =
    "Read-only. marketsReturned lists which player-prop markets the plan actually " +
    "serves for the sampled event. Empty markets with httpStatus 200 = plan allows " +
    "them but books have not posted props this far out (expected until ~preseason). " +
    "httpStatus 422 = plan does not include player props (upgrade needed). The /events " +
    "list call is free; the event-odds call is where credits are spent.";
  return out;
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const season = parseInt(req.query.season, 10) || 2025;
    const result = await probePlayerStats(season);
    res.json(result);
  } catch (e) {
    console.error("[nfl-props-probe/stats] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/odds", async (req, res) => {
  try {
    const result = await probePropOdds();
    res.json(result);
  } catch (e) {
    console.error("[nfl-props-probe/odds] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
