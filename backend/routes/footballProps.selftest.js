const assert = require("assert");
const Module = require("module");

const routes = [];
const router = {
  get(path, ...handlers) { routes.push({ path, handlers }); },
};
const gateModelData = function gateModelData() {};
const snapshot = {
  sport: "nfl",
  generatedAt: "2026-09-01T12:00:00.000Z",
  props: [
    { sport: "nfl", eventDate: "2026-09-03", player: "Thursday Player" },
    { sport: "nfl", eventDate: "2026-09-06", player: "Sunday Player" },
  ],
};

const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "express") return { Router: () => router };
  if (request === "../middleware/accessGate") return { gateModelData };
  if (request === "../services/nflPropsShadow") return { getLatestNflPropsSnapshot: () => snapshot };
  return originalLoad(request, parent, isMain);
};
require("./footballProps");
Module._load = originalLoad;

assert.equal(routes.length, 1);
assert.equal(routes[0].path, "/:sport");
assert.strictEqual(routes[0].handlers[0], gateModelData, "entitlement gate must run before the handler");

function invoke(params, query = {}) {
  let statusCode = 200;
  let body;
  const req = { params, query };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  routes[0].handlers[1](req, res);
  return { statusCode, body };
}

const nfl = invoke({ sport: "nfl" }, { date: "2026-09-06" });
assert.equal(nfl.statusCode, 200);
assert.deepEqual(nfl.body.props.map((prop) => prop.player), ["Sunday Player"]);

const cfb = invoke({ sport: "cfb" });
assert.equal(cfb.statusCode, 200);
assert.deepEqual(cfb.body.props, []);
assert.equal(cfb.body.verifiedOnly, true);

const unsupported = invoke({ sport: "mlb" });
assert.equal(unsupported.statusCode, 404);
assert.deepEqual(unsupported.body.props, []);

console.log("footballProps route self-test passed");
