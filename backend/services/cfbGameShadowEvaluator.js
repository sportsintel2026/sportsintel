"use strict";

// Prospective-only lifecycle for the immutable CFB game shadow challenger.
// This module has no provider client and no customer-model dependency. Its two
// production entry points consume data already fetched by the existing CFB odds
// tick and CFB grading workflows.

const crypto = require("crypto");
const { _internal: closingMath } = require("./cfbClosing");

const EVALUATION_VERSION = "cfb-game-shadow-eval-v1-2026";
const CLOSING_OBSERVATION_VERSION = "cfb-game-shadow-close-observation-v1-2026";
const RESULT_SOURCE = "espn-fbs-scoreboard-existing-grading-feed";
const US_CLOSE_SOURCE = "the-odds-api-us-best-price-existing-hourly-capture";
const PINNACLE_CLOSE_SOURCE = "pinnacle-existing-hourly-capture";
const SCOREBOARD_KICKOFF_TOLERANCE_MS = 15 * 60 * 1000;
const LOG_EPSILON = 1e-15;

const SHADOW_SELECT = [
  "id", "input_snapshot_id", "game_id", "season", "game_date", "prediction_at", "kickoff_at",
  "model_version", "team_model_version", "experiment_version", "input_fingerprint",
  "home_team_name", "away_team_name", "home_espn_team_id", "away_espn_team_id",
  "projected_home_margin", "home_win_probability", "away_win_probability",
  "market_fair_home_win_probability", "market_fair_away_win_probability",
  "home_spread", "away_spread", "home_cover_probability", "away_cover_probability",
  "spread_push_probability",
].join(",");

function finite(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 12) {
  const n = finite(value);
  if (n == null) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key]) ]));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function safeProbability(value) {
  const n = finite(value);
  return n != null && n >= 0 && n <= 1 ? n : null;
}

function logLoss(probability, actual) {
  const p = safeProbability(probability);
  if (p == null || !new Set([0, 1]).has(actual)) return null;
  const protectedP = Math.min(1 - LOG_EPSILON, Math.max(LOG_EPSILON, p));
  return round(actual === 1 ? -Math.log(protectedP) : -Math.log(1 - protectedP));
}

function fairPair(homeOdds, awayOdds) {
  const home = finite(homeOdds), away = finite(awayOdds);
  if (home == null || away == null) return { home: null, away: null };
  return {
    home: closingMath.fair(home, away),
    away: closingMath.fair(away, home),
  };
}

function normalizedBook(value, fallback = null) {
  const s = String(value || "").trim();
  const resolved = s || fallback;
  return resolved && resolved.length <= 120 && !/[\x00-\x1f\x7f]/.test(resolved) ? resolved : null;
}

function validAmericanOdds(value) {
  const n = finite(value);
  return n != null && Number.isInteger(n) && Math.abs(n) >= 100 ? n : null;
}

