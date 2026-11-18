const ConsumerMaster = require("../models/ConsumerMaster");
const Meter = require("../models/Meter");
const { WARDS } = require("../utils/constants");
const { applyWardScope } = require("../utils/wardAccess");
const cache = require("../utils/cache");

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// master consumer → meters मध्ये आहे का (consumerId वर indexed lookup, फक्त 1 doc पुरे)
const lookupMeter = {
  $lookup: {
    from: "meters",
    localField: "consumerId",
    foreignField: "consumerId",
    pipeline: [{ $project: { _id: 1, address: 1, ward: 1, surveyedAt: 1, poleCount: 1 } }, { $limit: 1 }],
    as: "meter",
  },
};

// ── shared helper (dashboard पण वापरतो) ──
exports.computeCoverage = async (user, ward) => {
  const scope = applyWardScope(user, ward ? { ward } : {});
  const key = `coverage:${JSON.stringify(scope)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const [rows, extra] = await Promise.all([
    ConsumerMaster.aggregate([
      { $match: { ...scope, suspicious: { $ne: true } } },
      lookupMeter,
      { $group: { _id: "$ward", master: { $sum: 1 }, surveyed: { $sum: { $cond: [{ $gt: [{ $size: "$meter" }, 0] }, 1, 0] } } } },
    ]),
    Meter.aggregate([
      { $match: { ...scope, dataFlags: "not_in_master_list" } },
      { $match: { dataFlags: { $ne: "test_entry" } } },
      { $group: { _id: "$ward", count: { $sum: 1 } } },
    ]),
  ]);

  const byWard = Object.fromEntries(rows.map((r) => [r._id, r]));
  const extraBy = Object.fromEntries(extra.map((r) => [r._id, r.count]));
  const wards = (scope.ward ? [scope.ward] : WARDS).map((w) => {
    const master = byWard[w]?.master || 0;
    const surveyed = byWard[w]?.surveyed || 0;
    return {
      ward: w,
      master,
      surveyed,
      pending: master - surveyed,
      notInMaster: extraBy[w] || 0,
      percent: master ? Math.round((surveyed / master) * 1000) / 10 : 0,
    };
  });
  const tot = wards.reduce(
    (a, w) => ({ master: a.master + w.master, surveyed: a.surveyed + w.surveyed, pending: a.pending + w.pending, notInMaster: a.notInMaster + w.notInMaster }),
    { master: 0, surveyed: 0, pending: 0, notInMaster: 0 }
  );
  tot.percent = tot.master ? Math.round((tot.surveyed / tot.master) * 1000) / 10 : 0;

  const out = { totals: tot, wards };
  cache.set(key, out);
  return out;
};

// ═══════════════════════════════════════════════════════
//  1) COVERAGE SUMMARY — ward-wise master vs surveyed
// ═══════════════════════════════════════════════════════
exports.getCoverageSummary = async (req, res) => {
  try {
    const data = await exports.computeCoverage(req.user, req.query.ward);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Coverage Summary Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  2) MASTER CONSUMERS — status=pending|surveyed, server-side pagination
// ═══════════════════════════════════════════════════════
exports.getMasterConsumers = async (req, res) => {
  try {
    const { ward, status, search } = req.query;
    const pageNum = Math.max(parseInt(req.query.page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);

    const match = applyWardScope(req.user, ward ? { ward } : {});
    if (req.query.includeJunk !== "true") match.suspicious = { $ne: true };
    if (search && search.trim()) match.consumerId = new RegExp(escapeRegex(search.trim().replace(/^0+(?=\d)/, "")));

    const pipeline = [{ $match: match }, lookupMeter, { $addFields: { meter: { $first: "$meter" } } }];
    if (status === "pending") pipeline.push({ $match: { meter: null } });
    if (status === "surveyed") pipeline.push({ $match: { meter: { $ne: null } } });

    const [r] = await ConsumerMaster.aggregate([
      ...pipeline,
      { $sort: { ward: 1, consumerId: 1 } },
      {
        $facet: {
          total: [{ $count: "n" }],
          data: [{ $skip: (pageNum - 1) * limitNum }, { $limit: limitNum }, { $project: { __v: 0, createdAt: 0, updatedAt: 0 } }],
        },
      },
    ]);
    const total = r.total[0]?.n || 0;

    return res.status(200).json({
      success: true,
      data: r.data,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error("Master Consumers Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};
