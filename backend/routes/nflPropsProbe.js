// WZ-NFLPROPS-PROBE-V7-2026-07-05
// nflPropsProbe.js  —  WizePicks NFL Player Props, Phase 3 recon (READ-ONLY).
//
// Isolated router (its own express.Router, own fetches, writes NOTHING) so a bug
// here can never destabilize the live edges feed — same containment as playerCard.js.
// Confirms two data sources BEFORE any projection math is written.
//
//   GET /api/nfl-props-probe/stats[?season=2025]
//       ESPN 2025 player-stat shapes. v2 probes FOUR sources INDEPENDENTLY (no
//       single-endpoint chain — v1's site "leaders" URL 404'd and blinded the rest):
//         1. core-API season leaders   (category names + an athlete $ref)
//         2. teams list -> roster      (athlete enumeration + a fallback athlete id)
//         3. athlete season statistics (THE field names a projection reads)
//         4. athlete gamelog           (per-game shape for a variance fit)
//       Reports raw category / stat field names + one sample value each. Nothing assumed.
//
//   GET /api/nfl-props-probe/odds
//       Odds API NFL player-prop availability + credit cost. Lists events (free call),
//       asks the nearest event for the core prop markets, reports HTTP status (200 vs
//       422 = plan gate), which markets returned, a sample outcome, and credit headers.
//
//   GET /api/nfl-props-probe/projections[?season=2025][&teams=3]
//       Read-only view of the projection engine (nflPropsData) run on real rosters,
//       so projected per-game means can be eyeballed before anything is ever logged.
//
//   GET /api/nfl-props-probe/lines[?days=8][&maxEvents=16]
//       Read-only view of the odds fetcher (nflPropsOdds): normalized per-player prop
//       lines for the imminent slate. Empty until books post NFL props (~preseason).
//
//   GET /api/nfl-props-probe/shadow-dry-run[?days=7]
//       Read-only DRY RUN of the shadow logger (nflPropsShadow): shows what WOULD be
//       written to model_predictions (matched/unmatched + sample rows) WITHOUT writing.
//       Empty until props post; the daily cron does the real (idempotent) write.
//
//   GET /api/nfl-props-probe/actuals[?date=YYYYMMDD]
//       Read-only probe of the box-score actuals extractor (nflPropsActuals), against a
//       REAL completed 2025 game, so the grader's stat source is confirmed before use.
//
//   GET /api/nfl-props-probe/grade-dry-run
//       Read-only DRY RUN of the grader (nflPropsGrader): grades pending shadow rows
//       from box scores and returns previews WITHOUT writing. Empty until rows exist;
//       the hourly cron does the real write-back.
//
// Delete this file (and its server.js mount) once the projection seed + prop fetcher
// are built on the confirmed shapes.

const express = require("express");
const router = express.Router();
const axios = require("axios");

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const TIMEOUT_MS = 9000;

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

function athleteIdFromRef(ref) {
  const m = String(ref || "").match(/athletes\/(\d+)/);
  return m ? m[1] : null;
}

function statusOf(e) {
  return (e && e.response && e.response.status) || null;
}

