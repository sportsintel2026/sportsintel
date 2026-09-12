const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
let axiosHandler = async () => { throw new Error("unexpected live axios call"); };
const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "axios") return { get: (...args) => axiosHandler(...args) };
  if (request === "@supabase/supabase-js") return { createClient: () => ({}) };
  return originalLoad(request, parent, isMain);
};
const { extractNflAvailability, attachUsageContext } = require("./nflAvailability");
const { getWeatherForVenue } = require("./weatherApi");
const { getNflGameWeather } = require("./nflWeatherContext");
const {
  CONTEXT_TABLE,
  PREDICTION_TABLE,
  MODEL_VERSION,
  EXPERIMENT_VERSION,
  applyIndependentAdjustments,
  buildComparison,
  collectNflInjuryWeatherShadow,
} = require("./nflInjuryWeatherShadow");
Module._load = originalLoad;

function athlete(id, position, status = null) {
  return {
    id: String(id),
    fullName: `Player ${id}`,
    position: { abbreviation: position },
    active: status !== "Out",
    injuries: status ? [{ status, details: { type: "Knee", detail: "Structured report" } }] : [],
  };
}

const expectedUnits = {
  QB: "quarterback", RB: "backfield", WR: "receiver", TE: "receiver",
  LT: "offensive_line", DE: "defensive_front", LB: "linebacker",
  CB: "secondary", S: "secondary", K: "specialist", P: "specialist",
};
for (const [position, unit] of Object.entries(expectedUnits)) {
  const row = extractNflAvailability(athlete(position, position), {
    id: "1", displayName: "Home Team", abbreviation: "HOM",
  });
  assert.equal(row.unit, unit, `${position} is captured by the shared exact-ID extractor`);
  assert.equal(row.importanceStatus, "unavailable");
  assert.equal(row.replacementStatus, "unavailable");
}
const injured = extractNflAvailability(athlete("qb-1", "QB", "Questionable"), {
  id: "1", displayName: "Home Team", abbreviation: "HOM",
});
assert.equal(injured.playerId, "qb-1");
assert.equal(injured.status, "questionable");
assert.equal(injured.uncertain, true);
assert.equal(injured.bodyPart, "Knee");
const withUsage = attachUsageContext([injured], [{
  id: "qb-1", season2025: { gamesPlayed: 17, passAtt: 520, rushAtt: 45, targets: 0, rushTds: 3, recTds: 0 },
}], 2025)[0];
assert.equal(withUsage.roleUsage.passAttempts, 520);
assert.equal(withUsage.roleUsage.sourceSeason, 2025);
assert.equal(withUsage.importanceStatus, "partial-usage-only", "usage is evidence, not a guessed point value");
assert.equal(withUsage.replacementStatus, "unavailable");

function gameFixture() {
  const event = {
    eventId: "odds-event-1",
    commenceTime: "2099-09-13T17:00:00Z",
    awayTeam: "Away Team",
    homeTeam: "Home Team",
    h2h: { home: -125, away: 110 },
    spreads: { homeLine: -2.5, awayLine: 2.5, home: -108, away: -112 },
    totals: { line: 46.5, over: -105, under: -115 },
    h2hQuotes: [{ book: "Book A", home: -125, away: 110 }],
  };
  const baseContext = {
    home: { rating: 3.5, projPoints: 25.1 },
    away: { rating: -0.5, projPoints: 21.2 },
  };
  const game = {};
  Object.defineProperty(game, "_injuryWeatherShadowInput", {
    enumerable: false,
    value: {
      event,
      baseContext,
      marketCapturedAt: "2099-09-08T16:00:00Z",
      espnGame: {
        gameId: "espn-game-1",
        date: event.commenceTime,
        venue: { id: "venue-1", name: "Lambeau Field", indoor: false },
        home: { id: "1", displayName: "Home Team" },
        away: { id: "2", displayName: "Away Team" },
      },
    },
  });
  return game;
}

