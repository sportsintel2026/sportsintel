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

// ── Rolling season blend (2025->2026 rollover) ───────────────────────────────
// WZ-NFLROLLOVER-2026-07-05
// Rate on the PRIOR completed season early, and let the CURRENT season take over as
// its games accumulate: weight on current = g / (g + SEASON_BLEND_K). Before the
// current season's regular opener there are provably ZERO current-season regular
// games, so this is PURE PRIOR — byte-identical to the old fixed-2025 behavior — and
// it transitions on its own once real games are played. The season year is derived,
// so no manual bump is needed from one year to the next.
const SEASON_BLEND_K = 6; // current-season pseudo-games; higher = trust the prior longer

// The season whose regular season is current/most-recent. A season's year is its
// calendar year, except Jan/Feb (playoffs) which belong to the prior year's season.
function currentNflSeasonYear(now = new Date()) {
  const m = now.getUTCMonth(); // 0=Jan
  return m <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

// PURE: blend two buildTeamRatings() results by per-team current-season games. Starts
// from the prior object and overrides only each team's rating, so every other field
// (ids, names the resolver needs, rated count) is preserved exactly.
function blendRatings(prior, current, k = SEASON_BLEND_K) {
  const curTeams = (current && current.teams) || {};
  const teams = {};
  let blendedTeams = 0;
  for (const id of Object.keys((prior && prior.teams) || {})) {
    const pt = prior.teams[id];
    const ct = curTeams[id];
    const gCur = ct ? (ct.gp || 0) : 0;
    if (gCur > 0 && ct.rating != null && pt.rating != null) {
      const w = gCur / (gCur + k);
      teams[id] = {
        ...pt,
        rating: Math.round((w * ct.rating + (1 - w) * pt.rating) * 100) / 100,
        priorRating: pt.rating, currentRating: ct.rating, currentGp: gCur,
        blendWeight: Math.round(w * 100) / 100,
      };
      blendedTeams++;
    } else {
      teams[id] = { ...pt, currentGp: gCur };
    }
  }
  return { ...prior, teams, blend: { mode: blendedTeams ? "blended" : "prior-only", k, blendedTeams } };
}

// Build the rolling-blend ratings for the live model. Fetches the prior season always;
// fetches the current season and blends only once its regular season has opened.
async function buildBlendedTeamRatings({ now = new Date() } = {}) {
  const currentSeason = currentNflSeasonYear(now);
  const priorSeason = currentSeason - 1;
  const prior = await buildTeamRatings(priorSeason);

  const regStart = nflRegularSeasonStart(currentSeason);
  if (now.getTime() < regStart.getTime()) {
    return { ...prior, blend: { mode: "prior-only", priorSeason, currentSeason, k: SEASON_BLEND_K, blendedTeams: 0 } };
  }
  const current = await buildTeamRatings(currentSeason);
  const out = blendRatings(prior, current, SEASON_BLEND_K);
  out.blend = { ...out.blend, priorSeason, currentSeason };
  return out;
}

// Run the full NFL slate: returns { ratingsMeta, games:[prediction...], match:{...} }.
// `weeks` limits output to the next N NFL weeks (default 1) so the board shows one
// slate at a time — each team appears once — instead of every lookahead game at
// once. The window is anchored to the EARLIEST upcoming game in the feed (rolls
// forward like the MLB board): week = [earliest, earliest + 7d*weeks). Pass
// weeks=0 to disable the filter and return the full multi-week slate.
// ── Totals scoring model (2025-seeded; mirrors CFB) ──────────────────────────
// WZ-NFLTOTALS-2026-07-05
// Projected points = a team's per-game offense vs the opponent's per-game defense,
// re-centered on the league average. Home + away projPts sum to the projected total,
// which nflModel already compares to the book line (NFL_TOTAL_SIGMA=10) to price
// over/under and gate an edge. Needs full pf/pa/gp on BOTH sides; returns null
// otherwise so the game stays market-only (no fabricated total). 2025 seed ->
// PROVISIONAL, shadow-graded off final scores before it earns trust.
function leaguePpgFrom(teams) {
  const vals = Object.values(teams || {})
    .map((t) => (t && t.gp > 0 && t.pf != null) ? t.pf / t.gp : null)
    .filter((v) => v != null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}
function projPointsFor(team, opp, leaguePPG) {
  if (!team || !opp || leaguePPG == null) return null;
  if (!(team.gp > 0) || !(opp.gp > 0) || team.pf == null || opp.pa == null) return null;
  return Math.round((team.pf / team.gp + opp.pa / opp.gp - leaguePPG) * 10) / 10;
}

async function runNFLSlate({ season = null, weeks = 1, phase = null } = {}) {
  const [eventsRaw, ratings] = await Promise.all([
    getNFLMainOdds(),
    season == null ? buildBlendedTeamRatings() : buildTeamRatings(season),
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
  const leaguePPG = leaguePpgFrom(ratings.teams); // baseline for the totals scoring model

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
      ? { home: { rating: homeT.rating, projPoints: projPointsFor(homeT, awayT, leaguePPG) },
          away: { rating: awayT.rating, projPoints: projPointsFor(awayT, homeT, leaguePPG) } }
      : {};
    const pred = predictGame(ev, ctx);
    // Carry the books' Market Read (consensus lean) through onto the prediction so
    // the board can show it alongside the model's edge (facts vs model claim).
    pred.marketRead = ev.marketRead || null;
    // Carry the book-by-book line-shopping grid through so the Odds page renders
    // NFL's per-book table (ML / total / spread) exactly like MLB.
    pred.oddsGrid = ev.oddsGrid || null;
    return pred;
  });

  return {
    season: ratings.season != null ? ratings.season : season,
    weekWindow,
    phase: { selected: selectedPhase, available: availablePhases },
    ratingsMeta: {
      loaded: ratingsLoaded,
      rated: ratings.rated || 0,
      note: ratings.note || null,
      blend: ratings.blend || null,
    },
    match: {
      matched, unmatched,
      unmatchedNames: [...unmatchedNames],
      coverage: games.length ? Math.round((matched / games.length) * 100) : 0,
    },
    games,
  };
}

module.exports = { runNFLSlate, captureNFLOddsTicks, getNFLMarketMovers, _internal: { normName, resolveTeam, buildResolver, nflPhaseFor, nflRegularSeasonStart, currentNflSeasonYear, blendRatings, buildBlendedTeamRatings, SEASON_BLEND_K, leaguePpgFrom, projPointsFor } };

// ── NFL odds-tick snapshots (line-movement history) ──────────────────────────
// Mirrors MLB captureOddsTicks but writes to its OWN table (nfl_odds_ticks) so the
// MLB pipeline is untouched and the two leagues' 4-day prune sweeps never collide.
// Snapshots best ML/total/spread prices per pre-game NFL event each run so Market
// Movers can show open→now movement. In the offseason lookahead lines barely move,
// so this accumulates slowly — that's expected; it comes alive as the season nears.
// Cache-respecting fetch (shares the 30-min odds cache) → ~no extra API credits.
const { createClient } = require("@supabase/supabase-js");
function nflDb() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); }

