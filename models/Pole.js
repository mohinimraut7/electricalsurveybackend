// ══════════════════════════════════════════════════════════
//  Pole Model — Street-light poles surveyed against a meter (ConsumerID)
//  Source: polesData.csv
// ══════════════════════════════════════════════════════════
// CSV मध्ये TypeofPole / TypeofLight हे Python-dict style strings आहेत:
//   {'PoleName': 'GI Pole', 'HightofPole': '6 meter', 'TypeofBracket': '', 'Bracket': '1 way bracket'}
// import वेळी ते proper sub-documents मध्ये parse होतात.

const mongoose = require("mongoose");
const { WARDS, POLE_TYPES, LIGHT_TYPES, DATA_FLAGS } = require("../utils/constants");

const poleSchema = new mongoose.Schema(
  {
    legacyId: { type: String, unique: true, sparse: true }, // CSV "_id" (old Mongo ObjectId)

    ward: { type: String, enum: WARDS, required: true }, // indexed via compound indexes below
    consumerId: { type: String, trim: true, default: "", index: true }, // → Meter.consumerId

    pole: {
      name: { type: String, enum: POLE_TYPES, required: true },
      height: { type: String, default: "" },       // "6 meter", "12.5 meter", "Pipe Pole Bracket"
      heightMeters: { type: Number, default: null }, // parsed numeric height (null for MSEB pipe bracket)
      bracketType: { type: String, default: "" },  // "Fixed", "motarized(movable)"
      bracket: { type: String, default: "" },      // "1 way bracket" …
    },

    light: {
      name: { type: String, enum: LIGHT_TYPES, required: true },
      watts: { type: String, default: "" },        // raw: "120w", "40-50w"
      wattsMin: { type: Number, default: null },
      wattsMax: { type: Number, default: null },
    },

    // Sept-2024 नंतरच्या survey मध्ये cable details
    cable: {
      type: { type: String, default: "" },    // "Underground" / "Overhead"
      material: { type: String, default: "" },// "Aluminium" / "Copper"
      size: { type: String, default: "" },    // "4x16", "4x6" …
    },

    numberOfLights: { type: Number, default: null, min: 0 },

    poleImageFile: { type: String, default: "" }, // original filename (photo data नसला तरी)
    poleImageUrl: { type: String, default: "" },
    poleThumbUrl: { type: String, default: "" },

    // 107 poles ना GPS नाही → location optional (2dsphere index missing field skip करतो)
    location: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },

    surveyedAt: { type: Date, required: true },

    dataFlags: { type: [{ type: String, enum: DATA_FLAGS }], default: [] },

    source: { type: String, default: "" },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

poleSchema.index({ location: "2dsphere" });
poleSchema.index({ ward: 1, consumerId: 1 });
poleSchema.index({ "pole.name": 1, "light.name": 1 });
poleSchema.index({ consumerId: 1, surveyedAt: 1 });          // meter detail → poles
poleSchema.index({ dataFlags: 1, ward: 1, surveyedAt: -1 }); // default list

poleSchema.virtual("meter", {
  ref: "Meter",
  localField: "consumerId",
  foreignField: "consumerId",
  justOne: true,
});

module.exports = mongoose.model("Pole", poleSchema);
