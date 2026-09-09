const assert = require("assert");
const Module = require("module");

const routes = [];
const router = {
  get(path, ...handlers) { routes.push({ path, handlers }); },
};
const gateModelData = function gateModelData() {};
const requireAuth = function requireAuth() {};
const snapshot = {
  sport: "nfl",
  generatedAt: "2026-09-01T12:00:00.000Z",
  props: [
    { sport: "nfl", eventDate: "2026-09-03", market: "rush_yds", player: "Thursday Player" },
    { sport: "nfl", eventDate: "2026-09-06", market: "pass_yds", player: "Sunday Player", quotes: [{ book: "Book A", line: 250.5, overOdds: -110, underOdds: -110 }] },
  ],
  tdSelections: [
    { eventDate: "2026-09-03", eventId: "td-thu", player: "Thursday Scorer" },
    { eventDate: "2026-09-06", eventId: "td-sun", player: "Sunday Scorer" },
  ],
};
const cfbSnapshot = {
  sport: "cfb",
  generatedAt: "2026-09-01T12:00:00.000Z",
  props: [{ sport: "cfb", eventDate: "2026-09-06", market: "anytime_td", player: "Exact College Player" }],
};

const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "express") return { Router: () => router };
  if (request === "../middleware/accessGate") return { gateModelData };
  if (request === "../middleware/auth") return { requireAuth, supabase: {} };
  if (request === "../services/nflPropsShadow") return {
    getLatestFootballPropsSnapshot: (sport) => sport === "cfb" ? cfbSnapshot : snapshot,
  };
  return originalLoad(request, parent, isMain);
};
require("./footballProps");
Module._load = originalLoad;

assert.equal(routes.length, 2);
assert.equal(routes[0].path, "/admin/:sport");
assert.strictEqual(routes[0].handlers[0].name, "requireAdminUser", "admin quote ladder must use the owner/admin gate");
assert.equal(routes[1].path, "/:sport");
assert.strictEqual(routes[1].handlers[0], gateModelData, "entitlement gate must run before the handler");

function invoke(params, query = {}, routeIndex = 1) {
  let statusCode = 200;
  let body;
  const req = { params, query };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  routes[routeIndex].handlers[1](req, res);
  return { statusCode, body };
}

const nfl = invoke({ sport: "nfl" }, { date: "2026-09-06" });
assert.equal(nfl.statusCode, 200);
assert.deepEqual(nfl.body.props.map((prop) => prop.player), ["Sunday Player"]);
assert.equal("quotes" in nfl.body.props[0], false, "normal customer response does not expose the new admin quote ladder");
assert.deepEqual(nfl.body.tdSelections.map((row) => row.player), ["Sunday Scorer"]);
assert.deepEqual(nfl.body.supportedMarkets, ["pass_yds"]);

const cfb = invoke({ sport: "cfb" });
assert.equal(cfb.statusCode, 200);
assert.deepEqual(cfb.body.props.map((prop) => prop.player), ["Exact College Player"]);
assert.deepEqual(cfb.body.supportedMarkets, ["anytime_td"]);
assert.equal(cfb.body.verifiedOnly, true);

const adminNfl = invoke({ sport: "nfl" }, { date: "2026-09-06" }, 0);
assert.equal(adminNfl.body.props[0].quotes.length, 1, "admin entry response retains the verified quote ladder");

const unsupported = invoke({ sport: "mlb" });
assert.equal(unsupported.statusCode, 404);
assert.deepEqual(unsupported.body.props, []);

console.log("footballProps route self-test passed");
