// ══════════════════════════════════════════════════════════
//  ConsumerMaster — ward-wise street-light consumer list (जुन्या app चा master data)
//  Source: staticdatas.WardConsumer (Mongo export)  — 1709 entries, 1509 unique
// ══════════════════════════════════════════════════════════
// Survey coverage साठी: list मधले कोणते consumers survey झाले, कोणते बाकी.
const mongoose = require("mongoose");
const { WARDS } = require("../utils/constants");

const consumerMasterSchema = new mongoose.Schema(
  {
    ward: { type: String, enum: WARDS, required: true },
    // matching साठी normalized (leading zeros काढलेले) — meters मध्ये ConsumerID number म्हणून
    // साठवला गेल्याने "001544075876" → "1544075876" झाला होता
    consumerId: { type: String, required: true, trim: true },
    consumerIdRaw: { type: String, default: "" }, // master list मध्ये जसा होता तसा
    // उघड junk entries (236, 666466646664, 9999994999994 …) — coverage मोजताना वगळतो
    suspicious: { type: Boolean, default: false },
  },
  { timestamps: true }
);

consumerMasterSchema.index({ ward: 1, consumerId: 1 }, { unique: true });
consumerMasterSchema.index({ consumerId: 1 });

module.exports = mongoose.model("ConsumerMaster", consumerMasterSchema);
