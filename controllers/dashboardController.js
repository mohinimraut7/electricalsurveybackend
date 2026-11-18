const Meter = require("../models/Meter");
const Pole = require("../models/Pole");
const { WARDS } = require("../utils/constants");
const { applyWardScope } = require("../utils/wardAccess");
const cache = require("../utils/cache");
const { computeCoverage } = require("./coverageController");

const toMap = (arr) => Object.fromEntries(arr.map((x) => [x._id ?? "Unknown", x.count]));

// ═══════════════════════════════════════════════════════
//  DASHBOARD SUMMARY — सर्व counts एकाच call मध्ये
// ═══════════════════════════════════════════════════════
exports.getSummary = async (req, res) => {
  try {
    const includeFlagged = req.query.includeFlagged === "true";
    const cacheKey = `summary:${req.user.role}:${req.user.ward || ""}:${req.query.ward || ""}:${includeFlagged}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.status(200).json({ success: true, cached: true, data: cached });

    const base = applyWardScope(req.user, req.query.ward ? { ward: req.query.ward } : {});
    const meterMatch = includeFlagged ? base : { ...base, dataFlags: { $ne: "test_entry" } };
    const poleMatch = includeFlagged ? { ...base } : { ...base, dataFlags: { $ne: "test_entry" } };

    const [meterAgg] = await Meter.aggregate([
      { $match: meterMatch },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                withPhoto: { $sum: { $cond: [{ $ne: ["$meterImageUrl", ""] }, 1, 0] } },
                withTimerPanel: { $sum: { $cond: [{ $eq: ["$hasTimerPanel", true] }, 1, 0] } },
                totalSanctionLoadKw: { $sum: { $ifNull: ["$sanctionLoadKw", 0] } },
                withLoadData: { $sum: { $cond: [{ $ne: ["$sanctionLoadKw", null] }, 1, 0] } },
              },
            },
          ],
          byWard: [
            {
              $group: {
                _id: "$ward",
                count: { $sum: 1 },
                threePhase: { $sum: { $cond: [{ $eq: ["$phaseCount", 3] }, 1, 0] } },
                load: { $sum: { $ifNull: ["$sanctionLoadKw", 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
          byPurpose: [{ $group: { _id: "$purpose", count: { $sum: 1 } } }, { $sort: { count: -1 } }],
          byPhase: [{ $group: { _id: "$phaseType", count: { $sum: 1 } } }],
          byDate: [
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$surveyedAt" } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]);

    const [poleAgg] = await Pole.aggregate([
      { $match: poleMatch },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                // 22 / 123 सारखे suspicious counts total फुगवू नयेत
                lights: { $sum: { $cond: [{ $in: ["suspicious_light_count", "$dataFlags"] }, 0, "$numberOfLights"] } },
              },
            },
          ],
          byPoleType: [{ $group: { _id: "$pole.name", count: { $sum: 1 } } }, { $sort: { count: -1 } }],
          byLightType: [{ $group: { _id: "$light.name", count: { $sum: 1 } } }, { $sort: { count: -1 } }],
          byCable: [
            { $group: { _id: { $cond: [{ $eq: [{ $ifNull: ["$cable.type", ""] }, ""] }, "Not recorded", "$cable.type"] }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          byWard: [{ $group: { _id: "$ward", count: { $sum: 1 } } }],
          noLocation: [{ $match: { location: { $exists: false } } }, { $count: "n" }],
        },
      },
    ]);

    const coverage = await computeCoverage(req.user, req.query.ward);

    const flagCounts = await Meter.aggregate([
      { $match: base },
      { $unwind: "$dataFlags" },
      { $group: { _id: "$dataFlags", count: { $sum: 1 } } },
    ]);

    const t = meterAgg.totals[0] || { total: 0, withPhoto: 0, withTimerPanel: 0, totalSanctionLoadKw: 0, withLoadData: 0 };
    const wardMap = Object.fromEntries(meterAgg.byWard.map((w) => [w._id, w]));

    const data = {
        meters: {
          total: t.total,
          withPhoto: t.withPhoto,
          withTimerPanel: t.withTimerPanel,
          withLoadData: t.withLoadData,
          totalSanctionLoadKw: Math.round(t.totalSanctionLoadKw * 100) / 100,
          byPurpose: toMap(meterAgg.byPurpose),
          byPhase: toMap(meterAgg.byPhase),
          byDate: meterAgg.byDate.map((d) => ({ date: d._id, count: d.count })),
          byWard: WARDS.map((w) => ({
            ward: w,
            count: wardMap[w]?.count || 0,
            threePhase: wardMap[w]?.threePhase || 0,
            sanctionLoadKw: Math.round((wardMap[w]?.load || 0) * 100) / 100,
          })),
        },
        poles: {
          total: poleAgg.totals[0]?.total || 0,
          lights: poleAgg.totals[0]?.lights || 0,
          byPoleType: toMap(poleAgg.byPoleType),
          byLightType: toMap(poleAgg.byLightType),
          byCable: toMap(poleAgg.byCable),
          byWard: toMap(poleAgg.byWard),
          withoutLocation: poleAgg.noLocation[0]?.n || 0,
        },
        coverage: coverage.totals,
        dataQuality: toMap(flagCounts),
    };
    cache.set(cacheKey, data);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Dashboard Summary Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};
