// ══════════════════════════════════════════════════════════
//  MasterData — dropdown catalogue (single document)
//  Source: staticdatas (Mongo export) — purposes, phase types, light types + watts,
//  pole types + heights + brackets. Cable options data मधून काढले.
// ══════════════════════════════════════════════════════════
const mongoose = require("mongoose");

const masterDataSchema = new mongoose.Schema(
  {
    key: { type: String, default: "main", unique: true },
    wards: [String],
    purposes: [String],
    phaseTypes: [String],
    lightTypes: [{ _id: false, name: String, watts: [String] }],
    poleTypes: [{ _id: false, name: String, heights: [String], bracketTypes: [String], brackets: [String] }],
    cableTypes: [{ _id: false, type: { type: String }, materials: [String], sizes: [String] }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("MasterData", masterDataSchema);