function normalizedMarketFields(event, prefix, fallbackBook = null) {
  const h2h = event?.h2h || {};
  const spread = event?.spreads || {};
  const homeMl = validAmericanOdds(h2h.home);
  const awayMl = validAmericanOdds(h2h.away);
  const homeMlBook = normalizedBook(h2h.homeBook, fallbackBook);
  const awayMlBook = normalizedBook(h2h.awayBook, fallbackBook);
  const hasMl = homeMl != null && awayMl != null && homeMlBook && awayMlBook;
  const homeSpread = finite(spread.homeLine);
  const awaySpread = finite(spread.awayLine);
  const homeSpreadOdds = validAmericanOdds(spread.home);
  const awaySpreadOdds = validAmericanOdds(spread.away);
  const homeSpreadBook = normalizedBook(spread.homeBook, fallbackBook);
  const awaySpreadBook = normalizedBook(spread.awayBook, fallbackBook);
  const hasSpread = homeSpread != null && awaySpread != null
    && Math.abs(homeSpread + awaySpread) < 1e-9
    && homeSpreadOdds != null && awaySpreadOdds != null
    && homeSpreadBook && awaySpreadBook;
  const mlFair = hasMl ? fairPair(homeMl, awayMl) : { home: null, away: null };
  const spreadFair = hasSpread ? fairPair(homeSpreadOdds, awaySpreadOdds) : { home: null, away: null };
  return {
    [`${prefix}_home_ml_odds`]: hasMl ? homeMl : null,
    [`${prefix}_away_ml_odds`]: hasMl ? awayMl : null,
    [`${prefix}_home_ml_book`]: hasMl ? homeMlBook : null,
    [`${prefix}_away_ml_book`]: hasMl ? awayMlBook : null,
    [`${prefix}_market_fair_home_win_probability`]: mlFair.home,
    [`${prefix}_market_fair_away_win_probability`]: mlFair.away,
    [`${prefix}_home_spread`]: hasSpread ? homeSpread : null,
    [`${prefix}_away_spread`]: hasSpread ? awaySpread : null,
    [`${prefix}_home_spread_odds`]: hasSpread ? homeSpreadOdds : null,
    [`${prefix}_away_spread_odds`]: hasSpread ? awaySpreadOdds : null,
    [`${prefix}_home_spread_book`]: hasSpread ? homeSpreadBook : null,
    [`${prefix}_away_spread_book`]: hasSpread ? awaySpreadBook : null,
    [`${prefix}_market_fair_home_cover_probability`]: spreadFair.home,
    [`${prefix}_market_fair_away_cover_probability`]: spreadFair.away,
  };
}

function hasMarket(fields, prefix) {
  return Object.entries(fields).some(([key, value]) => key.startsWith(`${prefix}_`) && value != null);
}

function buildClosingObservation(shadow, usEvent, pinnacleEvents, capturedAt, inputContext = null) {
  if (!shadow || !usEvent) return null;
  const quoteMs = Date.parse(capturedAt);
  const predictionMs = Date.parse(shadow.prediction_at);
  const kickoffMs = Date.parse(shadow.kickoff_at);
  if (!Number.isFinite(quoteMs) || !Number.isFinite(predictionMs) || !Number.isFinite(kickoffMs)
      || quoteMs < predictionMs || quoteMs >= kickoffMs) return null;
  if (String(usEvent.eventId) !== String(shadow.game_id)) return null;
  const eventKickoffMs = Date.parse(usEvent.commenceTime);
  if (!Number.isFinite(eventKickoffMs)
      || Math.abs(eventKickoffMs - kickoffMs) > SCOREBOARD_KICKOFF_TOLERANCE_MS) return null;
  if (!inputContext
      || String(inputContext.homeEspnTeamId || "") !== String(shadow.home_espn_team_id)
      || String(inputContext.awayEspnTeamId || "") !== String(shadow.away_espn_team_id)
      || !String(inputContext.homeTeam || "").trim()
      || !String(inputContext.awayTeam || "").trim()) return null;

  const us = normalizedMarketFields(usEvent, "us");
  const pinnacleEvent = closingMath.matchPinnacleEvent(usEvent, pinnacleEvents || []);
  const pinnacle = normalizedMarketFields(pinnacleEvent, "pinnacle", "Pinnacle");
  if (!hasMarket(us, "us") && !hasMarket(pinnacle, "pinnacle")) return null;

  const semantic = {
    shadowPredictionId: shadow.id,
    gameId: String(shadow.game_id),
    quoteAt: new Date(quoteMs).toISOString(),
    us,
    pinnacle,
  };
  return {
    shadow_prediction_id: shadow.id,
    input_snapshot_id: shadow.input_snapshot_id,
    game_id: String(shadow.game_id),
    observation_version: CLOSING_OBSERVATION_VERSION,
    quote_at: semantic.quoteAt,
    kickoff_at: new Date(kickoffMs).toISOString(),
    event_home_team: inputContext.homeTeam,
    event_away_team: inputContext.awayTeam,
    us_source: hasMarket(us, "us") ? US_CLOSE_SOURCE : null,
    ...us,
    pinnacle_source: hasMarket(pinnacle, "pinnacle") ? PINNACLE_CLOSE_SOURCE : null,
    ...pinnacle,
    observation_fingerprint: sha256(semantic),
  };
}

