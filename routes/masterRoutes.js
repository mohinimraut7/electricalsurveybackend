const express = require("express");
const router = express.Router();

const { getMasterData } = require("../controllers/masterController");
const { protect } = require("../middlewares/auth");

router.get("/", protect, getMasterData);

module.exports = router;
