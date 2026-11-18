const express = require("express");
const router = express.Router();

const { getAllPoles, getPoleById, getPoleMapPoints } = require("../controllers/poleController");
const { protect } = require("../middlewares/auth");

router.get("/getAll", protect, getAllPoles);
router.get("/map", protect, getPoleMapPoints);
router.get("/:id", protect, getPoleById);

module.exports = router;
