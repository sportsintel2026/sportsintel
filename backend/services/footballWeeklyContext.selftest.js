"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  TABLE,
  CONTEXT_VERSION,
  STATUSES,
  buildNflContext,
  buildCfbContext,
  persistContexts,
} = require("./footballWeeklyContext");

const capturedAt = "2026-09-11T15:00:00.000Z";
const kickoffAt = "2026-09-13T20:25:00.000Z";
const event = {
  eventId: "weekly-context-game-1",
  commenceTime: kickoffAt,
  awayTeam: "Away Team",
  homeTeam: "Home Team",
};
const espnGame = {
  gameId: "espn-weekly-context-1",
  date: kickoffAt,
  home: { id: "10", displayName: "Home Team" },
  away: { id: "20", displayName: "Away Team" },
  venue: { id: "venue-1", indoor: false },
};
const game = {};
Object.defineProperty(game, "_injuryWeatherShadowInput", {
  value: { event, espnGame }, enumerable: false,
});

function availability(overrides) {
  return {
    playerId: "player-1", playerName: "Player One", teamId: "10",
    teamName: "Home Team", position: "QB", unit: "quarterback",
    reportedInjury: false, status: "no-reported-injury", statusRaw: null,
    clearlyUnavailable: false, uncertain: false, starter: true,
    starterStatus: "reported", rosterActive: true, roleUsage: null,
    importanceStatus: "unavailable", replacementStatus: "unavailable",
    source: "espn-roster-athlete-id", ...overrides,
  };
}

const nflPlayers = [
  availability({ playerId: "qb-new", reportedInjury: true, status: "questionable", statusRaw: "Questionable", uncertain: true }),
  availability({ playerId: "ol-1", playerName: "Guard One", position: "G", unit: "offensive_line", reportedInjury: true, status: "out", statusRaw: "Out", clearlyUnavailable: true }),
  availability({ playerId: "ol-2", playerName: "Guard Two", position: "T", unit: "offensive_line", reportedInjury: true, status: "out", statusRaw: "Out", clearlyUnavailable: true }),
  availability({ playerId: "wr-1", playerName: "Receiver One", teamId: "20", teamName: "Away Team", position: "WR", unit: "receiver", reportedInjury: true, status: "suspended", statusRaw: "Suspended", clearlyUnavailable: true }),
  availability({ playerId: "rb-1", playerName: "Back One", teamId: "20", teamName: "Away Team", position: "RB", unit: "backfield", reportedInjury: true, status: "limited", statusRaw: "Limited", uncertain: true, starter: false }),
];
const comparison = {
  contextRow: {
    home_availability: nflPlayers.filter((row) => row.teamId === "10"),
    away_availability: nflPlayers.filter((row) => row.teamId === "20"),
    weather_context: {
      available: true, source: "open-meteo", capturedAt,
      kickoffAt, indoor: false, tempF: 58, windMph: 18,
      precipitation: 0.4, severeCondition: null,
    },
  },
};
const priorNfl = {
  structured_context: {
    starterState: { "10:quarterback": [{ playerId: "qb-old", playerName: "Old QB", teamId: "10", unit: "quarterback" }] },
  },
};
const predictionRows = [{
  id: 501, game_id: event.eventId, game_date: "2026-09-13", league: "nfl",
  market: "spread", selection: "Home Team -3", snapshotted_at: capturedAt,
  model_version: null, experiment_version: null,
}];
const nfl = buildNflContext({ game, comparison, predictionRows, previousContext: priorNfl, capturedAt });
assert.strictEqual(nfl.context_status, STATUSES.UNRESOLVED);
assert.strictEqual(nfl.context_version, CONTEXT_VERSION);
assert.strictEqual(nfl.event_id, event.eventId);
assert.strictEqual(nfl.espn_game_id, espnGame.gameId);
assert.strictEqual(nfl.home_team_id, "10");
assert.strictEqual(nfl.away_team_id, "20");
assert.strictEqual(nfl.prediction_keys.length, 1);
assert.strictEqual(nfl.prediction_keys[0].predictionId, 501);
assert.strictEqual(nfl.structured_context.suspensions.length, 1);
assert.strictEqual(nfl.structured_context.workloadRestrictions.length, 1);
assert.strictEqual(nfl.structured_context.unitClusters[0].teamUnit, "10:offensive_line");
assert.ok(nfl.unresolved_items.some((row) => row.reason === "high-impact-player-status-unresolved"));
assert.ok(nfl.material_items.some((row) => row.reason === "exact-quarterback-starter-identity-changed"));
assert.strictEqual(nfl.source_context.news.available, false);
assert.match(nfl.input_fingerprint, /^[0-9a-f]{64}$/);