function selectLatestCloses(observations, kickoffAt) {
  const kickoffMs = Date.parse(kickoffAt);
  const eligible = (observations || [])
    .filter((row) => Number.isFinite(Date.parse(row?.quote_at)) && Date.parse(row.quote_at) < kickoffMs)
    .sort((a, b) => Date.parse(a.quote_at) - Date.parse(b.quote_at));
  let us = null, pinnacle = null;
  for (const row of eligible) {
    if (row.us_source && hasMarket(row, "us")) us = row;
    if (row.pinnacle_source && hasMarket(row, "pinnacle")) pinnacle = row;
  }
  return { us, pinnacle };
}

function exactFinalMatch(shadow, scoreboardGames) {
  const kickoffMs = Date.parse(shadow?.kickoff_at);
  if (!shadow || !Number.isFinite(kickoffMs)) return { game: null, reason: "invalid-shadow-identity" };
  const oriented = (scoreboardGames || []).filter((game) => (
    String(game?.home?.id || "") === String(shadow.home_espn_team_id)
    && String(game?.away?.id || "") === String(shadow.away_espn_team_id)
    && Number.isFinite(Date.parse(game?.date))
    && Math.abs(Date.parse(game.date) - kickoffMs) <= SCOREBOARD_KICKOFF_TOLERANCE_MS
  ));
  if (oriented.length !== 1) return { game: null, reason: oriented.length ? "ambiguous-final-identity" : "no-exact-final-identity" };
  const game = oriented[0];
  if (game.state !== "post") return { game: null, reason: "not-final" };
  const homeScore = finite(game.home?.score), awayScore = finite(game.away?.score);
  if (homeScore == null || awayScore == null) return { game: null, reason: "final-score-unavailable" };
  return { game, reason: null };
}

function atsOutcome(actualHomeMargin, capturedHomeSpread) {
  const margin = finite(actualHomeMargin), line = finite(capturedHomeSpread);
  if (margin == null || line == null) return { value: null, result: null, homeActual: null };
  const value = round(margin + line);
  if (Math.abs(value) < 1e-12) return { value: 0, result: "PUSH", homeActual: null };
  return value > 0
    ? { value, result: "HOME_COVER", homeActual: 1 }
    : { value, result: "AWAY_COVER", homeActual: 0 };
}

