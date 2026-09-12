const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { predictGame } = require("./nflModel");
const { getNflGameWeather } = require("./nflWeatherContext");
const {
  buildNflContext,
  selectPredictionRows,
  selectPreviousContexts,
  persistContexts,
} = require("./footballWeeklyContext");
const { collectFootballNewsForGames } = require("./footballNewsContext");

const CONTEXT_TABLE = "nfl_injury_weather_context_snapshots";
const PREDICTION_TABLE = "nfl_injury_weather_shadow_predictions";
const CONTEXT_VERSION = "nfl-injury-weather-context-v1-2026-09-08";
const MODEL_VERSION = "nfl-game-control-30-70-v1-2026-09-08";
const EXPERIMENT_VERSION = "nfl-injury-weather-shadow-v1-2026-09-08";

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function probability(value) {
  const n = finite(value);
  return n == null ? null : n / 100;
}

function etDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  catch (_) { return null; }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function teamAvailabilitySummary(players) {
  const relevant = (players || []).filter((row) => row && (row.reportedInjury || row.rosterActive === false));
  const byUnit = {};
  for (const row of relevant) byUnit[row.unit] = (byUnit[row.unit] || 0) + 1;
  return {
    rosterPlayersCaptured: (players || []).length,
    coverageStatus: (players || []).length ? "captured" : "missing-team-roster",
    availabilityConcerns: relevant.length,
    clearlyUnavailable: relevant.filter((row) => row.clearlyUnavailable).length,
    uncertain: relevant.filter((row) => row.uncertain).length,
    byUnit,
    importanceComplete: relevant.length > 0
      && relevant.every((row) => row.importanceStatus === "complete"),
    replacementComplete: relevant.length > 0
      && relevant.every((row) => row.replacementStatus === "complete"),
  };
}

// This first collector deliberately has no injury/weather point coefficients.
// ESPN does not supply replacement value and the audit found no validated fit.
// Raw evidence is frozen now; an effect remains zero until a separately reviewed,
// held-out fit can supply a defensible point adjustment.
function deriveEvidenceAdjustments({ homeAvailability, awayAvailability, weather }) {
  const home = teamAvailabilitySummary(homeAvailability);
  const away = teamAvailabilitySummary(awayAvailability);
  const skipped = [];
  if (home.availabilityConcerns && (!home.importanceComplete || !home.replacementComplete)) {
    skipped.push("home-injury-impact-missing-importance-or-replacement-value");
  }
  if (away.availabilityConcerns && (!away.importanceComplete || !away.replacementComplete)) {
    skipped.push("away-injury-impact-missing-importance-or-replacement-value");
  }
  if (weather?.available && weather.indoor !== true) {
    skipped.push("weather-impact-coefficients-not-yet-fitted");
  }
  if (weather?.available !== true) skipped.push(`weather-${weather?.reason || "unavailable"}`);
  return {
    method: "capture-only-unfitted-v1",
    applied: false,
    homeRatingDelta: 0,
    awayRatingDelta: 0,
    homeTeamPointsDelta: 0,
    awayTeamPointsDelta: 0,
    home,
    away,
    skipped,
  };
}

// The challenger boundary is intentionally narrow: only the independent ratings
// and projected team points may move. predictGame then performs the existing
// key-number conversion, 30/70 market blend, thresholds and selection unchanged.
function applyIndependentAdjustments(baseContext, adjustments) {
  const next = clone(baseContext || {});
  if (next.home?.rating != null) next.home.rating += finite(adjustments?.homeRatingDelta) || 0;
  if (next.away?.rating != null) next.away.rating += finite(adjustments?.awayRatingDelta) || 0;
  if (next.home?.projPoints != null) next.home.projPoints += finite(adjustments?.homeTeamPointsDelta) || 0;
  if (next.away?.projPoints != null) next.away.projPoints += finite(adjustments?.awayTeamPointsDelta) || 0;
  return next;
}

function marketSnapshot(event) {
  return {
    eventId: event?.eventId == null ? null : String(event.eventId),
    commenceTime: event?.commenceTime || null,
    awayTeam: event?.awayTeam || null,
    homeTeam: event?.homeTeam || null,
    h2h: clone(event?.h2h || null),
    spreads: clone(event?.spreads || null),
    totals: clone(event?.totals || null),
    h2hQuotes: clone(event?.h2hQuotes || null),
    oddsGrid: clone(event?.oddsGrid || null),
  };
}

