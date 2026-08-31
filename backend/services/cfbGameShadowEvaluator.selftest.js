"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  EVALUATION_VERSION,
  CLOSING_OBSERVATION_VERSION,
  captureCfbGameShadowClosingObservations,
  evaluateCfbGameShadowsFromScoreboard,
  _internal,
} = require("./cfbGameShadowEvaluator");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
function near(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

const shadow = Object.freeze({
  id: 101,
  input_snapshot_id: 55,
  game_id: "odds-event-1",
  prediction_at: "2026-09-05T17:00:00.000Z",
  kickoff_at: "2026-09-05T19:30:00.000Z",
  home_team_name: "Stanford Cardinal",
  away_team_name: "UNLV Rebels",
  home_espn_team_id: "24",
  away_espn_team_id: "2439",
  projected_home_margin: 7,
  home_win_probability: 0.7,
  away_win_probability: 0.3,
  market_fair_home_win_probability: 0.55,
  market_fair_away_win_probability: 0.45,
  home_spread: -3,
  away_spread: 3,
  home_cover_probability: 0.62,
  away_cover_probability: 0.38,
  spread_push_probability: 0.05,
});

function game(overrides = {}) {
  return {
    gameId: "espn-game-9",
    date: shadow.kickoff_at,
    state: "post",
    home: { id: "24", displayName: "Stanford Cardinal", score: 28 },
    away: { id: "2439", displayName: "UNLV Rebels", score: 21 },
    ...overrides,
  };
}

const usClose = Object.freeze({
  id: 501,
  shadow_prediction_id: shadow.id,
  quote_at: "2026-09-05T19:20:00.000Z",
  kickoff_at: shadow.kickoff_at,
  us_source: "the-odds-api-us-best-price-existing-hourly-capture",
  us_market_fair_home_win_probability: 0.58,
  us_market_fair_away_win_probability: 0.42,
  us_home_spread: -4,
  us_away_spread: 4,
  us_market_fair_home_cover_probability: 0.52,
  us_market_fair_away_cover_probability: 0.48,
});

const pinClose = Object.freeze({
  id: 502,
  shadow_prediction_id: shadow.id,
  quote_at: "2026-09-05T19:18:00.000Z",
  kickoff_at: shadow.kickoff_at,
  pinnacle_source: "pinnacle-existing-hourly-capture",
  pinnacle_market_fair_home_win_probability: 0.57,
  pinnacle_market_fair_away_win_probability: 0.43,
  pinnacle_home_spread: -3.5,
  pinnacle_away_spread: 3.5,
  pinnacle_market_fair_home_cover_probability: 0.51,
  pinnacle_market_fair_away_cover_probability: 0.49,
});

test("explicit versions", () => {
  assert.strictEqual(EVALUATION_VERSION, "cfb-game-shadow-eval-v1-2026");
  assert.strictEqual(CLOSING_OBSERVATION_VERSION, "cfb-game-shadow-close-observation-v1-2026");
});
test("exact game match succeeds", () => assert.strictEqual(_internal.exactFinalMatch(shadow, [game()]).game.gameId, "espn-game-9"));
test("home-away reversal rejected", () => {
  const reversed = game({ home: game().away, away: game().home });
  assert.strictEqual(_internal.exactFinalMatch(shadow, [reversed]).game, null);
});
test("ambiguous identity rejected", () => assert.strictEqual(_internal.exactFinalMatch(shadow, [game(), game({ gameId: "duplicate" })]).reason, "ambiguous-final-identity"));
test("kickoff mismatch rejected", () => assert.strictEqual(_internal.exactFinalMatch(shadow, [game({ date: "2026-09-05T20:00:00Z" })]).game, null));
test("live result rejected", () => assert.strictEqual(_internal.exactFinalMatch(shadow, [game({ state: "in" })]).reason, "not-final"));
test("postponed result rejected", () => assert.strictEqual(_internal.exactFinalMatch(shadow, [game({ state: "pre" })]).reason, "not-final"));
test("final without score rejected", () => assert.strictEqual(_internal.exactFinalMatch(shadow, [game({ home: { ...game().home, score: null } })]).reason, "final-score-unavailable"));

const homeEval = _internal.buildEvaluation(shadow, game(), { us: usClose, pinnacle: pinClose }, "2026-09-06T01:00:00Z");
test("home result actual margin", () => assert.strictEqual(homeEval.actual_home_margin, 7));
test("home win actual", () => assert.strictEqual(homeEval.home_win_actual, 1));
test("ML Brier", () => near(homeEval.brier_ml, 0.09));
test("home-win log loss", () => near(homeEval.log_loss_ml, -Math.log(0.7)));
test("away-win log loss", () => {
  const away = _internal.buildEvaluation(shadow, game({ home: { ...game().home, score: 17 }, away: { ...game().away, score: 24 } }));
  near(away.log_loss_ml, -Math.log(0.3));
});
test("epsilon protects log zero", () => assert.ok(Number.isFinite(_internal.logLoss(0, 1))));
test("epsilon leaves ordinary probability", () => near(_internal.logLoss(0.7, 1), -Math.log(0.7)));
test("signed margin error", () => assert.strictEqual(homeEval.margin_error, 0));
test("absolute margin error", () => assert.strictEqual(homeEval.margin_absolute_error, 0));
test("squared margin error", () => assert.strictEqual(homeEval.margin_squared_error, 0));
test("negative margin errors", () => {
  const row = _internal.buildEvaluation(shadow, game({ home: { ...game().home, score: 14 }, away: { ...game().away, score: 21 } }));
  assert.strictEqual(row.margin_error, -14);
  assert.strictEqual(row.margin_absolute_error, 14);
  assert.strictEqual(row.margin_squared_error, 196);
});

test("home -3, margin +7 covers", () => assert.deepStrictEqual(_internal.atsOutcome(7, -3), { value: 4, result: "HOME_COVER", homeActual: 1 }));
test("home -3, margin +3 pushes", () => assert.deepStrictEqual(_internal.atsOutcome(3, -3), { value: 0, result: "PUSH", homeActual: null }));
test("home -3, margin +1 loses", () => assert.deepStrictEqual(_internal.atsOutcome(1, -3), { value: -2, result: "AWAY_COVER", homeActual: 0 }));
test("home +3, margin 0 covers", () => assert.deepStrictEqual(_internal.atsOutcome(0, 3), { value: 3, result: "HOME_COVER", homeActual: 1 }));
test("favorite-dog sign cannot invert", () => {
  assert.strictEqual(_internal.atsOutcome(4, -3).result, "HOME_COVER");
  assert.strictEqual(_internal.atsOutcome(-4, 3).result, "AWAY_COVER");
});
test("push has no binary spread score", () => {
  const row = _internal.buildEvaluation(shadow, game({ home: { ...game().home, score: 24 }, away: { ...game().away, score: 21 } }));
  assert.strictEqual(row.ats_result, "PUSH");
  assert.strictEqual(row.brier_spread_decisive, null);
  assert.strictEqual(row.log_loss_spread_decisive, null);
});

test("pre-kickoff close selected", () => assert.strictEqual(_internal.selectLatestCloses([usClose], shadow.kickoff_at).us.id, usClose.id));
test("post-kickoff close rejected", () => {
  const late = { ...usClose, id: 999, quote_at: "2026-09-05T19:31:00Z" };
  assert.strictEqual(_internal.selectLatestCloses([late], shadow.kickoff_at).us, null);
});
test("latest valid source-specific closes selected", () => {
  const earlierUs = { ...usClose, id: 400, quote_at: "2026-09-05T19:00:00Z" };
  const selected = _internal.selectLatestCloses([earlierUs, pinClose, usClose], shadow.kickoff_at);
  assert.strictEqual(selected.us.id, 501);
  assert.strictEqual(selected.pinnacle.id, 502);
});
test("missing close leaves CLV null", () => assert.strictEqual(_internal.buildEvaluation(shadow, game()).us_home_spread_clv_points, null));
test("favorite spread CLV sign", () => assert.strictEqual(homeEval.us_home_spread_clv_points, 1));
test("underdog spread CLV sign", () => {
  const dogShadow = { ...shadow, home_spread: 5, away_spread: -5 };
  const dogClose = { ...usClose, us_home_spread: 4, us_away_spread: -4 };
  assert.strictEqual(_internal.buildEvaluation(dogShadow, game(), { us: dogClose }).us_home_spread_clv_points, 1);
});
test("worse spread CLV negative", () => {
  const worseClose = { ...usClose, us_home_spread: -2, us_away_spread: 2 };
  assert.strictEqual(_internal.buildEvaluation(shadow, game(), { us: worseClose }).us_home_spread_clv_points, -1);
});
test("ML market movement sign", () => near(homeEval.us_home_ml_market_move, 0.03));
test("shadow-vs-close ML disagreement", () => near(homeEval.shadow_vs_us_closing_home_ml_disagreement, 0.12));
test("projected margin vs close", () => assert.strictEqual(homeEval.shadow_vs_us_close_points, 3));
test("closing probability never changes shadow probability", () => assert.strictEqual(homeEval.source_home_win_probability, shadow.home_win_probability));
test("away close metrics reversible", () => {
  assert.strictEqual(homeEval.us_away_spread_clv_points, -1);
  near(homeEval.us_away_ml_market_move, -0.03);
});

test("closing observation exact identity", () => {
  const event = {
    eventId: shadow.game_id, commenceTime: shadow.kickoff_at,
    homeTeam: shadow.home_team_name, awayTeam: shadow.away_team_name,
    h2h: { home: -130, away: 115, homeBook: "Book A", awayBook: "Book B" },
    spreads: { homeLine: -3, awayLine: 3, home: -110, away: -110, homeBook: "Book A", awayBook: "Book B" },
  };
  const row = _internal.buildClosingObservation(shadow, event, [], "2026-09-05T18:00:00Z");
  assert.ok(row);
  assert.strictEqual(row.game_id, shadow.game_id);
  assert.strictEqual(row.us_home_spread, -3);
});
test("closing observation requires exact original event orientation", () => {
  const event = {
    eventId: shadow.game_id, commenceTime: shadow.kickoff_at,
    homeTeam: shadow.home_team_name, awayTeam: shadow.away_team_name,
    h2h: { home: -130, away: 115, homeBook: "Book A", awayBook: "Book B" },
  };
  assert.strictEqual(_internal.buildClosingObservation(
    shadow, event, [], "2026-09-05T18:00:00Z",
    { homeTeam: "Different Raw Name", awayTeam: shadow.away_team_name },
  ), null);
});
test("incomplete or invalid market groups are omitted safely", () => {
  const event = {
    eventId: shadow.game_id, commenceTime: shadow.kickoff_at,
    homeTeam: shadow.home_team_name, awayTeam: shadow.away_team_name,
    h2h: { home: -130, away: null, homeBook: "Book A", awayBook: "Book B" },
    spreads: { homeLine: -3, awayLine: 3.5, home: -110, away: -110, homeBook: "Book A", awayBook: "Book B" },
  };
  assert.strictEqual(_internal.buildClosingObservation(shadow, event, [], "2026-09-05T18:00:00Z"), null);
});
test("closing observation side swap rejected", () => {
  const event = { eventId: shadow.game_id, commenceTime: shadow.kickoff_at, homeTeam: shadow.away_team_name, awayTeam: shadow.home_team_name };
  assert.strictEqual(_internal.buildClosingObservation(shadow, event, [], "2026-09-05T18:00:00Z"), null);
});
test("closing observation at kickoff rejected", () => {
  const event = { eventId: shadow.game_id, commenceTime: shadow.kickoff_at, homeTeam: shadow.home_team_name, awayTeam: shadow.away_team_name };
  assert.strictEqual(_internal.buildClosingObservation(shadow, event, [], shadow.kickoff_at), null);
});
test("closing observation before prediction rejected", () => {
  const event = {
    eventId: shadow.game_id, commenceTime: shadow.kickoff_at,
    homeTeam: shadow.home_team_name, awayTeam: shadow.away_team_name,
    h2h: { home: -130, away: 115, homeBook: "Book A", awayBook: "Book B" },
  };
  assert.strictEqual(_internal.buildClosingObservation(shadow, event, [], "2026-09-05T16:59:59Z"), null);
});

const root = path.resolve(__dirname, "..");
const evaluatorSource = fs.readFileSync(path.join(__dirname, "cfbGameShadowEvaluator.js"), "utf8");
const challengerSource = fs.readFileSync(path.join(__dirname, "cfbGameShadowChallenger.js"), "utf8");
const customerModelSource = fs.readFileSync(path.join(__dirname, "cfbModel.js"), "utf8");
const customerRouteSource = fs.readFileSync(path.join(root, "routes", "edges.js"), "utf8");
const schemaSource = fs.readFileSync(path.resolve(__dirname, "..", "..", "sql", "cfb_game_shadow_evaluations.sql"), "utf8");

test("evaluator has no provider fetch capability", () => {
  assert.ok(!/require\(["']\.\/oddsApi["']\)/.test(evaluatorSource));
  assert.ok(!/require\(["']\.\/cfbdApi["']\)/.test(evaluatorSource));
  assert.ok(!/\bfetch\s*\(/.test(evaluatorSource));
  assert.ok(!/\baxios\b/.test(evaluatorSource));
});
test("challenger has no evaluation dependency", () => assert.ok(!challengerSource.includes("cfbGameShadowEvaluator")));
test("customer model has no evaluation dependency", () => assert.ok(!customerModelSource.includes("cfbGameShadowEvaluator")));
test("customer route has no evaluation dependency", () => assert.ok(!customerRouteSource.includes("cfbGameShadowEvaluator")));
test("schema preserves one evaluation per prediction", () => assert.ok(/shadow_prediction_id bigint not null unique/.test(schemaSource)));
test("schema makes closing observations immutable", () => assert.ok(schemaSource.includes("cfb_game_shadow_closing_observation_immutable")));
test("schema makes evaluations immutable", () => assert.ok(schemaSource.includes("cfb_game_shadow_evaluation_immutable")));
test("schema prevents orphan closing metrics", () => {
  assert.ok(schemaSource.includes("cfb_game_shadow_eval_us_close_group_ck"));
  assert.ok(schemaSource.includes("cfb_game_shadow_eval_pinnacle_close_group_ck"));
});
test("schema grants no update or delete", () => {
  assert.ok(!/grant[^;]*(update|delete)/i.test(schemaSource));
  assert.ok(schemaSource.includes("grant select, insert"));
});
test("upserts are duplicate-ignore only", () => {
  assert.ok(evaluatorSource.includes('onConflict: "shadow_prediction_id,quote_at", ignoreDuplicates: true'));
  assert.ok(evaluatorSource.includes('onConflict: "shadow_prediction_id", ignoreDuplicates: true'));
});

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.rangeBounds = null;
    this.operation = "select";
    this.payload = null;
  }
  select() { this.operation = "select"; return this; }
  in(column, values) { this.filters.push(["in", column, values.map(String)]); return this; }
  gt(column, value) { this.filters.push(["gt", column, value]); return this; }
  lte(column, value) { this.filters.push(["lte", column, value]); return this; }
  order() { return this; }
  range(from, to) { this.rangeBounds = [from, to]; return this; }
  upsert(rows, options) { this.operation = "upsert"; this.payload = rows; this.options = options; return this; }
  then(resolve, reject) { return Promise.resolve(this.db.execute(this)).then(resolve, reject); }
}

class FakeSupabase {
  constructor() {
    this.tables = {
      cfb_game_input_snapshots: [{ id: shadow.input_snapshot_id, game_context: {
        homeTeam: shadow.home_team_name, awayTeam: shadow.away_team_name,
      } }],
      cfb_game_shadow_predictions: [shadow],
      cfb_game_shadow_closing_observations: [],
      cfb_game_shadow_evaluations: [],
    };
  }
  from(table) { return new FakeQuery(this, table); }
  execute(query) {
    const rows = this.tables[query.table];
    if (!rows) return { data: null, error: { message: `unknown table ${query.table}` } };
    if (query.operation === "upsert") {
      for (const candidate of query.payload) {
        const duplicate = query.table === "cfb_game_shadow_closing_observations"
          ? rows.some((row) => String(row.shadow_prediction_id) === String(candidate.shadow_prediction_id)
            && row.quote_at === candidate.quote_at)
          : rows.some((row) => String(row.shadow_prediction_id) === String(candidate.shadow_prediction_id));
        if (!duplicate) rows.push({ id: rows.length + 1, ...candidate });
      }
      return { data: null, error: null };
    }
    let selected = [...rows];
    for (const [kind, column, value] of query.filters) {
      if (kind === "in") selected = selected.filter((row) => value.includes(String(row[column])));
      if (kind === "gt") selected = selected.filter((row) => Date.parse(row[column]) > Date.parse(value));
      if (kind === "lte") selected = selected.filter((row) => Date.parse(row[column]) <= Date.parse(value));
    }
    if (query.rangeBounds) selected = selected.slice(query.rangeBounds[0], query.rangeBounds[1] + 1);
    return { data: selected, error: null };
  }
}

async function runPersistenceTests() {
  const db = new FakeSupabase();
  const event = {
    eventId: shadow.game_id, commenceTime: shadow.kickoff_at,
    homeTeam: shadow.home_team_name, awayTeam: shadow.away_team_name,
    h2h: { home: -130, away: 115, homeBook: "Book A", awayBook: "Book B" },
    spreads: { homeLine: -3, awayLine: 3, home: -110, away: -110, homeBook: "Book A", awayBook: "Book B" },
  };
  const capture = await captureCfbGameShadowClosingObservations(db, {
    usEvents: [event], capturedAt: "2026-09-05T18:00:00Z",
  });
  test("persistence captures one exact close without a provider", () => {
    assert.strictEqual(capture.inserted, 1);
    assert.strictEqual(db.tables.cfb_game_shadow_closing_observations.length, 1);
    assert.strictEqual(db.tables.cfb_game_shadow_closing_observations[0].us_home_ml_book, "Book A");
  });

  const first = await evaluateCfbGameShadowsFromScoreboard(db, {
    scoreboardGames: [game()], evaluatedAt: "2026-09-06T01:00:00Z",
  });
  const second = await evaluateCfbGameShadowsFromScoreboard(db, {
    scoreboardGames: [game()], evaluatedAt: "2026-09-06T01:05:00Z",
  });
  test("first exact final creates one evaluation", () => {
    assert.strictEqual(first.evaluated, 1);
    assert.strictEqual(db.tables.cfb_game_shadow_evaluations.length, 1);
  });
  test("repeated evaluator run cannot duplicate output", () => {
    assert.strictEqual(second.evaluated, 0);
    assert.strictEqual(db.tables.cfb_game_shadow_evaluations.length, 1);
  });
}

runPersistenceTests()
  .then(() => console.log(`cfbGameShadowEvaluator self-test passed: ${passed} assertions`))
  .catch((error) => { console.error(error); process.exitCode = 1; });
