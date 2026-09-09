const assert = require("assert");
const Module = require("module");
let liveOddsFixture = { ok: true, lines: [] };
let liveProjectionFixture = { players: [] };
let liveTdContextFixture = {};
let oddsProviderCalls = 0;
let projectionProviderCalls = 0;
let injuryWeatherCollectorCalls = 0;
let injuryWeatherCollectorArgs = null;
const writesByTable = new Map();
const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient: () => ({
    from: (table) => ({ upsert: async (rows) => {
      writesByTable.set(table, [...(writesByTable.get(table) || []), ...rows]);
      return { error: null };
    } }),
  }) };
  if (request === "./nflPropsOdds") return { getFootballPropLines: async () => {
    oddsProviderCalls++;
    return liveOddsFixture;
  } };
  if (request === "./nflPropsData") return {
    buildPlayerProjections: async () => {
      projectionProviderCalls++;
      return liveProjectionFixture;
    },
    overProb: (mean, line) => mean > line ? 0.6 : 0.4,
  };
  if (request === "./nflEdges") return { getLatestNflTdContextByEvent: () => ({}) };
  if (request === "./nflTdSlateContext") return {
    loadCurrentNflTdSlateContext: async () => ({
      contextByEvent: JSON.parse(JSON.stringify(liveTdContextFixture)),
      loaded: Object.keys(liveTdContextFixture).length,
    }),
  };
  if (request === "./nflInjuryWeatherShadow") return {
    collectNflInjuryWeatherShadow: async (args) => {
      injuryWeatherCollectorCalls++;
      injuryWeatherCollectorArgs = args;
      return { contextsRecorded: 1, comparisonsRecorded: 5, skipped: 0, errors: [] };
    },
  };
  return originalLoad(request, parent, isMain);
};
const {
  buildShadowRows,
  buildCfbRosterIdentities,
  getLatestNflPropsSnapshot,
  recordFootballProps,
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
assert.deepEqual(getLatestNflPropsSnapshot(), { sport: "nfl", generatedAt: null, props: [], tdSelections: [] }, "pure row construction does not publish a cache snapshot");

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
  { player: "Jordan Example Jr.", market: "anytime_td", line: null, overOdds: 160, underOdds: null, fairOverProb: null, book: "Best Book", priceMode: "over-only", overLabel: "YES", underLabel: null, eventId: "evt-1", matchup: "Arizona Cardinals @ Buffalo Bills" },
], { "evt-1": { commence: "2026-09-13T17:00:00Z", matchup: "Arizona Cardinals @ Buffalo Bills" } }, [
  { id: "99", name: "Jordan Example", team: "ARI", teamId: "22", pos: "QB", gamesPlayed: 17, projected: { pass_yds: 263.2 }, season2025: { gamesPlayed: 17, rushAtt: 45, targets: 0, rushTds: 4, recTds: 0 } },
]);
assert.equal(touchdown.rows.length, 0, "unmodeled touchdown markets never create prediction-ledger rows");
assert.deepEqual(touchdown.verifiedProps.map((prop) => prop.market), ["pass_tds", "anytime_td"]);
assert.equal(touchdown.verifiedProps[0].modelEdge, null);
assert.equal(touchdown.verifiedProps[1].priceMode, "over-only");
assert.equal(touchdown.verifiedProps[1].overOdds, 160);
assert.equal(touchdown.verifiedProps[1].book, "Best Book", "one verified player identity keeps one Anytime TD card at the best price");
assert.equal(touchdown.tdCandidates.length, 1, "one durable player/event identity feeds one ranking candidate");
assert.equal(touchdown.tdCandidates[0].baseline.rushTds, 4);

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
warmLines.push(
  { player: "Home Runner", market: "anytime_td", line: null, overOdds: 120, underOdds: null, fairOverProb: null, book: "Book B", priceMode: "over-only", eventId: "warm-event", matchup: "Arizona Cardinals @ Buffalo Bills" },
  { player: "Home Receiver", market: "anytime_td", line: null, overOdds: 100, underOdds: null, fairOverProb: null, book: "Book A", priceMode: "over-only", eventId: "warm-event", matchup: "Arizona Cardinals @ Buffalo Bills" },
  { player: "Away Runner", market: "anytime_td", line: null, overOdds: 110, underOdds: null, fairOverProb: null, book: "Book A", priceMode: "over-only", eventId: "warm-event", matchup: "Arizona Cardinals @ Buffalo Bills" },
);
liveOddsFixture = {
  ok: true,
  lines: warmLines,
  byEvent: { "warm-event": { commence: "2026-09-13T17:00:00Z", matchup: "Arizona Cardinals @ Buffalo Bills" } },
};
liveProjectionFixture = {
  availability: [{ playerId: "home-runner", teamId: "2", position: "RB" }],
  players: warmLines.slice(0, 11).map((line, index) => ({
    id: `player-${index}`,
    name: line.player,
    team: "ARI",
    pos: index < 3 ? "QB" : index < 5 ? "RB" : "WR",
    gamesPlayed: 17,
    projected: { [line.market]: line.line + 1 },
  })).concat([
    { id: "home-runner", name: "Home Runner", team: "BUF", teamId: "2", pos: "RB", gamesPlayed: 17, projected: {}, season2025: { gamesPlayed: 17, rushAtt: 250, targets: 55, rushTds: 12, recTds: 2 } },
    { id: "home-receiver", name: "Home Receiver", team: "BUF", teamId: "2", pos: "RB", gamesPlayed: 17, projected: {}, season2025: { gamesPlayed: 17, rushAtt: 4, targets: 140, rushTds: 0, recTds: 9 } },
    { id: "away-runner", name: "Away Runner", team: "ARI", teamId: "22", pos: "RB", gamesPlayed: 17, projected: {}, season2025: { gamesPlayed: 17, rushAtt: 190, targets: 35, rushTds: 7, recTds: 1 } },
  ]),
};
liveTdContextFixture = {
  "warm-event": {
    eventId: "warm-event", commenceTime: "2026-09-13T17:00:00Z",
    totalLine: 47.5, homeSpreadLine: -3.5, sourceSeason: 2025,
    home: { teamId: "2", team: "Buffalo Bills", offensePointsPerGame: 25, opponentDefensePointsAllowedPerGame: 24, projectedPoints: 26.5 },
    away: { teamId: "22", team: "Arizona Cardinals", offensePointsPerGame: 21, opponentDefensePointsAllowedPerGame: 20, projectedPoints: 20.5 },
  },
};