const availability = [
  injured,
  extractNflAvailability(athlete("away-lt", "LT", "Out"), {
    id: "2", displayName: "Away Team", abbreviation: "AWY",
  }),
];
const weather = {
  available: true, source: "open-meteo-cached-game-time", indoor: false,
  tempF: 44, windMph: 18, precipitation: 0.4, weatherCode: 63,
  severeCondition: null, forecastAtGameTime: true,
};
const predictionAt = "2099-09-08T16:05:00Z";
const availabilityMeta = { source: "espn-roster-athlete-id", roleUsageSeason: 2025, teamsProbed: 32, statErrors: 0 };
const comparison = buildComparison({ game: gameFixture(), availability, availabilityMeta, weather, predictionAt });
assert.ok(comparison);
assert.equal(comparison.comparisonRows.length, 5, "ML/spread/total and two team-point comparisons are frozen together");
assert.equal(comparison.contextRow.espn_game_id, "espn-game-1");
assert.equal(comparison.contextRow.venue_id, "venue-1");
assert.equal(comparison.contextRow.home_availability[0].playerId, "qb-1");
assert.deepEqual(comparison.contextRow.availability_collection, availabilityMeta);
assert.equal(comparison.adjustments.applied, false);
assert.ok(comparison.adjustments.skipped.includes("weather-impact-coefficients-not-yet-fitted"));
assert.deepEqual(comparison.control, comparison.challenger, "unfitted context never invents a model adjustment");
for (const row of comparison.comparisonRows) {
  assert.equal(row.controlProjection, row.challengerProjection);
  assert.equal(row.controlPublishedProb, row.challengerPublishedProb);
}
assert.equal(MODEL_VERSION, "nfl-game-control-30-70-v1-2026-09-08");
assert.equal(EXPERIMENT_VERSION, "nfl-injury-weather-shadow-v1-2026-09-08");

const adjusted = applyIndependentAdjustments({
  home: { rating: 3.5, projPoints: 25.1 }, away: { rating: -0.5, projPoints: 21.2 }, neutralSite: true,
}, { homeRatingDelta: -1, awayRatingDelta: 0.5, homeTeamPointsDelta: -0.7, awayTeamPointsDelta: 0.2 });
assert.equal(adjusted.home.rating, 2.5);
assert.ok(Math.abs(adjusted.home.projPoints - 24.4) < 1e-9);
assert.equal(adjusted.away.rating, 0);
assert.equal(adjusted.away.projPoints, 21.4);
assert.equal(adjusted.neutralSite, true, "the challenger seam preserves every non-independent context field");

