// WZ-DETAIL-SSOT-2026-07-17 :: SINGLE SOURCE OF TRUTH for which sports have a
// /game/<sport>/:id detail route. The routes themselves live in App.jsx; every
// card tap / "full matchup breakdown" gate across the app imports from HERE so the
// answer can't drift per-surface. This is the fix for the class of bug where a
// detail route shipped (NFL/CFB, 2026-07-16) but a gate in another file still said
// "this sport has no detail page", making taps silently dead.
//
// TO ADD A SPORT: add its <Route path="/game/<sport>/:gameId"> in App.jsx AND add
// the sport key to DETAIL_SPORTS below. Nothing else needs to change.
export const DETAIL_SPORTS = new Set(["mlb", "nba", "nfl", "cfb"]);

const norm = (s) => String(s || "").toLowerCase();

// Does this sport have a detail page at all?
export const hasGameDetail = (sport) => DETAIL_SPORTS.has(norm(sport));

// The path to a game's detail page, or null when there's no route for the sport OR
// no id to resolve it by. Callers use the null to render a non-clickable card instead
// of navigating into the catch-all (which lands on "/" and looks like a logout).
export const gameDetailPath = (sport, id) =>
  hasGameDetail(sport) && id != null && id !== "" ? `/game/${norm(sport)}/${id}` : null;
