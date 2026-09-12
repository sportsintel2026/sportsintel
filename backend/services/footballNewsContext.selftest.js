"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { CATEGORIES, collectFootballNewsForGames } = require("./footballNewsContext");

const capturedAt = "2026-09-11T16:00:00.000Z";
const kickoffAt = "2026-09-13T20:25:00.000Z";
function category(type, id, description, extras = {}) {
  return { type, id: String(id), description, ...extras };
}
function game(eventId, espnId, awayId, awayTeam, homeId, homeTeam) {
  return {
    event: { eventId, commenceTime: kickoffAt, awayTeam, homeTeam },
    espnGame: {
      gameId: espnId, date: kickoffAt,
      away: { id: awayId, displayName: awayTeam },
      home: { id: homeId, displayName: homeTeam },
    },
  };
}

const nflGame = game("nfl-odds-1", "nfl-espn-1", "20", "Away NFL", "10", "Home NFL");
const nflAvailability = [
  { playerId: "qb-10", playerName: "Quarterback Exact", teamId: "10", teamName: "Home NFL", position: "QB", unit: "quarterback", starter: true },
  { playerId: "wr-20", playerName: "Receiver Exact", teamId: "20", teamName: "Away NFL", position: "WR", unit: "receiver", starter: true },
  { playerId: "dup-a", playerName: "Shared Name", teamId: "10", teamName: "Home NFL", position: "RB", unit: "backfield", starter: false },
  { playerId: "dup-b", playerName: "Shared Name", teamId: "20", teamName: "Away NFL", position: "WR", unit: "receiver", starter: false },
];
const nflItems = [
  {
    id: "espn-qb-status", source: "espn",
    headline: "Quarterback Exact remains questionable to start",
    summary: "The starting quarterback is a game-time decision.",
    published: "2026-09-11T14:00:00.000Z", link: "https://example.test/nfl-qb",
    identityCategories: [
      category("event", "nfl-espn-1", "Away NFL at Home NFL"),
      category("team", "10", "Home NFL"),
      category("athlete", "qb-10", "Quarterback Exact"),
    ],
  },
  {
    id: "roto-wr-role", source: "rotowire",
    headline: "Receiver Exact: Named starter after depth-chart change",
    summary: "Receiver Exact will start Sunday.", playerName: "Receiver Exact",
    published: "2026-09-11T13:00:00.000Z", link: "https://example.test/nfl-wr",
  },
  {
    id: "roto-ambiguous", source: "rotowire",
    headline: "Shared Name: Role may grow", summary: "Could see more work.",
    playerName: "Shared Name", published: "2026-09-11T12:00:00.000Z",
    link: "https://example.test/ambiguous",
  },
  {
    id: "espn-vague", source: "espn", headline: "Sunday matchup preview",
    summary: "A look at the game.", published: "2026-09-11T11:00:00.000Z",
    link: "https://example.test/vague",
    identityCategories: [category("event", "nfl-espn-1", "Away NFL at Home NFL")],
  },
  {
    id: "espn-team-ambiguous", source: "espn",
    headline: "Head coach changes the offensive play-caller",
    summary: "A coordinator will call plays Sunday.",
    published: "2026-09-11T10:30:00.000Z", link: "https://example.test/team-ambiguous",
    identityCategories: [category("event", "nfl-espn-1", "Away NFL at Home NFL")],
  },
  {
    id: "espn-wrong-athlete-id", source: "espn",
    headline: "Quarterback Exact is questionable",
    summary: "The quarterback may not start.",
    published: "2026-09-11T10:00:00.000Z", link: "https://example.test/wrong-athlete-id",
    identityCategories: [
      category("event", "nfl-espn-1", "Away NFL at Home NFL"),
      category("team", "10", "Home NFL"),
      category("athlete", "wrong-id", "Quarterback Exact"),
    ],
  },
];

