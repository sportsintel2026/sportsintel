const assert = require("assert");
const Module = require("module");

let profileIsAdmin = false;
const originalLoad = Module._load;
Module._load = function loadWithRouteStubs(request, parent, isMain) {
  if (request === "express") return { Router: () => ({ get() {} }) };
  if (request === "../services/expertPicksGrader") return { gradeExpertPicks: async () => ({}) };
  if (request === "../middleware/adminGuard") {
    return (req, res, next) => req.validAdminSecret
      ? next()
      : res.status(404).json({ error: "Not found" });
  }
  if (request === "../middleware/auth") {
    return {
      requireAuth(req, res, next) {
        if (!req.authenticatedUser) return res.status(401).json({ error: "Invalid authentication" });
        req.user = req.authenticatedUser;
        return next();
      },
      supabase: {
        from() {
          return {
            select() {
              return {
                eq() {
                  return {
                    async single() { return { data: { is_admin: profileIsAdmin }, error: null }; },
                  };
                },
              };
            },
          };
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { _test } = require("./expertGrade");
Module._load = originalLoad;

function request({ user = null, token = null, validAdminSecret = false } = {}) {
  return {
    query: {},
    authenticatedUser: user,
    validAdminSecret,
    get(name) { return name === "x-admin-token" ? token : null; },
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

async function check(req) {
  const res = response();
  let allowed = false;
  await _test.guardExpertGrade(req, res, () => { allowed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  return { allowed, res };
}

(async () => {
  let result = await check(request());
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.res.statusCode, 401);

  result = await check(request({ user: { id: "free", email: "free@example.test" } }));
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.res.statusCode, 404);

  result = await check(request({ user: { id: "owner", email: "r7002g@gmail.com" } }));
  assert.strictEqual(result.allowed, true);

  profileIsAdmin = true;
  result = await check(request({ user: { id: "admin", email: "admin@example.test" } }));
  assert.strictEqual(result.allowed, true);
  profileIsAdmin = false;

  result = await check(request({ token: "present", validAdminSecret: false }));
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.res.statusCode, 404);

  result = await check(request({ token: "present", validAdminSecret: true }));
  assert.strictEqual(result.allowed, true);

  console.log("expertGrade access self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
