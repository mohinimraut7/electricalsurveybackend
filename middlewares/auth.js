const jwt = require("jsonwebtoken");

// ── Login असणे आवश्यक (JWT verify) ──
exports.protect = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Token missing ❌" });
    }
    const token = authHeader.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET); // { id, userName, role, ward }
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token ❌" });
  }
};

// ── ठराविक roles लाच access ──  usage: allowRoles("super_admin", "ward_engineer")
exports.allowRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Access denied ❌ (Role not allowed)" });
  }
  next();
};
