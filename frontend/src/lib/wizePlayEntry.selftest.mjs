import assert from "node:assert/strict";
import {
  WIZEPLAY_PROP_MARKETS,
  entryKey,
  gameOddsQuote,
  normalizeGameRows,
  propOddsQuote,
  propRowsForSport,
  propSides,
  validAmericanOdds,
} from "./wizePlayEntry.js";

assert.equal(validAmericanOdds(-110), true);
assert.equal(validAmericanOdds(125), true);
assert.equal(validAmericanOdds(0), false);
assert.equal(validAmericanOdds(-99), false);

const football = normalizeGameRows({ games: [{
  eventId: "evt-1", commenceTime: "2026-09-10T00:20:00Z",
  awayTeam: "Dallas Cowboys", homeTeam: "Philadelphia Eagles",
  oddsGrid: {
    consensusTotalLine: 47.5,
    best: {
      awayML: { price: 135, book: "Book A" },
      homeML: { price: -145, book: "Book B" },
      over: { price: -105, book: "Book C" },
      under: { price: -110, book: "Book D" },
      awaySpread: { price: -108, line: 3, book: "Book E" },
      homeSpread: { price: -102, line: -3, book: "Book F" },
    },
  },
}] });
assert.equal(football.length, 1);
assert.deepEqual(gameOddsQuote(football[0], "moneyline", "away"), { odds: 135, book: "Book A", line: null, verified: true });
assert.deepEqual(gameOddsQuote(football[0], "spread", "home"), { odds: -102, book: "Book F", line: -3, verified: true });
assert.deepEqual(gameOddsQuote(football[0], "total", "over"), { odds: -105, book: "Book C", line: 47.5, verified: true });
assert.equal(gameOddsQuote({ raw: {} }, "moneyline", "home"), null, "missing odds never become a fabricated default");

const prop = {
  market: "pass_yds", line: 245.5, book: "Book A", overOdds: -110, underOdds: -110,
  quotes: [
    { line: 245.5, book: "Book A", overOdds: -110, underOdds: -110 },
    { line: 245.5, book: "Book B", overOdds: 105, underOdds: -125 },
    { line: 246.5, book: "Book C", overOdds: 115, underOdds: -135 },
  ],
};
assert.deepEqual(propOddsQuote(prop, "over"), { odds: 105, book: "Book B", line: 245.5, verified: true });
assert.deepEqual(propOddsQuote(prop, "under"), { odds: -110, book: "Book A", line: 245.5, verified: true });
assert.deepEqual(propSides(prop), [["over", "Over"], ["under", "Under"]]);

const td = { market: "anytime_td", quotes: [{ book: "A", price: 135 }, { book: "B", price: 165 }] };
assert.deepEqual(propOddsQuote(td, "yes"), { odds: 165, book: "B", line: null, verified: true });
assert.deepEqual(propSides(td), [["yes", "Anytime TD"]]);

const mlb = propRowsForSport("mlb", {
  date: "2026-09-09",
  hrPropEdges: [{ gameId: 1, playerId: 2, player: "Batter", team: "SEA", game: "SEA @ LAD", odds: 310, book: "Book H", hrProb: 0.24, edge: 0.03 }],
  kPropEdges: [{ gameId: 1, playerId: 3, player: "Pitcher", team: "LAD", game: "SEA @ LAD", line: 5.5, side: "under", odds: -105, oppOdds: -115, book: "Book K", expectedKs: 5.1, edge: 0.02 }],
  hitsPropEdges: [{ gameId: 1, playerId: 4, player: "Hitter", team: "SEA", game: "SEA @ LAD", line: 0.5, side: "over", odds: -145, oppOdds: 120, book: "Book I", edge: 0.04 }],
});
assert.deepEqual(mlb.map((row) => row.market), ["home_run", "pitcher_strikeouts", "hits"]);
assert.deepEqual(propOddsQuote(mlb[1], "under"), { odds: -105, book: "Book K", line: 5.5, verified: true });
assert.equal(propRowsForSport("ncaafb", { props: [{ market: "pass_yds" }] }).length, 0, "CFB remains unavailable until it has an automatic final-stat grader");
assert.equal(WIZEPLAY_PROP_MARKETS.ncaafb.length, 0);

const key = entryKey({ kind: "prop", sport: "nfl", gameId: "g", playerId: "p", propCategory: "pass_yds", selection: "over", line: 240.5, odds: -110, book: "A" });
assert.equal(key, "prop:nfl:g:p:pass_yds:over:240.5");
assert.equal(key, entryKey({ kind: "prop", sport: "nfl", gameId: "g", playerId: "p", propCategory: "pass_yds", selection: "over", line: 240.5, odds: 105, book: "B" }), "duplicate identity ignores mutable price shopping");

console.log("wizePlayEntry self-test: PASS");
