// ── Shared Constants (used across models, controllers & import script) ──

// VVCMC चे सर्व Ward Committees (CSV मध्ये फक्त "A".."I" येतं — import वेळी "Ward A" मध्ये convert होतं)
exports.WARDS = [
  "Ward A", "Ward B", "Ward C", "Ward D",
  "Ward E", "Ward F", "Ward G", "Ward H", "Ward I",
];

// User roles
exports.ROLES = [
  "super_admin",     // full access, no ward restriction   (जुन्या app मध्ये "Admin")
  "ward_engineer",   // ward-wise: स्वतःच्या ward चे meters बघू + edit   ("Junior Engineer")
  "surveyor",        // ward-wise: स्वतःच्या ward चा data फक्त बघू शकतो  ("Surveyor")
  "viewer",          // read-only (सर्व wards) — self-registration
];

// जुन्या VVCM app (logindatas) चे roles → आपले roles
exports.LEGACY_ROLE_MAP = {
  admin: "super_admin",
  "junior engineer": "ward_engineer",
  surveyor: "surveyor",
};

// Meter connection purpose (CSV "Purpose" column)
// (staticdatas.Purpose — Mongo export मधून)
exports.METER_PURPOSES = ["Street light", "Garden", "Pond/Lake", "Smashan Bhumi", "Dafan Bhumi", "Kabrastan"];

// Meter phase (CSV "Type" column → "Three Phase(3)" / "Single Phase(1)")
exports.PHASE_TYPES = ["Single Phase", "Three Phase"];

// Pole types (polesData.csv → TypeofPole.PoleName)
exports.POLE_TYPES = [
  "GI Pole", "Octagonal Pole", "Tubular Pole",
  "Decorative Pole", "HighMast Pole", "On MSEB Pole", "On Wall",
];

// Light types (polesData.csv → TypeofLight.LightName)
// (spelling source data प्रमाणेच ठेवलं — "Matal Helide(MH)")
exports.LIGHT_TYPES = ["LED (Street Light)", "LED Flood", "HPSV(Halogen)", "Matal Helide(MH)"];

// Cable (Response.TypesofCable) — Sept-2024 नंतरच्या pole survey मध्ये
exports.CABLE_TYPES = ["Underground", "Overhead"];

// Data quality flags — import script हे auto लावतो, data delete करत नाही
exports.DATA_FLAGS = [
  "test_entry",          // ConsumerID/Address dummy दिसतो (12345, xyz, ss ...)
  "missing_image",       // meter photo नाही
  "image_not_available", // filename आहे पण actual photo data CSV मध्ये नाही
  "missing_address",
  "suspicious_consumer_id", // खूप लहान / खूप मोठा ConsumerID
  "suspicious_light_count", // NumberLight > 10 (उदा. 22, 123)
  "no_matching_meter",      // pole चा ConsumerID कुठल्याही meter शी match होत नाही
  "out_of_area",            // coordinates VVCMC boundary box बाहेर
  "missing_location",       // pole ला lat/lng नाही
  "not_in_master_list",     // meter चा ConsumerID ward च्या MSEB master list (staticdatas.WardConsumer) मध्ये नाही
];

// Ward letter → "Ward X"
exports.toWard = (letter) => {
  const l = String(letter || "").trim().toUpperCase().replace(/^WARD\s*/, "");
  return /^[A-I]$/.test(l) ? `Ward ${l}` : "";
};
