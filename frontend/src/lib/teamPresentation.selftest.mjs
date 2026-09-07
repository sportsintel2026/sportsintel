import assert from "node:assert/strict";
import { collapseRepeatedTeamWords, presentationPickText } from "./teamPresentation.js";

assert.equal(collapseRepeatedTeamWords("UAB Blazers Blazers +27.5"), "UAB Blazers +27.5");
assert.equal(collapseRepeatedTeamWords("Miami RedHawks RedHawks ML"), "Miami RedHawks ML");
assert.equal(collapseRepeatedTeamWords("Boston Red Sox ML"), "Boston Red Sox ML");
assert.equal(collapseRepeatedTeamWords("Old Dominion Monarchs Dominion Monarchs +17.5"), "Old Dominion Monarchs +17.5");
assert.equal(collapseRepeatedTeamWords("San Diego State Aztecs Diego State Aztecs +11"), "San Diego State Aztecs +11");
assert.equal(collapseRepeatedTeamWords("Sam Houston State Bearkats Houston State Bearkats +13.5"), "Sam Houston State Bearkats +13.5");
assert.equal(presentationPickText({ pick: "UAB Blazers +27.5", displayName: "UAB Blazers", abbreviation: "UAB" }), "UAB Blazers +27.5");
assert.equal(presentationPickText({ pick: "Over 48.5", displayName: "UAB Blazers", abbreviation: "UAB" }), "Over 48.5");

console.log("team presentation self-test: ok");