function closeMetrics(shadow, close, prefix) {
  if (!close) return {
    [`${prefix}_closing_observation_id`]: null,
    [`${prefix}_closing_home_ml_fair_probability`]: null,
    [`${prefix}_closing_away_ml_fair_probability`]: null,
    [`${prefix}_closing_home_spread`]: null,
    [`${prefix}_closing_away_spread`]: null,
    [`${prefix}_closing_home_cover_fair_probability`]: null,
    [`${prefix}_closing_away_cover_fair_probability`]: null,
    [`${prefix}_home_spread_clv_points`]: null,
    [`${prefix}_away_spread_clv_points`]: null,
    [`${prefix}_home_ml_market_move`]: null,
    [`${prefix}_away_ml_market_move`]: null,
    [`shadow_vs_${prefix}_closing_home_ml_disagreement`]: null,
    [`shadow_vs_${prefix}_closing_away_ml_disagreement`]: null,
    [`shadow_vs_${prefix}_close_points`]: null,
    [`shadow_vs_${prefix}_closing_home_cover_disagreement`]: null,
    [`shadow_vs_${prefix}_closing_away_cover_disagreement`]: null,
  };
  const sourcePrefix = prefix === "us" ? "us" : "pinnacle";
  const homeMlFair = safeProbability(close[`${sourcePrefix}_market_fair_home_win_probability`]);
  const awayMlFair = safeProbability(close[`${sourcePrefix}_market_fair_away_win_probability`]);
  const homeSpread = finite(close[`${sourcePrefix}_home_spread`]);
  const awaySpread = finite(close[`${sourcePrefix}_away_spread`]);
  const homeCoverFair = safeProbability(close[`${sourcePrefix}_market_fair_home_cover_probability`]);
  const awayCoverFair = safeProbability(close[`${sourcePrefix}_market_fair_away_cover_probability`]);
  const capturedHomeSpread = finite(shadow.home_spread);
  const capturedAwaySpread = finite(shadow.away_spread);
  const capturedHomeFair = safeProbability(shadow.market_fair_home_win_probability);
  const capturedAwayFair = safeProbability(shadow.market_fair_away_win_probability);
  const shadowHomeWin = safeProbability(shadow.home_win_probability);
  const shadowAwayWin = safeProbability(shadow.away_win_probability);
  const shadowHomeCover = safeProbability(shadow.home_cover_probability);
  const shadowAwayCover = safeProbability(shadow.away_cover_probability);
  return {
    [`${prefix}_closing_observation_id`]: close.id,
    [`${prefix}_closing_home_ml_fair_probability`]: homeMlFair,
    [`${prefix}_closing_away_ml_fair_probability`]: awayMlFair,
    [`${prefix}_closing_home_spread`]: homeSpread,
    [`${prefix}_closing_away_spread`]: awaySpread,
    [`${prefix}_closing_home_cover_fair_probability`]: homeCoverFair,
    [`${prefix}_closing_away_cover_fair_probability`]: awayCoverFair,
    [`${prefix}_home_spread_clv_points`]: capturedHomeSpread == null || homeSpread == null ? null : round(capturedHomeSpread - homeSpread),
    [`${prefix}_away_spread_clv_points`]: capturedAwaySpread == null || awaySpread == null ? null : round(capturedAwaySpread - awaySpread),
    [`${prefix}_home_ml_market_move`]: capturedHomeFair == null || homeMlFair == null ? null : round(homeMlFair - capturedHomeFair),
    [`${prefix}_away_ml_market_move`]: capturedAwayFair == null || awayMlFair == null ? null : round(awayMlFair - capturedAwayFair),
    [`shadow_vs_${prefix}_closing_home_ml_disagreement`]: shadowHomeWin == null || homeMlFair == null ? null : round(shadowHomeWin - homeMlFair),
    [`shadow_vs_${prefix}_closing_away_ml_disagreement`]: shadowAwayWin == null || awayMlFair == null ? null : round(shadowAwayWin - awayMlFair),
    [`shadow_vs_${prefix}_close_points`]: finite(shadow.projected_home_margin) == null || homeSpread == null
      ? null : round(finite(shadow.projected_home_margin) + homeSpread),
    [`shadow_vs_${prefix}_closing_home_cover_disagreement`]: shadowHomeCover == null || homeCoverFair == null
      ? null : round(shadowHomeCover - homeCoverFair),
    [`shadow_vs_${prefix}_closing_away_cover_disagreement`]: shadowAwayCover == null || awayCoverFair == null
      ? null : round(shadowAwayCover - awayCoverFair),
  };
}

