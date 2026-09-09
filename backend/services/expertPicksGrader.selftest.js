const assert = require("assert");
const { _test } = require("./expertPicksGrader");

assert.equal(_test.scoreboardLeague("ncaafb"), "cfb");
assert.equal(_test.settle({ market: "moneyline", selection: "away" }, { away: 24, home: 20 }), "win");
assert.equal(_test.settle({ market: "spread", selection: "home", line: -3 }, { away: 20, home: 23 }), "push");
assert.equal(_test.settle({ market: "spread", selection: "away", line: 3.5 }, { away: 20, home: 23 }), "win");
assert.equal(_test.settle({ market: "total", selection: "under", line: 44.5 }, { away: 20, home: 21 }), "win");

assert.equal(_test.pnlFor("win", 150, 2), 3);
assert.equal(_test.pnlFor("win", -125, 1), 0.8);
assert.equal(_test.pnlFor("loss", 400, 1.5), -1.5);
assert.equal(_test.pnlFor("push", -110, 1), 0);

const nflProp = {
  type: "straight", kind: "prop", sport: "nfl", gameId: "g", playerId: "p", playerName: "Player",
  propCategory: "pass_tds", selection: "over", line: 1.5, odds: 120, result: "pending",
};
assert.equal(_test.isGradeable(nflProp), true, "NFL Passing TDs use the active ESPN final-stat path");
assert.equal(_test.isGradeable({ ...nflProp, sport: "ncaafb" }), false, "CFB props remain unavailable without an automatic exact-stat grader");
assert.equal(_test.isGradeable({ ...nflProp, propCategory: "first_td" }), false, "unsupported prop markets cannot enter automatic grading");
assert.equal(_test.isGradeable({ type: "straight", kind: "game", sport: "ncaafb", gameId: "g", market: "spread", selection: "home", result: "" }), true);

const hr = _test.gradeMlbPropActual({ playerName: "Exact Batter", propCategory: "home_run", selection: "yes" }, {
  ok: true,
  hr: new Map([["exact batter", 1]]),
});
assert.deepEqual(hr, { result: "win", finalStat: 1, resultSource: "mlb-official-boxscore" });
const strikeouts = _test.gradeMlbPropActual({ playerName: "Exact Pitcher", propCategory: "pitcher_strikeouts", selection: "under", line: 5.5 }, {
  ok: true,
  ks: new Map([["exact pitcher", 5]]),
});
assert.equal(strikeouts.result, "win");
const missing = _test.gradeMlbPropActual({ playerName: "Missing", propCategory: "hits", selection: "over", line: 0.5 }, { ok: true, hits: new Map() });
assert.equal(missing.result, "void", "a missing official player line is never fabricated as zero");
assert.equal(_test.gradeMlbPropActual({ playerName: "Missing", propCategory: "hits", selection: "over", line: 0.5 }, { ok: false, hits: null }), null, "an unavailable official box score stays pending");

console.log("expertPicksGrader self-test: PASS");