const clearComparison = {
  contextRow: {
    home_availability: [availability({ playerId: "qb-home" })],
    away_availability: [availability({ playerId: "qb-away", teamId: "20", teamName: "Away Team" })],
    weather_context: { available: true, source: "espn-event-venue", capturedAt, kickoffAt, indoor: true },
  },
};
assert.strictEqual(buildNflContext({ game, comparison: clearComparison, capturedAt }).context_status, STATUSES.CLEAR);
const newsOnly = buildNflContext({
  game,
  comparison: clearComparison,
  capturedAt,
  newsMeta: { available: true, sources: { espn: { available: true, capturedAt } } },
  newsItems: [{
    newsId: "espn-news-qb-1", source: "espn", category: "QB change",
    statusChange: "game-time-decision", contextImpact: "unresolved",
    teamId: "10", teamName: "Home Team", playerId: "qb-home",
    playerName: "Player One", position: "QB", publishedAt: capturedAt,
  }],
});
assert.strictEqual(newsOnly.context_status, STATUSES.UNRESOLVED);
assert.strictEqual(newsOnly.structured_context.newsContext.items.length, 1);
assert.strictEqual(newsOnly.source_context.news.available, true);
assert.ok(newsOnly.unresolved_items.some((row) => row.newsId === "espn-news-qb-1"));
const inactiveQbComparison = {
  contextRow: {
    home_availability: [availability({ playerId: "qb-inactive", rosterActive: false })],
    away_availability: clearComparison.contextRow.away_availability,
    weather_context: clearComparison.contextRow.weather_context,
  },
};
assert.strictEqual(buildNflContext({ game, comparison: inactiveQbComparison, capturedAt }).context_status, STATUSES.MATERIAL);
assert.strictEqual(buildNflContext({ game, comparison: clearComparison, capturedAt: kickoffAt }), null,
  "post-kickoff snapshots must never be built");

function cfbSnapshot(id, name, quarterback, continuity = true) {
  return {
    id: Number(id), snapshot_at: "2026-08-30T12:00:00.000Z",
    team_name: name, espn_team_id: String(id),
    quarterback,
    roster: { available: true, playerCount: 110 },
    transfers: { available: true, arrivals: [], departures: [] },
    coaching: { available: true, identityStatus: "exact", continuity, headCoach: { name: `${name} Coach` } },
    quality: { completeness: 0.8 },
    sources: {
      roster: { available: true, retrievedAt: "2026-08-30T10:00:00.000Z", season: 2026 },
      transfers: { available: true, retrievedAt: "2026-08-30T10:01:00.000Z", season: 2026 },
      coaching: { available: true, retrievedAt: "2026-08-30T10:02:00.000Z", season: 2026 },
    },
  };
}
const cfb = buildCfbContext({
  event,
  espnGame,
  homeSnapshot: cfbSnapshot("10", "Home Team", {
    category: "confirmed-transfer-starter", playerId: "cfb-qb-1",
    playerName: "New QB", evidenceStatus: "confirmed",
  }, false),
  awaySnapshot: cfbSnapshot("20", "Away Team", {
    category: "open-competition", playerId: null, playerName: null,
    evidenceStatus: "unverified",
  }),
  predictionRows: [{ ...predictionRows[0], league: "cfb" }],
  capturedAt,
});
assert.strictEqual(cfb.context_status, STATUSES.UNRESOLVED);
assert.strictEqual(cfb.structured_context.cfbRosterContext.teams.length, 2);
assert.strictEqual(cfb.structured_context.cfbRosterContext.teams[0].sources.roster.available, true);
assert.ok(cfb.material_items.some((row) => row.type === "coaching"));
assert.ok(cfb.unresolved_items.some((row) => row.type === "cfb-quarterback"));
assert.strictEqual(cfb.structured_context.injuriesAvailability.length, 0);
assert.strictEqual(cfb.source_context.currentAvailability.available, false);
const cfbWithoutEspnJoin = buildCfbContext({
  event,
  homeSnapshot: cfbSnapshot("10", "Home Team", { category: "returning-starter", playerId: "hqb", playerName: "Home QB", evidenceStatus: "confirmed" }),
  awaySnapshot: cfbSnapshot("20", "Away Team", { category: "returning-starter", playerId: "aqb", playerName: "Away QB", evidenceStatus: "confirmed" }),
  capturedAt,
});
assert.strictEqual(cfbWithoutEspnJoin.home_team_id, "10", "durable preseason identity survives a failed ESPN game join");
assert.strictEqual(cfbWithoutEspnJoin.away_team_id, "20");
assert.strictEqual(cfbWithoutEspnJoin.context_confidence, "low", "missing exact game join is disclosed, not guessed");

