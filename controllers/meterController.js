const ExcelJS = require("exceljs");
const Meter = require("../models/Meter");
const { applyWardScope, checkWardAccess } = require("../utils/wardAccess");
const cache = require("../utils/cache");

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── query string → mongo filter (ward scope नेहमी JWT वरून) ──
const buildFilter = (req) => {
  const { ward, purpose, phaseType, hasImage, hasTimerPanel, hasPoles, flag, includeFlagged, search, from, to } = req.query;
  const filter = {};

  if (ward) filter.ward = ward;
  if (purpose) filter.purpose = purpose;
  if (phaseType) filter.phaseType = phaseType;
  if (hasImage === "true") filter.meterImageUrl = { $ne: "" };
  if (hasImage === "false") filter.meterImageUrl = "";
  if (hasTimerPanel === "true") filter.hasTimerPanel = true;
  if (hasTimerPanel === "false") filter.hasTimerPanel = { $ne: true };
  if (hasPoles === "true") filter.poleCount = { $gt: 0 };
  if (hasPoles === "false") filter.poleCount = 0;

  if (flag) filter.dataFlags = flag;
  else if (includeFlagged !== "true") filter.dataFlags = { $ne: "test_entry" }; // default: test entries लपवा

  if (search && search.trim()) {
    const q = search.trim();
    const rx = new RegExp(escapeRegex(q), "i");
    // ConsumerID leading zeros शिवाय साठवले आहेत ("001544…" शोधलं तरी सापडावं)
    const idRx = /^\d+$/.test(q) ? new RegExp(escapeRegex(q.replace(/^0+(?=\d)/, ""))) : rx;
    filter.$or = [{ address: rx }, { consumerId: idRx }, { newMeterNumber: rx }];
  }

  if (from || to) {
    filter.surveyedAt = {};
    if (from) filter.surveyedAt.$gte = new Date(from);
    if (to) filter.surveyedAt.$lte = new Date(`${to}T23:59:59`);
  }

  return applyWardScope(req.user, filter);
};

