"use strict";

const assert = require("assert");
const Module = require("module");

const routes = [];
let profileAdmin = false;
const requireAuth = function requireAuth() {};
const fakeSupabase = {
  from(table) {
    assert.equal(table, "profiles");
    return { select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: profileAdmin }, error: null }) }) }) };
  },
};
const originalLoad = Module._load;
Module._load = function dependencyFreeLoad(request, parent, isMain) {
  if (request === "express") return { Router: () => ({ get(path, ...handlers) { routes.push({ path, handlers }); } }) };
  if (request === "../middleware/auth") return { requireAuth, supabase: fakeSupabase };
  if (request === "../services/nflPropsTracker") return {
    CATEGORIES: ["pass_yds"],
    loadTracker: async () => ({ overall: {}, breakdown: {}, rows: [] }),
  };
  return originalLoad(request, parent, isMain);
};
const trackerRoute = require("./nflPropsTracker");
Module._load = originalLoad;

assert.equal(routes.length, 1);
assert.equal(routes[0].path, "/");
assert.strictEqual(routes[0].handlers[0], requireAuth, "bearer authentication executes first");
assert.strictEqual(routes[0].handlers[1], trackerRoute._test.requireAdminUser, "database admin authorization executes before the tracker query");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

(async () => {
  const denied = response();
  let advanced = false;
  profileAdmin = false;
  await trackerRoute._test.requireAdminUser({ user: { id: "free" } }, denied, () => { advanced = true; });
  assert.equal(denied.statusCode, 403);
  assert.equal(advanced, false);

  const allowed = response();
  profileAdmin = true;
  await trackerRoute._test.requireAdminUser({ user: { id: "admin" } }, allowed, () => { advanced = true; });
  assert.equal(advanced, true);
  console.log("nflPropsTracker route self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