(async () => {
  const before = getLatestNflPropsSnapshot();
  assert.equal(before.props.length, 0, "a restarted process begins with an empty in-memory snapshot");
  const warmed = await warmNflPropsSnapshotOnBoot();
  const after = getLatestNflPropsSnapshot();
  assert.equal(warmed.verified, 14, "startup warm publishes every verified production-shaped row");
  assert.equal(after.props.length, 14);
  assert.deepEqual(after.tdSelections.map((row) => row.player), ["Home Runner"], "fresh startup hydrates exact durable slate context before TD v3 ranking");
  assert.deepEqual(
    [...new Set(after.props.map((prop) => prop.market))],
    ["pass_yds", "rush_yds", "receptions", "rec_yds", "anytime_td"],
    "existing core markets survive normalization and startup recording",
  );
  assert.equal((writesByTable.get("nfl_anytime_td_rankings_shadow") || []).length, 3, "all exact-identity TD candidates reach immutable shadow recording");
  assert.deepEqual({ oddsProviderCalls, projectionProviderCalls }, { oddsProviderCalls: 1, projectionProviderCalls: 1 }, "durable context hydration adds zero provider calls");
  const second = await warmNflPropsSnapshotOnBoot();
  assert.deepEqual(second, { skipped: true, verified: 14 }, "an already-populated process is never warmed twice");
  assert.deepEqual({ oddsProviderCalls, projectionProviderCalls }, { oddsProviderCalls: 1, projectionProviderCalls: 1 }, "repeat warm also adds zero provider calls");
  const scheduled = await recordFootballProps({ sport: "nfl", slate: { games: [{ eventId: "warm-event" }] } });
  assert.equal(injuryWeatherCollectorCalls, 1, "injury/weather shadow runs only when the existing scheduled slate is supplied");
  assert.deepEqual(injuryWeatherCollectorArgs.availability, liveProjectionFixture.availability,
    "the collector reuses the exact roster availability bundle already fetched for props");
  assert.equal(injuryWeatherCollectorArgs.availabilityMeta.teamsProbed, undefined,
    "missing fixture metadata remains explicitly unavailable rather than guessed");
  assert.deepEqual({ oddsProviderCalls, projectionProviderCalls }, { oddsProviderCalls: 2, projectionProviderCalls: 2 },
    "shadow wiring adds no Odds or ESPN projection request beyond the existing recorder call");
  assert.equal(scheduled.injuryWeatherShadow.comparisonsRecorded, 5);
  console.log("nflPropsShadow self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
