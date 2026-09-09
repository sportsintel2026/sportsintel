const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  RANKING_VERSION,
  buildAnytimeTdRankings,
  persistAnytimeTdRankings,
  rankingRow,
  toCustomerAnytimeTdSelection,
} = require("./nflAnytimeTdRankings");

const predictionAt = "2026-09-08T13:00:00.000Z";
const contextByEvent = {
  "event-1": {
    eventId: "event-1", commenceTime: "2026-09-10T00:00:00.000Z",
    totalLine: 47.5, homeSpreadLine: -3.5, sourceSeason: 2025,
    home: { teamId: "1", team: "Home", offensePointsPerGame: 25, opponentDefensePointsAllowedPerGame: 24, projectedPoints: 26.5 },
    away: { teamId: "2", team: "Away", offensePointsPerGame: 21, opponentDefensePointsAllowedPerGame: 20, projectedPoints: 20.5 },
  },
};

function candidate({ id, name, teamId, team, opponent, rushAtt, targets, rushTds, recTds, price, book, quotes, availability = null }) {
  return {
    prop: {
      sport: "nfl", eventId: "event-1", eventDate: "2026-09-09",
      commenceTime: "2026-09-10T00:00:00.000Z", matchup: "Away @ Home",
      playerId: id, player: name, teamId, team, opponent, position: "RB",
      market: "anytime_td", overOdds: price, book, priceMode: "over-only",
      quoteCapturedAt: predictionAt, quotes,
    },
    baseline: { gamesPlayed: 17, rushAtt, targets, rushTds, recTds },
    availability,
  };
}

const rankings = buildAnytimeTdRankings({
  predictionAt,
  contextByEvent,
  candidates: [
    candidate({ id: "101", name: "Home Runner", teamId: "1", team: "HOME", opponent: "Away", rushAtt: 250, targets: 55, rushTds: 12, recTds: 2, price: 120, book: "Book B", quotes: [
      { book: "Book A", price: 105, counterPrice: null, priceMode: "over-only" },
      { book: "Book B", price: 120, counterPrice: null, priceMode: "over-only" },
    ] }),
    candidate({ id: "102", name: "Home Receiver", teamId: "1", team: "HOME", opponent: "Away", rushAtt: 4, targets: 140, rushTds: 0, recTds: 9, price: 100, book: "Book A", quotes: [{ book: "Book A", price: 100, counterPrice: null, priceMode: "over-only" }] }),
    candidate({ id: "201", name: "Away Runner", teamId: "2", team: "AWAY", opponent: "Home", rushAtt: 190, targets: 35, rushTds: 7, recTds: 1, price: 110, book: "Book A", quotes: [{ book: "Book A", price: 110, counterPrice: null, priceMode: "over-only" }] }),
    candidate({ id: "999", name: "Unavailable Runner", teamId: "2", team: "AWAY", opponent: "Home", rushAtt: 300, targets: 80, rushTds: 20, recTds: 3, price: -110, book: "Book A", quotes: [{ book: "Book A", price: -110, counterPrice: null, priceMode: "over-only" }], availability: { status: "Out", unavailable: true } }),
  ],
});

