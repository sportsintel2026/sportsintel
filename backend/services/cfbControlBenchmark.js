"use strict";

// Prospective-only linkage between the immutable production CFB ledger and the
// immutable independent game-shadow prediction. This module has no provider or
// result imports. It observes outputs that already exist and never calculates a
// customer prediction.
const crypto = require("crypto");

const LINK_TABLE = "cfb_game_control_benchmark_links";
const BENCHMARK_VERSION = "cfb-production-control-benchmark-v1-2026";
const PROTOCOL_VERSION = "cfb-shadow-vs-control-protocol-v1-2026";
const SHADOW_MODEL_VERSION = "cfb-game-preseason-shadow-v1-2026";
const CONTROL_EXPERIMENT_VERSION = "cfb-side-edge-provenance-v1-2026-08-30";
const CONTROL_MODEL_VERSIONS = Object.freeze({
  moneyline: "cfb-moneyline-v1-2026-08-30",
  spread: "cfb-spread-v1-2026-08-30",
});
const CONTROL_FIXED_MARKETS = Object.freeze({
  moneyline: "moneyline_shadow",
  spread: "spread_shadow",
});
const MAX_PAIR_DELTA_SECONDS = 300;
const MAX_KICKOFF_DELTA_SECONDS = 15 * 60;
const PRIMARY_POPULATION = "PAIRED_RATED_FBS";
const MIN_PROMOTION_GAMES = 100;
const MIN_PROMOTION_WEEKS = 4;
const LOG_EPSILON = 1e-15;

const PROTOCOL = Object.freeze({
  version: PROTOCOL_VERSION,
  primaryPopulation: PRIMARY_POPULATION,
  secondaryPopulations: Object.freeze([
    "SHADOW_ALL_ELIGIBLE",
    "PAIRED_WITH_CLOSE",
    "NEUTRAL_ONLY",
    "MARKET_ONLY_BASELINE",
  ]),
  pairing: Object.freeze({
    maxDeltaSeconds: MAX_PAIR_DELTA_SECONDS,
    maxKickoffDeltaSeconds: MAX_KICKOFF_DELTA_SECONDS,
    exactGameId: true,
    exactHomeAwayOrientation: true,
    exactMarketPayload: true,
    bothPreKickoff: true,
  }),
  promotion: Object.freeze({
    minimumPairedRatedGames: MIN_PROMOTION_GAMES,
    minimumDistinctWeeks: MIN_PROMOTION_WEEKS,
    requireLowerMeanBrierThanControlRaw: true,
    requireLowerMeanLogLossThanControlRaw: true,
    requireWeeklyStabilityReview: true,
    recalibrationBeforeFrozenV1Measurement: false,
  }),
  metrics: Object.freeze({
    moneyline: Object.freeze(["brier", "log_loss"]),
    margin: Object.freeze(["bias", "mae", "rmse"]),
    spread: Object.freeze(["cover_push_loss", "push_aware_scoring", "point_clv"]),
    market: Object.freeze(["closing_fair_scoring", "model_vs_close_points", "captured_line_clv"]),
  }),
});

function round3(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 1000) / 1000;
}

function validProbability(value) {
  return value != null && Number.isFinite(Number(value))
    && Number(value) > 0 && Number(value) < 1;
}

function sameNumber(left, right, tolerance = 0.0000001) {
  if (left == null || right == null) return left == null && right == null;
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) <= tolerance;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function controlState(row) {
  if (row?.data_quality === "rated") return "RATED_CONTROL";
  if (row?.data_quality === "market-only") return "MARKET_ONLY_CONTROL";
  if (row?.data_quality === "suspect") return "INELIGIBLE_CONTROL";
  return null;
}

