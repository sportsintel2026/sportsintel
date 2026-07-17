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
const { predictGame } = require("./cfbModel");

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
  return new Date(Date.UTC(year, 7, 20)); // Aug 20
}

function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

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
    const gCur = ct ? (ct.gp || 0) : 0;
    if (gCur > 0 && ct.rating != null && pt && pt.rating != null) {
      const w = gCur / (gCur + k);
      teams[id] = { ...pt, rating: round2(w * ct.rating + (1 - w) * pt.rating), priorRating: pt.rating, currentRating: ct.rating, currentGp: gCur, blendWeight: round2(w) };
      blendedTeams++;
    } else if (gCur > 0 && ct.rating != null) {
      teams[id] = { ...ct }; // new-to-FBS team: no prior to blend
    } else if (pt) {
      teams[id] = { ...pt, currentGp: gCur };
    } else if (ct) {
      teams[id] = { ...ct };
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
    return { ...prior, blend: { mode: "prior-only", priorSeason, currentSeason, k: SEASON_BLEND_K, blendedTeams: 0 } };
  }
  const current = await buildTeamRatings(currentSeason);
  const out = blendRatings(prior, current, SEASON_BLEND_K);
  out.blend = { ...out.blend, priorSeason, currentSeason };
  return out;
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

  let events = Array.isArray(eventsRaw) ? eventsRaw.slice() : [];
  const now = Date.now();

  // ── Week filter (anchor to earliest upcoming game, roll forward) ────────────
  let weekWindow = null;
  if (weeks > 0 && events.length) {
    const DAY = 86400000;
    const times = events
      .map(e => ({ e, t: e.commenceTime ? new Date(e.commenceTime).getTime() : null }))
      .filter(x => x.t != null);
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
    // ctx carries ratings only when BOTH teams resolved (FBS-vs-FBS). If either side
    // is unrated (FCS opponent, or a name still to alias), the game stays market-only.
    const ctx = (ratingsLoaded && homeT && awayT)
      ? { home: { rating: homeT.rating, projPoints: projPointsFor(homeT, awayT, leaguePPG) },
          away: { rating: awayT.rating, projPoints: projPointsFor(awayT, homeT, leaguePPG) },
          neutralSite: !!ev.neutralSite }
      : { neutralSite: !!ev.neutralSite };
    const pred = predictGame(ev, ctx);
    pred.marketRead = ev.marketRead || null;
    pred.oddsGrid = ev.oddsGrid || null;
    return pred;
  });

  return {
    season: ratings.season != null ? ratings.season : season,
    weekWindow,
    phase: { selected: "regular", available: ["regular"] }, // shape parity with NFL
    ratingsMeta: {
      loaded: ratingsLoaded,
      rated: ratings.rated || 0,
      fbsListed: ratings.fbsListed || null,
      sosApplied: ratings.sosApplied || false,
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
}

module.exports = { runCFBSlate, captureCFBOddsTicks, getCFBMarketMovers, _internal: { normName, schoolKey, resolveTeam, buildResolver, currentCfbSeasonYear, cfbRegularSeasonStart, blendRatings, buildBlendedTeamRatings, SEASON_BLEND_K, leaguePpgFrom, projPointsFor } };

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
  try {
    const pinEvents = await getCFBPinnacleClose();
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
  if (!rows.length) return 0;
  const { error } = await supabase.from("cfb_odds_ticks").insert(rows);
  if (error) { console.error("[CFB Ticks] insert failed (table may not exist yet):", error.message); return 0; }
  try { await supabase.from("cfb_odds_ticks").delete().lt("captured_at", new Date(Date.now() - 10 * 864e5).toISOString()); } catch (_) {}
  console.log(`[CFB Ticks] saved ${rows.length} snapshots`);
  return rows.length;
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
