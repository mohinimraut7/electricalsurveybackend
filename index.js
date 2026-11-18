require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");

const userRoutes = require("./routes/userRoutes");
const meterRoutes = require("./routes/meterRoutes");
const poleRoutes = require("./routes/poleRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const coverageRoutes = require("./routes/coverageRoutes");
const masterRoutes = require("./routes/masterRoutes");

const app = express();

// ── Middlewares ──
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } })); // photos frontend वर दिसाव्या म्हणून
app.use(compression()); // JSON responses gzip — list/map API खूप हलके होतात
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true }));

// ── Login / Register brute-force protection ──
app.use(["/api/users/login", "/api/users/register"], rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// ── Meter / pole photos (import script इथे files लिहितो) ──
app.use("/uploads", express.static(path.join(__dirname, "uploads"), { maxAge: "7d" }));

// ── DB Connect ──
connectDB();

// ── Routes ──
app.use("/api/users", userRoutes);
app.use("/api/meters", meterRoutes);
app.use("/api/poles", poleRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/coverage", coverageRoutes);
app.use("/api/master", masterRoutes);

// ── Health check ──
app.get("/", (req, res) => {
  res.send("✅ VVCMC Electrical Survey Backend (Street-light Meters & Poles) is running");
});

const PORT = process.env.PORT || 5009;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
