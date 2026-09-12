/**
// CFB-EDGES-SOSAPPLIED-META-2026-06-22
 * cfbEdges.js — WizePicks CFB edge slate runner (Phase 2).
 *
 * Mirrors nflEdges, wiring the three CFB pieces together:
 *   getCFBMainOdds()      (oddsApi)        → parsed odds events
 *   buildTeamRatings()    (cfbDataSource)  → FBS power ratings by ESPN id
 *   predictGame(ev, ctx)  (cfbModel)       → predictions + edges
 *
 * THE HARD PART IS NAME MATCHING. The ratings key off ESPN names ("San José State
 * Spartans", "Hawai'i Rainbow Warriors", "Miami (OH) RedHawks") while the Odds API
 * sends its own spellings. So the resolver here is CFB-specific, NOT the NFL one:
 *   - normName FOLDS diacritics (José→Jose, Hawai'i→Hawaii) before stripping
 *     punctuation — the NFL normalizer would drop the accented letter entirely.
 *   - matching is by FULL NAME, then by SCHOOL name (name minus the mascot) — NOT by
 *     mascot, because CFB mascots collide massively (Tigers = Auburn/LSU/Clemson/...).
 *   - an ALIASES map handles abbreviation-style mismatches (App State vs Appalachian
 *     State, etc.); it starts small and is extended from the live unmatched list.
 *
 * HONESTY: 2025-seeded SRS ratings (strength-of-schedule applied), against (now)
 * preseason 2026 lines — directionally reasonable but NOT calibrated. FBS-vs-FCS
 * games keep the unrated (FCS) side market-only, which is correct. Every pick ships
 * provisional behind the route's "IN TRAINING" fence until shadow-graded in-season.
 *
 * Cmd-F build token: CFB-EDGES-ALIASES-MASSACHUSETTS-SAMHOUSTON-VERIFIED-2026-06-22
 */

const { getCFBMainOdds, getCFBPinnacleClose } = require("./oddsApi");
const { buildTeamRatings } = require("./cfbDataSource");
const { predictGame, EDGE_ML, EDGE_SPREAD, EDGE_TOTAL } = require("./cfbModel");
const {
  buildCfbPredictionContract,
  applyCfbContractToPrediction,
} = require("./cfbPredictionContract");

// WZ-TEAMKEY-SSOT-2026-07-17 :: the CFB name-matching primitives (diacritic-folding normalize,
// schoolKey mascot-strip, and the verified odds→ESPN alias map) now live ONCE in ./teamKey. This
// file was their original home; they were lifted VERBATIM, so behavior is identical. Imported under
// the original local names so buildResolver / resolveTeam / the _internal export are all unchanged.
const { cfbNorm: normName, schoolKey, CFB_ALIASES: ALIASES } = require("./teamKey");

// Build lookup maps from the ratings map. bySchool marks collisions as null so an
// ambiguous school name (rare) resolves to nothing rather than the wrong team.
function buildResolver(ratingsTeams) {
  const byName = new Map();
  const bySchool = new Map();
  const byAbbr = new Map();
  for (const id of Object.keys(ratingsTeams || {})) {
    const t = ratingsTeams[id];
    if (!t) continue;
    if (t.name) {
      const n = normName(t.name);
      byName.set(n, t);
      const sk = schoolKey(n);
      if (bySchool.has(sk)) { if (bySchool.get(sk) !== t) bySchool.set(sk, null); } // collision → ambiguous
      else bySchool.set(sk, t);
    }
    if (t.abbr) byAbbr.set(normName(t.abbr), t);
  }
  return { byName, bySchool, byAbbr };
}

// Resolve one odds team name → rating team. full name → alias → school → abbr.
// null = no rating (unrated FBS name to alias, OR a legitimately-unrated FCS team).
function resolveTeam(resolver, oddsTeamName) {
  const n = normName(oddsTeamName);
  if (resolver.byName.has(n)) return resolver.byName.get(n);
  const alias = ALIASES[n];
  if (alias && resolver.byName.has(alias)) return resolver.byName.get(alias);
  const sk = schoolKey(n);
  if (resolver.bySchool.has(sk)) { const t = resolver.bySchool.get(sk); if (t) return t; }
  if (resolver.byAbbr.has(n)) return resolver.byAbbr.get(n);
  return null;
}