function orientFixedControl(row, market) {
  if (!row || row.market !== CONTROL_FIXED_MARKETS[market] || row.selection !== "home") return null;
  if (row.model_version !== CONTROL_MODEL_VERSIONS[market]
      || row.experiment_version !== CONTROL_EXPERIMENT_VERSION) return null;
  if (!validProbability(row.model_prob) || !validProbability(row.market_fair_prob)) return null;
  if (row.odds == null || row.opp_odds == null || !row.entry_book || !row.opposing_book) return null;

  const state = controlState(row);
  if (!state) return null;
  if (state === "MARKET_ONLY_CONTROL") {
    if (row.raw_win_prob != null || row.edge != null
        || !sameNumber(row.model_prob, row.market_fair_prob)) return null;
  } else if (!validProbability(row.raw_win_prob)
      || row.edge == null
      || !sameNumber(row.edge, Number(row.model_prob) - Number(row.market_fair_prob))) {
    return null;
  }

  const selectedSide = Number(row.model_prob) >= 0.5 ? "home" : "away";
  const home = selectedSide === "home";
  return Object.freeze({
    state,
    selectedSide,
    rawProbability: row.raw_win_prob == null
      ? null : round3(home ? row.raw_win_prob : 1 - Number(row.raw_win_prob)),
    publishedProbability: round3(home ? row.model_prob : 1 - Number(row.model_prob)),
    marketFairProbability: round3(home ? row.market_fair_prob : 1 - Number(row.market_fair_prob)),
    edge: row.edge == null ? null : round3(home ? row.edge : -Number(row.edge)),
    odds: home ? row.odds : row.opp_odds,
    opposingOdds: home ? row.opp_odds : row.odds,
    book: home ? row.entry_book : row.opposing_book,
    opposingBook: home ? row.opposing_book : row.entry_book,
    line: market === "spread" && row.line != null
      ? Number(home ? row.line : -Number(row.line)) : null,
  });
}

function selectedRowMatches(fixed, selected, oriented, market) {
  if (!selected || oriented.state !== "RATED_CONTROL") return false;
  return selected.league === "cfb"
    && selected.game_id === fixed.game_id
    && selected.matchup === fixed.matchup
    && selected.market === market
    && selected.selection === oriented.selectedSide
    && selected.snapshotted_at === fixed.snapshotted_at
    && selected.model_version === fixed.model_version
    && selected.experiment_version === fixed.experiment_version
    && selected.data_quality === "rated"
    && sameNumber(selected.model_prob, oriented.publishedProbability)
    && sameNumber(selected.raw_win_prob, oriented.rawProbability)
    && sameNumber(selected.market_fair_prob, oriented.marketFairProbability)
    && sameNumber(selected.edge, oriented.edge)
    && sameNumber(selected.line, oriented.line)
    && Number(selected.odds) === Number(oriented.odds)
    && Number(selected.opp_odds) === Number(oriented.opposingOdds)
    && selected.entry_book === oriented.book
    && selected.opposing_book === oriented.opposingBook;
}

function marketContextMatches(shadow, fixed, market) {
  if (market === "moneyline") {
    return Number(fixed.odds) === Number(shadow.home_ml_odds)
      && Number(fixed.opp_odds) === Number(shadow.away_ml_odds)
      && fixed.entry_book === shadow.home_ml_book
      && fixed.opposing_book === shadow.away_ml_book
      && sameNumber(fixed.market_fair_prob, round3(shadow.market_fair_home_win_probability));
  }
  return shadow.home_spread != null
    && sameNumber(fixed.line, shadow.home_spread)
    && Number(fixed.odds) === Number(shadow.home_spread_odds)
    && Number(fixed.opp_odds) === Number(shadow.away_spread_odds)
    && fixed.entry_book === shadow.home_spread_book
    && fixed.opposing_book === shadow.away_spread_book
    && sameNumber(fixed.market_fair_prob, round3(shadow.market_fair_home_cover_probability));
}

