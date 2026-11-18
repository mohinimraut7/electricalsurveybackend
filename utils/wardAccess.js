// ── Ward-wise access control helper ──
// ward_engineer / surveyor ला फक्त स्वतःच्या ward चा data. super_admin / viewer ला सर्व wards.

exports.WARD_SCOPED_ROLES = ["ward_engineer", "surveyor"];

/** query filter मध्ये ward lock लावतो (client ने दिलेला ward ignore होतो) */
exports.applyWardScope = (user, filter = {}) => {
  if (exports.WARD_SCOPED_ROLES.includes(user?.role)) {
    filter.ward = user.ward || "__none__";
  }
  return filter;
};

/** single record वर action करताना check */
exports.checkWardAccess = (user, targetWard) => {
  if (!user) return { ok: false, message: "Unauthorized ❌" };
  if (!exports.WARD_SCOPED_ROLES.includes(user.role)) return { ok: true };
  if (!user.ward) return { ok: false, message: "तुमच्या account ला ward assign नाही ❌" };
  if (targetWard && user.ward !== targetWard) {
    return { ok: false, message: `Access denied ❌ — तुम्ही फक्त ${user.ward} चा data बघू शकता` };
  }
  return { ok: true };
};
