"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  MODEL_VERSION,
  TEAM_MODEL_VERSION,
  HOME_FIELD_POINTS,
  BASE_GAME_SIGMA,
  buildCfbGameShadowPrediction,
  _internal,
} = require("./cfbGameShadowChallenger");
const { CFB_SIGMA, CFB_HFA_POINTS, CFB_W_MODEL, _internal: customerMath } = require("./cfbModel");

const predictionAt = "2026-08-30T20:00:00.000Z";
const kickoffAt = "2026-08-30T23:00:00.000Z";
const team = (name, rating, sd = 4) => ({
  modelVersion: TEAM_MODEL_VERSION,
  challengerRating: rating,
  uncertainty: { sd },
  status: "suspect",
  team: { name },
});
const market = (overrides = {}) => ({
  source: "the-odds-api-us-best-price",
  quoteAt: predictionAt,
  h2h: { home: -150, away: +140, homeBook: "Home Book", awayBook: "Away Book", ...(overrides.h2h || {}) },
  spreads: { homeLine: -3, awayLine: 3, home: -105, away: -115, homeBook: "Home Spread", awayBook: "Away Spread", ...(overrides.spreads || {}) },
});
const build = ({ homeRating = 10, awayRating = 6, neutral = "non-neutral", market: quote = market(), home = "Home", away = "Away" } = {}) => (
  buildCfbGameShadowPrediction({
    game: { gameId: "game-1", predictionAt, kickoffAt, homeTeam: home, awayTeam: away },
    homeTeam: team(home, homeRating),
    awayTeam: team(away, awayRating),
    neutralSiteStatus: neutral,
    market: quote,
  })
);

assert.strictEqual(MODEL_VERSION, "cfb-game-preseason-shadow-v1-2026");
assert.strictEqual(CFB_SIGMA, BASE_GAME_SIGMA);
assert.strictEqual(CFB_HFA_POINTS, HOME_FIELD_POINTS);
assert.strictEqual(CFB_W_MODEL, 0.30);

// Rating math, trusted HFA, neutral context, and home/away reversal.
assert.strictEqual(build().projectedHomeMargin, 7);
assert.strictEqual(build({ neutral: "neutral" }).projectedHomeMargin, 4);
const neutralForward = build({ homeRating: 8, awayRating: 3, neutral: "neutral" });
const neutralReverse = build({ homeRating: 3, awayRating: 8, neutral: "neutral", home: "Away", away: "Home" });
assert.strictEqual(neutralForward.projectedHomeMargin, -neutralReverse.projectedHomeMargin);
const wagerForward = build({
  homeRating: 8, awayRating: 3, neutral: "neutral",
  market: market({ spreads: { homeLine: -3, awayLine: 3 } }),
});
const wagerReverse = build({
  homeRating: 3, awayRating: 8, neutral: "neutral", home: "Away", away: "Home",
  market: market({
    h2h: { home: +140, away: -150, homeBook: "Away Book", awayBook: "Home Book" },
    spreads: { homeLine: 3, awayLine: -3, home: -115, away: -105, homeBook: "Away Spread", awayBook: "Home Spread" },
  }),
});
assert.strictEqual(wagerForward.homeWinProbability, wagerReverse.awayWinProbability);
assert.strictEqual(wagerForward.homeCoverProbability, wagerReverse.awayCoverProbability);
assert.strictEqual(wagerForward.pointDisagreement, -wagerReverse.pointDisagreement);
assert.strictEqual(wagerForward.homeMlDisagreement, wagerReverse.awayMlDisagreement);
assert.strictEqual(wagerForward.homeSpreadDisagreement, wagerReverse.awaySpreadDisagreement);

