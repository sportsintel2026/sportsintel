const assert = require("assert");
const Module = require("module");

process.env.ODDS_API_KEY = "selftest-only";
const providerCalls = [];
const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "axios") return { get: async (url, options) => {
    providerCalls.push({ url, params: options?.params || {} });
    if (url.endsWith("/events")) return {
      data: [{ id: "cfb-event", commence_time: new Date(Date.now() + 864e5).toISOString(), home_team: "Exact State", away_team: "Mapped State" }],
      headers: {},
    };
    return { data: { bookmakers: [] }, headers: { "x-requests-remaining": "test" } };
  } };
  return originalLoad(request, parent, isMain);
};
const { parsePropLines, getFootballPropLines, MARKET_TO_ODDSKEY, MARKET_SPECS, FOOTBALL_SPORTS } = require("./nflPropsOdds");
Module._load = originalLoad;

const lines = parsePropLines({
  bookmakers: [
    {
      key: "book-a",
      title: "Book A",
      markets: [
        {
          key: "player_pass_yds",
          outcomes: [
            { description: "Exact Player", name: "Over", point: 250.5, price: -101 },
            { description: "Exact Player", name: "Under", point: 250.5, price: -119 },
            { description: "Exact Player", name: "Over", point: 249.5, price: -108 },
            { description: "Exact Player", name: "Under", point: 249.5, price: -112 },
          ],
        },
        {
          key: "player_pass_tds",
          outcomes: [
            { description: "Exact Player", name: "Over", point: 1.5, price: -110 },
            { description: "Exact Player", name: "Under", point: 1.5, price: -110 },
          ],
        },
        {
          key: "player_rush_tds",
          outcomes: [
            { description: "Exact Runner", name: "Over", point: 0.5, price: 145 },
            { description: "Exact Runner", name: "Under", point: 0.5, price: -175 },
          ],
        },
        {
          key: "player_reception_tds",
          outcomes: [
            { description: "Exact Receiver", name: "Over", point: 0.5, price: 120 },
            { description: "Exact Receiver", name: "Under", point: 0.5, price: -145 },
          ],
        },
        {
          key: "player_anytime_td",
          outcomes: [
            { description: "Exact Scorer", name: "Yes", price: 135 },
          ],
        },
        {
          key: "player_1st_td",
          outcomes: [
            { description: "Exact Scorer", name: "Yes", price: 900 },
          ],
        },
        {
          key: "player_last_td",
          outcomes: [
            { description: "Exact Scorer", name: "Yes", price: 1000 },
          ],
        },
        {
          key: "player_tds_over",
          outcomes: [
            { description: "Exact Scorer", name: "Over", point: 0.5, price: 135 },
            { description: "Exact Scorer", name: "Over", point: 1.5, price: 475 },
            { description: "Exact Scorer", name: "Over", point: 2.5, price: 1400 },
          ],
        },
      ],
    },
    {
      key: "book-b",
      title: "Book B",
      markets: [
        {
          key: "player_pass_yds",
          outcomes: [
            { description: "Exact Player", name: "Over", point: 249.5, price: 105 },
            { description: "Exact Player", name: "Under", point: 249.5, price: -125 },
          ],
        },
        {
          key: "player_anytime_td",
          outcomes: [{ description: "Exact Scorer", name: "Yes", price: 150 }],
        },
      ],
    },
  ],
});

assert.equal(lines.length, 9, "one core and eight requested touchdown market shapes normalize without duplicates");
assert.deepEqual(lines.find((line) => line.market === "pass_yds"), {
  player: "Exact Player",
  market: "pass_yds",
  line: 249.5,
  overOdds: -108,
  underOdds: -112,
  fairOverProb: 0.4957,
  book: "Book A",
  priceMode: "over-under",
  overLabel: "OVER",
  underLabel: "UNDER",
}, "line and both prices stay paired to the selected book");
assert.equal(lines.find((line) => line.market === "anytime_td").overOdds, 150);
assert.equal(lines.find((line) => line.market === "anytime_td").book, "Book B", "Anytime TD keeps the best verified price across books");
assert.equal(lines.find((line) => line.market === "anytime_td").underOdds, null);
assert.equal(lines.find((line) => line.market === "anytime_td").fairOverProb, null);
assert.equal(lines.find((line) => line.market === "anytime_td").priceMode, "over-only", "provider YES-only scorer board remains honest one-sided market data");
assert.deepEqual(lines.find((line) => line.market === "anytime_td").quotes, [
  { book: "Book B", price: 150, counterPrice: null, priceMode: "over-only" },
  { book: "Book A", price: 135, counterPrice: null, priceMode: "over-only" },
], "Anytime TD keeps the all-book quote ladder while the card still uses the best price");
assert.equal(lines.find((line) => line.market === "first_td").priceMode, "over-only");
assert.equal(lines.find((line) => line.market === "last_td").priceMode, "over-only");
assert.equal(lines.find((line) => line.market === "touchdowns_2_plus").line, 1.5);
assert.equal(lines.find((line) => line.market === "touchdowns_3_plus").line, 2.5);
assert.equal(lines.some((line) => line.market === "touchdown_milestone"), false, "the provider-only milestone key never leaks into the customer contract");
assert.equal(MARKET_TO_ODDSKEY.pass_tds, "player_pass_tds");
assert.equal(MARKET_TO_ODDSKEY.rush_tds, "player_rush_tds");
assert.equal(MARKET_TO_ODDSKEY.rec_tds, "player_reception_tds");
assert.equal(MARKET_TO_ODDSKEY.anytime_td, "player_anytime_td");
assert.equal(MARKET_TO_ODDSKEY.first_td, "player_1st_td");
assert.equal(MARKET_TO_ODDSKEY.last_td, "player_last_td");
assert.equal(MARKET_SPECS.player_anytime_td.offer, "yes-no");
assert.deepEqual(FOOTBALL_SPORTS, { nfl: "americanfootball_nfl", cfb: "americanfootball_ncaaf" });

const unsupportedMilestone = parsePropLines({ bookmakers: [{ key: "book-a", markets: [{
  key: "player_tds_over",
  outcomes: [{ description: "Milestone Scorer", name: "Over", point: 0.5, price: 125 }],
}] }] });
assert.deepEqual(unsupportedMilestone, [], "player_tds_over 0.5 is not relabeled as the provider's distinct player_anytime_td market");

(async () => {
  const cfb = await getFootballPropLines({ sport: "cfb", daysAhead: 2, maxEvents: 1 });
  assert.equal(cfb.ok, true);
  assert.equal(providerCalls.length, 2, "one event-list request plus one event-odds request; markets are not fetched separately");
  assert.match(providerCalls[0].url, /americanfootball_ncaaf\/events$/);
  assert.match(providerCalls[1].url, /americanfootball_ncaaf\/events\/cfb-event\/odds$/);
  assert.ok(providerCalls[1].params.markets.includes("player_anytime_td"));
  assert.ok(providerCalls[1].params.markets.includes("player_last_td"));
  console.log("nfl props odds self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