function buildEvaluation(shadow, resultGame, closes = {}, evaluatedAt = new Date().toISOString()) {
  const match = exactFinalMatch(shadow, [resultGame]);
  if (!match.game) throw new Error(match.reason);
  const finalHome = finite(match.game.home.score), finalAway = finite(match.game.away.score);
  const actualHomeMargin = finalHome - finalAway;
  const homeWinActual = actualHomeMargin === 0 ? null : (actualHomeMargin > 0 ? 1 : 0);
  const homeWinProbability = safeProbability(shadow.home_win_probability);
  const mlBrier = homeWinActual == null || homeWinProbability == null
    ? null : round((homeWinProbability - homeWinActual) ** 2);
  const projectedHomeMargin = finite(shadow.projected_home_margin);
  const marginError = round(actualHomeMargin - projectedHomeMargin);
  const ats = atsOutcome(actualHomeMargin, shadow.home_spread);
  const homeCoverProbability = safeProbability(shadow.home_cover_probability);
  const spreadBrier = ats.homeActual == null || homeCoverProbability == null
    ? null : round((homeCoverProbability - ats.homeActual) ** 2);
  const us = closeMetrics(shadow, closes.us || null, "us");
  const pinnacle = closeMetrics(shadow, closes.pinnacle || null, "pinnacle");

  const metricSemantic = {
    shadowPredictionId: shadow.id,
    evaluationVersion: EVALUATION_VERSION,
    resultGameId: String(match.game.gameId),
    finalHome,
    finalAway,
    usClose: closes.us?.id || null,
    pinnacleClose: closes.pinnacle?.id || null,
  };
  return {
    shadow_prediction_id: shadow.id,
    evaluation_version: EVALUATION_VERSION,
    evaluated_at: new Date(evaluatedAt).toISOString(),
    result_source: RESULT_SOURCE,
    result_game_id: String(match.game.gameId),
    result_scheduled_at: new Date(match.game.date).toISOString(),
    result_home_espn_team_id: String(match.game.home.id),
    result_away_espn_team_id: String(match.game.away.id),
    result_status: "final",
    final_home_score: finalHome,
    final_away_score: finalAway,
    actual_home_margin: actualHomeMargin,
    home_win_actual: homeWinActual,
    source_home_win_probability: homeWinProbability,
    source_projected_home_margin: projectedHomeMargin,
    source_home_spread: finite(shadow.home_spread),
    source_home_cover_probability: homeCoverProbability,
    source_away_cover_probability: safeProbability(shadow.away_cover_probability),
    source_spread_push_probability: safeProbability(shadow.spread_push_probability),
    brier_ml: mlBrier,
    log_loss_ml: homeWinActual == null ? null : logLoss(homeWinProbability, homeWinActual),
    margin_error: marginError,
    margin_absolute_error: marginError == null ? null : round(Math.abs(marginError)),
    margin_squared_error: marginError == null ? null : round(marginError ** 2),
    ats_home_result_value: ats.value,
    ats_result: ats.result,
    spread_home_actual_decisive: ats.homeActual,
    brier_spread_decisive: spreadBrier,
    log_loss_spread_decisive: ats.homeActual == null ? null : logLoss(homeCoverProbability, ats.homeActual),
    ...us,
    ...pinnacle,
    metric_fingerprint: sha256(metricSemantic),
  };
}

async function captureCfbGameShadowClosingObservations(supabase, {
  usEvents = [], pinnacleEvents = [], capturedAt = new Date().toISOString(),
} = {}) {
  const stats = { candidates: 0, inserted: 0, skipped: 0, errors: 0 };
  const eventIds = [...new Set((usEvents || []).map((event) => event?.eventId).filter((id) => id != null).map(String))];
  if (!eventIds.length) return stats;
  const { data, error } = await supabase
    .from("cfb_game_shadow_predictions")
    .select(SHADOW_SELECT)
    .in("game_id", eventIds)
    .gt("kickoff_at", capturedAt);
  if (error) throw new Error(error.message);
  const shadows = data || [];
  stats.candidates = shadows.length;
  const inputIds = [...new Set(shadows.map((row) => row.input_snapshot_id).filter((id) => id != null))];
  const inputById = new Map();
  if (inputIds.length) {
    const { data: inputs, error: inputError } = await supabase
      .from("cfb_game_input_snapshots")
      .select("id,game_context")
      .in("id", inputIds);
    if (inputError) throw new Error(inputError.message);
    for (const input of inputs || []) inputById.set(String(input.id), input.game_context || null);
  }
  const byEvent = new Map((usEvents || []).map((event) => [String(event.eventId), event]));
  const rows = [];
  for (const shadow of shadows) {
    const row = buildClosingObservation(
      shadow,
      byEvent.get(String(shadow.game_id)),
      pinnacleEvents,
      capturedAt,
      inputById.get(String(shadow.input_snapshot_id)) || null,
    );
    if (row) rows.push(row); else stats.skipped++;
  }
  if (!rows.length) return stats;
  const { error: insertError } = await supabase
    .from("cfb_game_shadow_closing_observations")
    .upsert(rows, { onConflict: "shadow_prediction_id,quote_at", ignoreDuplicates: true });
  if (insertError) { stats.errors = rows.length; throw new Error(insertError.message); }
  stats.inserted = rows.length;
  return stats;
}

