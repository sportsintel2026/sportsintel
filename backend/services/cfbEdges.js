/**
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
 * HONESTY: 2025-seeded ratings with no strength-of-schedule layer, against (now)
 * preseason 2026 lines — directionally reasonable but NOT calibrated. FBS-vs-FCS
 * games keep the unrated (FCS) side market-only, which is correct. Every pick ships
 * provisional behind the route's "IN TRAINING" fence until shadow-graded in-season.
 */

const { getCFBMainOdds } = require("./oddsApi");
const { buildTeamRatings } = require("./cfbDataSource");
const { predictGame } = require("./cfbModel");

// Normalize a team name for matching: FOLD diacritics → ASCII, lowercase, turn
// punctuation/parens into spaces (keeps token boundaries), collapse whitespace.
function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // José→Jose, Hawai'i→Hawai'i (accents only)
    .toLowerCase()
    .replace(/['\u2019\u2018`]/g, "")                  // DELETE apostrophes: Hawai'i→Hawaii
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")                       // other punctuation/parens → space
    .replace(/\s+/g, " ")
    .trim();
}

// School portion = normalized name minus the last token (the mascot). Schools are
// far more unique than mascots, so this is the safe fuzzy fallback.
function schoolKey(normalized) {
  const parts = normalized.split(" ");
  return parts.length > 1 ? parts.slice(0, -1).join(" ") : normalized;
}

// Known odds-name → ESPN-name aliases (both normalized). Intentionally small — the
// resolver's diacritic folding + school fallback handle most cases; this is for the
// genuine abbreviation mismatches surfaced by the live unmatched list. Extend as
// real misses appear (do not guess blind).
const ALIASES = {
  // "normalized odds name": "normalized espn name"
};

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

// Run the full CFB slate: { season, weekWindow, ratingsMeta, match, games }.
// CFB has no preseason, so (unlike NFL) there's no phase split — just the rolling
// week window anchored to the earliest upcoming game (weeks=1 → next ~7 days).
async function runCFBSlate({ season = 2025, weeks = 1 } = {}) {
  const [eventsRaw, ratings] = await Promise.all([
    getCFBMainOdds(),
    buildTeamRatings(season),
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
      ? { home: { rating: homeT.rating }, away: { rating: awayT.rating }, neutralSite: !!ev.neutralSite }
      : { neutralSite: !!ev.neutralSite };
    const pred = predictGame(ev, ctx);
    pred.marketRead = ev.marketRead || null;
    pred.oddsGrid = ev.oddsGrid || null;
    return pred;
  });

  return {
    season,
    weekWindow,
    phase: { selected: "regular", available: ["regular"] }, // shape parity with NFL
    ratingsMeta: {
      loaded: ratingsLoaded,
      rated: ratings.rated || 0,
      fbsListed: ratings.fbsListed || null,
      note: ratings.note || null,
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

module.exports = { runCFBSlate, captureCFBOddsTicks, getCFBMarketMovers, _internal: { normName, schoolKey, resolveTeam, buildResolver } };

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
