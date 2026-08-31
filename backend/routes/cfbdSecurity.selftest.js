const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
const originalFetch = global.fetch;
const originalAdminToken = process.env.ADMIN_TOKEN;
const originalCfbdKey = process.env.CFBD_API_KEY;

const adminGuard = require("../middleware/adminGuard");
const routers = [];
const cfbdCalls = [];
const fetchCalls = [];

function makeRouter() {
  const routes = [];
  const router = { routes };
  for (const method of ["get", "post", "put", "patch", "delete", "use"]) {
    router[method] = (path, ...handlers) => {
      routes.push({ method, path, handlers });
      return router;
    };
  }
  routers.push(router);
  return router;
}

const serviceStubs = new Proxy({}, {
  get() { return () => null; },
});

const cfbdStub = {
  async getSpRatings(year) { cfbdCalls.push(["sp", year]); return []; },
  async getReturningProduction(year) { cfbdCalls.push(["returning", year]); return []; },
  async getSrsRatings(year) { cfbdCalls.push(["srs", year]); return []; },
  async getGames(year) { cfbdCalls.push(["games", year]); return []; },
  async getLines(year) { cfbdCalls.push(["lines", year]); return []; },
};

Module._load = function loadWithRouteStubs(request, parent, isMain) {
  if (request === "express") return { Router: makeRouter };
  if (request === "@supabase/supabase-js") return { createClient: () => null };
  if (request === "../middleware/adminGuard") return adminGuard;
  if (request === "../middleware/auth") return { supabase: {} };
  if (request === "../middleware/accessGate") return serviceStubs;
  if (request === "../services/cfbdApi") return cfbdStub;
  if (request === "../services/cfbRatingBacktest") {
    return {
      evaluatePair() {
        return {
          sp: { n: 0, mae: 0, atsWin: 0, atsLoss: 0 },
          srs: { n: 0, mae: 0, atsWin: 0, atsLoss: 0 },
          market: { n: 0, mae: 0 },
        };
      },
    };
  }
  if (request.startsWith("../services/")) return serviceStubs;
  return originalLoad.call(this, request, parent, isMain);
};

require("./edges");
require("./backtest");

const edgesRouter = routers[0];
const backtestRouter = routers[1];

function route(router, path) {
  const found = router.routes.find((entry) => entry.method === "get" && entry.path === path);
  assert(found, `missing GET ${path}`);
  return found;
}

function request({ query = {}, adminToken = null, authorization = null } = {}) {
  const headers = {
    ...(adminToken == null ? {} : { "x-admin-token": adminToken }),
    ...(authorization == null ? {} : { authorization }),
  };
  return {
    query: { ...query },
    headers,
    get(name) { return headers[String(name).toLowerCase()] || null; },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function dispatch(entry, req) {
  const res = response();
  async function run(index) {
    if (index >= entry.handlers.length) return;
    let nextPromise = null;
    const next = () => {
      nextPromise = run(index + 1);
      return nextPromise;
    };
    await entry.handlers[index](req, res, next);
    if (nextPromise) await nextPromise;
  }
  await run(0);
  return res;
}

function resetCalls() {
  cfbdCalls.length = 0;
  fetchCalls.length = 0;
}

function totalProviderCalls() {
  return cfbdCalls.length + fetchCalls.length;
}

global.fetch = async (url, options = {}) => {
  fetchCalls.push({ url: String(url), authorization: options.headers && options.headers.Authorization });
  return { ok: true, status: 200, statusText: "OK", async json() { return []; } };
};

(async () => {
  process.env.ADMIN_TOKEN = "admin-test-token";
  process.env.CFBD_API_KEY = "server-side-test-value";

  const probe = route(edgesRouter, "/cfbdprobe");
  const ratingBacktest = route(edgesRouter, "/cfbratingbacktest");
  const calibrate = route(backtestRouter, "/cfb-calibrate");
  const customerMlb = route(edgesRouter, "/mlb");
  const customerNfl = route(edgesRouter, "/nfl");
  const customerCfb = route(edgesRouter, "/cfb");

  assert.strictEqual(probe.handlers.length, 2);
  assert.strictEqual(probe.handlers[0], adminGuard);
  assert.strictEqual(ratingBacktest.handlers.length, 2);
  assert.strictEqual(ratingBacktest.handlers[0], adminGuard);
  assert.strictEqual(calibrate.handlers.length, 3);
  assert.strictEqual(calibrate.handlers[1], adminGuard);

  for (const entry of [probe, ratingBacktest, calibrate]) {
    for (const req of [
      request(),
      request({ authorization: "Bearer free-user-token" }),
      request({ adminToken: "wrong-token" }),
    ]) {
      resetCalls();
      const res = await dispatch(entry, req);
      assert.strictEqual(res.statusCode, 404);
      assert.deepStrictEqual(res.body, { error: "Not found" });
      assert.strictEqual(totalProviderCalls(), 0);
    }
  }

  resetCalls();
  let res = await dispatch(probe, request({ adminToken: "admin-test-token" }));
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(cfbdCalls, [["sp", 2026], ["returning", 2026]]);
  assert.strictEqual(fetchCalls.length, 0);

  resetCalls();
  res = await dispatch(ratingBacktest, request({ adminToken: "admin-test-token" }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(cfbdCalls.length, 12);
  assert.strictEqual(fetchCalls.length, 0);

  resetCalls();
  res = await dispatch(calibrate, request({
    adminToken: "admin-test-token",
    query: { seasons: "2020", key: "query-value-must-be-ignored" },
  }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(fetchCalls.length, 2);
  assert(fetchCalls.every((call) => call.authorization === "Bearer server-side-test-value"));

  resetCalls();
  res = await dispatch(calibrate, request({ query: { seasons: "2020", key: "admin-test-token" } }));
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(totalProviderCalls(), 0);

  resetCalls();
  res = await dispatch(calibrate, request({ query: { seasons: "not-a-season" } }));
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(totalProviderCalls(), 0);

  for (const seasons of ["", "2020,abc", "2020.0", "2019", "2099", "2020,2021,2022,2023,2024,2025"]) {
    resetCalls();
    res = await dispatch(calibrate, request({
      adminToken: "admin-test-token",
      query: { seasons },
    }));
    assert.strictEqual(res.statusCode, 400, seasons);
    assert.strictEqual(totalProviderCalls(), 0, seasons);
  }

  resetCalls();
  res = await dispatch(calibrate, request({
    adminToken: "admin-test-token",
    query: { seasons: "2020,2020,2021" },
  }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(fetchCalls.length, 4);
  assert.deepStrictEqual(
    fetchCalls.map((call) => new URL(call.url).searchParams.get("year")),
    ["2020", "2021", "2020", "2021"],
  );

  resetCalls();
  res = await dispatch(calibrate, request({
    adminToken: "admin-test-token",
    query: { seasons: "2020,2021,2022,2023,2024" },
  }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(fetchCalls.length, 10);

  delete process.env.CFBD_API_KEY;
  resetCalls();
  res = await dispatch(calibrate, request({
    adminToken: "admin-test-token",
    query: { seasons: "2020" },
  }));
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(totalProviderCalls(), 0);

  for (const customerRoute of [customerMlb, customerNfl, customerCfb]) {
    assert.strictEqual(customerRoute.handlers.length, 2);
    assert.notStrictEqual(customerRoute.handlers[0], adminGuard);
  }

  console.log("CFBD provider security self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
  if (originalAdminToken == null) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = originalAdminToken;
  if (originalCfbdKey == null) delete process.env.CFBD_API_KEY;
  else process.env.CFBD_API_KEY = originalCfbdKey;
});