(async () => {
  axiosHandler = async (_url, request) => {
    assert.equal(request.params.forecast_days, undefined, "the existing no-kickoff MLB request stays current-only");
    return { data: { current: {
      temperature_2m: 82, wind_speed_10m: 12, wind_direction_10m: 180,
      precipitation: 0, weather_code: 0,
    } } };
  };
  const mlbWeather = await getWeatherForVenue("Coors Field", null);
  assert.equal(mlbWeather.windEffect, "out", "the existing MLB orientation behavior is unchanged");
  assert.match(mlbWeather.summary, /Wind OUT/);

  let weatherCalls = 0;
  const indoor = await getNflGameWeather({
    date: "2099-09-13T17:00:00Z",
    venue: { id: "indoor-1", name: "Ford Field", indoor: true },
  }, { weatherFetcher: async () => { weatherCalls++; return null; }, capturedAt: predictionAt });
  assert.equal(indoor.indoor, true);
  assert.equal(weatherCalls, 0, "indoor handling never calls Open-Meteo");

  const outdoor = await getNflGameWeather({
    date: "2099-09-13T17:00:00Z",
    venue: { id: "venue-1", name: "Lambeau Field", indoor: false },
  }, {
    capturedAt: predictionAt,
    weatherFetcher: async (_name, _kickoff, options) => {
      weatherCalls++;
      assert.equal(options.forecastDays, 8);
      return { forecastAtGameTime: true, tempF: 44, windMph: 18, precipitation: 0.4, weatherCode: 63, severeCondition: null, conditions: "Rain" };
    },
  });
  assert.equal(outdoor.available, true);
  assert.equal(outdoor.windMph, 18);
  assert.equal(outdoor.precipitation, 0.4);
  assert.equal(weatherCalls, 1);

  const writes = new Map();
  const supabase = {
    from(table) {
      return {
        upsert(payload) {
          const rows = Array.isArray(payload) ? payload : [payload];
          const current = writes.get(table) || [];
          for (const row of rows) {
            const duplicate = table === CONTEXT_TABLE
              ? current.some((existing) => existing.event_id === row.event_id
                && existing.prediction_at === row.prediction_at
                && existing.context_version === row.context_version)
              : current.some((existing) => existing.context_snapshot_id === row.context_snapshot_id
                && existing.market === row.market);
            if (!duplicate) current.push(table === CONTEXT_TABLE ? { ...row, id: 41 } : row);
          }
          writes.set(table, current);
          return Promise.resolve({ error: null });
        },
        select() {
          const filters = [];
          const query = {
            eq(column, value) { filters.push([column, value]); return query; },
            async single() {
              const row = (writes.get(table) || []).find((candidate) => filters.every(([column, value]) => candidate[column] === value));
              return row ? { data: { id: row.id }, error: null } : { data: null, error: { message: "not found" } };
            },
          };
          return query;
        },
      };
    },
  };
  let collectorWeatherCalls = 0;
  let weeklyContextRows = [];
  const weeklyContextStore = {
    selectPredictionRows: async () => [{
      game_id: "odds-event-1", game_date: "2099-09-13", league: "nfl",
      market: "spread", selection: "Home Team -2.5", snapshotted_at: predictionAt,
    }],
    selectPreviousContexts: async () => ({}),
    persistContexts: async (_db, rows) => { weeklyContextRows.push(...rows); return { attempted: rows.length }; },
  };
  const newsCollector = async () => ({
    capturedAt: predictionAt,
    byEvent: { "odds-event-1": [{
      newsId: "nfl-news-1", source: "espn", publishedAt: "2099-09-08T15:00:00Z",
      capturedAt: predictionAt, eventId: "odds-event-1", espnGameId: "espn-game-1",
      teamId: "1", teamName: "Home Team", playerId: "qb-1", playerName: "Player qb-1",
      position: "QB", unit: "quarterback", category: "injury/status update",
      statusChange: "questionable", confidence: "high", confirmed: false,
      unresolved: true, contextImpact: "unresolved", identityMethod: "espn-event-id+espn-team-id+espn-athlete-id",
    }] },
    meta: { available: true, received: 1, resolved: 1 },
  });
  const result = await collectNflInjuryWeatherShadow({
    slate: { games: [gameFixture()] },
    availability,
    availabilityMeta,
    predictionAt,
    supabase,
    weatherFetcher: async () => { collectorWeatherCalls++; return weather; },
    weeklyContextStore,
    newsCollector,
  });
  assert.deepEqual(result, {
    contextsRecorded: 1, comparisonsRecorded: 5, weeklyContextsRecorded: 1,
    skipped: 0, errors: [], weeklyContextErrors: [], weeklyNewsErrors: [],
  });
  assert.equal(weeklyContextRows.length, 1);
  assert.equal(weeklyContextRows[0].prediction_keys.length, 1);
  assert.equal(weeklyContextRows[0].structured_context.newsContext.items.length, 1);
  assert.equal(collectorWeatherCalls, 1, "one game produces one cached weather lookup, not one per challenger market");
  assert.equal((writes.get(CONTEXT_TABLE) || []).length, 1);
  assert.equal((writes.get(PREDICTION_TABLE) || []).length, 5);
  assert.deepEqual([...new Set(writes.get(PREDICTION_TABLE).map((row) => row.context_snapshot_id))], [41]);
  const duplicate = await collectNflInjuryWeatherShadow({
    slate: { games: [gameFixture()] }, availability, availabilityMeta, predictionAt, supabase,
    weatherFetcher: async () => { collectorWeatherCalls++; return weather; },
    weeklyContextStore,
    newsCollector,
  });
  assert.equal(duplicate.errors.length, 0);
  assert.equal((writes.get(CONTEXT_TABLE) || []).length, 1, "duplicate run cannot replace the first context snapshot");
  assert.equal((writes.get(PREDICTION_TABLE) || []).length, 5, "duplicate run cannot replace first comparisons");

  const customerShape = { eventId: "odds-event-1", moneyline: comparison.control.moneyline };
  Object.defineProperty(customerShape, "_injuryWeatherShadowInput", { value: { private: true }, enumerable: false });
  assert.equal(JSON.stringify(customerShape).includes("injuryWeather"), false, "recording metadata cannot enter customer JSON");

  const sql = fs.readFileSync(path.join(__dirname, "../../sql/nfl_injury_weather_shadow.sql"), "utf8").toLowerCase();
  assert.ok(sql.includes("create table public.nfl_injury_weather_context_snapshots"));
  assert.ok(sql.includes("create table public.nfl_injury_weather_shadow_predictions"));
  assert.equal((sql.match(/enable row level security/g) || []).length, 2);
  assert.ok(!sql.includes("create policy"), "no browser-facing RLS policy exists");
  assert.ok(sql.includes("nfl injury/weather prediction-time context is immutable"));
  assert.ok(sql.includes("grant select, insert\n  on table public.nfl_injury_weather_context_snapshots"));
  assert.ok(sql.includes("grant update (\n  closing_line"));
  assert.ok(!/grant\s+delete/.test(sql), "service_role receives no DELETE privilege");

  const propsSource = fs.readFileSync(path.join(__dirname, "nflPropsShadow.js"), "utf8");
  assert.ok(propsSource.includes("availability: projectionBundle?.availability || []"), "already-fetched roster context is reused");
  const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.equal((serverSource.match(/recordFootballProps\(\{ sport: "nfl", slate \}\)/g) || []).length, 1,
    "the existing once-daily scheduled path is unchanged");

  console.log("nflInjuryWeatherShadow self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
