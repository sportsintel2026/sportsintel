// Dependency-free integration check for the active runCFBSlate/tick wiring.
const assert = require("assert");
const Module = require("module");

let usCalls = 0;
let pinnacleCalls = 0;
const start = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
const oddsEvent = {
  eventId: "active-cfb-event", commenceTime: start,
  awayTeam: "Memphis Tigers", homeTeam: "UNLV Rebels",
  h2h: { away: +135, home: -145, awayBook: "Away Book", homeBook: "Home Book" },
  spreads: { awayLine: 3.5, away: -110, awayBook: "Away Spread", homeLine: -3.5, home: -110, homeBook: "Home Spread" },
  totals: { line: 52.5, over: -105, overBook: "Over Book", under: -115, underBook: "Under Book" },
};
const ratings = {
  season: 2026, rated: 2, sosApplied: true,
  teams: {
    1: { id: "1", name: "Memphis Tigers", abbr: "MEM", rating: 2, gp: 5, pf: 160, pa: 120, sosApplied: true },
    2: { id: "2", name: "UNLV Rebels", abbr: "UNLV", rating: 5, gp: 5, pf: 170, pa: 115, sosApplied: true },
  },
};

class Query {
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  is() { return this; }
  gt() { return this; }
  lt() { return Promise.resolve({ error: null }); }
  insert() { return Promise.resolve({ error: null }); }
  delete() { return this; }
  update() { return this; }
  then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
}
const fakeSupabase = { from() { return new Query(); } };

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "./oddsApi") return {
    getCFBMainOdds: async () => { usCalls++; return [oddsEvent]; },
    getCFBPinnacleClose: async () => { pinnacleCalls++; return [{ ...oddsEvent }]; },
  };
  if (request === "./cfbDataSource") return {
    buildTeamRatings: async () => ratings,
    fetchScoreboard: async () => [],
  };
  if (request === "./predictionTracker") return { FOOTBALL_IMMINENT_DAYS: 7 };
  if (request === "./footballVenue") return {
    buildNeutralIndex: async () => ({ isNeutral: () => false, meta: { matched: 1, neutral: 0 } }),
  };
  if (request === "@supabase/supabase-js") return { createClient: () => fakeSupabase };
  return originalLoad.call(this, request, parent, isMain);
};

const { runCFBSlate, captureCFBOddsTicks } = require("./cfbEdges");
const { toCfbBoardEdge, toCfbLedgerRow } = require("./cfbPredictionContract");

(async () => {
  const slate = await runCFBSlate({ season: 2026, weeks: 1 });
  assert.strictEqual(slate.games.length, 1);
  assert.ok(slate.cfbControlContext, "recorder-only control context should be present");
  assert.strictEqual(slate.cfbControlContext.usEvents.length, 1);
  assert.strictEqual(Object.isFrozen(slate.cfbControlContext), true);
  assert.strictEqual(Object.isFrozen(slate.cfbControlContext.usEvents), true);
  assert.strictEqual(JSON.stringify(slate).includes("cfbControlContext"), false,
    "recorder-only context must not enter the customer payload");
  const game = slate.games[0];
  assert.ok(game.cfbPredictionContract?.moneyline?.selected);
  assert.strictEqual(JSON.stringify(game).includes("cfbPredictionContract"), false);
  const side = game.cfbPredictionContract.moneyline.selected;
  const board = toCfbBoardEdge(game, "moneyline");
  const row = toCfbLedgerRow(game, start.slice(0, 10), "moneyline", "moneyline", side);
  assert.strictEqual(board.side, row.selection);
  assert.strictEqual(board.modelProb, row.model_prob);
  assert.strictEqual(board.marketFairProb, row.market_fair_prob);
  assert.strictEqual(board.edge, row.edge * 100);
  assert.strictEqual(row.home_rating_source, "current-only");
  assert.strictEqual(row.away_rating_source, "current-only");
  assert.strictEqual(row.home_current_season_weight, 1);
  assert.strictEqual(row.away_current_season_weight, 1);

  assert.strictEqual(usCalls, 1, "one US provider call for the slate");
  await captureCFBOddsTicks();
  assert.strictEqual(usCalls, 2, "tick adds exactly its one pre-existing US call");
  assert.strictEqual(pinnacleCalls, 1, "tick makes exactly its one pre-existing Pinnacle call");
  Module._load = originalLoad;
  console.log("cfbSlateContract self-test: PASS");
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
