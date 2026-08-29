// Dependency-free recorder regression test.
// Runs with: node backend/services/mlbPredictionIntegrity.selftest.js

const Module = require("module");

let capturedRows = null;

class Query {
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  range() { return this; }
  order() { return this; }
  upsert(rows) { capturedRows = rows; return Promise.resolve({ error: null }); }
  then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
}

const supabase = { from() { return new Query(); } };
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
  if (request === "./oddsApi") return { getMLBMainOdds: asyncEmpty, getMLBPinnacleClose: asyncNull };
  if (request === "./teamKey") return { teamKey: identity, matchupKey: identity, cfbSchoolKey: identity };
  return originalLoad.call(this, request, parent, isMain);
};

const { recordPredictions } = require("./predictionTracker");
Module._load = originalLoad;

async function main() {
  const result = {
    date: "2026-08-29",
    recordingByGame: {
      "game-1": {
        moneyline: { awayRawModelProb: 0.43, homeRawModelProb: 0.57 },
        totals: { overRawModelProb: 0.58, underRawModelProb: 0.42 },
        runLine: { awayRawModelProb: 0.46, homeRawModelProb: 0.54 },
      },
    },
    games: [{
      id: "game-1", status: "scheduled", awayAbbr: "AWY", homeAbbr: "HOM",
      moneyline: { homeWinProb: 0.55, homeOdds: -120, awayOdds: 110, homeEdge: 0.02, homeConfidence: "LOW" },
      totals: { overProb: 0.56, line: 8.5, overOdds: -105, underOdds: -115, overEdge: 0.03, overConfidence: "LOW", breakdown: {} },
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
    ["published probability remains the supplied value", byMarket.total?.model_prob === 0.54 && byMarket.total_shadow?.model_prob === 0.56],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  console.log(JSON.stringify({ passed: checks.length - failed.length, failed, checks }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
