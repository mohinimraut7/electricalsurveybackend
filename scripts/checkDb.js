// ── MongoDB connection check ──  usage: npm run db:check
// Atlas connect होतो का, version, आणि collections मध्ये किती documents आहेत ते दाखवतो.
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

(async () => {
  const uri = process.env.MONGO_URI || "";
  console.log("🔌 Connecting to", uri.replace(/\/\/([^:]+):[^@]+@/, "//$1:****@"));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const info = await db.admin().command({ buildInfo: 1 });
  console.log(`✅ Connected — MongoDB ${info.version}, database "${db.databaseName}"`);
  const cols = await db.listCollections().toArray();
  if (!cols.length) console.log("ℹ️  Database रिकामा आहे — आता `npm run import:data` चालवा");
  for (const c of cols) console.log(`   ${c.name.padEnd(18)} ${await db.collection(c.name).estimatedDocumentCount()}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error("❌ Connection failed:", e.message);
  if (/ENOTFOUND|querySrv/i.test(e.message)) console.error("   → internet / DNS तपासा (office network वर SRV lookup block असू शकतो)");
  if (/whitelist|not authorized|timed out|Server selection/i.test(e.message))
    console.error("   → Atlas → Network Access मध्ये तुमचा IP add करा (Add Current IP Address)");
  if (/auth|bad auth|Authentication/i.test(e.message)) console.error("   → Atlas → Database Access मध्ये username/password तपासा");
  process.exit(1);
});
