const express = require("express");
const { gateModelData } = require("../middleware/accessGate");
const { getLatestNflPropsSnapshot } = require("../services/nflPropsShadow");

const router = express.Router();

router.get("/:sport", gateModelData, (req, res) => {
  const sport = String(req.params.sport || "").toLowerCase();
  if (sport !== "nfl" && sport !== "cfb") return res.status(404).json({ ok: false, sport, props: [] });
  if (sport === "cfb") {
    return res.json({
      ok: true,
      sport: "cfb",
      generatedAt: null,
      props: [],
      verifiedOnly: true,
      message: "No verified CFB player-prop feed is available yet.",
    });
  }
  const snapshot = getLatestNflPropsSnapshot();
  const requestedDate = typeof req.query.date === "string" ? req.query.date : null;
  const props = requestedDate ? snapshot.props.filter((prop) => prop.eventDate === requestedDate) : snapshot.props;
  return res.json({ ...snapshot, props, ok: true, verifiedOnly: true });
});

module.exports = router;
