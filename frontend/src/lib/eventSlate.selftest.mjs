import assert from "node:assert/strict";
import {
  chooseEventDate, createLatestRequestGuard, eventDateGroups, eventDateKey,
  isEventSettled, scopeEdgeFeed, scopeProps, sportStartLabel,
} from "./eventSlate.js";

const games = [
  { id: "thu", commenceTime: "2026-09-04T00:00:00Z", status: "final" },
  { id: "fri", commenceTime: "2026-09-05T00:00:00Z", status: "scheduled" },
  { id: "sat", commenceTime: "2026-09-06T19:30:00Z", status: "scheduled" },
];
assert.deepEqual(eventDateGroups(games).map((g) => g.date), ["2026-09-03", "2026-09-04", "2026-09-06"]);
assert.equal(chooseEventDate(games, { now: new Date("2026-09-03T18:00:00Z") }), "2026-09-04", "advance after completed current event day");
assert.equal(eventDateKey({ commenceTime: "2026-09-05T03:30:00Z" }), "2026-09-04", "ET date prevents UTC day drift");
assert.equal(eventDateKey({ sport: "cfb", commenceTime: "2026-09-06T19:30:00Z" }), "2026-09-06", "future CFB games use their scheduled event date");
assert.equal(eventDateKey({ sport: "nfl", commenceTime: "2026-09-08T00:15:00Z" }), "2026-09-07", "future NFL games use their ET kickoff date");
assert.equal(isEventSettled({ status: "cancelled" }), true);
assert.equal(isEventSettled({ st: "final" }), true, "normalized game cards retain completed-state semantics");

const feed = {
  games,
  moneylineEdges: [{ gameId: "thu" }, { gameId: "fri" }],
  spreadEdges: [{ gameId: "sat" }],
  marketByGame: { thu: { gameId: "thu" }, fri: { gameId: "fri" } },
};
const friday = scopeEdgeFeed(feed, "2026-09-04");
assert.deepEqual(friday.games.map((g) => g.id), ["fri"]);
assert.deepEqual(friday.moneylineEdges.map((g) => g.gameId), ["fri"]);
assert.equal(friday.spreadEdges.length, 0, "one event day never mixes Saturday edges");

assert.deepEqual(scopeProps([{ sport: "mlb", id: 1 }, { sport: "cfb", id: 2 }], "cfb").map((x) => x.id), [2]);
assert.deepEqual(scopeProps([{ id: 1 }], "cfb"), [], "untagged props never fall through to another sport");
assert.deepEqual(scopeProps([{ sport: "nfl", id: 3 }, { sport: "cfb", id: 4 }], "cfb").map((x) => x.id), [4], "NFL props never appear in CFB");
assert.deepEqual(scopeProps([{ sport: "cfb", id: 4 }, { sport: "nfl", id: 3 }], "nfl").map((x) => x.id), [3], "CFB props never appear in NFL");
assert.equal(sportStartLabel("mlb"), "first pitch");
assert.equal(sportStartLabel("cfb"), "kickoff");

const guard = createLatestRequestGuard();
const mlb = guard.begin("mlb");
const cfb = guard.begin("cfb");
assert.equal(guard.accepts(mlb, "mlb"), false, "stale MLB response rejected after CFB switch");
assert.equal(guard.accepts(cfb, "cfb"), true);
const nfl = guard.begin("nfl");
const mlbAgain = guard.begin("mlb");
assert.equal(guard.accepts(nfl, "nfl"), false, "stale NFL response rejected after MLB switch");
assert.equal(guard.accepts(mlbAgain, "mlb"), true);
const oldDate = guard.begin("nfl:2026-09-06");
const newDate = guard.begin("nfl:2026-09-07");
assert.equal(guard.accepts(oldDate, "nfl:2026-09-06"), false, "an old event-date response cannot replace a newer date");
assert.equal(guard.accepts(newDate, "nfl:2026-09-07"), true);

console.log("eventSlate self-test passed");
