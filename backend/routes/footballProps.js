const express = require("express");
const { gateModelData } = require("../middleware/accessGate");
const { getLatestFootballPropsSnapshot } = require("../services/nflPropsShadow");

const router = express.Router();

router.get("/:sport", gateModelData, (req, res) => {
  const sport = String(req.params.sport || "").toLowerCase();
  if (sport !== "nfl" && sport !== "cfb") return res.status(404).json({ ok: false, sport, props: [] });
  const snapshot = getLatestFootballPropsSnapshot(sport);
  const requestedDate = typeof req.query.date === "string" ? req.query.date : null;
  const props = requestedDate ? snapshot.props.filter((prop) => prop.eventDate === requestedDate) : snapshot.props;
  return res.json({
    ...snapshot,
    props,
    supportedMarkets: [...new Set(props.map((prop) => prop.market).filter(Boolean))],
    ok: true,
    verifiedOnly: true,
    message: props.length ? null : `No verified ${sport.toUpperCase()} player-prop markets are available for this slate.`,
  });
});

module.exports = router;
