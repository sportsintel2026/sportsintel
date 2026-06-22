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

// Run the full NFL slate: returns { ratingsMeta, games:[prediction...], match:{...} }.
async function runNFLSlate({ season = 2025 } = {}) {
  const [events, ratings] = await Promise.all([
    getNFLMainOdds(),
    buildTeamRatings(season),
  ]);

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
