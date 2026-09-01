const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient: () => ({}) };
  if (request === "./nflPropsOdds") return { getNflPropLines: async () => ({ ok: true, lines: [] }) };
  if (request === "./nflPropsData") return {
    buildPlayerProjections: async () => ({ players: [] }),
    overProb: (mean, line) => mean > line ? 0.6 : 0.4,
  };
  return originalLoad(request, parent, isMain);
};
const { buildShadowRows, getLatestNflPropsSnapshot } = require("./nflPropsShadow");
Module._load = originalLoad;

const built = buildShadowRows([
  { player: "Jordan Example", market: "pass_yds", line: 249.5, overOdds: -105, underOdds: -115, fairOverProb: 0.489, book: "Verified Book", eventId: "evt-1", matchup: "Away Team @ Home Team" },
], { "evt-1": { commence: "2026-09-13T17:00:00Z", matchup: "Away Team @ Home Team" } }, [
  { name: "Jordan Example", team: "AWY", pos: "QB", gamesPlayed: 17, projected: { pass_yds: 263.2 } },
]);

assert.equal(built.rows.length, 1);
assert.equal(built.verifiedProps.length, 1);
assert.equal(built.verifiedProps[0].sport, "nfl");
assert.equal(built.verifiedProps[0].book, "Verified Book");
assert.equal(built.verifiedProps[0].projection, 263.2);
assert.equal(built.verifiedProps[0].overOdds, -105);
assert.equal(built.verifiedProps[0].underOdds, -115);
assert.equal(built.verifiedProps[0].modelEdge, 0.111);
assert.deepEqual(getLatestNflPropsSnapshot(), { sport: "nfl", generatedAt: null, props: [] }, "pure row construction does not publish a cache snapshot");

const unsupported = buildShadowRows([
  { player: "Jordan Example", market: "pass_tds", line: 1.5, overOdds: -105, underOdds: -115, fairOverProb: 0.489, book: "Verified Book", eventId: "evt-1" },
  { player: "Jordan Ex", market: "pass_yds", line: 249.5, overOdds: -105, underOdds: -115, fairOverProb: 0.489, book: "Verified Book", eventId: "evt-1" },
], { "evt-1": { commence: "2026-09-13T17:00:00Z", matchup: "Away Team @ Home Team" } }, [
  { name: "Jordan Example", team: "AWY", pos: "QB", gamesPlayed: 17, projected: { pass_yds: 263.2 } },
]);
assert.equal(unsupported.rows.length, 0, "unsupported markets and inexact player identities never publish a prediction");
console.log("nflPropsShadow self-test passed");