// ═══════════════════════════════════════════════════════
//  1) GET ALL METERS — filters + search + pagination
// ═══════════════════════════════════════════════════════
exports.getAllMeters = async (req, res) => {
  try {
    const pageNum = Math.max(parseInt(req.query.page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
    const sortField = ["surveyedAt", "ward", "consumerId", "sanctionLoadKw", "address", "poleCount"].includes(req.query.sort)
      ? req.query.sort
      : "surveyedAt";
    const sortDir = req.query.order === "asc" ? 1 : -1;

    const filter = buildFilter(req);
    const [total, meters] = await Promise.all([
      Meter.countDocuments(filter),
      Meter.find(filter)
        .sort({ [sortField]: sortDir, _id: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select("-__v -source")
        .lean({ virtuals: false }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Meters Fetched Successfully ✅",
      data: meters,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error("Get All Meters Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  2) MAP POINTS — lightweight list (map साठी, pagination नाही)
// ═══════════════════════════════════════════════════════
exports.getMeterMapPoints = async (req, res) => {
  try {
    const meters = await Meter.find(buildFilter(req))
      .select("ward consumerId purpose phaseType address location meterThumbUrl sanctionLoadKw poleCount")
      .lean();
    const data = meters.map((m) => ({
      id: m._id,
      ward: m.ward,
      consumerId: m.consumerId,
      purpose: m.purpose,
      phaseType: m.phaseType,
      address: m.address,
      lat: m.location.coordinates[1],
      lng: m.location.coordinates[0],
      thumb: m.meterThumbUrl || "",
      sanctionLoadKw: m.sanctionLoadKw,
      poleCount: m.poleCount || 0,
    }));
    return res.status(200).json({ success: true, data, total: data.length });
  } catch (error) {
    console.error("Map Points Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  3) GET METER BY ID — linked poles सोबत
// ═══════════════════════════════════════════════════════
exports.getMeterById = async (req, res) => {
  try {
    const meter = await Meter.findById(req.params.id).populate({
      path: "poles",
      select: "-source -__v",
      options: { sort: { surveyedAt: 1 } },
    });
    if (!meter) return res.status(404).json({ success: false, message: "Meter not found ❌" });

    const access = checkWardAccess(req.user, meter.ward);
    if (!access.ok) return res.status(403).json({ success: false, message: access.message });

    return res.status(200).json({ success: true, data: meter });
  } catch (error) {
    console.error("Get Meter Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  4) NEARBY METERS — lat/lng पासून radius (m) मध्ये
// ═══════════════════════════════════════════════════════
exports.getNearbyMeters = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = Math.min(parseInt(req.query.radius) || 500, 10000);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ success: false, message: "lat आणि lng आवश्यक ❌" });
    }

    const filter = applyWardScope(req.user, {
      location: { $nearSphere: { $geometry: { type: "Point", coordinates: [lng, lat] }, $maxDistance: radius } },
    });
    const meters = await Meter.find(filter).limit(50);
    return res.status(200).json({ success: true, data: meters, total: meters.length });
  } catch (error) {
    console.error("Nearby Meters Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  5) UPDATE METER — ward_engineer (स्वतःचा ward) / super_admin
// ═══════════════════════════════════════════════════════
const EDITABLE = ["newMeterNumber", "purpose", "address", "sanctionLoadKw", "hasTimerPanel", "dataFlags"];

exports.updateMeter = async (req, res) => {
  try {
    const meter = await Meter.findById(req.params.id);
    if (!meter) return res.status(404).json({ success: false, message: "Meter not found ❌" });

    const access = checkWardAccess(req.user, meter.ward);
    if (!access.ok) return res.status(403).json({ success: false, message: access.message });

    EDITABLE.forEach((k) => {
      if (req.body[k] !== undefined) meter[k] = req.body[k];
    });
    await meter.save();
    cache.clear();

    return res.status(200).json({ success: true, message: "Meter Updated ✅", data: meter });
  } catch (error) {
    console.error("Update Meter Error:", error);
    const code = error.name === "ValidationError" ? 400 : 500;
    return res.status(code).json({ success: false, message: "Update failed ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  6) EXPORT EXCEL — current filters नुसार
// ═══════════════════════════════════════════════════════
exports.exportMeters = async (req, res) => {
  try {
    const meters = await Meter.find(buildFilter(req)).sort({ ward: 1, surveyedAt: 1 }).lean();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Meters");
    ws.columns = [
      { header: "Ward", key: "ward", width: 10 },
      { header: "Consumer ID", key: "consumerId", width: 18 },
      { header: "New Meter No.", key: "newMeterNumber", width: 16 },
      { header: "Purpose", key: "purpose", width: 15 },
      { header: "Phase", key: "phaseType", width: 14 },
      { header: "Address", key: "address", width: 40 },
      { header: "Sanction Load (kW)", key: "sanctionLoadKw", width: 18 },
      { header: "Timer Panel", key: "hasTimerPanel", width: 12 },
      { header: "Latitude", key: "lat", width: 12 },
      { header: "Longitude", key: "lng", width: 12 },
      { header: "Surveyed At", key: "surveyedAt", width: 20 },
      { header: "Poles", key: "poleCount", width: 8 },
      { header: "Photo", key: "photo", width: 8 },
      { header: "Data Flags", key: "flags", width: 30 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00843C" } };

    meters.forEach((m) =>
      ws.addRow({
        ...m,
        hasTimerPanel: m.hasTimerPanel === null ? "" : m.hasTimerPanel ? "Yes" : "No",
        lat: m.location.coordinates[1],
        lng: m.location.coordinates[0],
        photo: m.meterImageUrl ? "Yes" : "No",
        flags: (m.dataFlags || []).join(", "),
      })
    );

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="meters-${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Export Meters Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};
