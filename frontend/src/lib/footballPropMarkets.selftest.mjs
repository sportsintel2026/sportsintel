import assert from "node:assert/strict";
import {
  availableFootballPropFamilies,
  filterFootballProps,
  footballPropMarket,
} from "./footballPropMarkets.js";

assert.equal(footballPropMarket("pass_yds").family, "passing");
assert.equal(footballPropMarket("pass_tds").family, "passing");
assert.equal(footballPropMarket("rush_yds").family, "rushing");
assert.equal(footballPropMarket("receptions").family, "receiving");
assert.equal(footballPropMarket("rec_yds").family, "receiving");
assert.equal(footballPropMarket("anytime_td").family, "touchdowns");
assert.equal(footballPropMarket("touchdowns_2_plus").family, "touchdowns");
assert.equal(footballPropMarket("rush_tds").family, "rushing");
assert.equal(footballPropMarket("rec_tds").family, "receiving");
assert.equal(footballPropMarket("first_td").family, "touchdowns");
assert.equal(footballPropMarket("last_td").family, "touchdowns");

const props = [
  { sport: "nfl", market: "pass_yds", player: "Passer" },
  { sport: "nfl", market: "rush_yds", player: "Runner" },
  { sport: "nfl", market: "receptions", player: "Receiver" },
  { sport: "nfl", market: "last_td", player: "Last Score" },
  { sport: "nfl", market: "touchdowns_2_plus", player: "Two Score" },
  { sport: "nfl", market: "touchdowns_3_plus", player: "Three Score" },
  { sport: "nfl", market: "pass_tds", player: "Passing Score" },
  { sport: "nfl", market: "rush_tds", player: "Rushing Score" },
  { sport: "nfl", market: "rec_tds", player: "Receiving Score" },
  { sport: "nfl", market: "first_td", player: "First Score" },
  { sport: "nfl", market: "anytime_td", player: "Scorer" },
  { sport: "nfl", market: "unsupported_market", player: "Hidden" },
];
const families = availableFootballPropFamilies({ props });
assert.deepEqual(families.map((family) => family.key), ["all", "passing", "rushing", "receiving", "touchdowns"]);
assert.deepEqual(filterFootballProps(props, "passing").map((prop) => prop.player), ["Passer", "Passing Score"]);
assert.deepEqual(filterFootballProps(props, "rushing").map((prop) => prop.player), ["Runner", "Rushing Score"]);
assert.deepEqual(filterFootballProps(props, "receiving").map((prop) => prop.player), ["Receiver", "Receiving Score"]);
assert.deepEqual(filterFootballProps(props, "touchdowns").map((prop) => prop.player), ["Scorer"], "the default Touchdowns board is exclusively the provider's Anytime TD Scorer market");
assert.equal(filterFootballProps(props, "all").some((prop) => prop.player === "Hidden"), false, "unsupported markets stay hidden");

assert.deepEqual(
  availableFootballPropFamilies({ supportedMarkets: ["first_td", "last_td", "touchdowns_2_plus", "touchdowns_3_plus"] }).map((family) => family.key),
  ["all"],
  "secondary scorer markets alone do not create a misleading default Touchdowns board",
);

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
