const express = require("express");
const router = express.Router();

const { login, register, getMe, createUser, getAllUsers, updateUser } = require("../controllers/userController");
const { protect, allowRoles } = require("../middlewares/auth");

// ── Staff login ──
router.post("/login", login);
router.post("/register", register);

// ── Current user ──
router.get("/me", protect, getMe);

// ── User management — super_admin only ──
router.post("/create", protect, allowRoles("super_admin"), createUser);
router.get("/getAll", protect, allowRoles("super_admin"), getAllUsers);
router.patch("/:id", protect, allowRoles("super_admin"), updateUser);

module.exports = router;