async function captureNFLOddsTicks() {
  let events = [];
  try { events = await getNFLMainOdds(); }
  catch (e) { console.error("[NFL Ticks] odds fetch failed:", e.message); return 0; }
  if (!events || !events.length) { console.log("[NFL Ticks] no events"); return 0; }

  const supabase = nflDb();
  const now = new Date().toISOString();
  const rows = [];
  for (const ev of events) {
    const away = ev.awayTeam, home = ev.homeTeam;
    if (!away || !home) continue;
    // Only snapshot PRE-GAME prices (skip anything already started).
    if (ev.commenceTime && new Date(ev.commenceTime).getTime() <= Date.now()) continue;
    const base = { captured_at: now, away_team: away, home_team: home };
    if (ev.h2h?.away != null)   rows.push({ ...base, market: "ml",     side: "away",  line: null, odds: ev.h2h.away });
    if (ev.h2h?.home != null)   rows.push({ ...base, market: "ml",     side: "home",  line: null, odds: ev.h2h.home });
    if (ev.totals?.over != null)  rows.push({ ...base, market: "total",  side: "over",  line: ev.totals.line ?? null,  odds: ev.totals.over });
    if (ev.totals?.under != null) rows.push({ ...base, market: "total",  side: "under", line: ev.totals.line ?? null,  odds: ev.totals.under });
    if (ev.spreads?.away != null) rows.push({ ...base, market: "spread", side: "away",  line: ev.spreads.awayLine ?? null, odds: ev.spreads.away });
    if (ev.spreads?.home != null) rows.push({ ...base, market: "spread", side: "home",  line: ev.spreads.homeLine ?? null, odds: ev.spreads.home });
  }
  if (!rows.length) return 0;
  const { error } = await supabase.from("nfl_odds_ticks").insert(rows);
  if (error) { console.error("[NFL Ticks] insert failed:", error.message); return 0; }
  // Keep ~10 days (NFL games are weekly, so a longer window than MLB's 4d).
  try { await supabase.from("nfl_odds_ticks").delete().lt("captured_at", new Date(Date.now() - 10 * 864e5).toISOString()); } catch (_) {}
  console.log(`[NFL Ticks] saved ${rows.length} snapshots`);
  return rows.length;
}

// Read movement: for each event+market+side, compare the EARLIEST stored price
// (open) to the latest (now). Returns movers sorted by absolute cent move, so the
// dashboard can show "Steelers ML -105 → -130 ▼25". Empty until ticks accumulate.
function amCents(odds) { // american odds → "cents" distance from pick'em for comparable movement
  if (odds == null) return null;
  return odds > 0 ? odds : odds; // keep raw american; movement is delta of these
}
async function getNFLMarketMovers({ limit = 12 } = {}) {
  const supabase = nflDb();
  // pull recent ticks (last 10 days), then reduce in JS to open/now per key.
  const { data, error } = await supabase
    .from("nfl_odds_ticks")
    .select("away_team,home_team,market,side,line,odds,captured_at")
    .order("captured_at", { ascending: true })
    .limit(5000);
  if (error) { console.error("[NFL Movers] read failed:", error.message); return []; }
  if (!data || !data.length) return [];
  const byKey = new Map(); // key → { open, now, ... }
  for (const r of data) {
    const key = `${r.away_team}@${r.home_team}|${r.market}|${r.side}|${r.line ?? ""}`;
    const slot = byKey.get(key) || { matchup: `${r.away_team} @ ${r.home_team}`, market: r.market, side: r.side, line: r.line, open: r.odds, openAt: r.captured_at };
    slot.now = r.odds; slot.nowAt = r.captured_at;
    byKey.set(key, slot);
  }
  const movers = [];
  for (const s of byKey.values()) {
    if (s.open == null || s.now == null) continue;
    const delta = amCents(s.now) - amCents(s.open);
    if (delta === 0) continue; // no movement
    movers.push({ ...s, delta, dir: delta > 0 ? "up" : "dn" });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return movers.slice(0, limit);
}
