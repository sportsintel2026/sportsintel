// Dependency-free recorder regression test.
// Runs with: node backend/services/mlbPredictionIntegrity.selftest.js

const Module = require("module");

let capturedRows = null;
let calibrationRows = null;

class Query {
  constructor(table) { this.table = table; }
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  range() { return this; }
  order() { return this; }
  upsert(rows) {
    if (this.table === "model_predictions") capturedRows = rows;
    if (this.table === "mlb_totals_calibration_shadow") calibrationRows = rows;
    return Promise.resolve({ error: null });
  }
  then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
}

const supabase = { from(table) { return new Query(table); } };
const asyncNull = async () => null;
const asyncEmpty = async () => [];
const identity = (value) => String(value || "").toLowerCase();

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "@supabase/supabase-js") return { createClient: () => supabase };
  if (request === "./mlbStatsApi") return {
    isPreGame: (status) => status === "scheduled",
    getEasternDate: () => "2026-08-29",
    getScheduleForDate: asyncEmpty,
    getGameHRHitters: asyncNull,
    getGamePitcherStrikeouts: asyncNull,
    getGameBatterHits: asyncNull,
    getGameBatterTotalBases: asyncNull,
    getLinescore: asyncNull,
    getGameStatusAndScore: asyncNull,
    normPlayerName: identity,
  };
  if (request === "./nbaGamelog") return { fetchGamelog: asyncNull };
  if (request === "./nbaDataSource" || request === "./nflDataSource" || request === "./cfbDataSource") {
    return { fetchScoreboard: asyncEmpty };
  }
  if (request === "./oddsApi") return {
    getMLBMainOdds: asyncEmpty,
    getMLBPinnacleClose: asyncNull,
    americanToImpliedProb: (odds) => odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100),
  };
  if (["./umpireStore", "./savantApi", "./weatherApi"].includes(request)) return {};
  if (request === "./winProbCalibration") return {
    winProbHaircut: () => 0,
    calibrateWinProb: (p) => p,
    calibrateCoverProb: (p) => p,
    calibrateHitsProb: (p) => p,
  };
  if (request === "./teamKey") return { teamKey: identity, matchupKey: identity, cfbSchoolKey: identity };
  return originalLoad.call(this, request, parent, isMain);
};

const { recordPredictions } = require("./predictionTracker");
Module._load = originalLoad;

async function main() {
  const result = {
    date: "2026-08-29",
    computedAt: "2026-08-29T16:00:00.000Z",
    recordingByGame: {
      "game-1": {
        moneyline: { awayRawModelProb: 0.43, homeRawModelProb: 0.57 },
        totals: {
          overRawModelProb: 0.58,
          underRawModelProb: 0.42,
          marketFairOverProb: 0.5,
          marketFairUnderProb: 0.5,
          formulaVersion: "test-formula",
          totalSd: 6,
          meanToMedian: 0.5,
          marketBlendEnabled: true,
          marketBlendWeight: 0.55,
        },
        runLine: { awayRawModelProb: 0.46, homeRawModelProb: 0.54 },
      },
    },
    games: [{
      id: "game-1", status: "scheduled", awayAbbr: "AWY", homeAbbr: "HOM",
      moneyline: { homeWinProb: 0.55, homeOdds: -120, awayOdds: 110, homeEdge: 0.02, homeConfidence: "LOW" },
      totals: {
        projected: 9.6826,
        overProb: 0.511,
        line: 8.5,
        overOdds: -105,
        underOdds: -115,
        overBook: "Book A",
        underBook: "Book B",
        overEdge: 0.03,
        overConfidence: "LOW",
        breakdown: { fatigueAdj: 0.2, base: 9.1 },
      },
      runLine: { homeCoverProb: 0.53, homeLine: -1.5, homeOdds: 135, awayOdds: -155, homeEdge: 0.02, homeConfidence: "LOW" },
    }],
    moneylineEdges: [{ gameId: "game-1", matchup: "AWY @ HOM", side: "home", teamAbbr: "HOM", modelProb: 0.55, odds: -120, oppOdds: 110, edge: 0.02, confidence: "LOW" }],
    totalsEdges: [{ gameId: "game-1", matchup: "AWY @ HOM", side: "under", line: 8.5, modelProb: 0.54, odds: -115, oppOdds: -105, edge: 0.02, confidence: "LOW" }],
    runLineEdges: [{ gameId: "game-1", matchup: "AWY @ HOM", side: "away", teamAbbr: "AWY", line: 1.5, modelProb: 0.55, odds: -155, oppOdds: 135, edge: 0.02, confidence: "LOW" }],
  };

  await recordPredictions(result);
  const byMarket = Object.fromEntries((capturedRows || []).map((row) => [row.market, row]));
  const checks = [
    ["six core/shadow rows recorded", capturedRows && capturedRows.length === 6],
    ["moneyline core raw stored", byMarket.moneyline?.raw_win_prob === 0.57],
    ["total selected-side raw stored", byMarket.total?.raw_win_prob === 0.42],
    ["run-line selected-side raw stored", byMarket.run_line?.raw_win_prob === 0.46],
    ["moneyline shadow raw and opposing price stored", byMarket.moneyline_shadow?.raw_win_prob === 0.57 && byMarket.moneyline_shadow?.opp_odds === 110],
    ["total shadow raw and opposing price stored", byMarket.total_shadow?.raw_win_prob === 0.58 && byMarket.total_shadow?.opp_odds === -115],
    ["run-line shadow raw and opposing price stored", byMarket.run_line_shadow?.raw_win_prob === 0.54 && byMarket.run_line_shadow?.opp_odds === -155],
    ["published probability remains the supplied value", byMarket.total?.model_prob === 0.54 && byMarket.total_shadow?.model_prob === 0.511],
    ["separate calibration ledger records five betas plus one discrete row", calibrationRows?.length === 6],
    ["calibration control remains beta 1", calibrationRows?.some((row) => row.variant_key === "logistic_beta_1.00" && row.published_over_prob === 0.511)],
    ["calibration entry books are preserved", calibrationRows?.every((row) => row.over_book === "Book A" && row.under_book === "Book B")],
    ["calibration formula metadata is complete", calibrationRows?.every((row) => row.logistic_sd === 6 && row.mean_to_median === 0.5 && row.market_blend_weight === 0.55)],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  console.log(JSON.stringify({ passed: checks.length - failed.length, failed, checks }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
