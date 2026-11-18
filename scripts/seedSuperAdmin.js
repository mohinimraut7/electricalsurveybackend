// ── Super Admin create (idempotent) ──  usage: npm run seed:admin
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const userName = (process.env.SUPER_ADMIN_USERNAME || "admin").toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || "Admin@123";

  const exists = await User.findOne({ userName });
  if (exists) {
    console.log(`ℹ️  Super admin "${userName}" already exists`);
  } else {
    await User.create({
      fullName: "Super Admin",
      userName,
      password: await bcrypt.hash(password, 10),
      role: "super_admin",
      isActive: true,
    });
    console.log(`✅ Super admin created → username: ${userName}`);
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error("❌ Seed failed:", e.message);
  process.exit(1);
});