// ── Rolling season blend (2025->2026 rollover; mirrors nflEdges) ─────────────
// WZ-CFBROLLOVER-2026-07-05
// Rate on the PRIOR completed season early, letting the CURRENT season take over as
// its games accumulate (weight = g/(g+K)). Before CFB's late-August opener there are
// zero current-season games, so this is PURE PRIOR — identical to the old fixed-2025
// behavior — and it transitions on its own. Season year is derived (no manual bump),
// and it blends over the UNION of both seasons' FBS teams since membership shifts with
// realignment. K is lower than NFL's: CFB's ~12-game season is shorter and rosters
// turn over harder year to year (recruiting, transfer portal), so the current season
// earns trust a touch faster. Uncalibrated default pending in-season shadow grading.
const SEASON_BLEND_K = 4;

// Season whose regular season is current/most-recent (Jan bowls/playoff belong to the
// prior year's season, same convention as NFL).
function currentCfbSeasonYear(now = new Date()) {
  const m = now.getUTCMonth(); // 0=Jan
  return m <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

// Late-August floor (year-rolling). Used ONLY to skip the expensive ~146-team current
// season crawl before any games exist; correctness comes from the per-team games
// weighting regardless of this boundary.
function cfbRegularSeasonStart(year) {
  // WZ-FBCAL-2026-08-03 :: 2026 Week 0 opens Aug 27, not Aug 20. Pinned explicitly; the Aug 20
  // floor stays as the fallback for unpinned years. Same pattern as nflRegularSeasonStart.
  const CFB_REG_START_UTC = { 2026: Date.UTC(2026, 7, 27, 0, 0, 0) }; // Aug 27, 2026
  if (CFB_REG_START_UTC[year] != null) return new Date(CFB_REG_START_UTC[year]);
  return new Date(Date.UTC(year, 7, 20)); // Aug 20
}

function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

function withRatingProvenance(team, fields) {
  if (!team) return team;
  return { ...team, ...fields };
}

// PURE: blend two buildTeamRatings() results by per-team current-season games, over the
// UNION of both seasons' teams. Preserves every non-rating field of each team object.
function blendRatings(prior, current, k = SEASON_BLEND_K) {
  const priTeams = (prior && prior.teams) || {};
  const curTeams = (current && current.teams) || {};
  const ids = new Set([...Object.keys(priTeams), ...Object.keys(curTeams)]);
  const teams = {};
  let blendedTeams = 0;
  for (const id of ids) {
    const pt = priTeams[id];
    const ct = curTeams[id];
    const completedGames = Number(current?.completedGamesByTeam?.[id]);
    const observedGames = Number.isInteger(completedGames) && completedGames >= 0 ? completedGames : 0;
    const gCur = ct ? (ct.gp || 0) : 0;
    if (gCur > 0 && ct.rating != null && pt && pt.rating != null) {
      const w = gCur / (gCur + k);
      teams[id] = withRatingProvenance(pt, {
        rating: round2(w * ct.rating + (1 - w) * pt.rating),
        priorRating: pt.rating,
        currentRating: ct.rating,
        currentGp: gCur,
        blendWeight: round2(w),
        ratingSource: "blended",
        ratingSosApplied: pt.sosApplied === true && ct.sosApplied === true,
        priorOffenseRating: pt.offenseRating ?? null,
        priorDefenseRating: pt.defenseRating ?? null,
        priorOdGames: pt.odGames ?? null,
        currentOffenseRating: ct.inSeasonOffenseRating ?? null,
        currentDefenseRating: ct.inSeasonDefenseRating ?? null,
        currentOdGames: ct.inSeasonOdGames ?? observedGames,
      });
      blendedTeams++;
    } else if (gCur > 0 && ct.rating != null) {
      teams[id] = withRatingProvenance(ct, {
        currentRating: ct.rating, currentGp: gCur, blendWeight: 1,
        ratingSource: "current-only", ratingSosApplied: ct.sosApplied === true,
        priorOffenseRating: null, priorDefenseRating: null, priorOdGames: null,
        currentOffenseRating: ct.inSeasonOffenseRating ?? null,
        currentDefenseRating: ct.inSeasonDefenseRating ?? null,
        currentOdGames: ct.inSeasonOdGames ?? observedGames,
      }); // new-to-FBS team: no prior to blend
    } else if (pt) {
      teams[id] = withRatingProvenance(pt, {
        priorRating: pt.rating, currentGp: gCur, blendWeight: 0,
        ratingSource: "prior-only", ratingSosApplied: pt.sosApplied === true,
        priorOffenseRating: pt.offenseRating ?? null,
        priorDefenseRating: pt.defenseRating ?? null,
        priorOdGames: pt.odGames ?? null,
        currentOffenseRating: null, currentDefenseRating: null, currentOdGames: observedGames,
      });
    } else if (ct) {
      teams[id] = withRatingProvenance(ct, {
        currentRating: ct.rating, currentGp: gCur, blendWeight: 1,
        ratingSource: "current-only", ratingSosApplied: ct.sosApplied === true,
        priorOffenseRating: null, priorDefenseRating: null, priorOdGames: null,
        currentOffenseRating: ct.inSeasonOffenseRating ?? null,
        currentDefenseRating: ct.inSeasonDefenseRating ?? null,
        currentOdGames: ct.inSeasonOdGames ?? observedGames,
      });
    }
  }
  return { ...prior, teams, rated: Object.keys(teams).length, blend: { mode: blendedTeams ? "blended" : "prior-only", k, blendedTeams } };
}

// Build the rolling-blend ratings for the live model. Prior season always; current
// season fetched and blended only once its regular season has opened.
async function buildBlendedTeamRatings({ now = new Date() } = {}) {
  const currentSeason = currentCfbSeasonYear(now);
  const priorSeason = currentSeason - 1;
  const prior = await buildTeamRatings(priorSeason);

  const regStart = cfbRegularSeasonStart(currentSeason);
  if (now.getTime() < regStart.getTime()) {
    const teams = {};
    for (const [id, team] of Object.entries(prior.teams || {})) {
      teams[id] = withRatingProvenance(team, {
        priorRating: team.rating, currentGp: 0, blendWeight: 0,
        ratingSource: "prior-only", ratingSosApplied: team.sosApplied === true,
        priorOffenseRating: team.offenseRating ?? null,
        priorDefenseRating: team.defenseRating ?? null,
        priorOdGames: team.odGames ?? null,
        currentOffenseRating: null, currentDefenseRating: null, currentOdGames: 0,
      });
    }
    return { ...prior, teams, blend: { mode: "prior-only", priorSeason, currentSeason, k: SEASON_BLEND_K, blendedTeams: 0 } };
  }
  const current = await buildTeamRatings(currentSeason);
  const out = blendRatings(prior, current, SEASON_BLEND_K);
  out.blend = { ...out.blend, priorSeason, currentSeason };
  return out;
}

function buildOffenseDefenseContext(ratings, asOf) {
  const teams = {};
  for (const [id, team] of Object.entries(ratings?.teams || {})) {
    teams[id] = Object.freeze({
      priorOffenseRating: team.priorOffenseRating ?? null,
      priorDefenseRating: team.priorDefenseRating ?? null,
      priorOdGames: team.priorOdGames ?? null,
      currentOffenseRating: team.currentOffenseRating ?? null,
      currentDefenseRating: team.currentDefenseRating ?? null,
      currentOdGames: team.currentOdGames ?? 0,
    });
  }
  return Object.freeze({
    asOf,
    priorSeason: ratings?.blend?.priorSeason ?? null,
    currentSeason: ratings?.blend?.currentSeason ?? ratings?.season ?? null,
    providerCallsAdded: 0,
    teams: Object.freeze(teams),
  });
}

function ratingSourceFor(team) {
  if (!team) return { source: "unavailable", weight: null, sosApplied: null };
  const source = team.ratingSource || "current-only";
  const weight = source === "prior-only" ? 0
    : source === "current-only" ? 1
      : source === "blended" ? team.blendWeight : null;
  const sosApplied = typeof team.ratingSosApplied === "boolean"
    ? team.ratingSosApplied
    : (typeof team.sosApplied === "boolean" ? team.sosApplied : null);
  return { source, weight, sosApplied };
}

function buildRatingSnapshot(ratings, homeTeam, awayTeam, neutralSiteStatus) {
  const home = ratingSourceFor(homeTeam);
  const away = ratingSourceFor(awayTeam);
  const available = [home, away].filter((x) => x.source !== "unavailable");
  if (!available.length) {
    return { priorSeason: null, currentSeason: null, home, away, sosApplied: null, neutralSiteStatus };
  }
  const needsPrior = available.some((x) => x.source === "prior-only" || x.source === "blended");
  const priorSeason = needsPrior ? (ratings?.blend?.priorSeason ?? null) : null;
  const currentSeason = ratings?.blend?.currentSeason ?? ratings?.season ?? null;
  const sosKnown = available.every((x) => typeof x.sosApplied === "boolean");
  const sosApplied = sosKnown ? available.every((x) => x.sosApplied === true) : null;
  return { priorSeason, currentSeason, home, away, sosApplied, neutralSiteStatus };
}

// ── Totals scoring model (2025-seeded; mirrors the margin model's honesty) ────
// WZ-CFBTOTALS-2026-07-05
// Projected points for a team = its per-game offense vs the opponent's per-game
// defense, re-centered on the league so the shared baseline isn't double-counted:
//   projPts = teamPF/gp + oppPA/gp - leaguePPG
// The home and away projPts sum to the projected game total, which cfbModel already
// compares to the book line (CFB_TOTAL_SIGMA) to price over/under and gate an edge.
// Requires full pf/pa/gp on BOTH sides; returns null otherwise so the game stays
// market-only (no fabricated total). Uses the same 2025 seed as the ratings, so it is
// PROVISIONAL and gets shadow-graded off final scores before it earns trust. A pace
// (plays/game) layer and blended in-season pf/pa are v2 refinements.
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

// Run the full CFB slate: { season, weekWindow, ratingsMeta, match, games }.
// CFB has no preseason, so (unlike NFL) there's no phase split — just the rolling
// week window anchored to the earliest upcoming game (weeks=1 → next ~7 days).
async function runCFBSlate({ season = null, weeks = 1 } = {}) {
  const [eventsRaw, ratings] = await Promise.all([
    getCFBMainOdds(),
    season == null ? buildBlendedTeamRatings() : buildTeamRatings(season),
  ]);
  // Freeze the moment at which the already-fetched market payload becomes the
  // production control input. This stays non-enumerable on the returned slate,
  // so customer JSON is byte/semantically unchanged while the recorder can
  // create a genuinely contemporaneous shadow/control pair with zero new calls.
  const controlCapturedAt = new Date().toISOString();

  let events = Array.isArray(eventsRaw) ? eventsRaw.slice() : [];
  const now = Date.now();

  // ── Week filter (anchor to earliest upcoming game, roll forward) ────────────
  // WZ-FBHORIZON-2026-08-06 :: identical contract to nflEdges. recordCFBPredictions routes through
  // the same recordFootballPredictions and the same FOOTBALL_IMMINENT_DAYS gate, so CFB had the same
  // split: the board was publishing an Aug 29 slate ~23 days out with 25 edges the recorder dropped.
  // DELETED with this change: the `upcoming.length ? upcoming : times` past-game fallback.
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
        // Clamp the far edge too, same reason as NFL: no published game outside the horizon.
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

  let matched = 0, unmatched = 0;
  const unmatchedNames = new Set();
  // WZ-FBNEUTRAL-2026-08-03 :: this file used to read `ev.neutralSite` off the odds event, but The
  // Odds API never carries that field -- the read was always false, so every CFB game took the full
  // CFB_HFA_POINTS 3.0 including Week 0 in Dublin and Rio. Those two dead reads are deleted below.
  // ESPN's scoreboard carries the real flag and cfbDataSource already parses it; footballVenue joins
  // them with the same collision-guarded matcher gradeFootball uses. Any throw leaves this null and
  // every game keeps today's behaviour -- the board can never go down over a venue lookup.
  let neutralIdx = null;
  try {
    const { buildNeutralIndex } = require("./footballVenue");
    const { fetchScoreboard } = require("./cfbDataSource");
    neutralIdx = await buildNeutralIndex({ fetchBoard: fetchScoreboard, league: "cfb", events });
  } catch (e) {
    console.error("[cfbEdges] neutral-site index failed, all games keep home-field:", e.message);
    neutralIdx = null;
  }

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
    // ctx carries ratings only when BOTH teams resolved (FBS-vs-FBS). If either side
    // is unrated (FCS opponent, or a name still to alias), the game stays market-only.
    const ctx = (ratingsLoaded && homeT && awayT)
      ? { home: { rating: homeT.rating, projPoints: projPointsFor(homeT, awayT, leaguePPG) },
          away: { rating: awayT.rating, projPoints: projPointsFor(awayT, homeT, leaguePPG) } }
      : {};
    // WZ-FBNEUTRAL-2026-08-03 :: null = UNKNOWN -> leave unset (full home-field, today's behaviour).
    // Only an explicit true from ESPN zeroes the HFA. Never guess a venue in either direction.
    const nSite = neutralIdx ? neutralIdx.isNeutral(ev.awayTeam, ev.homeTeam) : null;
    if (nSite === true) ctx.neutralSite = true;
    const pred = predictGame(ev, ctx);
    const espnGame = neutralIdx && typeof neutralIdx.resolveGame === "function"
      ? neutralIdx.resolveGame(ev.awayTeam, ev.homeTeam) : null;
    if (espnGame?.venue?.name) {
      pred.venue = {
        name: espnGame.venue.name,
        city: espnGame.venue.city || null,
        state: espnGame.venue.state || null,
        country: espnGame.venue.country || null,
      };
    }
    const ratingSnapshot = buildRatingSnapshot(
      ratings,
      homeT,
      awayT,
      nSite === true ? "neutral" : nSite === false ? "non-neutral" : "unknown"
    );
    const contract = buildCfbPredictionContract({ prediction: pred, event: ev, ratingSnapshot });
    applyCfbContractToPrediction(pred, contract, {
      moneyline: EDGE_ML, spread: EDGE_SPREAD, total: EDGE_TOTAL,
    });
    // The contract is recording-only/internal state. Both the board projection and recorder
    // consume the same object, but JSON serialization of `games` cannot expose it.
    Object.defineProperty(pred, "cfbPredictionContract", {
      value: contract, enumerable: false, writable: false,
    });
    // Recording-only handoff for the weekly context ledger. The ESPN game was
    // already resolved for neutral-site/venue handling; retaining it here adds
    // no provider work and never enters customer JSON.
    Object.defineProperty(pred, "_weeklyContextInput", {
      value: Object.freeze({ espnGame }), enumerable: false, writable: false,
    });
    pred.marketRead = ev.marketRead || null;
    pred.oddsGrid = ev.oddsGrid || null;
    pred.teamIdentity = {
      away: awayT ? { id: awayT.id || null, abbr: awayT.abbr || null, name: awayT.name || ev.awayTeam } : null,
      home: homeT ? { id: homeT.id || null, abbr: homeT.abbr || null, name: homeT.name || ev.homeTeam } : null,
    };
    return pred;
  });

  const slate = {
    season: ratings.season != null ? ratings.season : season,
    weekWindow,
    // WZ-FBHORIZON-2026-08-06 :: why the board is empty when it is empty, for the UI to say so.
    boardHorizon,
    phase: { selected: "regular", available: ["regular"] }, // shape parity with NFL
    ratingsMeta: {
      loaded: ratingsLoaded,
      rated: ratings.rated || 0,
      fbsListed: ratings.fbsListed || null,
      sosApplied: ratings.sosApplied || false,
      // WZ-CFBSOSMETA-2026-08-06 :: WZ-CFBSOSHONEST added these counters to the ratings object
      // but never wired them here, so they reached nothing. retries = schedule fetches that threw
      // and were retried; recovered = teams that only succeeded because of a retry, i.e. flakes
      // that would otherwise have declined the whole league. The decline REASON needs no field --
      // it is already embedded in `note` by the decline branch of buildTeamRatings.
      sosFetch: ratings.sosFetch || null,
      // WZ-FBNEUTRAL-2026-08-03 :: coverage of the neutral-site join, same as NFL. On a Week 0 slate
      // this should show a non-zero `neutral` count -- Dublin and Rio are both neutral.
      neutral: neutralIdx ? neutralIdx.meta : null,
      note: ratings.note || null,
      blend: ratings.blend || null,
    },
    match: {
      matched, unmatched,
      unmatchedNames: [...unmatchedNames],
      // NOTE: CFB coverage is EXPECTED below 100% — FBS-vs-FCS games have an unrated
      // FCS side by design. Read unmatchedNames to separate FCS (fine) from FBS name
      // mismatches (fix via ALIASES).
      coverage: games.length ? Math.round((matched / games.length) * 100) : 0,
    },
    games,
  };
  Object.defineProperty(slate, "cfbControlContext", {
    value: Object.freeze({
      capturedAt: controlCapturedAt,
      usEvents: Object.freeze(events.slice()),
      odContext: buildOffenseDefenseContext(ratings, controlCapturedAt),
      espnGamesByEvent: Object.freeze(Object.fromEntries(games
        .filter((game) => game?.eventId)
        .map((game) => [String(game.eventId), game?._weeklyContextInput?.espnGame || null]))),
    }),
    enumerable: false,
    writable: false,
  });
  return slate;
}