function cfbSnapshot(teamId, teamName, players, quarterback) {
  return {
    espn_team_id: teamId, team_name: teamName,
    roster: { players }, quarterback,
  };
}
const cfbGame = game("cfb-odds-1", "cfb-espn-1", "120", "Away College", "110", "Home College");
const cfbSnapshots = [
  cfbSnapshot("110", "Home College", [{ id: "cfb-qb-1", firstName: "Freshman", lastName: "Quarterback", position: "QB" }], {
    playerId: "cfb-qb-1", playerName: "Freshman Quarterback", evidenceStatus: "confirmed",
    category: "freshman-new-starter",
  }),
  cfbSnapshot("120", "Away College", [{ id: "cfb-rb-1", firstName: "Away", lastName: "Runner", position: "RB" }], {
    playerId: "away-qb", playerName: "Away Quarterback", evidenceStatus: "confirmed",
    category: "returning-established-starter",
  }),
];
const cfbItems = [
  {
    id: "espn-cfb-qb", source: "espn",
    headline: "Home College names Freshman Quarterback starter after QB competition",
    summary: "The competition is over and Freshman Quarterback will start.",
    published: "2026-09-11T14:30:00.000Z", link: "https://example.test/cfb-qb",
    identityCategories: [
      category("event", "cfb-espn-1", "Away College at Home College"),
      category("team", "110", "Home College"),
      category("athlete", "cfb-qb-1", "Freshman Quarterback"),
    ],
  },
  {
    id: "espn-cfb-coach", source: "espn",
    headline: "Home College head coach changes offensive play-caller",
    summary: "The head coach confirmed the coordinator will call plays.",
    published: "2026-09-11T13:30:00.000Z", link: "https://example.test/cfb-coach",
    identityCategories: [
      category("event", "cfb-espn-1", "Away College at Home College"),
      category("team", "110", "Home College"),
    ],
  },
];

(async () => {
  let nflLoads = 0;
  const nfl = await collectFootballNewsForGames({
    league: "nfl", records: [nflGame], availability: nflAvailability,
    sourceLoader: async () => {
      nflLoads++;
      return {
        capturedAt, items: nflItems,
        sources: { espn: { available: true, capturedAt }, rotowire: { available: true, capturedAt } },
      };
    },
  });
  assert.strictEqual(nflLoads, 1, "one league-wide source load serves every game");
  assert.strictEqual(nfl.byEvent["nfl-odds-1"].length, 2);
  const qb = nfl.byEvent["nfl-odds-1"].find((row) => row.playerId === "qb-10");
  assert.strictEqual(qb.league, "nfl");
  assert.strictEqual(qb.espnGameId, "nfl-espn-1");
  assert.strictEqual(qb.teamId, "10");
  assert.strictEqual(qb.category, CATEGORIES.QB);
  assert.strictEqual(qb.statusChange, "questionable");
  assert.strictEqual(qb.confirmed, false);
  assert.strictEqual(qb.contextImpact, "unresolved");
  assert.strictEqual(qb.confidence, "high");
  const receiver = nfl.byEvent["nfl-odds-1"].find((row) => row.playerId === "wr-20");
  assert.strictEqual(receiver.identityMethod, "espn-team-id+exact-roster-name-collision-guarded");
  assert.strictEqual(receiver.category, CATEGORIES.STARTER);
  assert.strictEqual(receiver.contextImpact, "material");
  assert.strictEqual(nfl.meta.ambiguousOrIrrelevant, 4,
    "ambiguous players, vague/team-ambiguous stories, and mismatched durable IDs are not attached");

  let cfbLoads = 0;
  const cfb = await collectFootballNewsForGames({
    league: "cfb", records: [cfbGame], snapshots: cfbSnapshots,
    sourceLoader: async () => {
      cfbLoads++;
      return {
        capturedAt, items: cfbItems,
        sources: { espn: { available: true, capturedAt }, rotowire: { available: true, capturedAt } },
      };
    },
  });
  assert.strictEqual(cfbLoads, 1);
  assert.strictEqual(cfb.byEvent["cfb-odds-1"].length, 2);
  const cfbQb = cfb.byEvent["cfb-odds-1"].find((row) => row.playerId === "cfb-qb-1");
  assert.strictEqual(cfbQb.league, "cfb");
  assert.strictEqual(cfbQb.category, CATEGORIES.CFB_ROSTER);
  assert.strictEqual(cfbQb.statusChange, "named-starter");
  assert.strictEqual(cfbQb.contextImpact, "material");
  const coach = cfb.byEvent["cfb-odds-1"].find((row) => row.category === CATEGORIES.COACHING);
  assert.strictEqual(coach.teamId, "110");
  assert.strictEqual(coach.confirmed, true);

  const routeSource = fs.readFileSync(path.join(__dirname, "../routes/news.js"), "utf8");
  assert.match(routeSource, /Object\.defineProperty\(item, "_identityCategories", \{[\s\S]*?enumerable: false/);
  assert.match(routeSource, /getFootballContextNews/);
  const serviceSource = fs.readFileSync(path.join(__dirname, "footballNewsContext.js"), "utf8");
  assert.doesNotMatch(serviceSource, /axios|fetch\(/, "identity normalization adds no separate provider client");

  console.log("footballNewsContext self-test: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
