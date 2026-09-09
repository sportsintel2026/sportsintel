const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadWithRouteStubs(request, parent, isMain) {
  if (request === "express") return { Router: () => ({ get() {} }) };
  if (request === "../middleware/auth") return { requireAuth() {}, supabase: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { _test } = require("./wizePicks");
Module._load = originalLoad;

const rows = [
  {
    date: "2026-08-28",
    picks: JSON.stringify([
      { type: "straight", sport: "mlb", pick: "PRIVATE MLB PICK", odds: "+150", unitPnl: null, result: "win", analysis: "private analysis" },
      { type: "straight", sport: "nba", pick: "PRIVATE NBA PICK", odds: "-110", result: "loss" },
      { type: "straight", sport: "mlb", pick: "CURRENT PRIVATE PICK", odds: "-110", result: "" },
      { type: "straight", kind: "prop", sport: "nfl", propCategory: "pass_yds", pick: "PRIVATE NFL PROP", odds: "+150", units: 2, unitPnl: 3, result: "win" },
      {
        type: "parlay",
        combinedOdds: null,
        result: "win",
        legs: [
          { sport: "nfl", pick: "PRIVATE LEG 1", odds: "-110" },
          { sport: "ncaafb", pick: "PRIVATE LEG 2", odds: "-110" },
        ],
      },
    ]),
  },
];

function fakeClient({ tier = "free", isAdmin = false, entitlementError = false } = {}) {
  return {
    from(table) {
      if (table === "expert_picks") {
        return {
          select(columns) {
            assert.strictEqual(columns, "date, picks");
            return {
              async order(column, options) {
                assert.strictEqual(column, "date");
                assert.deepStrictEqual(options, { ascending: false });
                return { data: rows, error: null };
              },
            };
          },
        };
      }
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  if (entitlementError) return { data: null, error: new Error("lookup unavailable") };
                  return table === "subscriptions"
                    ? { data: { tier }, error: null }
                    : { data: { is_admin: isAdmin }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function runHandler(user, client) {
  const response = fakeResponse();
  await _test.createHandler(client)({ user }, response);
  return response;
}

(async () => {
  const proofPayload = _test.buildPayload(rows, false);
  assert.strictEqual(proofPayload.access, "proof");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(proofPayload, "rows"), false);
  assert.strictEqual(JSON.stringify(proofPayload).includes("PRIVATE"), false);
  assert.deepStrictEqual(
    Object.keys(proofPayload.proof.overall).sort(),
    ["losses", "pending", "pushes", "riskedUnits", "roi", "units", "voids", "winRate", "wins"],
  );
  assert.strictEqual(proofPayload.proof.overall.wins, 3);
  assert.strictEqual(proofPayload.proof.overall.losses, 1);
  assert.strictEqual(proofPayload.proof.bySport.mlb.wins, 1);
  assert.strictEqual(proofPayload.proof.bySport.mlb.units, 1.5, "null stored P&L falls back to the posted price rather than zero");
  assert.strictEqual(proofPayload.proof.bySport.nfl.wins, 2);
  assert.strictEqual(proofPayload.proof.bySport.cfb.wins, 1);
  assert.strictEqual(proofPayload.proof.props.overall.wins, 1);
  assert.strictEqual(proofPayload.proof.props.overall.units, 3);
  assert.strictEqual(proofPayload.proof.props.overall.roi, 150);
  assert.strictEqual(proofPayload.proof.props.bySport.nfl.wins, 1);
  assert.strictEqual(proofPayload.proof.props.byCategory.pass_yds.wins, 1);

  const fullPayload = _test.buildPayload(rows, true);
  assert.strictEqual(fullPayload.access, "full");
  assert.deepStrictEqual(fullPayload.rows, rows);

  const anonymous = await runHandler(null, fakeClient());
  assert.strictEqual(anonymous.statusCode, 401);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(anonymous.body, "rows"), false);

  const free = await runHandler({ id: "free", email: "free@example.test" }, fakeClient());
  assert.strictEqual(free.statusCode, 200);
  assert.strictEqual(free.body.access, "proof");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(free.body, "rows"), false);

  const paid = await runHandler({ id: "paid", email: "paid@example.test" }, fakeClient({ tier: "pro" }));
  assert.strictEqual(paid.body.access, "full");
  assert.deepStrictEqual(paid.body.rows, rows);

  const admin = await runHandler({ id: "admin", email: "admin@example.test" }, fakeClient({ isAdmin: true }));
  assert.strictEqual(admin.body.access, "full");

  const owner = await runHandler({ id: "owner", email: "r7002g@gmail.com" }, fakeClient({ entitlementError: true }));
  assert.strictEqual(owner.body.access, "full");

  const lookupFailure = await runHandler({ id: "unknown", email: "unknown@example.test" }, fakeClient({ tier: "pro", entitlementError: true }));
  assert.strictEqual(lookupFailure.body.access, "proof");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(lookupFailure.body, "rows"), false);

  console.log("wizePicks route self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