module.exports = { runCFBSlate, captureCFBOddsTicks, getCFBMarketMovers, _internal: { normName, schoolKey, resolveTeam, buildResolver, currentCfbSeasonYear, cfbRegularSeasonStart, blendRatings, buildBlendedTeamRatings, buildRatingSnapshot, ratingSourceFor, buildOffenseDefenseContext, SEASON_BLEND_K, leaguePpgFrom, projPointsFor } };

// ── CFB odds-tick snapshots (line-movement history) ──────────────────────────
// Mirrors NFL ticks but writes to cfb_odds_ticks. Best-effort: if the table doesn't
// exist yet, this no-ops gracefully (so the route's movers just stay empty). Only
// run by a cron (wired later) — the edge route never depends on it.
const { createClient } = require("@supabase/supabase-js");
function cfbDb() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); }

async function captureCFBOddsTicks() {
  let events = [];
  try { events = await getCFBMainOdds(); }
  catch (e) { console.error("[CFB Ticks] odds fetch failed:", e.message); return 0; }
  if (!events || !events.length) { console.log("[CFB Ticks] no events"); return 0; }

  const supabase = cfbDb();
  const now = new Date().toISOString();
  const rows = [];
  for (const ev of events) {
    const away = ev.awayTeam, home = ev.homeTeam;
    if (!away || !home) continue;
    if (ev.commenceTime && new Date(ev.commenceTime).getTime() <= Date.now()) continue;
    const base = { captured_at: now, away_team: away, home_team: home };
    if (ev.h2h?.away != null)     rows.push({ ...base, market: "ml",     side: "away",  line: null, odds: ev.h2h.away });
    if (ev.h2h?.home != null)     rows.push({ ...base, market: "ml",     side: "home",  line: null, odds: ev.h2h.home });
    if (ev.totals?.over != null)  rows.push({ ...base, market: "total",  side: "over",  line: ev.totals.line ?? null, odds: ev.totals.over });
    if (ev.totals?.under != null) rows.push({ ...base, market: "total",  side: "under", line: ev.totals.line ?? null, odds: ev.totals.under });
    if (ev.spreads?.away != null) rows.push({ ...base, market: "spread", side: "away",  line: ev.spreads.awayLine ?? null, odds: ev.spreads.away });
    if (ev.spreads?.home != null) rows.push({ ...base, market: "spread", side: "home",  line: ev.spreads.homeLine ?? null, odds: ev.spreads.home });
  }
  // WZ-CFB-PINN-TICKS-2026-07-14 :: also snapshot Pinnacle (sharp book, eu) into cfb_odds_ticks,
  // tagged side "...@Pinnacle", so sharp-side / reverse-line-movement detection can compare the
  // sharp line against the soft-book consensus. Fail-safe: a Pinnacle failure never blocks the US capture.
  let pinEvents = [];
  try {
    pinEvents = await getCFBPinnacleClose();
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
  } catch (e) { console.error("[CFB Ticks] Pinnacle snapshot failed:", e.message); }
  let saved = 0;
  if (rows.length) {
    const { error } = await supabase.from("cfb_odds_ticks").insert(rows);
    if (error) console.error("[CFB Ticks] insert failed (table may not exist yet):", error.message);
    else {
      saved = rows.length;
      try { await supabase.from("cfb_odds_ticks").delete().lt("captured_at", new Date(Date.now() - 10 * 864e5).toISOString()); } catch (_) {}
      console.log(`[CFB Ticks] saved ${rows.length} snapshots`);
    }
  }

  // Enrich pending CFB ledger rows from the two provider payloads already fetched
  // above. This adds zero calls and is isolated so ledger trouble cannot break ticks.
  try {
    const { enrichCfbPredictionClosing } = require("./cfbClosing");
    const enriched = await enrichCfbPredictionClosing(supabase, {
      // Stamp at enrichment time (after both provider reads), not at tick-start. If
      // either read crosses kickoff, the strict pre-kick guard must refuse the write.
      usEvents: events, pinnacleEvents: pinEvents, capturedAt: new Date().toISOString(),
    });
    if (enriched.updated || enriched.errors) {
      console.log(`[CFB Closing] updated=${enriched.updated} pending=${enriched.pending} skipped=${enriched.skipped} errors=${enriched.errors}`);
    }
  } catch (e) {
    console.error("[CFB Closing] enrichment failed:", e.message);
  }

  // Shadow-only preseason game projections reuse the exact same already-fetched
  // US/Pinnacle payloads. Failure is isolated from ticks, closing, and customers.
  try {
    const { collectCfbGameShadowPredictions } = require("./cfbGameShadowCollector");
    const shadow = await collectCfbGameShadowPredictions(supabase, {
      usEvents: events,
      pinnacleEvents: pinEvents,
      capturedAt: new Date().toISOString(),
    });
    console.log(`[CFB Game Shadow] ${JSON.stringify(shadow)}`);
  } catch (e) {
    console.error("[CFB Game Shadow] collection failed:", e.message);
  }

  // Pair any now-complete prospective control/shadow evidence. This is a
  // database-only, idempotent pass; it remains isolated from the collector.
  try {
    const { linkCfbShadowControls } = require("./cfbControlBenchmark");
    const linked = await linkCfbShadowControls(supabase, {
      gameIds: events.map((event) => String(event?.eventId || "")).filter(Boolean),
    });
    if (linked.linked || linked.errors) {
      console.log(`[CFB Control Benchmark] ${JSON.stringify(linked)}`);
    }
  } catch (e) {
    console.error("[CFB Control Benchmark] linking failed:", e.message);
  }

  // Bank exact-ID, side-aligned closing observations for immutable shadow rows
  // using only the US/Pinnacle payloads already fetched by this tick. The
  // lifecycle service has no provider client and cannot affect customer output.
  try {
    const { captureCfbGameShadowClosingObservations } = require("./cfbGameShadowEvaluator");
    const observed = await captureCfbGameShadowClosingObservations(supabase, {
      usEvents: events,
      pinnacleEvents: pinEvents,
      capturedAt: new Date().toISOString(),
    });
    if (observed.inserted || observed.errors) {
      console.log(`[CFB Game Shadow Close] ${JSON.stringify(observed)}`);
    }
  } catch (e) {
    console.error("[CFB Game Shadow Close] capture failed:", e.message);
  }
  return saved;
}

async function getCFBMarketMovers({ limit = 12 } = {}) {
  const supabase = cfbDb();
  let data, error;
  try {
    ({ data, error } = await supabase
      .from("cfb_odds_ticks")
      .select("away_team,home_team,market,side,line,odds,captured_at")
      .order("captured_at", { ascending: true })
      .limit(5000));
  } catch (e) { return []; } // table missing → no movers yet
  if (error || !data || !data.length) return [];
  const byKey = new Map();
  for (const r of data) {
    const key = `${r.away_team}@${r.home_team}|${r.market}|${r.side}|${r.line ?? ""}`;
    const slot = byKey.get(key) || { matchup: `${r.away_team} @ ${r.home_team}`, market: r.market, side: r.side, line: r.line, open: r.odds, openAt: r.captured_at };
    slot.now = r.odds; slot.nowAt = r.captured_at;
    byKey.set(key, slot);
  }
  const movers = [];
  for (const s of byKey.values()) {
    if (s.open == null || s.now == null) continue;
    const delta = s.now - s.open;
    if (delta === 0) continue;
    movers.push({ ...s, delta, dir: delta > 0 ? "up" : "dn" });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return movers.slice(0, limit);
}