function fixedReferenceRows({ event, control, challenger, controlContext, challengerContext }) {
  const rows = [];
  if (control.moneyline && challenger.moneyline) {
    rows.push({
      market: "moneyline", referenceSide: "home", marketLine: null,
      entryPrice: finite(event?.h2h?.home), marketFairProb: probability(control.moneyline.fair?.home),
      controlProjection: finite(control.moneyline.modelMargin),
      challengerProjection: finite(challenger.moneyline.modelMargin),
      controlRawProb: probability(control.moneyline.modelHomeWinProb),
      challengerRawProb: probability(challenger.moneyline.modelHomeWinProb),
      controlPublishedProb: probability(control.moneyline.homeWinProb),
      challengerPublishedProb: probability(challenger.moneyline.homeWinProb),
      controlOutput: control.moneyline, challengerOutput: challenger.moneyline,
    });
  }
  if (control.spread && challenger.spread) {
    rows.push({
      market: "spread", referenceSide: "home", marketLine: finite(event?.spreads?.homeLine),
      entryPrice: finite(event?.spreads?.home), marketFairProb: probability(control.spread.fair?.home),
      controlProjection: finite(control.moneyline?.modelMargin),
      challengerProjection: finite(challenger.moneyline?.modelMargin),
      controlRawProb: null, challengerRawProb: null,
      controlPublishedProb: probability(control.spread.homeCoverProb),
      challengerPublishedProb: probability(challenger.spread.homeCoverProb),
      controlOutput: control.spread, challengerOutput: challenger.spread,
    });
  }
  if (control.total && challenger.total) {
    rows.push({
      market: "total", referenceSide: "over", marketLine: finite(event?.totals?.line),
      entryPrice: finite(event?.totals?.over), marketFairProb: probability(control.total.fair?.over),
      controlProjection: finite(control.total.projTotal),
      challengerProjection: finite(challenger.total.projTotal),
      controlRawProb: null, challengerRawProb: null,
      controlPublishedProb: probability(control.total.overProb),
      challengerPublishedProb: probability(challenger.total.overProb),
      controlOutput: control.total, challengerOutput: challenger.total,
    });
  }
  for (const side of ["home", "away"]) {
    rows.push({
      market: `${side}_team_points`, referenceSide: side, marketLine: null,
      entryPrice: null, marketFairProb: null,
      controlProjection: finite(controlContext?.[side]?.projPoints),
      challengerProjection: finite(challengerContext?.[side]?.projPoints),
      controlRawProb: null, challengerRawProb: null,
      controlPublishedProb: null, challengerPublishedProb: null,
      controlOutput: null, challengerOutput: null,
    });
  }
  return rows;
}

