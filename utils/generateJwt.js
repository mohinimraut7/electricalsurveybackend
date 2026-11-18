const jwt = require("jsonwebtoken");

module.exports = (user) =>
  jwt.sign(
    { id: user._id, userName: user.userName, role: user.role, ward: user.ward || "" },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
