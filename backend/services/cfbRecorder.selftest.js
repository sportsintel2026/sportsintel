// Dependency-free integration test for the active recordCFBPredictions path.
const assert = require("assert");
const Module = require("module");
const {
  buildCfbPredictionContract,
  applyCfbContractToPrediction,
} = require("./cfbPredictionContract");

let recorded = null;
let upsertOptions = null;
let pendingRows = [];
const gradeUpdates = [];
let pairedShadowCalls = 0;
let pairedLinkCalls = 0;
let pairedShadowArgs = null;
let pairedLinkArgs = null;
class Query {
  constructor() { this.mode = "select"; this.filters = {}; this.values = null; }
  select() { return this; }
  eq(key, value) { this.filters[key] = value; return this; }
  is(key, value) { this.filters[key] = value; return this; }
  in() { return this; }
  range() { return this; }
  order() { return this; }
  gte() { return this; }
  lte() { return this; }
  update(values) { this.mode = "update"; this.values = values; return this; }
  upsert(rows, options) { recorded = rows; upsertOptions = options; return Promise.resolve({ error: null }); }
  then(resolve) {
    if (this.mode === "update") {
      gradeUpdates.push({ values: this.values, id: this.filters.id });
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    const data = this.filters.result === "pending" && this.filters.league == null ? pendingRows : [];
    return Promise.resolve({ data, error: null }).then(resolve);
  }
}
const supabase = { from() { return new Query(); } };
const asyncEmpty = async () => [];
const asyncNull = async () => null;
const identity = (value) => String(value || "").toLowerCase();
const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient: () => supabase };
  if (request === "./mlbStatsApi") return {
    isPreGame: () => true, getEasternDate: () => "2026-08-30", getScheduleForDate: asyncEmpty,
    getGameHRHitters: asyncNull, getGamePitcherStrikeouts: asyncNull, getGameBatterHits: asyncNull,
    getGameBatterTotalBases: asyncNull, getLinescore: asyncNull, getGameStatusAndScore: asyncNull,
    normPlayerName: identity,
  };
  if (request === "./nbaGamelog") return { fetchGamelog: asyncNull };
  if (request === "./nbaDataSource" || request === "./nflDataSource") return { fetchScoreboard: asyncEmpty };
  if (request === "./cfbDataSource") return { fetchScoreboard: async () => [{
    state: "post",
    away: { displayName: "Memphis Tigers", score: 24 },
    home: { displayName: "UNLV Rebels", score: 31 },
  }] };
  if (request === "./oddsApi") return { getMLBMainOdds: asyncEmpty, getMLBPinnacleClose: asyncEmpty };
  if (request === "./teamKey") return {
    teamKey: identity,
    matchupKey: (away, home) => `${identity(away)}|${identity(home)}`,
    cfbSchoolKey: identity,
  };
  if (request === "./mlbTotalsCalibration") return {
    recordMlbTotalsCalibration: async () => 0,
    captureMlbTotalsCalibrationClosing: async () => 0,
    gradeMlbTotalsCalibration: async () => 0,
  };
  if (request === "./cfbGameShadowCollector") return {
    collectCfbGameShadowPredictions: async (_supabase, args) => {
      pairedShadowCalls++;
      pairedShadowArgs = args;
      return { created: 1 };
    },
  };
  if (request === "./cfbControlBenchmark") return {
    linkCfbShadowControls: async (_supabase, args) => {
      pairedLinkCalls++;
      pairedLinkArgs = args;
      return { linked: 2 };
    },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { recordCFBPredictions, gradeFinishedGames } = require("./predictionTracker");

const commenceTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const ev = {
  eventId: "cfb-recorder-1", commenceTime, awayTeam: "Memphis Tigers", homeTeam: "UNLV Rebels",
  h2h: { away: +135, home: -145, awayBook: "Away Book", homeBook: "Home Book" },
  spreads: { awayLine: 3.5, away: -115, awayBook: "Away Spread", homeLine: -3.5, home: -105, homeBook: "Home Spread" },
  totals: { line: 52.5, over: -102, overBook: "Over Book", under: -118, underBook: "Under Book" },
};
const game = {
  eventId: ev.eventId, commenceTime, awayTeam: ev.awayTeam, homeTeam: ev.homeTeam,
  matchup: `${ev.awayTeam} @ ${ev.homeTeam}`, dataQuality: "rated",
  moneyline: { homeWinProb: 56, awayWinProb: 44, modelHomeWinProb: 58, modelMargin: 4, fair: { home: 59, away: 41 }, book: { home: -145, away: +135 } },
  spread: { line: -3.5, homeCoverProb: 54, modelHomeCoverProb: 57, fair: { home: 56, away: 44 }, book: { home: -105, away: -115 } },
  total: { line: 52.5, overProb: 48, modelOverProb: 45, projTotal: 51, fair: { over: 46, under: 54 }, book: { over: -102, under: -118 } },
};
const ratingSnapshot = {
  priorSeason: 2025, currentSeason: 2026,
  home: { source: "prior-only", weight: 0 }, away: { source: "prior-only", weight: 0 },
  sosApplied: true, neutralSiteStatus: "non-neutral",
};
const contract = buildCfbPredictionContract({ prediction: game, event: ev, ratingSnapshot });
applyCfbContractToPrediction(game, contract, { moneyline: 0.03, spread: 0.03, total: 0.03 });
Object.defineProperty(game, "cfbPredictionContract", { value: contract, enumerable: false });

(async () => {
  const controlCapturedAt = new Date().toISOString();
  const slate = { games: [game] };
  Object.defineProperty(slate, "cfbControlContext", {
    value: Object.freeze({ capturedAt: controlCapturedAt, usEvents: Object.freeze([ev]) }),
    enumerable: false,
  });
  await recordCFBPredictions(slate);
  assert.strictEqual(recorded.length, 6);
  const byMarket = Object.fromEntries(recorded.map((row) => [row.market, row]));
  assert.strictEqual(byMarket.moneyline.selection, contract.moneyline.selected.selection);
  assert.strictEqual(byMarket.moneyline.edge, -0.03);
  assert.strictEqual(byMarket.spread.edge, -0.02);
  assert.strictEqual(byMarket.total.selection, "under");
  assert.strictEqual(byMarket.total.edge, -0.02);
  assert.strictEqual(byMarket.moneyline.entry_book, "Home Book");
  assert.strictEqual(byMarket.moneyline.opposing_book, "Away Book");
  assert.strictEqual(byMarket.spread_shadow.selection, "home");
  assert.strictEqual(byMarket.total_shadow.selection, "over");
  assert.strictEqual(upsertOptions.onConflict, "game_id,market,selection,game_date");
  assert.strictEqual(upsertOptions.ignoreDuplicates, true);
  assert.ok(recorded.every((row) => row.snapshotted_at === controlCapturedAt));
  assert.strictEqual(pairedShadowCalls, 1);
  assert.strictEqual(pairedLinkCalls, 1);
  assert.deepStrictEqual(pairedShadowArgs.usEvents, [ev]);
  assert.deepStrictEqual(pairedShadowArgs.pinnacleEvents, []);
  assert.strictEqual(pairedShadowArgs.capturedAt, controlCapturedAt);
  assert.deepStrictEqual(pairedLinkArgs.gameIds, [ev.eventId]);

  // New rows keep the existing market/selection/line contract understood by the
  // active CFB grader; provenance columns do not interfere with settlement.
  pendingRows = [{ ...byMarket.moneyline, id: 1, result: "pending" }];
  const graded = await gradeFinishedGames();
  assert.strictEqual(graded, 1);
  assert.strictEqual(gradeUpdates.length, 1);
  assert.strictEqual(gradeUpdates[0].id, 1);
  assert.strictEqual(gradeUpdates[0].values.result, "win");
  Module._load = originalLoad;
  console.log("cfbRecorder self-test: PASS");
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