function buildBenchmarkLink({ shadow, input, fixed, selected = null, market }) {
  const oriented = orientFixedControl(fixed, market);
  if (!oriented) throw new Error("invalid frozen control row");
  if (!shadow || shadow.model_version !== SHADOW_MODEL_VERSION) throw new Error("invalid shadow version");
  if (!input || Number(input.id) !== Number(shadow.input_snapshot_id)) throw new Error("shadow/input mismatch");
  const context = input.game_context || {};
  if (String(fixed.game_id) !== String(shadow.game_id)
      || String(input.game_id) !== String(shadow.game_id)
      || String(context.homeEspnTeamId) !== String(shadow.home_espn_team_id)
      || String(context.awayEspnTeamId) !== String(shadow.away_espn_team_id)) {
    throw new Error("control/shadow game identity or orientation mismatch");
  }

  const controlMs = Date.parse(fixed.snapshotted_at);
  const shadowMs = Date.parse(shadow.prediction_at);
  const marketMs = Date.parse(shadow.market_quote_at);
  const kickoffMs = Date.parse(shadow.kickoff_at);
  const inputPredictionMs = Date.parse(input.prediction_at);
  const inputKickoffMs = Date.parse(input.kickoff_at);
  if (![controlMs, shadowMs, marketMs, kickoffMs, inputPredictionMs, inputKickoffMs].every(Number.isFinite)
      || controlMs >= kickoffMs || shadowMs >= kickoffMs || marketMs > shadowMs) {
    throw new Error("benchmark timestamps are not pre-kickoff");
  }
  if (input.prediction_at !== shadow.prediction_at) {
    throw new Error("control and shadow do not share the required prediction timestamp");
  }
  if (Math.abs(inputKickoffMs - kickoffMs) / 1000 > MAX_KICKOFF_DELTA_SECONDS) {
    throw new Error("control/shadow kickoff delta is excessive");
  }
  const deltaSeconds = (controlMs - shadowMs) / 1000;
  if (Math.abs(deltaSeconds) > MAX_PAIR_DELTA_SECONDS) throw new Error("control/shadow time delta is excessive");
  if (fixed.snapshotted_at !== shadow.prediction_at || shadow.market_quote_at !== shadow.prediction_at) {
    throw new Error("control and shadow do not share the frozen market instant");
  }
  if (!marketContextMatches(shadow, fixed, market)) throw new Error("control/shadow market context mismatch");

  if (oriented.state === "RATED_CONTROL") {
    if (!selectedRowMatches(fixed, selected, oriented, market)) throw new Error("rated selected control row mismatch");
  } else if (selected != null) {
    throw new Error("non-rated control cannot claim a selected customer row");
  }

  const weekValue = context.week == null ? null : Number(context.week);
  const semantic = {
    shadowPredictionId: Number(shadow.id),
    fixedControlPredictionId: String(fixed.id),
    selectedControlPredictionId: selected?.id ? String(selected.id) : null,
    benchmarkVersion: BENCHMARK_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    market,
    controlState: oriented.state,
    gameId: String(shadow.game_id),
    season: Number(shadow.season),
    week: Number.isInteger(weekValue) ? weekValue : null,
    homeEspnTeamId: String(shadow.home_espn_team_id),
    awayEspnTeamId: String(shadow.away_espn_team_id),
    homeTeamName: shadow.home_team_name,
    awayTeamName: shadow.away_team_name,
    kickoffAt: shadow.kickoff_at,
    controlPredictionAt: fixed.snapshotted_at,
    shadowPredictionAt: shadow.prediction_at,
    controlMarketQuoteAt: shadow.market_quote_at,
    deltaSeconds,
    neutralSiteStatus: shadow.neutral_site_status,
    controlSelectedSide: oriented.selectedSide,
  };
  return Object.freeze({
    shadow_prediction_id: semantic.shadowPredictionId,
    control_fixed_prediction_id: semantic.fixedControlPredictionId,
    control_selected_prediction_id: semantic.selectedControlPredictionId,
    benchmark_version: BENCHMARK_VERSION,
    protocol_version: PROTOCOL_VERSION,
    market,
    control_state: oriented.state,
    game_id: semantic.gameId,
    season: semantic.season,
    week: semantic.week,
    home_espn_team_id: semantic.homeEspnTeamId,
    away_espn_team_id: semantic.awayEspnTeamId,
    home_team_name: semantic.homeTeamName,
    away_team_name: semantic.awayTeamName,
    kickoff_at: semantic.kickoffAt,
    control_prediction_at: semantic.controlPredictionAt,
    shadow_prediction_at: semantic.shadowPredictionAt,
    control_market_quote_at: semantic.controlMarketQuoteAt,
    control_shadow_time_delta_seconds: semantic.deltaSeconds,
    neutral_site_status: semantic.neutralSiteStatus,
    control_selected_side: semantic.controlSelectedSide,
    link_fingerprint: sha256(semantic),
  });
}