assert.equal(rankings.length, 3, "only exact offered players with complete inputs and usable availability rank");
const runner = rankings.find((row) => row.playerId === "101");
assert.equal(runner.teamImpliedPoints, 25.5, "team implied points derive from total and signed home spread");
assert.equal(runner.bestBook, "Book B");
assert.equal(runner.bestPrice, 120);
assert.equal(runner.allBookQuotes.length, 2, "the complete existing quote ladder is retained");
assert.equal(runner.marketQuoteCount, 2);
assert.ok(runner.marketConsensusImplied > 0 && runner.marketConsensusImplied < 1);
assert.equal(runner.teamRank, 1);
assert.ok(runner.candidateScore >= 0 && runner.candidateScore <= 100);
assert.equal(Object.hasOwn(runner, "probability"), false);
assert.equal(Object.hasOwn(runner, "edge"), false);
assert.equal(Object.hasOwn(runner, "fairOdds"), false);
const selections = rankings.map(toCustomerAnytimeTdSelection).filter(Boolean);
assert.equal(selections.length, 1, "v3 does not force one player per team or fill three cards");
assert.deepEqual(selections.map((item) => item.player), ["Home Runner"]);
assert.equal(selections[0].reasons.length, 3);
assert.equal(Object.hasOwn(selections[0], "candidateScore"), false, "customer selection hides internal score");
assert.equal(Object.hasOwn(selections[0], "gameRank"), false, "customer selection hides internal rank");
assert.equal(Object.hasOwn(selections[0], "marketRank"), false, "customer selection hides market rank");
assert.equal(Object.hasOwn(selections[0], "marketConsensusImplied"), false, "customer selection hides the market consensus calculation");
assert.equal(Object.hasOwn(selections[0], "probability"), false);
assert.equal(Object.hasOwn(selections[0], "edge"), false);

const row = rankingRow(runner);
assert.equal(row.ranking_version, RANKING_VERSION);
assert.equal(row.result_status, "pending");
assert.equal(row.best_book, "Book B");
assert.equal(row.selected_for_display, true);
assert.equal(row.market_quote_count, 2);
assert.ok(row.market_consensus_implied > 0 && row.market_consensus_implied < 1);
assert.deepEqual(row.all_book_quotes, runner.allBookQuotes);

const noForcedSelection = buildAnytimeTdRankings({
  predictionAt,
  contextByEvent,
  candidates: [
    candidate({ id: "301", name: "Aligned Favorite", teamId: "1", team: "HOME", opponent: "Away", rushAtt: 260, targets: 60, rushTds: 13, recTds: 2, price: -150, book: "Book A", quotes: [{ book: "Book A", price: -150 }] }),
    candidate({ id: "302", name: "Aligned Middle", teamId: "2", team: "AWAY", opponent: "Home", rushAtt: 180, targets: 40, rushTds: 7, recTds: 1, price: 175, book: "Book A", quotes: [{ book: "Book A", price: 175 }] }),
    candidate({ id: "303", name: "Aligned Longshot", teamId: "2", team: "AWAY", opponent: "Home", rushAtt: 40, targets: 30, rushTds: 2, recTds: 1, price: 350, book: "Book A", quotes: [{ book: "Book A", price: 350 }] }),
  ],
});
assert.equal(noForcedSelection.filter((item) => item.selectedForDisplay).length, 0, "matching scorer and consensus-market order produces no forced WizePicks selection");

let persisted = null;
let options = null;
const fakeDb = {
  from(table) {
    assert.equal(table, "nfl_anytime_td_rankings_shadow");
    return { upsert: async (rows, opts) => { persisted = rows; options = opts; return { error: null }; } };
  },
};

(async () => {
  const result = await persistAnytimeTdRankings(fakeDb, rankings);
  assert.equal(result.recorded, 3);
  assert.equal(persisted.length, 3);
  assert.deepEqual(options, {
    onConflict: "event_id,player_id,ranking_version",
    ignoreDuplicates: true,
  }, "duplicates preserve the immutable first snapshot rather than replacing it");

  const sql = fs.readFileSync(path.join(__dirname, "../../sql/nfl_anytime_td_rankings_shadow.sql"), "utf8");
  assert.match(sql, /unique \(event_id, player_id, ranking_version\)/i);
  assert.match(sql, /selected_for_display boolean not null/i);
  assert.match(sql, /market_consensus_implied double precision not null/i);
  assert.match(sql, /market_quote_count integer not null/i);
  assert.match(sql, /nfl-anytime-td-role-value-v3-2026-09-08/i);
  assert.match(sql, /prediction-time ranking fields are immutable/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /grant select, insert[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant delete/i);
  console.log("nfl Anytime TD rankings self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
