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

const { getNFLMainOdds, getNFLPinnacleClose } = require("./oddsApi");
const { buildTeamRatings } = require("./nflDataSource");
const { predictGame } = require("./nflModel");
const { teamKey } = require("./teamKey"); // WZ-TEAMKEY-SSOT-2026-07-17

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
  const byKey = new Map(); // WZ-TEAMKEY-SSOT-2026-07-17 :: canonical, collision-safe (null on clash)
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
    // canonical key from the shared team table — resolves name/nick/abbr variants uniformly.
    const k = teamKey(t.name || t.abbr, "nfl");
    if (k) { if (byKey.has(k)) { if (byKey.get(k) !== t) byKey.set(k, null); } else byKey.set(k, t); }
  }
  return { byName, byNick, byAbbr, byKey };
}

// Resolve one odds team name to a rating team (exact name → nickname → abbr).
// Returns the rating team object or null (null = no rating → model stays market-only).
function resolveTeam(resolver, oddsTeamName) {
  const n = normName(oddsTeamName);
  if (resolver.byName.has(n)) return resolver.byName.get(n);        // exact full name (unchanged, first)
  // WZ-TEAMKEY-SSOT-2026-07-17 :: canonical pass — collision-safe, handles name/nick/abbr variants.
  // Runs BEFORE the last-word nick fallback (which it strictly improves on) and AFTER exact name,
  // so it can only ADD a correct match. A null byKey entry = ambiguous -> fall through, never guess.
  const k = teamKey(oddsTeamName, "nfl");
  if (k && resolver.byKey && resolver.byKey.has(k)) { const t = resolver.byKey.get(k); if (t) return t; }
  const parts = n.split(" ");
  const nick = parts[parts.length - 1];
  if (resolver.byNick.has(nick)) return resolver.byNick.get(nick);  // legacy fallback
  if (resolver.byAbbr.has(n)) return resolver.byAbbr.get(n);        // legacy fallback
  return null;
}

