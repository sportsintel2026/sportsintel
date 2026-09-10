import assert from "node:assert/strict";
import {
  buildSeoPrimarySchema,
  buildCurrentSeoPages,
  currentSeoPageForPath,
  footballWeekForDate,
  seoMatchupPath,
  usefulSeoGame,
} from "./seoPhase2Config.js";

const now = new Date("2026-09-08T19:00:00Z");
const feeds = {
  nfl: {
    teaser: true,
    games: [{ id: "nfl-1", awayTeam: "New England Patriots", homeTeam: "Seattle Seahawks", commenceTime: "2026-09-10T00:20:00Z", venue: { name: "Lumen Field", city: "Seattle", state: "WA", country: "USA" }, modelProb: 0.61, edge: 0.07 }],
  },
  cfb: {
    teaser: true,
    games: [{ id: "cfb-1", awayTeam: "Missouri Tigers", homeTeam: "Kansas Jayhawks", commenceTime: "2026-09-12T00:00:00Z", venue: { name: "David Booth Kansas Memorial Stadium", city: "Lawrence", state: "KS" }, modelProb: 0.59, edge: 0.04 }],
  },
  mlb: {
    teaser: true,
    date: "2026-09-08",
    games: [{ id: "mlb-1", away: "Cleveland Guardians", home: "Baltimore Orioles", commenceTime: "2026-09-08T22:35:00Z", time: "6:35 PM ET", venue: "Oriole Park at Camden Yards", modelProb: 0.57, edge: 0.03 }],
  },
};

assert.deepEqual(footballWeekForDate("nfl", "2026-09-09"), { week: 1, year: 2026 });
assert.deepEqual(footballWeekForDate("cfb", "2026-09-11"), { week: 2, year: 2026 });
assert.equal(footballWeekForDate("nfl", "2027-01-10")?.year, 2026);
assert.equal(usefulSeoGame("mlb", feeds.mlb.games[0], feeds.mlb.date, now), true);
assert.equal(usefulSeoGame("nfl", { ...feeds.nfl.games[0], id: null }, null, now), false);
assert.equal(usefulSeoGame("nfl", { ...feeds.nfl.games[0], commenceTime: "2025-09-10T00:20:00Z" }, null, now), false);

const pages = buildCurrentSeoPages(feeds, now);
assert.equal(pages.length, 6);
assert.equal(new Set(pages.map((page) => page.path)).size, pages.length);
assert.ok(pages.some((page) => page.path === "/nfl-picks/week-1-2026"));
assert.ok(pages.some((page) => page.path === "/college-football-picks/week-2-2026"));
assert.ok(pages.some((page) => page.path === "/mlb-picks/2026-09-08"));

const nflPath = seoMatchupPath("nfl", feeds.nfl.games[0]);
const nflPage = currentSeoPageForPath("nfl", nflPath, feeds.nfl, now);
assert.equal(nflPage?.gameId, "nfl-1");
assert.equal(nflPage?.away, "New England Patriots");
assert.equal("modelProb" in nflPage, false);
assert.equal("edge" in nflPage, false);
assert.equal(currentSeoPageForPath("nfl", `${nflPath}-stale`, feeds.nfl, now), null);

for (const sport of ["nfl", "cfb", "mlb"]) {
  const game = feeds[sport].games[0];
  const page = currentSeoPageForPath(sport, seoMatchupPath(sport, game, feeds[sport].date), feeds[sport], now);
  const event = buildSeoPrimarySchema(page, game);
  assert.equal(event["@type"], "SportsEvent");
  assert.equal(event.identifier, page.gameId);
  assert.match(event.startDate, /^2026-09-/);
  assert.equal(event.location["@type"], "Place");
  assert.ok(event.location.name);
}

const incompleteEventPage = { ...nflPage, startDate: null, location: null };
assert.equal(buildSeoPrimarySchema(incompleteEventPage)["@type"], "WebPage",
  "a matchup without verified event time/location must not emit invalid Event markup");
assert.equal(buildSeoPrimarySchema(pages.find((page) => page.kind === "slate"))["@type"], "CollectionPage",
  "weekly/daily list pages must never masquerade as one physical event");

const duplicateMlb = buildCurrentSeoPages({ mlb: { ...feeds.mlb, games: [feeds.mlb.games[0], { ...feeds.mlb.games[0], id: "mlb-duplicate" }] } }, now);
assert.equal(duplicateMlb.filter((page) => page.kind === "matchup").length, 1);

console.log("seo phase 3 self-test: PASS");
