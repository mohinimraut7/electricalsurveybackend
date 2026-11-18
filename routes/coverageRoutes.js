const express = require("express");
const router = express.Router();

const { getCoverageSummary, getMasterConsumers } = require("../controllers/coverageController");
const { protect } = require("../middlewares/auth");

// ── Survey coverage vs ward consumer list ──
router.get("/summary", protect, getCoverageSummary);
router.get("/consumers", protect, getMasterConsumers);

module.exports = router;