const clearCfb = buildCfbContext({
  event,
  espnGame,
  homeSnapshot: cfbSnapshot("10", "Home Team", { category: "returning-starter", playerId: "hqb", playerName: "Home QB", evidenceStatus: "confirmed" }),
  awaySnapshot: cfbSnapshot("20", "Away Team", { category: "returning-starter", playerId: "aqb", playerName: "Away QB", evidenceStatus: "confirmed" }),
  capturedAt,
});
assert.strictEqual(clearCfb.context_status, STATUSES.CLEAR);
const unavailableCfbQb = buildCfbContext({
  event,
  espnGame,
  homeSnapshot: cfbSnapshot("10", "Home Team", { category: "confirmed-unavailable", playerId: "hqb", playerName: "Home QB", evidenceStatus: "confirmed" }),
  awaySnapshot: cfbSnapshot("20", "Away Team", { category: "returning-established-starter", playerId: "aqb", playerName: "Away QB", evidenceStatus: "confirmed" }),
  capturedAt,
});
assert.strictEqual(unavailableCfbQb.context_status, STATUSES.MATERIAL);
assert.ok(unavailableCfbQb.material_items.some((row) => row.reason === "starting-quarterback-confirmed-unavailable"));

// The persistence boundary is insert-only/upsert-ignore. It must never issue an
// update or expose an overwrite path.
let persistedCall = null;
const fakeDb = {
  from(table) {
    assert.strictEqual(table, TABLE);
    return {
      async upsert(rows, options) {
        persistedCall = { rows, options };
        return { error: null };
      },
    };
  },
};

(async () => {
  const result = await persistContexts(fakeDb, [nfl, cfb]);
  assert.deepStrictEqual(result, { attempted: 2 });
  assert.deepStrictEqual(persistedCall.options, {
    onConflict: "league,event_id,captured_at,context_version",
    ignoreDuplicates: true,
  });

  const sql = fs.readFileSync(path.join(__dirname, "../../sql/football_weekly_context.sql"), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /grant select, insert on table public\.football_weekly_context_snapshots to service_role/i);
  assert.doesNotMatch(sql, /grant[^;]*(update|delete)/i);
  assert.match(sql, /before update or delete/i);
  assert.match(sql, /unique \(league, event_id, captured_at, context_version\)/i);
  assert.match(sql, /captured_at < kickoff_at/i);

  const serviceSource = fs.readFileSync(path.join(__dirname, "footballWeeklyContext.js"), "utf8");
  for (const forbidden of ["fetch(", "axios", 'require("./oddsApi")', 'require("./weatherApi")', 'require("./cfbdApi")']) {
    assert.ok(!serviceSource.includes(forbidden), `weekly context service contains provider surface ${forbidden}`);
  }
  const nflSource = fs.readFileSync(path.join(__dirname, "nflInjuryWeatherShadow.js"), "utf8");
  assert.match(nflSource, /buildNflContext/);
  const cfbSource = fs.readFileSync(path.join(__dirname, "cfbGameShadowCollector.js"), "utf8");
  assert.match(cfbSource, /buildCfbContext/);
  const trackerSource = fs.readFileSync(path.join(__dirname, "predictionTracker.js"), "utf8");
  assert.match(trackerSource, /espnGamesByEvent:\s*cfbControlContext\.espnGamesByEvent/);

  console.log("footballWeeklyContext self-test: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