// Compute the NFL regular-season opener for a given year: Week 1 kicks off the
// Thursday AFTER US Labor Day (Labor Day = first Monday of September). Derived in
// code so it auto-rolls year to year — no brittle hardcoded date. Returns a Date
// at that Thursday 00:00 UTC (good enough as a phase boundary).
function nflRegularSeasonStart(year) {
  // WZ-FBCAL-2026-08-03 :: The "Labor Day Monday + 3 = Thursday" formula below is right for most
  // seasons (2025 -> Sept 4, correct) but the league does not always open on a Thursday. 2026 opens
  // WEDNESDAY Sept 9 (Patriots at Seahawks, Super Bowl LX rematch), so the formula returned Sept 10
  // and tagged the season opener "preseason". nflPhaseFor then defaults the board to the earliest
  // phase with upcoming games, and runNFLSlate FILTERS events to that phase -- so for the ~10 days
  // before kickoff the board would have shown that ONE game and hidden the whole Week 1 slate,
  // taking the Week 1 shadow rows (recordFootballPredictions runs on the same filtered slate) with
  // it. Explicit sourced pins win; the formula stays as the fallback for unpinned years.
  // /api/edges/fbseasonprobe reads ESPN's own seasons/{year}/types/2 boundary so a later cycle can
  // DERIVE this instead of listing it.
  const NFL_REG_START_UTC = { 2026: Date.UTC(2026, 8, 9, 0, 0, 0) }; // Sept 9, 2026
  if (NFL_REG_START_UTC[year] != null) return new Date(NFL_REG_START_UTC[year]);
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
  // WZ-FBHORIZON-2026-08-06 :: the board may not publish a slate the recorder will not log.
  // recordFootballPredictions drops any game further out than FOOTBALL_IMMINENT_DAYS, so with an
  // empty preseason feed the board fell through to regular season and published 16 games ~35 days
  // out that the recorder silently dropped -- board and recorder disagreeing again, the same split
  // WZ-FBRECORD-MATCHES-BOARD-2026-08-03 closed from the other side. The recorder owns the number;
  // this reads it, so the two cannot drift.
  // DELETED with this change: the `upcoming.length ? upcoming : times` fallback that anchored to a
  // PAST game so the board would never be empty. A board showing finished games is worse than a
  // board that reports it has none, and boardHorizon now carries the reason.
  const { FOOTBALL_IMMINENT_DAYS } = require("./predictionTracker");
  let weekWindow = null;
  let boardHorizon = null;
  if (weeks > 0 && events.length) {
    const DAY = 86400000;
    const times = events
      .map(e => ({ e, t: e.commenceTime ? new Date(e.commenceTime).getTime() : null }))
      .filter(x => x.t != null);
    const upcoming = times.filter(x => x.t >= now);
    if (!upcoming.length) {
      events = [];
      boardHorizon = { published: false, reason: "no upcoming games in the feed", horizonDays: FOOTBALL_IMMINENT_DAYS, nextGameISO: null, daysOut: null };
    } else {
      const anchor = Math.min(...upcoming.map(x => x.t));
      const daysOut = Math.round(((anchor - now) / DAY) * 10) / 10;
      if (daysOut > FOOTBALL_IMMINENT_DAYS) {
        events = [];
        boardHorizon = { published: false, reason: "next game is beyond the publish horizon", horizonDays: FOOTBALL_IMMINENT_DAYS, nextGameISO: new Date(anchor).toISOString(), daysOut };
      } else {
        // Clamp the far edge too: a slate anchored 6 days out would otherwise reach 13 days and
        // publish a tail the recorder still drops. Every published game sits inside the horizon.
        // Math.max(anchor + 1, ...) because the game-filter below is `t < windowEnd`: a slate whose
        // anchor sits EXACTLY on the horizon would otherwise clamp windowEnd to the anchor instant
        // and exclude the very game it anchored on -- published:true over an empty board.
        const windowEnd = Math.max(anchor + 1, Math.min(anchor + DAY * 7 * weeks, now + DAY * FOOTBALL_IMMINENT_DAYS));
        events = times.filter(x => x.t >= anchor && x.t < windowEnd).map(x => x.e);
        weekWindow = { fromISO: new Date(anchor).toISOString(), toISO: new Date(windowEnd).toISOString(), weeks };
        boardHorizon = { published: true, reason: null, horizonDays: FOOTBALL_IMMINENT_DAYS, nextGameISO: new Date(anchor).toISOString(), daysOut };
      }
    }
  }

  const resolver = buildResolver(ratings.teams);
  const ratingsLoaded = (ratings.rated || 0) > 0;
  const leaguePPG = leaguePpgFrom(ratings.teams); // baseline for the totals scoring model
  // WZ-FBNEUTRAL-2026-08-03 :: The Odds API carries no venue field, so every game reached
  // nflModel as a home game and took the full NFL_HFA_POINTS 2.5 -- including the international
  // slate, where no home edge exists. ESPN's scoreboard already carries neutralSite and
  // nflDataSource already parses it; footballVenue joins the two using the SAME matcher
  // predictionTracker.gradeFootball uses. Failure here must never take the board down: any
  // throw leaves neutralIdx null and every game keeps today's behaviour.
  let neutralIdx = null;
  try {
    const { buildNeutralIndex } = require("./footballVenue");
    const { fetchScoreboard } = require("./nflDataSource");
    neutralIdx = await buildNeutralIndex({ fetchBoard: fetchScoreboard, league: "nfl", events });
  } catch (e) {
    console.error("[nflEdges] neutral-site index failed, all games keep home-field:", e.message);
    neutralIdx = null;
  }

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
    // WZ-FBNEUTRAL-2026-08-03 :: null = UNKNOWN (game not on ESPN's board yet, or name unmatched)
    // -> leave unset, which is today's behaviour: full home-field. Only an explicit true from
    // ESPN zeroes the HFA. We never guess a venue in either direction.
    const nSite = neutralIdx ? neutralIdx.isNeutral(ev.awayTeam, ev.homeTeam) : null;
    if (nSite === true) ctx.neutralSite = true;
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
    // WZ-FBHORIZON-2026-08-06 :: why the board is empty when it is empty, for the UI to say so.
    boardHorizon,
    phase: { selected: selectedPhase, available: availablePhases },
    ratingsMeta: {
      loaded: ratingsLoaded,
      rated: ratings.rated || 0,
      note: ratings.note || null,
      // WZ-NFLSOS-2026-08-01 :: the /api/edges/nfl disclaimer reads this to decide whether
      // to claim SRS strength-of-schedule. applyNflSrs is all-or-nothing and can decline,
      // so this must reflect what actually happened, never a hardcoded assumption.
      sosApplied: ratings.sosApplied === true,
      sosSkippedReason: ratings.sosSkippedReason || null,
      // WZ-FBNEUTRAL-2026-08-03 :: coverage of the neutral-site join. "resolved 0 of 16" must not
      // look identical to "no game was neutral" -- that ambiguity is what hid this bug for months.
      neutral: neutralIdx ? neutralIdx.meta : null,
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
  // WZ-NFL-PINN-TICKS-2026-07-14 :: also snapshot Pinnacle (sharp book, eu) into nfl_odds_ticks,
  // tagged side "...@Pinnacle", so sharp-side / reverse-line-movement detection can compare the
  // sharp line against the soft-book consensus. Fail-safe: a Pinnacle failure never blocks the US capture.
  try {
    const pinEvents = await getNFLPinnacleClose();
    for (const ev of (pinEvents || [])) {
      const pa = ev.awayTeam, ph = ev.homeTeam;
      if (!pa || !ph) continue;
      if (ev.commenceTime && new Date(ev.commenceTime).getTime() <= Date.now()) continue;
      const pbase = { captured_at: now, away_team: pa, home_team: ph };
      if (ev.h2h?.away != null)     rows.push({ ...pbase, market: "ml",     side: "away@Pinnacle",  line: null, odds: ev.h2h.away });
      if (ev.h2h?.home != null)     rows.push({ ...pbase, market: "ml",     side: "home@Pinnacle",  line: null, odds: ev.h2h.home });
      if (ev.totals?.over != null)  rows.push({ ...pbase, market: "total",  side: "over@Pinnacle",  line: ev.totals.line ?? null, odds: ev.totals.over });
      if (ev.totals?.under != null) rows.push({ ...pbase, market: "total",  side: "under@Pinnacle", line: ev.totals.line ?? null, odds: ev.totals.under });
      if (ev.spreads?.away != null) rows.push({ ...pbase, market: "spread", side: "away@Pinnacle",  line: ev.spreads.awayLine ?? null, odds: ev.spreads.away });
      if (ev.spreads?.home != null) rows.push({ ...pbase, market: "spread", side: "home@Pinnacle",  line: ev.spreads.homeLine ?? null, odds: ev.spreads.home });
    }
  } catch (e) { console.error("[NFL Ticks] Pinnacle snapshot failed:", e.message); }
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
