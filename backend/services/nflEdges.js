/**
 * nflEdges.js — WizePicks NFL edge slate runner (Phase 2, F4).
 *
 * Ties the three validated pieces together:
 *   getNFLMainOdds()      (oddsApi)        → parsed odds events  [F2]
 *   buildTeamRatings()    (nflDataSource)  → power ratings by id  [F3c]
 *   predictGame(ev, ctx)  (nflModel)       → predictions + edges  [F3a]
 *
 * It resolves each odds event's full team NAMES to the rating map (which carries
 * name + abbr per ESPN teamId), feeds the ratings into the model as ctx, and
 * returns the full predicted slate.
 *
 * HONESTY: this is a 2025-seeded rating against (currently) preseason 2026 lines.
 * The output is directionally reasonable but NOT calibrated — no graded results
 * exist yet. The route wraps this with calibrated:false / preseason flags, and
 * the model only publishes a `value:true` pick when it has real ratings AND a
 * meaningful edge. Until the season grades games in shadow mode, treat every edge
 * as provisional. No fabricated confidence ships.
 */

const { getNFLMainOdds } = require("./oddsApi");
const { buildTeamRatings } = require("./nflDataSource");
const { predictGame } = require("./nflModel");

// Normalize a team name for matching: lowercase, strip punctuation/extra spaces.
function normName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// Build fast lookup maps (by normalized full name, and by last word = nickname)
// from the ratings map so an odds team name resolves to its rating.
function buildResolver(ratingsTeams) {
  const byName = new Map();
  const byNick = new Map();
  const byAbbr = new Map();
  for (const id of Object.keys(ratingsTeams || {})) {
    const t = ratingsTeams[id];
    if (!t) continue;
    if (t.name) byName.set(normName(t.name), t);
    if (t.abbr) byAbbr.set(normName(t.abbr), t);
    // nickname = last token of the display name ("Seattle Seahawks" → "seahawks")
    if (t.name) {
      const parts = normName(t.name).split(" ");
      if (parts.length) byNick.set(parts[parts.length - 1], t);
    }
  }
  return { byName, byNick, byAbbr };
}

// Resolve one odds team name to a rating team (exact name → nickname → abbr).
// Returns the rating team object or null (null = no rating → model stays market-only).
function resolveTeam(resolver, oddsTeamName) {
  const n = normName(oddsTeamName);
  if (resolver.byName.has(n)) return resolver.byName.get(n);
  const parts = n.split(" ");
  const nick = parts[parts.length - 1];
  if (resolver.byNick.has(nick)) return resolver.byNick.get(nick);
  if (resolver.byAbbr.has(n)) return resolver.byAbbr.get(n);
  return null;
}

// Compute the NFL regular-season opener for a given year: Week 1 kicks off the
// Thursday AFTER US Labor Day (Labor Day = first Monday of September). Derived in
// code so it auto-rolls year to year — no brittle hardcoded date. Returns a Date
// at that Thursday 00:00 UTC (good enough as a phase boundary).
function nflRegularSeasonStart(year) {
  // first Monday of September
  const sept1 = new Date(Date.UTC(year, 8, 1));
  const dow = sept1.getUTCDay(); // 0=Sun..6=Sat
  const firstMonday = 1 + ((8 - dow) % 7); // day-of-month of first Monday
  // Labor Day Monday → Week 1 Thursday is Labor Day + 3 days
  const thursday = firstMonday + 3;
  return new Date(Date.UTC(year, 8, thursday, 0, 0, 0));
}

// Tag a commence time as the NFL season phase. Anything before that season's
// regular opener is preseason; on/after is regular. (Postseason in Jan/Feb is
// folded into "regular" for board purposes — separate tab not needed now.)
function nflPhaseFor(commenceISO) {
  if (!commenceISO) return "regular";
  const d = new Date(commenceISO);
  if (isNaN(d)) return "regular";
  // A game's season YEAR is its calendar year, except Jan/Feb playoffs belong to
  // the prior year's season — treat those as regular of (year-1).
  const month = d.getUTCMonth(); // 0=Jan
  const seasonYear = month <= 1 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const regStart = nflRegularSeasonStart(seasonYear);
  return d.getTime() < regStart.getTime() ? "preseason" : "regular";
}