function uniqueScoreboardGames(games) {
  const out = new Map();
  for (const game of games || []) {
    const key = String(game?.gameId || "");
    if (key) out.set(key, game);
  }
  return [...out.values()];
}

async function fetchAllPaged(build, { pageSize = 1000, maxPages = 20 } = {}) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build().range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  throw new Error(`CFB shadow evaluation paging exceeded ${maxPages * pageSize} rows`);
}

async function fetchClosingObservations(supabase, shadowIds) {
  const rows = [];
  const chunkSize = 200;
  for (let offset = 0; offset < shadowIds.length; offset += chunkSize) {
    const ids = shadowIds.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("cfb_game_shadow_closing_observations")
      .select("*")
      .in("shadow_prediction_id", ids)
      .order("quote_at", { ascending: true });
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return rows;
}

async function evaluateCfbGameShadowsFromScoreboard(supabase, {
  scoreboardGames = [], evaluatedAt = new Date().toISOString(),
} = {}) {
  const stats = { candidates: 0, evaluated: 0, noExactFinal: 0, notFinal: 0, errors: 0 };
  const games = uniqueScoreboardGames(scoreboardGames);
  if (!games.length) return stats;

  const existing = await fetchAllPaged(() => supabase
    .from("cfb_game_shadow_evaluations")
    .select("shadow_prediction_id")
    .order("shadow_prediction_id", { ascending: true }));
  const done = new Set(existing.map((row) => String(row.shadow_prediction_id)));
  const predictions = await fetchAllPaged(() => supabase
    .from("cfb_game_shadow_predictions")
    .select(SHADOW_SELECT)
    .lte("kickoff_at", evaluatedAt)
    .order("kickoff_at", { ascending: true })
    .order("id", { ascending: true }));
  const shadows = predictions.filter((row) => !done.has(String(row.id)));
  stats.candidates = shadows.length;
  if (!shadows.length) return stats;

  const ids = shadows.map((row) => row.id);
  const observations = await fetchClosingObservations(supabase, ids);
  const closesByShadow = new Map();
  for (const row of observations || []) {
    const key = String(row.shadow_prediction_id);
    if (!closesByShadow.has(key)) closesByShadow.set(key, []);
    closesByShadow.get(key).push(row);
  }

  const rows = [];
  for (const shadow of shadows) {
    const match = exactFinalMatch(shadow, games);
    if (!match.game) {
      if (match.reason === "not-final") stats.notFinal++;
      else stats.noExactFinal++;
      continue;
    }
    const closes = selectLatestCloses(closesByShadow.get(String(shadow.id)) || [], shadow.kickoff_at);
    try { rows.push(buildEvaluation(shadow, match.game, closes, evaluatedAt)); }
    catch (_) { stats.errors++; }
  }
  if (!rows.length) return stats;
  const { error: insertError } = await supabase
    .from("cfb_game_shadow_evaluations")
    .upsert(rows, { onConflict: "shadow_prediction_id", ignoreDuplicates: true });
  if (insertError) { stats.errors += rows.length; throw new Error(insertError.message); }
  stats.evaluated = rows.length;
  return stats;
}

module.exports = {
  EVALUATION_VERSION,
  CLOSING_OBSERVATION_VERSION,
  captureCfbGameShadowClosingObservations,
  evaluateCfbGameShadowsFromScoreboard,
  _internal: {
    LOG_EPSILON,
    SCOREBOARD_KICKOFF_TOLERANCE_MS,
    finite,
    logLoss,
    buildClosingObservation,
    selectLatestCloses,
    exactFinalMatch,
    atsOutcome,
    closeMetrics,
    buildEvaluation,
    uniqueScoreboardGames,
    fetchAllPaged,
  },
};
