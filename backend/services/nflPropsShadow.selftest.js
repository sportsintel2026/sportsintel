const assert = require("assert");
const Module = require("module");
let liveOddsFixture = { ok: true, lines: [] };
let liveProjectionFixture = { players: [] };
const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient: () => ({
    from: () => ({ upsert: async () => ({ error: null }) }),
  }) };
  if (request === "./nflPropsOdds") return { getFootballPropLines: async () => liveOddsFixture };
  if (request === "./nflPropsData") return {
    buildPlayerProjections: async () => liveProjectionFixture,
    overProb: (mean, line) => mean > line ? 0.6 : 0.4,
  };
  return originalLoad(request, parent, isMain);
};
const {
  buildShadowRows,
  buildCfbRosterIdentities,
  getLatestNflPropsSnapshot,
  warmNflPropsSnapshotOnBoot,
} = require("./nflPropsShadow");
Module._load = originalLoad;

const built = buildShadowRows([
  { player: "Jordan Example", market: "pass_yds", line: 249.5, overOdds: -105, underOdds: -115, fairOverProb: 0.489, book: "Verified Book", eventId: "evt-1", matchup: "Arizona Cardinals @ Buffalo Bills" },
], { "evt-1": { commence: "2026-09-13T17:00:00Z", matchup: "Arizona Cardinals @ Buffalo Bills" } }, [
  { id: "99", name: "Jordan Example", team: "ARI", pos: "QB", headshot: "https://example.test/jordan.png", gamesPlayed: 17, projected: { pass_yds: 263.2 } },
]);

assert.equal(built.rows.length, 1);
assert.equal(built.verifiedProps.length, 1);
assert.equal(built.verifiedProps[0].sport, "nfl");
assert.equal(built.verifiedProps[0].book, "Verified Book");
assert.equal(built.verifiedProps[0].projection, 263.2);
assert.equal(built.verifiedProps[0].overOdds, -105);
assert.equal(built.verifiedProps[0].underOdds, -115);
assert.equal(built.verifiedProps[0].modelEdge, 0.111);
assert.equal(built.verifiedProps[0].opponent, "Buffalo Bills");
assert.equal(built.verifiedProps[0].headshot, "https://example.test/jordan.png");
assert.deepEqual(getLatestNflPropsSnapshot(), { sport: "nfl", generatedAt: null, props: [] }, "pure row construction does not publish a cache snapshot");

const unsupported = buildShadowRows([
  { player: "Jordan Example", market: "unsupported_market", line: 1.5, overOdds: -105, underOdds: -115, fairOverProb: 0.489, book: "Verified Book", eventId: "evt-1" },
  { player: "Jordan Ex", market: "pass_yds", line: 249.5, overOdds: -105, underOdds: -115, fairOverProb: 0.489, book: "Verified Book", eventId: "evt-1" },
], { "evt-1": { commence: "2026-09-13T17:00:00Z", matchup: "Arizona Cardinals @ Buffalo Bills" } }, [
  { name: "Jordan Example", team: "ARI", pos: "QB", gamesPlayed: 17, projected: { pass_yds: 263.2 } },
]);
assert.equal(unsupported.rows.length, 0, "unsupported markets and inexact player identities never publish a prediction");

const touchdown = buildShadowRows([
  { player: "Jordan Example", market: "pass_tds", line: 1.5, overOdds: 105, underOdds: -125, fairOverProb: 0.466, book: "Verified Book", priceMode: "over-under", eventId: "evt-1", matchup: "Arizona Cardinals @ Buffalo Bills" },
  { player: "Jordan Example", market: "anytime_td", line: null, overOdds: 145, underOdds: -175, fairOverProb: 0.391, book: "Verified Book", priceMode: "yes-no", overLabel: "YES", underLabel: "NO", eventId: "evt-1", matchup: "Arizona Cardinals @ Buffalo Bills" },
], { "evt-1": { commence: "2026-09-13T17:00:00Z", matchup: "Arizona Cardinals @ Buffalo Bills" } }, [
  { id: "99", name: "Jordan Example", team: "ARI", pos: "QB", gamesPlayed: 17, projected: { pass_yds: 263.2 } },
]);
assert.equal(touchdown.rows.length, 0, "unmodeled touchdown markets never create prediction-ledger rows");
assert.deepEqual(touchdown.verifiedProps.map((prop) => prop.market), ["pass_tds", "anytime_td"]);
assert.equal(touchdown.verifiedProps[0].modelEdge, null);
assert.equal(touchdown.verifiedProps[1].priceMode, "yes-no");