function brier(probability, actual) {
  if (!validProbability(probability) || ![0, 1].includes(actual)) return null;
  return Math.pow(Number(probability) - actual, 2);
}

function logLoss(probability, actual) {
  if (!validProbability(probability) || ![0, 1].includes(actual)) return null;
  const p = Math.min(1 - LOG_EPSILON, Math.max(LOG_EPSILON, Number(probability)));
  return actual === 1 ? -Math.log(p) : -Math.log(1 - p);
}

function spreadBinaryActual(atsResult) {
  if (atsResult === "HOME_COVER") return 1;
  if (atsResult === "AWAY_COVER") return 0;
  return null;
}

function compareMoneyline({
  homeWinActual,
  shadowHomeProbability,
  controlRawHomeProbability,
  controlPublishedHomeProbability,
  closingHomeFairProbability = null,
}) {
  const shadowBrier = brier(shadowHomeProbability, homeWinActual);
  const controlRawBrier = brier(controlRawHomeProbability, homeWinActual);
  const shadowLogLoss = logLoss(shadowHomeProbability, homeWinActual);
  const controlRawLogLoss = logLoss(controlRawHomeProbability, homeWinActual);
  return Object.freeze({
    shadow: Object.freeze({ brier: shadowBrier, logLoss: shadowLogLoss }),
    controlRaw: Object.freeze({ brier: controlRawBrier, logLoss: controlRawLogLoss }),
    controlPublished: Object.freeze({
      brier: brier(controlPublishedHomeProbability, homeWinActual),
      logLoss: logLoss(controlPublishedHomeProbability, homeWinActual),
    }),
    closingMarket: Object.freeze({
      brier: brier(closingHomeFairProbability, homeWinActual),
      logLoss: logLoss(closingHomeFairProbability, homeWinActual),
    }),
    deltaShadowMinusControlRaw: Object.freeze({
      brier: shadowBrier == null || controlRawBrier == null ? null : shadowBrier - controlRawBrier,
      logLoss: shadowLogLoss == null || controlRawLogLoss == null ? null : shadowLogLoss - controlRawLogLoss,
    }),
  });
}

function isPrimaryPopulation(link) {
  return link?.benchmark_version === BENCHMARK_VERSION
    && link?.protocol_version === PROTOCOL_VERSION
    && link?.control_state === "RATED_CONTROL";
}

function selectColumns() {
  return [
    "id", "game_id", "league", "matchup", "market", "selection", "model_prob",
    "raw_win_prob", "market_fair_prob", "edge", "odds", "opp_odds", "line",
    "entry_book", "opposing_book", "model_version", "experiment_version",
    "data_quality", "neutral_site_status", "snapshotted_at",
  ].join(",");
}