// Independent ML mapping is the verified active normal CDF but never the 30/70 output.
assert.ok(neutralForward.homeWinProbability > 0.5);
assert.ok(Math.abs(neutralForward.homeWinProbability + neutralForward.awayWinProbability - 1) < 1e-8);
assert.strictEqual(build({ homeRating: 5, awayRating: 5, neutral: "neutral" }).homeWinProbability, 0.5);
for (const value of [-3, -1, 0, 1, 3]) {
  assert.ok(Math.abs(_internal.normalCDF(value) - customerMath.normalCDF(value)) < 1e-12);
}

// Spread sign convention: negative home line is a home handicap; positive is a cushion.
const favored = build({ homeRating: 7, awayRating: 0, neutral: "neutral" });
assert.strictEqual(favored.projectedHomeMargin, 7);
assert.ok(favored.homeCoverProbability > 0.5, "projected +7 should cover home -3 more than half");
const layingThreeAtPickem = build({ homeRating: 0, awayRating: 0, neutral: "neutral" });
assert.ok(layingThreeAtPickem.homeCoverProbability < 0.5);
const gettingThreeAtPickem = build({
  homeRating: 0,
  awayRating: 0,
  neutral: "neutral",
  market: market({ spreads: { homeLine: 3, awayLine: -3 } }),
});
assert.ok(gettingThreeAtPickem.homeCoverProbability > 0.5);
assert.ok(Math.abs(favored.homeCoverProbability + favored.awayCoverProbability - 1) < 1e-8);

// Market changes never change the independent projection or moneyline probability.
const marketA = build({ market: market() });
const marketB = build({ market: market({ h2h: { home: -400, away: +325 }, spreads: { homeLine: -7, awayLine: 7 } }) });
assert.strictEqual(marketA.projectedHomeMargin, marketB.projectedHomeMargin);
assert.strictEqual(marketA.homeWinProbability, marketB.homeWinProbability);
assert.notStrictEqual(marketA.homeCoverProbability, marketB.homeCoverProbability);

// Missing comparison markets remain honest without destroying the independent model.
const noSpread = build({ market: market({ spreads: { homeLine: null, awayLine: null, home: null, away: null } }) });
assert.ok(noSpread.homeWinProbability > 0.5);
assert.strictEqual(noSpread.homeCoverProbability, null);
assert.strictEqual(noSpread.pointDisagreement, null);
const noMl = build({ market: market({ h2h: { home: null, away: null } }) });
assert.ok(noMl.homeWinProbability > 0.5);
assert.strictEqual(noMl.homeMlDisagreement, null);

assert.throws(() => buildCfbGameShadowPrediction({
  game: { gameId: "started", predictionAt: kickoffAt, kickoffAt },
  homeTeam: team("Home", 1), awayTeam: team("Away", 0), neutralSiteStatus: "neutral", market: market(),
}), /strictly before kickoff/);
assert.throws(() => buildCfbGameShadowPrediction({
  game: { gameId: "unknown", predictionAt, kickoffAt },
  homeTeam: team("Home", 1), awayTeam: team("Away", 0), neutralSiteStatus: "unknown", market: market(),
}), /neutral-site status/);
assert.throws(() => buildCfbGameShadowPrediction({
  game: { gameId: "missing", predictionAt, kickoffAt },
  homeTeam: { ...team("Home", 1), challengerRating: null },
  awayTeam: team("Away", 0), neutralSiteStatus: "neutral", market: market(),
}), /unavailable/);

// Static isolation: no customer model/blend/provider capability can enter runtime.
const source = fs.readFileSync(path.join(__dirname, "cfbGameShadowChallenger.js"), "utf8");
for (const forbidden of [
  'require("./cfbModel")', "CFB_W_MODEL", "0.30", "getCFBMainOdds", "getCFBPinnacleClose",
  "cfbdApi", "oddsApi", "createClient", "model_predictions", ".from(", "fetch(",
]) {
  assert.ok(!source.includes(forbidden), `shadow game model contains forbidden dependency: ${forbidden}`);
}

console.log("cfbGameShadowChallenger self-test: PASS");