const cfbPlayers = buildCfbRosterIdentities([
  { team_name: "Stanford", espn_team_id: "24", identity_status: "exact", snapshot_at: "2026-08-30T12:00:00Z", roster: { players: [{ id: "cfbd-1", firstName: "Exact", lastName: "Cardinal", position: "RB" }] } },
  { team_name: "UNLV", espn_team_id: "2439", identity_status: "mapped", snapshot_at: "2026-08-30T12:00:00Z", roster: { players: [{ id: "cfbd-2", firstName: "Exact", lastName: "Rebel", position: "WR" }] } },
]);
const cfb = buildShadowRows([
  { player: "Exact Cardinal", market: "anytime_td", line: null, overOdds: 150, underOdds: -180, fairOverProb: 0.386, book: "Verified Book", priceMode: "yes-no", eventId: "cfb-1", matchup: "Stanford Cardinal @ UNLV Rebels" },
  { player: "Exact Cardinal", market: "rush_yds", line: 74.5, overOdds: -105, underOdds: -115, fairOverProb: 0.489, book: "Verified Book", priceMode: "over-under", eventId: "cfb-1", matchup: "Stanford Cardinal @ UNLV Rebels" },
  { player: "E. Cardinal", market: "anytime_td", line: null, overOdds: 150, underOdds: -180, fairOverProb: 0.386, book: "Verified Book", priceMode: "yes-no", eventId: "cfb-1", matchup: "Stanford Cardinal @ UNLV Rebels" },
], { "cfb-1": { commence: "2026-09-13T23:00:00Z", matchup: "Stanford Cardinal @ UNLV Rebels" } }, cfbPlayers, { sport: "cfb" });
assert.equal(cfb.rows.length, 0);
assert.equal(cfb.verifiedProps.length, 2, "CFB accepts only exact full-name identities and keeps unmodeled offers market-only");
assert.equal(cfb.verifiedProps[0].team, "Stanford");
assert.equal(cfb.verifiedProps[0].teamLogoId, "24");
assert.equal(cfb.verifiedProps[0].opponent, "UNLV Rebels");
assert.equal(cfb.verifiedProps[1].market, "rush_yds");
assert.equal(cfb.verifiedProps[1].projection, null, "CFB market data never fabricates an NFL projection");
assert.ok(cfb.unmatched.some((row) => row.startsWith("E. Cardinal")), "CFB initials are never fuzzy-matched");

const wrongTeam = buildShadowRows([
  { player: "Jordan Example", market: "pass_yds", line: 249.5, overOdds: -105, underOdds: -115, fairOverProb: 0.489, book: "Verified Book", eventId: "evt-1", matchup: "Arizona Cardinals @ Buffalo Bills" },
], { "evt-1": { commence: "2026-09-13T17:00:00Z", matchup: "Arizona Cardinals @ Buffalo Bills" } }, [
  { name: "Jordan Example", team: "DAL", pos: "QB", gamesPlayed: 17, projected: { pass_yds: 263.2 } },
]);
assert.equal(wrongTeam.rows.length, 0, "a matching player name cannot transfer a projection from another event");
assert.match(wrongTeam.unmatched[0], /team-event-mismatch/);

const warmLines = Array.from({ length: 11 }, (_, index) => {
  const markets = ["pass_yds", "pass_yds", "pass_yds", "rush_yds", "rush_yds", "receptions", "receptions", "receptions", "rec_yds", "rec_yds", "rec_yds"];
  return {
    player: `Verified Player ${index}`,
    market: markets[index],
    line: 50.5 + index,
    overOdds: -110,
    underOdds: -110,
    fairOverProb: 0.5,
    book: "Verified Book",
    eventId: "warm-event",
    matchup: "Arizona Cardinals @ Buffalo Bills",
  };
});
liveOddsFixture = {
  ok: true,
  lines: warmLines,
  byEvent: { "warm-event": { commence: "2026-09-13T17:00:00Z", matchup: "Arizona Cardinals @ Buffalo Bills" } },
};
liveProjectionFixture = {
  players: warmLines.map((line, index) => ({
    id: `player-${index}`,
    name: line.player,
    team: "ARI",
    pos: index < 3 ? "QB" : index < 5 ? "RB" : "WR",
    gamesPlayed: 17,
    projected: { [line.market]: line.line + 1 },
  })),
};

(async () => {
  const before = getLatestNflPropsSnapshot();
  assert.equal(before.props.length, 0, "a restarted process begins with an empty in-memory snapshot");
  const warmed = await warmNflPropsSnapshotOnBoot();
  const after = getLatestNflPropsSnapshot();
  assert.equal(warmed.verified, 11, "startup warm publishes every verified production-shaped row");
  assert.equal(after.props.length, 11);
  assert.deepEqual(
    [...new Set(after.props.map((prop) => prop.market))],
    ["pass_yds", "rush_yds", "receptions", "rec_yds"],
    "existing core markets survive normalization and startup recording",
  );
  const second = await warmNflPropsSnapshotOnBoot();
  assert.deepEqual(second, { skipped: true, verified: 11 }, "an already-populated process is never warmed twice");
  console.log("nflPropsShadow self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
