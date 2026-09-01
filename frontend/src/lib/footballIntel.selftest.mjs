import assert from "node:assert/strict";
import { buildFootballIntel } from "./footballIntel.js";

const marketOnly = buildFootballIntel({ games: [{ eventId: "1", matchup: "FCS @ Rated", dataQuality: "market-only" }], moneylineEdges: [{ gameId: "1", modelProb: .61, edge: null, dataQuality: "market-only", isModelEdge: false }] }, "cfb")[0];
assert.equal(marketOnly.marketOnly, true);
assert.equal(marketOnly.modelSignal, null);
assert.equal(marketOnly.weather, null);
assert.equal(marketOnly.availability, null);
assert.equal(buildFootballIntel({ games: [{ eventId: "m", matchup: "MLB Away @ MLB Home" }] }, "mlb").length, 0, "MLB Intel never leaks into football");
const rated = buildFootballIntel({ games: [{ eventId: "2", matchup: "Away @ Home", homeTeam: "Home", dataQuality: "rated", neutralSite: true, moneyline: { modelMargin: 4.2 } }], spreadEdges: [{ gameId: "2", teamAbbr: "Home", modelProb: .56, edge: 2.1, line: -3, dataQuality: "rated", isModelEdge: true }], marketMovers: [{ matchup: "Away @ Home", market: "spread", side: "home", line: -3, open: -105, now: -115 }] }, "nfl")[0];
assert.equal(rated.modelSignal.pick, "Home");
assert.equal(rated.venue, "Neutral-site adjustment verified");
assert.equal(rated.availability, null, "unknown QB/player status stays unavailable rather than fabricated");
assert.equal(rated.matchupEdge, "Home projected margin +4.2");
assert.equal(rated.lineMovement, "HOME SPREAD -3 · -105 → -115");
console.log("footballIntel self-test passed");
