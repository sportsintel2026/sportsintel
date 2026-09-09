const express = require("express");
const { gateModelData } = require("../middleware/accessGate");
const { requireAuth, supabase } = require("../middleware/auth");
const { getLatestFootballPropsSnapshot } = require("../services/nflPropsShadow");

const router = express.Router();
const OWNER_EMAIL = "r7002g@gmail.com";

function requireAdminUser(req, res, next) {
  return requireAuth(req, res, async () => {
    if (req.user?.email === OWNER_EMAIL) return next();
    try {
      const { data, error } = await supabase.from("profiles").select("is_admin").eq("id", req.user.id).single();
      if (!error && data?.is_admin === true) return next();
    } catch (_) {}
    return res.status(404).json({ error: "Not found" });
  });
}

function buildResponse(sport, requestedDate, { admin = false } = {}) {
  if (sport !== "nfl" && sport !== "cfb") return { status: 404, body: { ok: false, sport, props: [] } };
  const snapshot = getLatestFootballPropsSnapshot(sport);
  const filtered = requestedDate ? snapshot.props.filter((prop) => prop.eventDate === requestedDate) : snapshot.props;
  const props = admin ? filtered : filtered.map((prop) => {
    if (prop.market === "anytime_td") return prop;
    const { quotes, ...customerProp } = prop;
    return customerProp;
  });
  const tdSelections = requestedDate
    ? (snapshot.tdSelections || []).filter((row) => row.eventDate === requestedDate)
    : (snapshot.tdSelections || []);
  return { status: 200, body: {
    ...snapshot,
    props,
    tdSelections,
    supportedMarkets: [...new Set(props.map((prop) => prop.market).filter(Boolean))],
    ok: true,
    verifiedOnly: true,
    message: props.length ? null : `No verified ${sport.toUpperCase()} player-prop markets are available for this slate.`,
  } };
}

function sendSnapshot(req, res, admin) {
  const sport = String(req.params.sport || "").toLowerCase();
  const result = buildResponse(sport, typeof req.query.date === "string" ? req.query.date : null, { admin });
  return res.status(result.status).json(result.body);
}

router.get("/admin/:sport", requireAdminUser, (req, res) => sendSnapshot(req, res, true));

router.get("/:sport", gateModelData, (req, res) => {
  return sendSnapshot(req, res, false);
});

module.exports = router;
module.exports._test = { buildResponse, requireAdminUser };