// ── Probe A: ESPN 2025 player-stat shapes (four independent sources) ──────────
async function probePlayerStats(season) {
  const out = { season, sources: {} };
  let athId = null;
  let athName = null;
  let athFrom = null;

  // 1) Core-API season leaders — structured category list + athlete refs. Preferred
  //    athlete resolver AND confirmation of which stat categories exist for 2025.
  const coreLeadersUrl = `${ESPN_CORE}/seasons/${season}/types/2/leaders`;
  try {
    const data = await espnGet(coreLeadersUrl);
    const cats = data.categories || data.items || [];
    for (const c of cats) {
      const ld = (c.leaders || [])[0];
      const ref = ld && (ld.athlete ? ld.athlete.$ref || ld.athlete : null);
      const id = athleteIdFromRef(ref);
      if (id) { athId = id; athFrom = `coreLeaders:${c.name || c.abbreviation}`; break; }
    }
    out.sources.coreLeaders = {
      url: coreLeadersUrl,
      ok: true,
      categoryNames: cats.map((c) => c.name || c.abbreviation).filter(Boolean),
      resolvedAthleteId: athId,
    };
  } catch (e) {
    out.sources.coreLeaders = { url: coreLeadersUrl, ok: false, status: statusOf(e), error: e.message };
  }

  // 2) Teams list -> first team id -> roster. Confirms athlete enumeration and gives a
  //    fallback athlete id (prefer a QB — the pass-yds seed) if leaders didn't resolve one.
  let teamId = null;
  const teamsUrl = `${ESPN_SITE}/teams`;
  try {
    const data = await espnGet(teamsUrl);
    const teams = (data.sports && data.sports[0] && data.sports[0].leagues && data.sports[0].leagues[0] && data.sports[0].leagues[0].teams) || [];
    teamId = (teams[0] && teams[0].team && teams[0].team.id) || null;
    out.sources.teams = { url: teamsUrl, ok: true, teamCount: teams.length, sampleTeamId: teamId };
  } catch (e) {
    out.sources.teams = { url: teamsUrl, ok: false, status: statusOf(e), error: e.message };
  }

  if (teamId) {
    const rosterUrl = `${ESPN_SITE}/teams/${teamId}/roster`;
    try {
      const data = await espnGet(rosterUrl);
      const groups = data.athletes || [];
      const flat = [];
      for (const g of groups) {
        if (Array.isArray(g.items)) {
          for (const a of g.items) flat.push({ id: a.id, name: a.fullName || a.displayName, pos: a.position && a.position.abbreviation });
        } else if (g.id) {
          flat.push({ id: g.id, name: g.fullName || g.displayName, pos: g.position && g.position.abbreviation });
        }
      }
      const qb = flat.find((a) => a.pos === "QB") || flat[0] || null;
      if (!athId && qb && qb.id) { athId = String(qb.id); athName = qb.name; athFrom = "roster"; }
      else if (qb) athName = athName || qb.name;
      out.sources.roster = {
        url: rosterUrl,
        ok: true,
        groupCount: groups.length,
        athleteCount: flat.length,
        positionsSeen: [...new Set(flat.map((a) => a.pos))].filter(Boolean),
        sampleAthlete: qb,
      };
    } catch (e) {
      out.sources.roster = { url: rosterUrl, ok: false, status: statusOf(e), error: e.message };
    }
  }

  // 3) THE key source — athlete SEASON statistics (core API). Confirms the exact stat
  //    field names a projection reads (passingYards / rushingYards / receptions / attempts
  //    / gamesPlayed ...). Uses whichever athlete id sources 1 or 2 resolved.
  if (athId) {
    const statUrl = `${ESPN_CORE}/seasons/${season}/types/2/athletes/${athId}/statistics`;
    try {
      const data = await espnGet(statUrl);
      const cats = (data.splits && data.splits.categories) || [];
      out.sources.athleteSeasonStats = {
        url: statUrl,
        ok: true,
        athleteId: athId,
        athleteName: athName,
        resolvedFrom: athFrom,
        categories: cats.map((c) => ({
          name: c.name,
          displayName: c.displayName,
          stats: (c.stats || []).slice(0, 14).map((s) => ({
            name: s.name, abbr: s.abbreviation, value: s.value, display: s.displayValue,
          })),
        })),
      };
    } catch (e) {
      out.sources.athleteSeasonStats = { url: statUrl, ok: false, athleteId: athId, status: statusOf(e), error: e.message };
    }

    // 4) Athlete GAMELOG — per-game rows (the variance/dispersion source).
    const gamelogUrl = `${ESPN_SITE}/athletes/${athId}/gamelog?season=${season}`;
    try {
      const data = await espnGet(gamelogUrl);
      const st = data.seasonTypes || [];
      let firstRow = null;
      const cat0 = st[0] && st[0].categories && st[0].categories[0];
      const ev0 = cat0 && cat0.events && cat0.events[0];
      if (ev0) firstRow = { eventId: ev0.eventId, stats: ev0.stats };
      out.sources.athleteGamelog = {
        url: gamelogUrl,
        ok: true,
        athleteId: athId,
        statLabels: data.names || data.labels || null,
        seasonTypeCount: st.length,
        sampleGameRow: firstRow,
      };
    } catch (e) {
      out.sources.athleteGamelog = { url: gamelogUrl, ok: false, athleteId: athId, status: statusOf(e), error: e.message };
    }
  } else {
    out.sources.athleteSeasonStats = { ok: false, error: "no athlete id resolved from coreLeaders or roster" };
    out.sources.athleteGamelog = { ok: false, error: "no athlete id resolved from coreLeaders or roster" };
  }

  out.note =
    "Read-only v2. Sources probed independently. coreLeaders.categoryNames = stat " +
    "categories that exist for the season. athleteSeasonStats.categories[].stats = the " +
    "exact field names the projection seed reads (pass yds / rush yds / receptions + " +
    "attempts + gamesPlayed). athleteGamelog.sampleGameRow = per-game shape for a variance " +
    "fit. If season stats are empty, retry ?season=2024 to confirm on a fully-closed season.";
  return out;
}

