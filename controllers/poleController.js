const Pole = require("../models/Pole");
const { applyWardScope, checkWardAccess } = require("../utils/wardAccess");

// ═══════════════════════════════════════════════════════
//  1) GET ALL POLES — filters + pagination
// ═══════════════════════════════════════════════════════
exports.getAllPoles = async (req, res) => {
  try {
    const { ward, consumerId, poleType, lightType, cableType, flag, hasLocation, includeFlagged } = req.query;
    const pageNum = Math.max(parseInt(req.query.page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);

    const filter = {};
    if (ward) filter.ward = ward;
    if (consumerId) filter.consumerId = consumerId;
    if (poleType) filter["pole.name"] = poleType;
    if (lightType) filter["light.name"] = lightType;
    if (cableType === "none") filter["cable.type"] = "";
    else if (cableType) filter["cable.type"] = cableType;
    if (hasLocation === "false") filter.location = { $exists: false };
    if (flag) filter.dataFlags = flag;
    else if (includeFlagged !== "true") filter.dataFlags = { $ne: "test_entry" };
    applyWardScope(req.user, filter);

    const [total, poles] = await Promise.all([
      Pole.countDocuments(filter),
      Pole.find(filter)
        .populate({ path: "meter", select: "address purpose phaseType ward consumerId" })
        .select("-source -__v")
        .sort({ surveyedAt: -1, _id: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
    ]);

    return res.status(200).json({
      success: true,
      message: "Poles Fetched Successfully ✅",
      data: poles,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error("Get All Poles Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  2) GET POLE BY ID
// ═══════════════════════════════════════════════════════
exports.getPoleById = async (req, res) => {
  try {
    const pole = await Pole.findById(req.params.id).populate("meter");
    if (!pole) return res.status(404).json({ success: false, message: "Pole not found ❌" });

    const access = checkWardAccess(req.user, pole.ward);
    if (!access.ok) return res.status(403).json({ success: false, message: access.message });

    return res.status(200).json({ success: true, data: pole });
  } catch (error) {
    console.error("Get Pole Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  3) MAP POINTS — 7k+ poles, फक्त lat/lng + 3 fields (gzip नंतर ~100 KB)
// ═══════════════════════════════════════════════════════
exports.getPoleMapPoints = async (req, res) => {
  try {
    const filter = applyWardScope(req.user, {
      location: { $exists: true },
      dataFlags: { $ne: "test_entry" },
      ...(req.query.ward ? { ward: req.query.ward } : {}),
    });
    const poles = await Pole.find(filter).select("location pole.name light.name consumerId").lean();
    // compact array format: [lat, lng, poleName, lightName, consumerId]
    const data = poles.map((p) => [
      p.location.coordinates[1],
      p.location.coordinates[0],
      p.pole.name,
      p.light.name,
      p.consumerId,
    ]);
    return res.status(200).json({ success: true, data, total: data.length });
  } catch (error) {
    console.error("Pole Map Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};
