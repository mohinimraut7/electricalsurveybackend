const express = require("express");
const router = express.Router();

const {
  getAllMeters,
  getMeterMapPoints,
  getMeterById,
  getNearbyMeters,
  updateMeter,
  exportMeters,
} = require("../controllers/meterController");
const { protect, allowRoles } = require("../middlewares/auth");

// ── List / map / nearby / export — any logged-in role (ward_engineer auto ward-scoped) ──
router.get("/getAll", protect, getAllMeters);
router.get("/map", protect, getMeterMapPoints);
router.get("/nearby", protect, getNearbyMeters);
router.get("/export", protect, exportMeters);

// ── Single meter (with linked poles) ──
router.get("/:id", protect, getMeterById);

// ── Edit — ward_engineer (own ward) / super_admin ──
router.patch("/:id", protect, allowRoles("ward_engineer", "super_admin"), updateMeter);

module.exports = router;