// ── Probe B: Odds API NFL player-prop availability + cost ──────────────────────
async function probePropOdds() {
  if (!ODDS_API_KEY) return { ok: false, error: "ODDS_API_KEY not configured" };
  const out = { ok: true, markets: CORE_PROP_MARKETS };

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
    out.events = { url: eventsUrl, ok: false, status: statusOf(e), error: e.message };
  }

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
      const status = statusOf(e);
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
    "Read-only. marketsReturned lists which player-prop markets the plan actually serves " +
    "for the sampled event. Empty markets with httpStatus 200 = plan allows them but books " +
    "have not posted props this far out (expected until ~preseason). httpStatus 422 = plan " +
    "does not include player props (upgrade needed). The /events list call is free; the " +
    "event-odds call is where credits are spent.";
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

router.get("/projections", async (req, res) => {
  try {
    const season = parseInt(req.query.season, 10) || 2025;
    const teamsParam = req.query.teams != null ? parseInt(req.query.teams, 10) : 3;
    const teamLimit = Number.isFinite(teamsParam) && teamsParam >= 0 ? teamsParam : 3;
    const { buildPlayerProjections } = require("../services/nflPropsData");
    const result = await buildPlayerProjections({ season, teamLimit });
    res.json(result);
  } catch (e) {
    console.error("[nfl-props-probe/projections] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/lines", async (req, res) => {
  try {
    const days = req.query.days != null ? parseInt(req.query.days, 10) : 8;
    const maxEvents = req.query.maxEvents != null ? parseInt(req.query.maxEvents, 10) : 16;
    const { getNflPropLines } = require("../services/nflPropsOdds");
    const result = await getNflPropLines({
      daysAhead: Number.isFinite(days) && days > 0 ? days : 8,
      maxEvents: Number.isFinite(maxEvents) && maxEvents > 0 ? maxEvents : 16,
    });
    res.json(result);
  } catch (e) {
    console.error("[nfl-props-probe/lines] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/shadow-dry-run", async (req, res) => {
  try {
    const days = req.query.days != null ? parseInt(req.query.days, 10) : 7;
    const { recordNflPropShadow } = require("../services/nflPropsShadow");
    const result = await recordNflPropShadow({
      daysAhead: Number.isFinite(days) && days > 0 ? days : 7,
      dryRun: true,
    });
    res.json(result);
  } catch (e) {
    console.error("[nfl-props-probe/shadow-dry-run] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/actuals", async (req, res) => {
  try {
    const date = (req.query.date && /^\d{8}$/.test(req.query.date)) ? req.query.date : "20251207";
    const { probeActuals } = require("../services/nflPropsActuals");
    const result = await probeActuals({ date });
    res.json(result);
  } catch (e) {
    console.error("[nfl-props-probe/actuals] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/grade-dry-run", async (req, res) => {
  try {
    const { gradeNflPropShadows } = require("../services/nflPropsGrader");
    const result = await gradeNflPropShadows({ dryRun: true });
    res.json(result);
  } catch (e) {
    console.error("[nfl-props-probe/grade-dry-run] error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