function buildComparison({ game, availability = [], availabilityMeta = {}, weather, predictionAt }) {
  const input = game?._injuryWeatherShadowInput;
  const event = input?.event;
  const baseContext = input?.baseContext;
  const espnGame = input?.espnGame || null;
  if (!event?.eventId || !event?.commenceTime || !baseContext?.home || !baseContext?.away) return null;

  const homeTeamId = espnGame?.home?.id == null ? null : String(espnGame.home.id);
  const awayTeamId = espnGame?.away?.id == null ? null : String(espnGame.away.id);
  const homeAvailability = homeTeamId
    ? availability.filter((row) => String(row.teamId) === homeTeamId).map(clone) : [];
  const awayAvailability = awayTeamId
    ? availability.filter((row) => String(row.teamId) === awayTeamId).map(clone) : [];
  const adjustments = deriveEvidenceAdjustments({ homeAvailability, awayAvailability, weather });
  if (!homeAvailability.length) adjustments.skipped.push("home-availability-roster-unavailable");
  if (!awayAvailability.length) adjustments.skipped.push("away-availability-roster-unavailable");
  const challengerContext = applyIndependentAdjustments(baseContext, adjustments);
  const control = predictGame(event, clone(baseContext));
  const challenger = predictGame(event, challengerContext);
  const market = marketSnapshot(event);
  const contextPayload = {
    eventId: String(event.eventId),
    predictionAt,
    marketCapturedAt: input.marketCapturedAt || predictionAt,
    contextVersion: CONTEXT_VERSION,
    modelVersion: MODEL_VERSION,
    experimentVersion: EXPERIMENT_VERSION,
    espnGameId: espnGame?.gameId == null ? null : String(espnGame.gameId),
    commenceAt: event.commenceTime,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    homeTeamId,
    awayTeamId,
    venue: clone(espnGame?.venue || null),
    market,
    baseContext: clone(baseContext),
    homeAvailability,
    awayAvailability,
    availabilityCollection: clone(availabilityMeta || {}),
    weather: clone(weather || null),
    adjustments,
  };
  const contextRow = {
    event_id: contextPayload.eventId,
    game_date: etDate(event.commenceTime),
    commence_at: event.commenceTime,
    prediction_at: predictionAt,
    market_captured_at: contextPayload.marketCapturedAt,
    espn_game_id: contextPayload.espnGameId,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    home_team: event.homeTeam,
    away_team: event.awayTeam,
    venue_id: espnGame?.venue?.id || null,
    venue_name: espnGame?.venue?.name || null,
    indoor: espnGame?.venue?.indoor ?? null,
    market_snapshot: market,
    base_model_context: clone(baseContext),
    home_availability: homeAvailability,
    away_availability: awayAvailability,
    availability_collection: clone(availabilityMeta || {}),
    weather_context: clone(weather || null),
    adjustment_context: adjustments,
    context_version: CONTEXT_VERSION,
    model_version: MODEL_VERSION,
    experiment_version: EXPERIMENT_VERSION,
    input_fingerprint: fingerprint(contextPayload),
  };
  const comparisonRows = fixedReferenceRows({ event, control, challenger, controlContext: baseContext, challengerContext })
    .map((row) => ({
      event_id: String(event.eventId),
      game_date: etDate(event.commenceTime),
      commence_at: event.commenceTime,
      prediction_at: predictionAt,
      market: row.market,
      reference_side: row.referenceSide,
      market_line: row.marketLine,
      entry_price: row.entryPrice,
      market_fair_prob: row.marketFairProb,
      control_projection: row.controlProjection,
      challenger_projection: row.challengerProjection,
      control_raw_prob: row.controlRawProb,
      challenger_raw_prob: row.challengerRawProb,
      control_published_prob: row.controlPublishedProb,
      challenger_published_prob: row.challengerPublishedProb,
      control_signed_edge: row.controlPublishedProb == null || row.marketFairProb == null
        ? null : row.controlPublishedProb - row.marketFairProb,
      challenger_signed_edge: row.challengerPublishedProb == null || row.marketFairProb == null
        ? null : row.challengerPublishedProb - row.marketFairProb,
      control_output: clone(row.controlOutput),
      challenger_output: clone(row.challengerOutput),
      adjustment_applied: adjustments.applied,
      adjustment_status: adjustments.method,
      model_version: MODEL_VERSION,
      experiment_version: EXPERIMENT_VERSION,
    }));
  return { contextRow, comparisonRows, control, challenger, adjustments };
}

async function insertComparison(supabase, comparison) {
  const contextWrite = await supabase.from(CONTEXT_TABLE)
    .upsert(comparison.contextRow, {
      onConflict: "event_id,prediction_at,context_version",
      ignoreDuplicates: true,
    });
  if (contextWrite.error) throw new Error(contextWrite.error.message);
  // Read the immutable row after ON CONFLICT DO NOTHING. This makes a retry after
  // a partial process failure reuse the first snapshot rather than overwrite it.
  const contextResponse = await supabase.from(CONTEXT_TABLE)
    .select("id")
    .eq("event_id", comparison.contextRow.event_id)
    .eq("prediction_at", comparison.contextRow.prediction_at)
    .eq("context_version", comparison.contextRow.context_version)
    .single();
  if (contextResponse.error) throw new Error(contextResponse.error.message);
  const contextId = contextResponse.data?.id;
  if (contextId == null) throw new Error("NFL injury/weather context insert returned no id");
  const rows = comparison.comparisonRows.map((row) => ({ ...row, context_snapshot_id: contextId }));
  const predictionResponse = await supabase.from(PREDICTION_TABLE)
    .upsert(rows, { onConflict: "context_snapshot_id,market", ignoreDuplicates: true });
  if (predictionResponse.error) throw new Error(predictionResponse.error.message);
  return rows.length;
}