// Run the full NFL slate: returns { ratingsMeta, games:[prediction...], match:{...} }.
// `weeks` limits output to the next N NFL weeks (default 1) so the board shows one
// slate at a time — each team appears once — instead of every lookahead game at
// once. The window is anchored to the EARLIEST upcoming game in the feed (rolls
// forward like the MLB board): week = [earliest, earliest + 7d*weeks). Pass
// weeks=0 to disable the filter and return the full multi-week slate.
async function runNFLSlate({ season = 2025, weeks = 1, phase = null } = {}) {
  const [eventsRaw, ratings] = await Promise.all([
    getNFLMainOdds(),
    buildTeamRatings(season),
  ]);

  let events = Array.isArray(eventsRaw) ? eventsRaw.slice() : [];

  // ── Season phase (preseason vs regular), derived from each game's date ───────
  // Tag every game, then figure out which phases still have UPCOMING games so the
  // UI can show a phase tab ONLY when it has games left (auto-disappears when a
  // phase ends). If no phase is requested, default to the earliest phase that
  // still has upcoming games (preseason first, then regular).
  const now = Date.now();
  for (const e of events) e._phase = nflPhaseFor(e.commenceTime);
  const phasesUpcoming = { preseason: false, regular: false };
  for (const e of events) {
    const t = e.commenceTime ? new Date(e.commenceTime).getTime() : null;
    if (t != null && t >= now && phasesUpcoming[e._phase] != null) phasesUpcoming[e._phase] = true;
  }
  const availablePhases = ["preseason", "regular"].filter(p => phasesUpcoming[p]);
  // Selected phase: requested (if it has games) else first available else "regular".
  let selectedPhase = phase && phasesUpcoming[phase] ? phase
    : (availablePhases[0] || "regular");
  // If literally nothing is upcoming (deep offseason), don't phase-filter — show
  // whatever the feed has so the board isn't empty for testing.
  const anyUpcoming = availablePhases.length > 0;
  if (anyUpcoming) {
    events = events.filter(e => e._phase === selectedPhase);
  }

  // ── Week filter (Option B: anchor to earliest upcoming game, roll forward) ──
  let weekWindow = null;
  if (weeks > 0 && events.length) {
    const DAY = 86400000;
    const times = events
      .map(e => ({ e, t: e.commenceTime ? new Date(e.commenceTime).getTime() : null }))
      .filter(x => x.t != null);
    // Prefer games still upcoming; if none are upcoming (deep offseason), fall back
    // to the earliest game in the feed so the board is never empty.
    const upcoming = times.filter(x => x.t >= now);
    const pool = upcoming.length ? upcoming : times;
    if (pool.length) {
      const anchor = Math.min(...pool.map(x => x.t));
      const windowEnd = anchor + DAY * 7 * weeks;
      events = times.filter(x => x.t >= anchor && x.t < windowEnd).map(x => x.e);
      weekWindow = { fromISO: new Date(anchor).toISOString(), toISO: new Date(windowEnd).toISOString(), weeks };
    }
  }

  const resolver = buildResolver(ratings.teams);
  const ratingsLoaded = (ratings.rated || 0) > 0;

  let matched = 0, unmatched = 0;
  const unmatchedNames = new Set();

  const games = (events || []).map((ev) => {
    const homeT = resolveTeam(resolver, ev.homeTeam);
    const awayT = resolveTeam(resolver, ev.awayTeam);
    if (ratingsLoaded) {
      if (homeT && awayT) matched++;
      else {
        unmatched++;
        if (!homeT) unmatchedNames.add(ev.homeTeam);
        if (!awayT) unmatchedNames.add(ev.awayTeam);
      }
    }
    // ctx carries ratings when both teams resolved; absent → model is market-only.
    const ctx = (ratingsLoaded && homeT && awayT)
      ? { home: { rating: homeT.rating }, away: { rating: awayT.rating } }
      : {};
    return predictGame(ev, ctx);
  });

  return {
    season,
    weekWindow,
    phase: { selected: selectedPhase, available: availablePhases },
    ratingsMeta: {
      loaded: ratingsLoaded,
      rated: ratings.rated || 0,
      note: ratings.note || null,
    },
    match: {
      matched, unmatched,
      unmatchedNames: [...unmatchedNames],
      coverage: games.length ? Math.round((matched / games.length) * 100) : 0,
    },
    games,
  };
}

module.exports = { runNFLSlate, _internal: { normName, resolveTeam, buildResolver } };
