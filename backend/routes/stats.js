const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.json({ message: "Stats API ready" });
});

module.exports = router;
