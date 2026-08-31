"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const benchmark = require("./cfbControlBenchmark");

const {
  BENCHMARK_VERSION,
  PROTOCOL_VERSION,
  MAX_PAIR_DELTA_SECONDS,
  PRIMARY_POPULATION,
  MIN_PROMOTION_GAMES,
  MIN_PROMOTION_WEEKS,
  PROTOCOL,
  _internal,
} = benchmark;

const at = "2026-08-31T13:25:00.000Z";
const kickoff = "2026-08-31T17:00:00.000Z";
const fixedId = "11111111-1111-4111-8111-111111111111";
const selectedId = "22222222-2222-4222-8222-222222222222";

function shadow(overrides = {}) {
  return {
    id: 10,
    input_snapshot_id: 20,
    game_id: "odds-event-1",
    season: 2026,
    prediction_at: at,
    kickoff_at: kickoff,
    market_quote_at: at,
    model_version: "cfb-game-preseason-shadow-v1-2026",
    home_team_name: "Alpha",
    away_team_name: "Bravo",
    home_espn_team_id: "1",
    away_espn_team_id: "2",
    neutral_site_status: "non-neutral",
    home_ml_odds: -110,
    away_ml_odds: 100,
    home_ml_book: "Home Book",
    away_ml_book: "Away Book",
    market_fair_home_win_probability: 0.4196,
    home_spread: -3,
    away_spread: 3,
    home_spread_odds: -105,
    away_spread_odds: -115,
    home_spread_book: "Home Spread Book",
    away_spread_book: "Away Spread Book",
    market_fair_home_cover_probability: 0.4777,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    id: 20,
    game_context: {
      week: 1,
      homeTeam: "Alpha",
      awayTeam: "Bravo",
      homeEspnTeamId: "1",
      awayEspnTeamId: "2",
    },
    ...overrides,
  };
}

function fixedMoneyline(overrides = {}) {
  return {
    id: fixedId,
    game_id: "odds-event-1",
    league: "cfb",
    matchup: "Bravo @ Alpha",
    market: "moneyline_shadow",
    selection: "home",
    model_prob: 0.45,
    raw_win_prob: 0.4,
    market_fair_prob: 0.42,
    edge: 0.03,
    odds: -110,
    opp_odds: 100,
    line: null,
    entry_book: "Home Book",
    opposing_book: "Away Book",
    model_version: "cfb-moneyline-v1-2026-08-30",
    experiment_version: "cfb-side-edge-provenance-v1-2026-08-30",
    data_quality: "rated",
    neutral_site_status: "non-neutral",
    snapshotted_at: at,
    ...overrides,
  };
}

function selectedMoneyline(overrides = {}) {
  return {
    id: selectedId,
    game_id: "odds-event-1",
    league: "cfb",
    matchup: "Bravo @ Alpha",
    market: "moneyline",
    selection: "away",
    model_prob: 0.55,
    raw_win_prob: 0.6,
    market_fair_prob: 0.58,
    edge: -0.03,
    odds: 100,
    opp_odds: -110,
    line: null,
    entry_book: "Away Book",
    opposing_book: "Home Book",
    model_version: "cfb-moneyline-v1-2026-08-30",
    experiment_version: "cfb-side-edge-provenance-v1-2026-08-30",
    data_quality: "rated",
    snapshotted_at: at,
    ...overrides,
  };
}

function fixedSpread(overrides = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    game_id: "odds-event-1",
    league: "cfb",
    matchup: "Bravo @ Alpha",
    market: "spread_shadow",
    selection: "home",
    model_prob: 0.48,
    raw_win_prob: 0.44,
    market_fair_prob: 0.478,
    edge: 0.002,
    odds: -105,
    opp_odds: -115,
    line: -3,
    entry_book: "Home Spread Book",
    opposing_book: "Away Spread Book",
    model_version: "cfb-spread-v1-2026-08-30",
    experiment_version: "cfb-side-edge-provenance-v1-2026-08-30",
    data_quality: "rated",
    neutral_site_status: "non-neutral",
    snapshotted_at: at,
    ...overrides,
  };
}

function selectedSpread(overrides = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    game_id: "odds-event-1",
    league: "cfb",
    matchup: "Bravo @ Alpha",
    market: "spread",
    selection: "away",
    model_prob: 0.52,
    raw_win_prob: 0.56,
    market_fair_prob: 0.522,
    edge: -0.002,
    odds: -115,
    opp_odds: -105,
    line: 3,
    entry_book: "Away Spread Book",
    opposing_book: "Home Spread Book",
    model_version: "cfb-spread-v1-2026-08-30",
    experiment_version: "cfb-side-edge-provenance-v1-2026-08-30",
    data_quality: "rated",
    snapshotted_at: at,
    ...overrides,
  };
}