async function collectNflInjuryWeatherShadow({
  slate,
  availability = [],
  availabilityMeta = {},
  predictionAt = new Date().toISOString(),
  supabase = db(),
  weatherFetcher = getNflGameWeather,
  weeklyContextStore = { selectPredictionRows, selectPreviousContexts, persistContexts },
  newsCollector = collectFootballNewsForGames,
} = {}) {
  const games = Array.isArray(slate?.games) ? slate.games : [];
  const eventIds = games.map((game) => String(game?._injuryWeatherShadowInput?.event?.eventId || "")).filter(Boolean);
  let newsResult = {
    capturedAt: predictionAt, byEvent: {},
    meta: { available: false, reason: "news-source-unavailable" },
  };
  const weeklyNewsErrors = [];
  try {
    newsResult = await newsCollector({ league: "nfl", records: games, availability });
  } catch (error) {
    weeklyNewsErrors.push(error.message);
  }
  const newsCapturedMs = Date.parse(newsResult?.capturedAt);
  const predictionMs = Date.parse(predictionAt);
  const weeklyCapturedAt = Number.isFinite(newsCapturedMs) && newsCapturedMs > predictionMs
    ? new Date(newsCapturedMs).toISOString() : predictionAt;
  let predictionRows = [];
  let previousContexts = {};
  const weeklyContextErrors = [];
  try {
    [predictionRows, previousContexts] = await Promise.all([
      weeklyContextStore.selectPredictionRows(supabase, "nfl", eventIds),
      weeklyContextStore.selectPreviousContexts(supabase, "nfl", eventIds, weeklyCapturedAt),
    ]);
  } catch (error) {
    weeklyContextErrors.push({ stage: "context-input-read", error: error.message });
  }
  let contextsRecorded = 0;
  let comparisonsRecorded = 0;
  let weeklyContextsRecorded = 0;
  let skipped = 0;
  const errors = [];
  for (const game of games) {
    const input = game?._injuryWeatherShadowInput;
    if (!input?.event?.commenceTime || new Date(input.event.commenceTime).getTime() <= Date.now()) {
      skipped++;
      continue;
    }
    try {
      const weather = await weatherFetcher(input.espnGame, { capturedAt: predictionAt });
      const comparison = buildComparison({ game, availability, availabilityMeta, weather, predictionAt });
      if (!comparison) { skipped++; continue; }
      comparisonsRecorded += await insertComparison(supabase, comparison);
      contextsRecorded++;
      if (!weeklyContextErrors.length) {
        try {
          const context = buildNflContext({
            game,
            comparison,
            predictionRows,
            previousContext: previousContexts[String(input.event.eventId)] || null,
            capturedAt: weeklyCapturedAt,
            newsItems: newsResult?.byEvent?.[String(input.event.eventId)] || [],
            newsMeta: newsResult?.meta || null,
          });
          if (context) {
            await weeklyContextStore.persistContexts(supabase, [context]);
            weeklyContextsRecorded++;
          }
        } catch (error) {
          weeklyContextErrors.push({ eventId: String(input.event.eventId), error: error.message });
        }
      }
    } catch (error) {
      errors.push({ eventId: String(input?.event?.eventId || "unknown"), error: error.message });
    }
  }
  return {
    contextsRecorded, comparisonsRecorded, weeklyContextsRecorded, skipped, errors,
    weeklyContextErrors, weeklyNewsErrors,
  };
}

module.exports = {
  CONTEXT_TABLE,
  PREDICTION_TABLE,
  CONTEXT_VERSION,
  MODEL_VERSION,
  EXPERIMENT_VERSION,
  deriveEvidenceAdjustments,
  applyIndependentAdjustments,
  buildComparison,
  collectNflInjuryWeatherShadow,
  _internal: { finite, probability, etDate, stable, fingerprint, teamAvailabilitySummary, marketSnapshot, fixedReferenceRows, insertComparison },
};
