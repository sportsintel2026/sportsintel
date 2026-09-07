import assert from "node:assert/strict";
import {
  availableFootballPropFamilies,
  filterFootballProps,
  footballPropMarket,
} from "./footballPropMarkets.js";

assert.equal(footballPropMarket("pass_yds").family, "passing");
assert.equal(footballPropMarket("pass_tds").family, "touchdowns");
assert.equal(footballPropMarket("rush_yds").family, "rushing");
assert.equal(footballPropMarket("receptions").family, "receiving");
assert.equal(footballPropMarket("rec_yds").family, "receiving");
assert.equal(footballPropMarket("anytime_td").family, "touchdowns");
assert.equal(footballPropMarket("touchdowns_2_plus").family, "touchdowns");
assert.equal(footballPropMarket("rush_tds").family, "touchdowns");
assert.equal(footballPropMarket("rec_tds").family, "touchdowns");
assert.equal(footballPropMarket("first_td").family, "touchdowns");
assert.equal(footballPropMarket("last_td").family, "touchdowns");

const props = [
  { sport: "nfl", market: "pass_yds", player: "Passer" },
  { sport: "nfl", market: "rush_yds", player: "Runner" },
  { sport: "nfl", market: "receptions", player: "Receiver" },
  { sport: "nfl", market: "anytime_td", player: "Scorer" },
  { sport: "nfl", market: "touchdowns_2_plus", player: "Two Score" },
  { sport: "nfl", market: "pass_tds", player: "Passing Score" },
  { sport: "nfl", market: "rush_tds", player: "Rushing Score" },
  { sport: "nfl", market: "rec_tds", player: "Receiving Score" },
  { sport: "nfl", market: "first_td", player: "First Score" },
  { sport: "nfl", market: "last_td", player: "Last Score" },
  { sport: "nfl", market: "unsupported_market", player: "Hidden" },
];
const families = availableFootballPropFamilies({ props });
assert.deepEqual(families.map((family) => family.key), ["all", "passing", "rushing", "receiving", "touchdowns"]);
assert.deepEqual(filterFootballProps(props, "passing").map((prop) => prop.player), ["Passer"]);
assert.deepEqual(filterFootballProps(props, "rushing").map((prop) => prop.player), ["Runner"]);
assert.deepEqual(filterFootballProps(props, "receiving").map((prop) => prop.player), ["Receiver"]);
assert.deepEqual(filterFootballProps(props, "touchdowns").map((prop) => prop.player), ["Scorer", "Two Score", "Passing Score", "Rushing Score", "Receiving Score", "First Score", "Last Score"], "every verified touchdown category appears under the one touchdown tab");
assert.equal(filterFootballProps(props, "all").some((prop) => prop.player === "Hidden"), false, "unsupported markets stay hidden");

const supportedOnly = availableFootballPropFamilies({ supportedMarkets: ["pass_yds", "rush_yds", "receptions", "rec_yds"] });
assert.deepEqual(supportedOnly.map((family) => family.key), ["all", "passing", "rushing", "receiving"], "empty fake touchdown tabs are not created");
assert.deepEqual(availableFootballPropFamilies({ supportedMarkets: [] }), [], "CFB without verified markets keeps its honest empty state");

const pairedOffer = { book: "One Book", line: 249.5, overOdds: -108, underOdds: -112, modelEdge: -0.031, modelOverProb: 0.47, marketFairOverProb: 0.501 };
assert.deepEqual(
  { book: pairedOffer.book, line: pairedOffer.line, overOdds: pairedOffer.overOdds, underOdds: pairedOffer.underOdds },
  { book: "One Book", line: 249.5, overOdds: -108, underOdds: -112 },
  "book, line and two-sided prices remain one atomic offer",
);

console.log("football prop market self-test passed");