function mustReject(fn, pattern) {
  assert.throws(fn, pattern);
}

// Frozen versions, populations, and conservative promotion gates.
assert.strictEqual(BENCHMARK_VERSION, "cfb-production-control-benchmark-v1-2026");
assert.strictEqual(PROTOCOL_VERSION, "cfb-shadow-vs-control-protocol-v1-2026");
assert.strictEqual(MAX_PAIR_DELTA_SECONDS, 300);
assert.strictEqual(PRIMARY_POPULATION, "PAIRED_RATED_FBS");
assert.strictEqual(MIN_PROMOTION_GAMES, 100);
assert.strictEqual(MIN_PROMOTION_WEEKS, 4);
assert.strictEqual(PROTOCOL.promotion.requireLowerMeanBrierThanControlRaw, true);
assert.strictEqual(PROTOCOL.promotion.requireLowerMeanLogLossThanControlRaw, true);

// Rated control: fixed-home row remains the immutable scientific source while
// the exact customer-selected row proves selected-side production identity.
const fixed = fixedMoneyline();
const selected = selectedMoneyline();
const fixedBefore = JSON.stringify(fixed);
const ratedLink = _internal.buildBenchmarkLink({
  shadow: shadow(), input: input(), fixed, selected, market: "moneyline",
});
assert.strictEqual(JSON.stringify(fixed), fixedBefore, "benchmark capture mutated its customer source row");
assert.strictEqual(ratedLink.control_state, "RATED_CONTROL");
assert.strictEqual(ratedLink.control_selected_side, "away");
assert.strictEqual(ratedLink.control_fixed_prediction_id, fixedId);
assert.strictEqual(ratedLink.control_selected_prediction_id, selectedId);
assert.strictEqual(ratedLink.control_shadow_time_delta_seconds, 0);
assert.strictEqual(ratedLink.benchmark_version, BENCHMARK_VERSION);
assert.strictEqual(ratedLink.protocol_version, PROTOCOL_VERSION);
assert.strictEqual(_internal.isPrimaryPopulation(ratedLink), true);

const oriented = _internal.orientFixedControl(fixed, "moneyline");
assert.deepStrictEqual({
  raw: oriented.rawProbability,
  published: oriented.publishedProbability,
  fair: oriented.marketFairProbability,
  edge: oriented.edge,
}, { raw: 0.6, published: 0.55, fair: 0.58, edge: -0.03 });
assert.notStrictEqual(oriented.rawProbability, oriented.publishedProbability);

// Spread selected-side orientation is exact and reversible.
const spreadLink = _internal.buildBenchmarkLink({
  shadow: shadow(), input: input(), fixed: fixedSpread(), selected: selectedSpread(), market: "spread",
});
assert.strictEqual(spreadLink.control_selected_side, "away");

// Market-only remains a separate market baseline and never gains a raw model probability.
const marketOnly = fixedMoneyline({
  model_prob: 0.52,
  raw_win_prob: null,
  market_fair_prob: 0.52,
  edge: null,
  data_quality: "market-only",
});
const marketOnlyShadow = shadow({ market_fair_home_win_probability: 0.5202 });
const marketOnlyLink = _internal.buildBenchmarkLink({
  shadow: marketOnlyShadow, input: input(), fixed: marketOnly, selected: null, market: "moneyline",
});
assert.strictEqual(marketOnlyLink.control_state, "MARKET_ONLY_CONTROL");
assert.strictEqual(marketOnlyLink.control_selected_prediction_id, null);
assert.strictEqual(_internal.orientFixedControl(marketOnly, "moneyline").rawProbability, null);
assert.strictEqual(_internal.isPrimaryPopulation(marketOnlyLink), false);
assert.strictEqual(_internal.orientFixedControl(fixedMoneyline({ raw_win_prob: null }), "moneyline"), null);

