const MasterData = require("../models/MasterData");
const C = require("../utils/constants");
const cache = require("../utils/cache");

// ═══════════════════════════════════════════════════════
//  MASTER DATA — dropdown catalogue (staticdatas)
//  import झालं नसेल तर constants मधून fallback
// ═══════════════════════════════════════════════════════
exports.getMasterData = async (req, res) => {
  try {
    let data = cache.get("master");
    if (!data) {
      data = await MasterData.findOne({ key: "main" }).select("-_id -__v -key").lean();
      if (!data) {
        data = {
          wards: C.WARDS,
          purposes: C.METER_PURPOSES,
          phaseTypes: C.PHASE_TYPES,
          lightTypes: C.LIGHT_TYPES.map((name) => ({ name, watts: [] })),
          poleTypes: C.POLE_TYPES.map((name) => ({ name, heights: [], bracketTypes: [], brackets: [] })),
          cableTypes: C.CABLE_TYPES.map((type) => ({ type, materials: [], sizes: [] })),
          fallback: true,
        };
      }
      cache.set("master", data, 10 * 60 * 1000);
    }
    res.set("Cache-Control", "private, max-age=300");
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Master Data Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};