async function linkCfbShadowControls(supabase, { gameIds = [] } = {}) {
  if (!supabase) throw new Error("Supabase client is required");
  const ids = [...new Set((gameIds || []).map(String).filter(Boolean))];
  if (!ids.length) return Object.freeze({ considered: 0, linked: 0, duplicates: 0, unpaired: 0, ambiguous: 0, errors: 0 });

  const shadowResponse = await supabase
    .from("cfb_game_shadow_predictions")
    .select("id,input_snapshot_id,game_id,season,prediction_at,kickoff_at,market_quote_at,model_version,home_team_name,away_team_name,home_espn_team_id,away_espn_team_id,neutral_site_status,home_ml_odds,away_ml_odds,home_ml_book,away_ml_book,market_fair_home_win_probability,home_spread,away_spread,home_spread_odds,away_spread_odds,home_spread_book,away_spread_book,market_fair_home_cover_probability")
    .in("game_id", ids);
  if (shadowResponse.error) throw new Error(shadowResponse.error.message);
  const shadows = shadowResponse.data || [];
  const inputIds = [...new Set(shadows.map((row) => row.input_snapshot_id).filter((id) => id != null))];
  if (!inputIds.length) return Object.freeze({ considered: 0, linked: 0, duplicates: 0, unpaired: 0, ambiguous: 0, errors: 0 });

  const [inputResponse, controlResponse] = await Promise.all([
    supabase.from("cfb_game_input_snapshots")
      .select("id,game_id,prediction_at,kickoff_at,game_context").in("id", inputIds),
    supabase.from("model_predictions").select(selectColumns())
      .eq("league", "cfb")
      .in("game_id", ids)
      .in("market", ["moneyline", "spread", "moneyline_shadow", "spread_shadow"]),
  ]);
  if (inputResponse.error) throw new Error(inputResponse.error.message);
  if (controlResponse.error) throw new Error(controlResponse.error.message);
  const inputs = new Map((inputResponse.data || []).map((row) => [Number(row.id), row]));
  const controls = controlResponse.data || [];
  const links = [];
  const stats = { considered: 0, linked: 0, duplicates: 0, unpaired: 0, ambiguous: 0, errors: 0 };

  for (const shadow of shadows) {
    const input = inputs.get(Number(shadow.input_snapshot_id));
    for (const market of ["moneyline", "spread"]) {
      if (market === "spread" && shadow.home_spread == null) continue;
      stats.considered++;
      const fixedRows = controls.filter((row) => String(row.game_id) === String(shadow.game_id)
        && row.market === CONTROL_FIXED_MARKETS[market]);
      const candidates = [];
      for (const fixed of fixedRows) {
        try {
          const oriented = orientFixedControl(fixed, market);
          const selected = oriented?.state === "RATED_CONTROL"
            ? controls.find((row) => String(row.game_id) === String(shadow.game_id)
              && row.market === market
              && row.selection === oriented.selectedSide
              && row.snapshotted_at === fixed.snapshotted_at) || null
            : null;
          candidates.push(buildBenchmarkLink({ shadow, input, fixed, selected, market }));
        } catch (_) {}
      }
      if (!candidates.length) { stats.unpaired++; continue; }
      candidates.sort((a, b) => Math.abs(a.control_shadow_time_delta_seconds)
        - Math.abs(b.control_shadow_time_delta_seconds));
      if (candidates.length > 1
          && Math.abs(candidates[0].control_shadow_time_delta_seconds)
            === Math.abs(candidates[1].control_shadow_time_delta_seconds)) {
        stats.ambiguous++;
        continue;
      }
      links.push(candidates[0]);
    }
  }

  for (const link of links) {
    try {
      const response = await supabase.from(LINK_TABLE)
        .upsert(link, { onConflict: "shadow_prediction_id,market", ignoreDuplicates: true })
        .select("id")
        .maybeSingle();
      if (response.error) throw new Error(response.error.message);
      if (response.data) stats.linked++;
      else stats.duplicates++;
    } catch (error) {
      stats.errors++;
      console.error(`[CFB Control Benchmark] link failed game=${link.game_id} market=${link.market}: ${error.message}`);
    }
  }
  return Object.freeze(stats);
}

module.exports = {
  LINK_TABLE,
  BENCHMARK_VERSION,
  PROTOCOL_VERSION,
  MAX_PAIR_DELTA_SECONDS,
  MAX_KICKOFF_DELTA_SECONDS,
  PRIMARY_POPULATION,
  MIN_PROMOTION_GAMES,
  MIN_PROMOTION_WEEKS,
  LOG_EPSILON,
  PROTOCOL,
  linkCfbShadowControls,
  _internal: {
    round3,
    validProbability,
    sameNumber,
    stableValue,
    sha256,
    controlState,
    orientFixedControl,
    selectedRowMatches,
    marketContextMatches,
    buildBenchmarkLink,
    brier,
    logLoss,
    spreadBinaryActual,
    compareMoneyline,
    isPrimaryPopulation,
    selectColumns,
  },
};