// Exact identity, orientation, timing, version, and market-payload pairing.
mustReject(() => _internal.buildBenchmarkLink({
  shadow: shadow({ home_team_name: "Bravo", away_team_name: "Alpha" }),
  input: input(), fixed, selected, market: "moneyline",
}), /identity|orientation/);
mustReject(() => _internal.buildBenchmarkLink({
  shadow: shadow({ game_id: "another-game" }), input: input(), fixed, selected, market: "moneyline",
}), /identity|orientation/);
mustReject(() => _internal.buildBenchmarkLink({
  shadow: shadow({ prediction_at: kickoff, market_quote_at: kickoff }),
  input: input(), fixed: fixedMoneyline({ snapshotted_at: kickoff }),
  selected: selectedMoneyline({ snapshotted_at: kickoff }), market: "moneyline",
}), /pre-kickoff/);
const lateAt = "2026-08-31T13:30:01.000Z";
mustReject(() => _internal.buildBenchmarkLink({
  shadow: shadow(), input: input(), fixed: fixedMoneyline({ snapshotted_at: lateAt }),
  selected: selectedMoneyline({ snapshotted_at: lateAt }), market: "moneyline",
}), /time delta/);
mustReject(() => _internal.buildBenchmarkLink({
  shadow: shadow(), input: input(), fixed: fixedMoneyline({ odds: -108 }), selected, market: "moneyline",
}), /market context/);
mustReject(() => _internal.buildBenchmarkLink({
  shadow: shadow(), input: input(), fixed: fixedMoneyline({ model_version: "cfb-moneyline-v2-2027" }),
  selected, market: "moneyline",
}), /invalid frozen control/);

// Fingerprint is deterministic; duplicate handling can key on shadow+market.
const ratedAgain = _internal.buildBenchmarkLink({ shadow: shadow(), input: input(), fixed, selected, market: "moneyline" });
assert.strictEqual(ratedAgain.link_fingerprint, ratedLink.link_fingerprint);
assert.strictEqual(ratedAgain.shadow_prediction_id, ratedLink.shadow_prediction_id);
assert.strictEqual(ratedAgain.market, ratedLink.market);

// Frozen synthetic scoring protocol. Lower deltas are better; closing remains separate.
const comparison = _internal.compareMoneyline({
  homeWinActual: 1,
  shadowHomeProbability: 0.7,
  controlRawHomeProbability: 0.6,
  controlPublishedHomeProbability: 0.55,
  closingHomeFairProbability: 0.65,
});
assert.ok(Math.abs(comparison.shadow.brier - 0.09) < 1e-12);
assert.ok(Math.abs(comparison.controlRaw.brier - 0.16) < 1e-12);
assert.ok(comparison.deltaShadowMinusControlRaw.brier < 0);
assert.ok(comparison.deltaShadowMinusControlRaw.logLoss < 0);
assert.notStrictEqual(comparison.controlPublished.brier, comparison.controlRaw.brier);
assert.notStrictEqual(comparison.closingMarket.brier, comparison.controlRaw.brier);
assert.strictEqual(_internal.spreadBinaryActual("HOME_COVER"), 1);
assert.strictEqual(_internal.spreadBinaryActual("AWAY_COVER"), 0);
assert.strictEqual(_internal.spreadBinaryActual("PUSH"), null);

// Static no-leakage/no-provider/customer-isolation guardrails.
const root = __dirname;
const benchmarkSource = fs.readFileSync(path.join(root, "cfbControlBenchmark.js"), "utf8");
for (const forbidden of [
  'require("./oddsApi")', 'require("./cfbdApi")', 'require("./cfbDataSource")',
  'require("./cfbGameShadowEvaluator")', "getCFBMainOdds(", "getCFBPinnacleClose(",
  "fetchScoreboard(", "fetch(",
]) assert.ok(!benchmarkSource.includes(forbidden), `benchmark contains forbidden surface ${forbidden}`);
const challengerSource = fs.readFileSync(path.join(root, "cfbGameShadowChallenger.js"), "utf8");
const modelSource = fs.readFileSync(path.join(root, "cfbModel.js"), "utf8");
assert.ok(!challengerSource.includes("cfbControlBenchmark"));
assert.ok(!challengerSource.includes("cfbGameShadowEvaluator"));
assert.ok(!modelSource.includes("cfbControlBenchmark"));
assert.ok(!modelSource.includes("cfbGameShadowEvaluator"));

const edgeSource = fs.readFileSync(path.join(root, "cfbEdges.js"), "utf8");
assert.match(edgeSource, /Object\.defineProperty\(slate, "cfbControlContext", \{[\s\S]*?enumerable: false/);
const sql = fs.readFileSync(path.join(root, "../../sql/cfb_game_control_benchmark_links.sql"), "utf8");
assert.match(sql, /create table public\.cfb_game_control_benchmark_links/i);
assert.match(sql, /unique \(shadow_prediction_id, market\)/i);
assert.match(sql, /abs\(control_shadow_time_delta_seconds\) <= 300/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /grant select, insert[\s\S]*to service_role/i);
assert.doesNotMatch(sql, /grant\s+(update|delete|all)/i);
assert.match(sql, /before update or delete[\s\S]*prevent_cfb_game_control_benchmark_link_mutation/i);

console.log("cfbControlBenchmark self-test: PASS (40 protocol/identity/safety checks)");
