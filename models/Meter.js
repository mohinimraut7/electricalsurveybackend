// ══════════════════════════════════════════════════════════
//  Meter Model — Street-light / Garden / Smashan Bhumi electricity meters
//  Source: ward_A.csv … ward_I.csv  (+ MeterData.csv → actual meter photos)
// ══════════════════════════════════════════════════════════
// ConsumerID नेहमी String ठेवतो — 12-14 digit numbers Number मध्ये ठेवले तर
// leading zeros / precision जाऊ शकते.
//
// GeoJSON coordinate order is ALWAYS [longitude, latitude].

const mongoose = require("mongoose");
const { WARDS, METER_PURPOSES, PHASE_TYPES, DATA_FLAGS } = require("../utils/constants");

const meterSchema = new mongoose.Schema(
  {
    // CSV मधील meter photo filename चा UUID भाग (MeterData.csv मधील ApplicationID शी match होतो)
    applicationId: { type: String, required: true, unique: true, trim: true },

    legacyId: { type: String, default: undefined }, // जुन्या VVCM DB (resnewdatas) चा _id

    ward: { type: String, enum: WARDS, required: true }, // indexed via compound indexes below

    consumerId: { type: String, trim: true, default: "", index: true },
    newMeterNumber: { type: String, trim: true, default: "" },

    purpose: { type: String, enum: METER_PURPOSES, default: "Street light", index: true },

    phaseType: { type: String, enum: PHASE_TYPES, required: true },
    phaseCount: { type: Number, enum: [1, 3], required: true },

    address: { type: String, trim: true, default: "" },

    // ── Photos ──
    meterImageFile: { type: String, default: "" },   // original filename from CSV
    meterImageUrl: { type: String, default: "" },    // served path e.g. /uploads/meterPhotos/<id>.jpg
    meterThumbUrl: { type: String, default: "" },    // 320px webp — table/grid साठी
    timerPanelImageFile: { type: String, default: "" },
    timerPanelImageUrl: { type: String, default: "" },

    // ── Load / Timer panel (फक्त Sept-22 नंतरच्या survey मध्ये भरलेलं) ──
    sanctionLoadKw: { type: Number, default: null },
    hasTimerPanel: { type: Boolean, default: null },

    // ── GeoJSON Point ──
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },

    surveyedAt: { type: Date, required: true, index: true },

    // denormalized — import वेळी मोजलेले poles (list मध्ये $lookup न करता दाखवता येतं)
    poleCount: { type: Number, default: 0 },

    dataFlags: { type: [{ type: String, enum: DATA_FLAGS }], default: [] },

    source: { type: String, default: "" }, // e.g. "ward_A.csv:12"
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ── Indexes (speed) ──
meterSchema.index({ location: "2dsphere" });                     // map / nearby queries
meterSchema.index({ ward: 1, surveyedAt: -1 });                  // default list: ward filter + latest first
meterSchema.index({ dataFlags: 1, ward: 1, surveyedAt: -1 });    // test entries लपवून list
meterSchema.index({ ward: 1, purpose: 1, phaseType: 1 });        // filter combos + dashboard group-by

// ── Poles linked by ConsumerID ──
meterSchema.virtual("poles", {
  ref: "Pole",
  localField: "consumerId",
  foreignField: "consumerId",
});

meterSchema.virtual("latitude").get(function () {
  return this.location?.coordinates?.[1];
});
meterSchema.virtual("longitude").get(function () {
  return this.location?.coordinates?.[0];
});

module.exports = mongoose.model("Meter", meterSchema);
