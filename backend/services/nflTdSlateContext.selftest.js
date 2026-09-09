const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient: () => ({}) };
  return originalLoad(request, parent, isMain);
};
const {
  TABLE,
  CONTEXT_VERSION,
  buildContextRows,
  rowToContext,
  persistNflTdSlateContext,
  loadCurrentNflTdSlateContext,
} = require("./nflTdSlateContext");
Module._load = originalLoad;

const tdContext = {
  eventId: "event-1", commenceTime: "2026-09-10T00:00:00.000Z",
  totalLine: 47.5, homeSpreadLine: -3.5, sourceSeason: 2025,
  home: { teamId: "1", team: "Home", offensePointsPerGame: 25, opponentDefensePointsAllowedPerGame: 24, projectedPoints: 26.5 },
  away: { teamId: "2", team: "Away", offensePointsPerGame: 21, opponentDefensePointsAllowedPerGame: 20, projectedPoints: 20.5 },
};
const game = {};
Object.defineProperty(game, "_tdContext", { value: tdContext, enumerable: false });
const capturedAt = "2026-09-08T20:00:00.000Z";
const rows = buildContextRows({ games: [game] }, capturedAt);
assert.equal(rows.length, 1);
assert.equal(rows[0].context_version, CONTEXT_VERSION);
assert.equal(rows[0].home_implied_points, 25.5);
assert.equal(rows[0].away_implied_points, 22);
assert.equal(rows[0].home_projected_points, 26.5, "the exact active model team projection is stored, not reconstructed");
assert.equal(rows[0].away_projected_points, 20.5);
assert.deepEqual(rowToContext(rows[0]), tdContext);

const incomplete = {};
Object.defineProperty(incomplete, "_tdContext", { value: { ...tdContext, home: { ...tdContext.home, projectedPoints: null } }, enumerable: false });
assert.equal(buildContextRows({ games: [incomplete] }, capturedAt).length, 0, "incomplete context is never persisted as an approximation");

let persistedRows = null;
let persistOptions = null;
const writeDb = { from(table) {
  assert.equal(table, TABLE);
  return { upsert: async (nextRows, options) => {
    persistedRows = nextRows;
    persistOptions = options;
    return { error: null };
  } };
} };

function readDb(data) {
  const query = {
    gte() { return this; },
    lte() { return this; },
    order: async () => ({ data, error: null }),
  };
  return { from(table) {
    assert.equal(table, TABLE);
    return { select() { return query; } };
  } };
}

(async () => {
  const stored = await persistNflTdSlateContext({ games: [game] }, { supabase: writeDb, capturedAt });
  assert.equal(stored.recorded, 1);
  assert.equal(persistedRows[0].event_id, "event-1");
  assert.deepEqual(persistOptions, { onConflict: "event_id" });

  const loaded = await loadCurrentNflTdSlateContext({
    supabase: readDb(rows),
    now: new Date("2026-09-08T21:00:00.000Z"),
  });
  assert.equal(loaded.loaded, 1);
  assert.deepEqual(loaded.contextByEvent["event-1"], tdContext);

  const wrongVersion = await loadCurrentNflTdSlateContext({
    supabase: readDb([{ ...rows[0], context_version: "obsolete" }]),
    now: new Date("2026-09-08T21:00:00.000Z"),
  });
  assert.equal(wrongVersion.loaded, 0, "an obsolete context version cannot feed current TD v3");

  let persistedSlate = null;
  let mainOddsCalls = 0;
  const commenceTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  Module._load = function nflSlateWiringLoad(request, parent, isMain) {
    if (request === "@supabase/supabase-js") return { createClient: () => ({}) };
    if (request === "./oddsApi") return {
      getNFLMainOdds: async () => {
        mainOddsCalls++;
        return [{
          eventId: "event-live", commenceTime,
          awayTeam: "Away Team", homeTeam: "Home Team",
          h2h: { home: -135, away: 115 },
          spreads: { homeLine: -3.5, awayLine: 3.5, home: -110, away: -110 },
          totals: { line: 47.5, over: -110, under: -110 },
        }];
      },
      getNFLPinnacleClose: async () => [],
    };
    if (request === "./nflDataSource") return {
      buildTeamRatings: async (season) => ({
        season, rated: 2, sosApplied: false,
        teams: {
          1: { id: "1", name: "Home Team", abbr: "HOME", rating: 4, pf: 425, pa: 340, gp: 17 },
          2: { id: "2", name: "Away Team", abbr: "AWAY", rating: -2, pf: 340, pa: 391, gp: 17 },
        },
      }),
      fetchScoreboard: async () => ({ events: [] }),
    };
    if (request === "./nflModel") return { predictGame: (event) => ({
      eventId: event.eventId, commenceTime: event.commenceTime,
      awayTeam: event.awayTeam, homeTeam: event.homeTeam,
      matchup: `${event.awayTeam} @ ${event.homeTeam}`,
    }) };
    if (request === "./footballVenue") return { buildNeutralIndex: async () => ({ isNeutral: () => false, meta: {} }) };
    if (request === "./predictionTracker") return { FOOTBALL_IMMINENT_DAYS: 7 };
    if (request === "./nflTdSlateContext") return { persistNflTdSlateContext: async (slate) => {
      persistedSlate = slate;
      return { recorded: slate.games.length };
    } };
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[require.resolve("./nflEdges")];
  const { runNFLSlate } = require("./nflEdges");
  const liveSlate = await runNFLSlate();
  Module._load = originalLoad;
  assert.equal(mainOddsCalls, 1, "the normal slate run retains its existing single main-odds fetch");
  assert.equal(liveSlate.games.length, 1);
  assert.ok(persistedSlate, "the normal production runNFLSlate flow persists TD context");
  assert.equal(persistedSlate.games[0]._tdContext.eventId, "event-live");
  assert.equal(persistedSlate.games[0]._tdContext.home.projectedPoints, 25.5);
  assert.equal(persistedSlate.games[0]._tdContext.away.projectedPoints, 17.5);
  console.log("nfl TD durable slate-context self-test passed");
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
