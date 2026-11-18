// ══════════════════════════════════════════════════════════
//  DATA IMPORT → MongoDB   (Mongo JSON export + CSV files + photos)
// ══════════════════════════════════════════════════════════
//  Usage:
//    node scripts/importData.js                  → import / upsert (re-run safe)
//    node scripts/importData.js --dry-run        → DB शिवाय parse + schema validate + report
//    node scripts/importData.js --drop           → आधी meters/poles/master collections रिकामे
//    node scripts/importData.js --skip-users     → जुने VVCM users import करू नका
//    node scripts/importData.js --dry-run --with-photos      → DB शिवाय photos + thumbnails लिहा
//    node scripts/importData.js --dry-run --json-out=./export → parsed docs JSON
//    node scripts/importData.js --data-dir=./data
//
//  Sources (data/ folder):
//   data/mongoExport/  (startto29April — जुन्या VVCM database चा export, PRIMARY source)
//     VVCM.resnewdatas.json  → 999 meters, प्रत्येकाच्या "Response" array मध्ये poles (7,341) + cable
//     VVCM.resnewdats.json   → 420 meters (resnewdatas चा जुना subset — फक्त missing असतील तर वापरतो)
//     VVCM.staticdatas.json  → dropdown master + WardConsumer (ward-wise MSEB consumer list)
//     VVCM.logindatas.json   → users (फक्त bcrypt HashPassword वापरतो; plaintext Password कधीच नाही)
//   data/ward_A.csv … ward_I.csv → 538 meters (export मध्ये आधीच आहेत — extra असतील तेच add होतात)
//   data/MeterData.csv           → 131 meter photos (base64)
//   data/polesData.csv           → 28 जुने (June-July 2024) poles + photos
//
//  Merge rules:
//   • Meter key = ApplicationID. JSON export जिंकतो (newer). CSV row चा ApplicationID वेगळा असला
//     पण ConsumerID + Date + Time same असेल तर तोच meter समजतो (120 असे rows आहेत).
//   • Base64 photos DB मध्ये नाहीत → uploads/ मध्ये file + 320px webp thumbnail.
//   • काहीच delete नाही — संशयास्पद data ला dataFlags लावतो.
// ══════════════════════════════════════════════════════════

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const sharp = require("sharp");
const { parse } = require("csv-parse");
const { parse: parseSync } = require("csv-parse/sync");

const Meter = require("../models/Meter");
const Pole = require("../models/Pole");
const User = require("../models/User");
const ConsumerMaster = require("../models/ConsumerMaster");
const MasterData = require("../models/MasterData");
const { toWard, METER_PURPOSES, POLE_TYPES, LIGHT_TYPES, WARDS, LEGACY_ROLE_MAP } = require("../utils/constants");

// ── CLI args ──
const args = process.argv.slice(2);
const argVal = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=");
const DRY_RUN = args.includes("--dry-run");
const DROP = args.includes("--drop");
const SKIP_USERS = args.includes("--skip-users");
const WRITE_PHOTOS = !DRY_RUN || args.includes("--with-photos");
const JSON_OUT = argVal("json-out");
const DATA_DIR = path.resolve(argVal("data-dir") || path.join(__dirname, "..", "data"));
const EXPORT_DIR = path.join(DATA_DIR, "mongoExport");
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const METER_PHOTO_DIR = path.join(UPLOAD_DIR, "meterPhotos");
const POLE_PHOTO_DIR = path.join(UPLOAD_DIR, "polePhotos");

// VVCMC area चा ढोबळ bounding box
const AREA = { minLat: 19.25, maxLat: 19.55, minLng: 72.7, maxLng: 72.98 };
const JUNK_ADDRESSES = new Set(["xyz", "ss", "abc", "test", "na", "-"]);
const DUMMY_CONSUMER_IDS = new Set(["120", "12345", "123456", "1234567890", "9876543210", "563893"]);

const report = {
  sources: {},
  meters: { fromJson: 0, fromCsvExtra: 0, csvMerged: 0, valid: 0, skipped: [], perWard: {}, photosWritten: 0, flags: {} },
  poles: { fromJson: 0, fromCsv: 0, valid: 0, skipped: [], photosWritten: 0, flags: {} },
  master: { consumers: 0, duplicatesDropped: 0, suspicious: 0 },
  users: { found: 0, imported: 0, skippedExisting: 0 },
};

// ═══════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// Mongo Extended JSON → plain value  ({$numberLong:"9001"} → "9001", {$oid} → "66b…")
const ej = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("$numberLong" in v) return v.$numberLong;
    if ("$numberInt" in v) return v.$numberInt;
    if ("$numberDouble" in v) return v.$numberDouble;
    if ("$oid" in v) return v.$oid;
    if ("$date" in v) return typeof v.$date === "object" ? ej(v.$date) : v.$date;
  }
  return v;
};
const str = (v) => {
  const x = ej(v);
  return x === null || x === undefined ? "" : clean(x);
};

const toDate = (d, t) => {
  const date = clean(d);
  const time = clean(t) || "00:00:00";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dt = new Date(`${date}T${time.length === 5 ? time + ":00" : time}+05:30`);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const toPoint = (lat, lng) => {
  const la = parseFloat(ej(lat));
  const ln = parseFloat(ej(lng));
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return null;
  return { type: "Point", coordinates: [ln, la] };
};

const outOfArea = ([lng, lat]) => lat < AREA.minLat || lat > AREA.maxLat || lng < AREA.minLng || lng > AREA.maxLng;

const normalizePurpose = (p) => {
  const v = clean(p).toLowerCase();
  return METER_PURPOSES.find((x) => x.toLowerCase() === v) || "Street light";
};

const parsePhase = (t) => {
  const count = /\(3\)|three/i.test(clean(t)) ? 3 : 1;
  return { phaseType: count === 3 ? "Three Phase" : "Single Phase", phaseCount: count };
};

const parseTimerPanel = (v) => (/^yes$/i.test(clean(v)) ? true : /^no$/i.test(clean(v)) ? false : null);

const parseLoad = (v) => {
  const n = parseFloat(ej(v));
  return Number.isFinite(n) ? n : null;
};

const imageUuid = (filename) => clean(filename).replace(/\.(jpe?g|png)$/i, "").replace(/_meter$/i, "");

// ConsumerID matching: फक्त digits, leading zeros नाहीत
const normId = (v) => {
  const s = clean(v);
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s;
};

// master list मधील उघड junk IDs
const isJunkId = (id) => {
  if (id.length < 7 || DUMMY_CONSUMER_IDS.has(id)) return true;
  if (/123456789|987654321/.test(id)) return true;
  const counts = [...id].reduce((a, c) => ((a[c] = (a[c] || 0) + 1), a), {});
  return Math.max(...Object.values(counts)) >= id.length - 2; // 666466646664, 9999994999994
};

const matchKey = (consumerId, surveyedAt) => `${consumerId}|${surveyedAt?.getTime()}`;

const countFlags = (bucket, flags) => flags.forEach((f) => (bucket[f] = (bucket[f] || 0) + 1));

const readJson = (file) => {
  const p = path.join(EXPORT_DIR, file);
  if (!fs.existsSync(p)) return null;
  report.sources[file] = true;
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

// "data:image/jpeg;base64,...." → original file + 320px webp thumbnail
const writeDataUri = async (dataUri, dir, baseName) => {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/s.exec(String(dataUri || "").trim());
  if (!m) return null;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const file = `${baseName}.${ext}`;
  const thumb = `${baseName}_thumb.webp`;
  const buf = Buffer.from(m[2], "base64");
  try {
    if (!WRITE_PHOTOS) await sharp(buf).metadata();
    else {
      fs.writeFileSync(path.join(dir, file), buf);
      await sharp(buf).rotate().resize({ width: 320, withoutEnlargement: true }).webp({ quality: 70 }).toFile(path.join(dir, thumb));
    }
  } catch (e) {
    console.warn(`⚠️  corrupt image ${baseName}: ${e.message}`);
    return null;
  }
  return { file, thumb };
};

// "{'PoleName': 'GI Pole', ...}" (Python-dict string) किंवा actual object → object
const parseDictLike = (s) => {
  if (s && typeof s === "object") return s;
  const out = {};
  const re = /['"](\w+)['"]\s*:\s*['"]([^'"]*)['"]/g;
  let m;
  while ((m = re.exec(String(s || "")))) out[m[1]] = m[2].trim();
  return out;
};

// ── Meter flags (master list नंतर "not_in_master_list" वेगळा लावतो) ──
const meterFlags = (m, hasImageRef) => {
  const flags = [];
  const id = m.consumerId;
  if (DUMMY_CONSUMER_IDS.has(id) || JUNK_ADDRESSES.has(m.address.toLowerCase()) || (!hasImageRef && id.length < 7)) flags.push("test_entry");
  if (!hasImageRef) flags.push("missing_image");
  if (!m.address) flags.push("missing_address");
  if (id.length < 9 || id.length > 13) flags.push("suspicious_consumer_id");
  if (outOfArea(m.location.coordinates)) flags.push("out_of_area");
  return flags;
};

// ═══════════════════════════════════════════════════════
//  POLE builder — CSV row आणि JSON Response दोघांसाठी
// ═══════════════════════════════════════════════════════
function buildPole({ legacyId, ward, consumerId, pole: p, light: l, cable, numberLight, imageFile, lat, lng, date, time, fallbackDate, source }) {
  if (!ward) return { error: "invalid ward" };
  if (!POLE_TYPES.includes(p.PoleName) || !LIGHT_TYPES.includes(l.LightName)) {
    return { error: `unknown pole/light: ${p.PoleName} / ${l.LightName}` };
  }
  const location = toPoint(lat, lng);
  const surveyedAt = toDate(date, time) || fallbackDate;
  if (!surveyedAt) return { error: "invalid date" };

  const n = numberLight === null || numberLight === undefined || numberLight === "" ? null : parseInt(ej(numberLight));
  const numberOfLights = Number.isFinite(n) ? n : null;
  const heightNum = /([\d.]+)\s*m/i.exec(p.HightofPole || "");
  const watts = /(\d+)\s*(?:-\s*(\d+))?\s*w/i.exec(l.Watts || "");

  const flags = [];
  if (DUMMY_CONSUMER_IDS.has(consumerId)) flags.push("test_entry");
  // Light count plausibility — bracket च्या ways पेक्षा जास्त lights शक्य नाहीत
  //   "N way bracket" → max N×2 (double fitting) ; bracket नाही (MSEB / wall) → 4 ; HighMast → 16
  //   उदा. "GI Pole, 1 way bracket" वर 17 lights = surveyor ने serial no. टाकलेला दिसतो
  const ways = parseInt((/(\d+)\s*way/i.exec(p.Bracket || "") || [])[1]);
  const lightLimit = p.PoleName === "HighMast Pole" ? Math.max(16, (ways || 0) * 2) : ways ? ways * 2 : 4;
  if (numberOfLights !== null && numberOfLights > lightLimit) flags.push("suspicious_light_count");
  if (!location) flags.push("missing_location");
  else if (outOfArea(location.coordinates)) flags.push("out_of_area");

  const doc = {
    ...(mongoose.isValidObjectId(legacyId) ? { _id: new mongoose.Types.ObjectId(legacyId) } : {}),
    legacyId: legacyId || undefined,
    ward,
    consumerId,
    pole: {
      name: p.PoleName,
      height: p.HightofPole || "",
      heightMeters: heightNum ? parseFloat(heightNum[1]) : null,
      bracketType: p.TypeofBracket || "",
      bracket: p.Bracket || "",
    },
    light: {
      name: l.LightName,
      watts: l.Watts || "",
      wattsMin: watts ? parseInt(watts[1]) : null,
      wattsMax: watts ? parseInt(watts[2] || watts[1]) : null,
    },
    cable: {
      type: clean(cable?.CableType),
      material: clean(cable?.SubTypeName),
      size: clean(cable?.CableWatts),
    },
    numberOfLights,
    poleImageFile: clean(imageFile && !String(imageFile).startsWith("data:") ? imageFile : ""),
    poleImageUrl: "",
    poleThumbUrl: "",
    surveyedAt,
    dataFlags: flags,
    source,
  };
  if (location) doc.location = location;
  return { doc };
}

// ═══════════════════════════════════════════════════════
//  1) Mongo JSON export
// ═══════════════════════════════════════════════════════
function readMongoExport() {
  const out = { meters: new Map(), poles: [], master: null, wardConsumers: [], users: [] };
  if (!fs.existsSync(EXPORT_DIR)) {
    console.warn("⚠️  data/mongoExport/ नाही — फक्त CSV import");
    return out;
  }

  // resnewdatas (999) primary; resnewdats (420) फक्त missing ApplicationID साठी
  const collections = [
    ["VVCM.resnewdatas.json", readJson("VVCM.resnewdatas.json") || []],
    ["VVCM.resnewdats.json", readJson("VVCM.resnewdats.json") || []],
  ];

  for (const [file, docs] of collections) {
    docs.forEach((d, i) => {
      const applicationId = str(d.ApplicationID);
      const source = `${file}#${i}`;
      if (!applicationId || out.meters.has(applicationId)) return;

      const ward = toWard(d.WardCommittee);
      const location = toPoint(d.MeterLatitude, d.MeterLongitude);
      const surveyedAt = toDate(d.Date, d.Time);
      if (!ward || !location || !surveyedAt) {
        report.meters.skipped.push({ source, reason: "invalid ward/coordinates/date" });
        return;
      }

      const meterImageFile = str(d.MeterImageData);
      const timerImg = str(d.TimerPanelImage);
      const m = {
        applicationId,
        legacyId: str(d._id),
        ward,
        consumerId: normId(str(d.ConsumerID)),
        newMeterNumber: str(d.NewMeterNumber),
        purpose: normalizePurpose(d.Purpose),
        ...parsePhase(d.Type),
        address: str(d.Address),
        meterImageFile,
        meterImageUrl: "",
        meterThumbUrl: "",
        timerPanelImageFile: timerImg,
        timerPanelImageUrl: "",
        sanctionLoadKw: parseLoad(d.SanctionLoad),
        hasTimerPanel: parseTimerPanel(d.TimerPanel),
        location,
        surveyedAt,
        dataFlags: [],
        source,
      };
      m.dataFlags = meterFlags(m, !!meterImageFile);
      out.meters.set(applicationId, m);
      report.meters.fromJson++;

      // ── embedded poles ──
      (d.Response || []).forEach((r, j) => {
        const res = buildPole({
          legacyId: str(r._id),
          ward: toWard(r.WardCommittee) || ward,
          consumerId: normId(str(r.ConsumerID)) || m.consumerId,
          pole: parseDictLike(r.TypeofPole),
          light: parseDictLike(r.TypeofLight),
          cable: r.TypesofCable,
          numberLight: r.NumberLight,
          imageFile: r.PoleImageData,
          lat: r.PoleLatitude,
          lng: r.PoleLongitude,
          date: r.Date,
          time: r.Time,
          fallbackDate: surveyedAt,
          source: `${source}.Response#${j}`,
        });
        if (res.error) report.poles.skipped.push({ source: `${source}.Response#${j}`, reason: res.error });
        else {
          out.poles.push(res.doc);
          report.poles.fromJson++;
        }
      });
    });
  }

  // ── staticdatas → master catalogue + ward consumer list ──
  const st = (readJson("VVCM.staticdatas.json") || [])[0];
  if (st) {
    out.master = {
      key: "main",
      wards: (st.WardCommittee || []).map(toWard).filter(Boolean),
      purposes: st.Purpose || [],
      phaseTypes: (st.Type || []).map((t) => parsePhase(t).phaseType),
      lightTypes: (st.TypeofLight || []).map((l) => ({ name: l.LightName, watts: l.Watts || [] })),
      poleTypes: (st.TypeofPole || []).map((p) => ({
        name: p.PoleName,
        heights: p.HightofPole || [],
        bracketTypes: p.TypeofBracket || [],
        brackets: p.Bracket || [],
      })),
      cableTypes: [], // poles मधून खाली भरतो
    };
    const seen = new Set();
    (st.WardConsumer || []).forEach((w) => {
      const ward = toWard(w.Ward);
      (w.ConsumerID || []).forEach((c) => {
        const raw = str(c);
        const consumerId = normId(raw);
        if (!ward || !consumerId) return;
        const k = `${ward}|${consumerId}`;
        if (seen.has(k)) return report.master.duplicatesDropped++;
        seen.add(k);
        const suspicious = isJunkId(consumerId);
        if (suspicious) report.master.suspicious++;
        out.wardConsumers.push({ ward, consumerId, consumerIdRaw: raw, suspicious });
      });
    });
    report.master.consumers = out.wardConsumers.length;
  }

  out.users = readJson("VVCM.logindatas.json") || [];
  report.users.found = out.users.length;
  return out;
}

// ═══════════════════════════════════════════════════════
//  2) Ward CSVs
// ═══════════════════════════════════════════════════════
const FRONT = 5; // WardCommittee, ConsumerID, NewMeterNumber, Purpose, Type
const BACK = 8;  // MeterImageData, TimerPanelImage, SanctionLoad, TimerPanel, Lat, Lng, Date, Time

function readWardFiles() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => /^ward_[A-I]\.csv$/i.test(f)).sort();
  const meters = [];

  for (const file of files) {
    report.sources[file] = true;
    const records = parseSync(fs.readFileSync(path.join(DATA_DIR, file)), {
      bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true,
    });

    records.slice(1).forEach((rec, i) => {
      const source = `${file}:${i + 2}`;
      const cols = [...rec];
      while (cols.length > FRONT + BACK && cols[cols.length - 1] === "") cols.pop(); // trailing comma
      if (cols.length < FRONT + BACK - 1) return report.meters.skipped.push({ source, reason: `only ${cols.length} columns` });
      if (cols.length === FRONT + BACK - 1) cols.push("");

      const [wardLetter, consumerIdRaw, newMeterNumber, purpose, type] = cols.slice(0, FRONT);
      const [meterImg, timerImg, sanctionLoad, timerPanel, lat, lng, date, time] = cols.slice(-BACK);
      // Address मध्ये unquoted comma असू शकतो → मधला सगळा भाग
      const address = clean(cols.slice(FRONT, cols.length - BACK).join(", "));

      const ward = toWard(wardLetter) || toWard(file.match(/ward_([A-I])/i)[1]);
      const location = toPoint(lat, lng);
      const surveyedAt = toDate(date, time);
      if (!location || !surveyedAt) return report.meters.skipped.push({ source, reason: "invalid coordinates/date" });

      const consumerId = normId(consumerIdRaw);
      const uuid = imageUuid(meterImg);
      const m = {
        applicationId: uuid || `noimg-${ward.slice(-1)}-${consumerId || "x"}-${clean(date)}T${clean(time).replace(/:/g, "")}`,
        ward,
        consumerId,
        newMeterNumber: clean(newMeterNumber),
        purpose: normalizePurpose(purpose),
        ...parsePhase(type),
        address,
        meterImageFile: clean(meterImg),
        meterImageUrl: "",
        meterThumbUrl: "",
        timerPanelImageFile: clean(timerImg),
        timerPanelImageUrl: "",
        sanctionLoadKw: parseLoad(sanctionLoad),
        hasTimerPanel: parseTimerPanel(timerPanel),
        location,
        surveyedAt,
        dataFlags: [],
        source,
      };
      m.dataFlags = meterFlags(m, !!uuid);
      meters.push(m);
    });
  }
  return meters;
}

function mergeCsvIntoJson(jsonMeters, csvMeters) {
  const byKey = new Map([...jsonMeters.values()].map((m) => [matchKey(m.consumerId, m.surveyedAt), m]));
  for (const c of csvMeters) {
    const existing = jsonMeters.get(c.applicationId) || byKey.get(matchKey(c.consumerId, c.surveyedAt));
    if (existing) {
      report.meters.csvMerged++;
      // JSON जिंकतो; फक्त रिकामे fields CSV मधून भरा
      ["address", "meterImageFile", "timerPanelImageFile", "newMeterNumber"].forEach((k) => {
        if (!existing[k] && c[k]) existing[k] = c[k];
      });
      if (existing.sanctionLoadKw === null && c.sanctionLoadKw !== null) existing.sanctionLoadKw = c.sanctionLoadKw;
      if (existing.hasTimerPanel === null && c.hasTimerPanel !== null) existing.hasTimerPanel = c.hasTimerPanel;
      continue;
    }
    jsonMeters.set(c.applicationId, c);
    byKey.set(matchKey(c.consumerId, c.surveyedAt), c);
    report.meters.fromCsvExtra++;
  }
  return jsonMeters;
}

// ═══════════════════════════════════════════════════════
//  3) MeterData.csv → meter photos (streamed, 26 MB)
// ═══════════════════════════════════════════════════════
async function attachMeterPhotos(meters) {
  const file = path.join(DATA_DIR, "MeterData.csv");
  if (fs.existsSync(file)) {
    report.sources["MeterData.csv"] = true;
    const parser = fs.createReadStream(file).pipe(parse({ columns: true, bom: true, relax_column_count: true }));
    for await (const row of parser) {
      const id = clean(row.ApplicationID);
      const meter = meters.get(id);
      if (!meter) continue;
      const img = await writeDataUri(row.MeterImageData, METER_PHOTO_DIR, id);
      if (img) {
        meter.meterImageUrl = `/uploads/meterPhotos/${img.file}`;
        meter.meterThumbUrl = `/uploads/meterPhotos/${img.thumb}`;
        report.meters.photosWritten++;
      }
    }
  }
  for (const m of meters.values()) {
    if (m.meterImageFile && !m.meterImageUrl && !m.dataFlags.includes("image_not_available")) m.dataFlags.push("image_not_available");
  }
}

// ═══════════════════════════════════════════════════════
//  4) polesData.csv (जुने June-July 2024 poles, photos सोबत)
// ═══════════════════════════════════════════════════════
async function readCsvPoles() {
  const file = path.join(DATA_DIR, "polesData.csv");
  if (!fs.existsSync(file)) return [];
  report.sources["polesData.csv"] = true;
  const parser = fs.createReadStream(file).pipe(parse({ columns: true, bom: true, relax_column_count: true }));
  const poles = [];
  let line = 1;
  for await (const row of parser) {
    line++;
    const source = `polesData.csv:${line}`;
    const legacyId = clean(row._id);
    const res = buildPole({
      legacyId,
      ward: toWard(row.WardCommittee),
      consumerId: normId(row.ConsumerID),
      pole: parseDictLike(row.TypeofPole),
      light: parseDictLike(row.TypeofLight),
      cable: null,
      numberLight: row.NumberLight,
      imageFile: "",
      lat: row.PoleLatitude,
      lng: row.PoleLongitude,
      date: row.Date,
      time: row.Time,
      source,
    });
    if (res.error) {
      report.poles.skipped.push({ source, reason: res.error });
      continue;
    }
    const photo = await writeDataUri(row.PoleImageData, POLE_PHOTO_DIR, legacyId || `pole-${line}`);
    if (photo) {
      res.doc.poleImageUrl = `/uploads/polePhotos/${photo.file}`;
      res.doc.poleThumbUrl = `/uploads/polePhotos/${photo.thumb}`;
      report.poles.photosWritten++;
    }
    poles.push(res.doc);
    report.poles.fromCsv++;
  }
  return poles;
}

// ═══════════════════════════════════════════════════════
//  5) Users (जुने VVCM logindatas)
// ═══════════════════════════════════════════════════════
function buildUsers(raw) {
  return raw
    .map((u) => {
      const hash = clean(u.HashPassword);
      if (!/^\$2[aby]\$\d{2}\$/.test(hash)) return null; // bcrypt नसेल तर import नाही
      const email = clean(u.Email).toLowerCase();
      const userName = (email.split("@")[0] || clean(u.Name)).toLowerCase().replace(/[^a-z0-9_.]/g, "");
      const role = u.SuperAdmin ? "super_admin" : LEGACY_ROLE_MAP[clean(u.Role).toLowerCase()] || "viewer";
      return {
        legacyId: str(u._id),
        fullName: clean(u.Name) || userName,
        userName,
        email,
        mobileNumber: clean(u.Phone),
        password: hash,
        role,
        // super_admin ला ward नको; बाकी ward-scoped
        ward: role === "super_admin" ? "" : toWard(u.Ward),
        isActive: true,
      };
    })
    .filter(Boolean);
}

// ═══════════════════════════════════════════════════════
//  Validate with mongoose schema (DB शिवाय)
// ═══════════════════════════════════════════════════════
async function validateDocs(Model, docs, bucket) {
  const ok = [];
  for (const d of docs) {
    try {
      await new Model(d).validate();
      ok.push(d);
    } catch (err) {
      const reason = err.errors ? Object.values(err.errors).map((e) => e.message).join("; ") : err.message;
      bucket.skipped.push({ source: d.source, reason });
    }
  }
  bucket.valid = ok.length;
  return ok;
}

async function bulkUpsert(Model, docs, keyOf, label) {
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < docs.length; i += 1000) {
    const r = await Model.bulkWrite(
      docs.slice(i, i + 1000).map(({ _id, ...d }) => ({
        updateOne: {
          filter: keyOf({ _id, ...d }),
          update: { $set: d, ...(_id ? { $setOnInsert: { _id } } : {}) },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    inserted += r.upsertedCount;
    updated += r.modifiedCount;
  }
  console.log(`⚡ ${label.padEnd(15)} → inserted ${inserted}, updated ${updated}`);
}

// ═══════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════
(async () => {
  const started = Date.now();
  console.log(`📂 Data dir: ${DATA_DIR}${DRY_RUN ? "   (DRY RUN — DB write नाही)" : ""}`);
  fs.mkdirSync(METER_PHOTO_DIR, { recursive: true });
  fs.mkdirSync(POLE_PHOTO_DIR, { recursive: true });

  // ── Parse + merge ──
  const exp = readMongoExport();
  const meterMap = mergeCsvIntoJson(exp.meters, readWardFiles());
  await attachMeterPhotos(meterMap);

  // master list नसलेले consumers
  const masterIds = new Set(exp.wardConsumers.filter((c) => !c.suspicious).map((c) => c.consumerId));
  if (masterIds.size) {
    for (const m of meterMap.values()) {
      if (m.consumerId && !masterIds.has(m.consumerId)) m.dataFlags.push("not_in_master_list");
    }
  }

  // poles: JSON + CSV (legacyId ने dedupe)
  const allPoles = [];
  const seenPole = new Set();
  for (const p of [...exp.poles, ...(await readCsvPoles())]) {
    if (p.legacyId && seenPole.has(p.legacyId)) continue;
    if (p.legacyId) seenPole.add(p.legacyId);
    allPoles.push(p);
  }

  // poleCount (denormalized) — test entries धरू नका
  const poleCountBy = new Map();
  allPoles.forEach((p) => {
    if (!p.dataFlags.includes("test_entry")) poleCountBy.set(p.consumerId, (poleCountBy.get(p.consumerId) || 0) + 1);
  });
  const meterConsumerIds = new Set();
  for (const m of meterMap.values()) {
    m.poleCount = poleCountBy.get(m.consumerId) || 0;
    if (m.consumerId) meterConsumerIds.add(m.consumerId);
  }
  allPoles.forEach((p) => {
    if (!meterConsumerIds.has(p.consumerId)) p.dataFlags.push("no_matching_meter");
  });

  // cable options (poles मधून)
  if (exp.master) {
    const cab = new Map();
    allPoles.forEach(({ cable }) => {
      if (!cable.type) return;
      const e = cab.get(cable.type) || { type: cable.type, materials: new Set(), sizes: new Set() };
      if (cable.material) e.materials.add(cable.material);
      if (cable.size) e.sizes.add(cable.size);
      cab.set(cable.type, e);
    });
    exp.master.cableTypes = [...cab.values()].map((e) => ({ type: e.type, materials: [...e.materials].sort(), sizes: [...e.sizes].sort() }));
  }

  const meterDocs = await validateDocs(Meter, [...meterMap.values()], report.meters);
  meterDocs.forEach((m) => {
    report.meters.perWard[m.ward] = (report.meters.perWard[m.ward] || 0) + 1;
    countFlags(report.meters.flags, m.dataFlags);
  });
  const poleDocs = await validateDocs(Pole, allPoles, report.poles);
  poleDocs.forEach((p) => countFlags(report.poles.flags, p.dataFlags));
  const users = SKIP_USERS ? [] : buildUsers(exp.users);

  // ── Write ──
  if (!DRY_RUN) {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI .env मध्ये नाही ❌");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected");

    if (DROP) {
      await Promise.all([Meter.deleteMany({}), Pole.deleteMany({}), ConsumerMaster.deleteMany({}), MasterData.deleteMany({})]);
      console.log("🗑️  meters / poles / master cleared (users untouched)");
    }

    // indexes आधी — upsert lookups fast
    await Promise.all([Meter.syncIndexes(), Pole.syncIndexes(), ConsumerMaster.syncIndexes(), MasterData.syncIndexes(), User.syncIndexes()]);

    await bulkUpsert(Meter, meterDocs, (d) => ({ applicationId: d.applicationId }), "Meters");
    await bulkUpsert(Pole, poleDocs, (d) => (d.legacyId ? { legacyId: d.legacyId } : { source: d.source }), "Poles");

    if (exp.wardConsumers.length) {
      await bulkUpsert(ConsumerMaster, exp.wardConsumers, (d) => ({ ward: d.ward, consumerId: d.consumerId }), "Consumer master");
    }
    if (exp.master) {
      await MasterData.updateOne({ key: "main" }, { $set: exp.master }, { upsert: true });
      console.log("⚡ Master data     → saved");
    }

    // users — आधीच असलेला userName / legacyId कधीच overwrite करत नाही (password बदललेला असू शकतो)
    for (const u of users) {
      const exists = await User.exists({ $or: [{ userName: u.userName }, { legacyId: u.legacyId }] });
      if (exists) {
        report.users.skippedExisting++;
        continue;
      }
      await User.create(u);
      report.users.imported++;
    }
    if (users.length) console.log(`⚡ Users           → imported ${report.users.imported}, existing skipped ${report.users.skippedExisting}`);

    console.log(
      `📊 DB totals: meters=${await Meter.countDocuments()} poles=${await Pole.countDocuments()} master consumers=${await ConsumerMaster.countDocuments()} users=${await User.countDocuments()}`
    );
    await mongoose.disconnect();
  } else {
    report.users.imported = `${users.length} (dry-run)`;
  }

  if (JSON_OUT) {
    const dir = path.resolve(JSON_OUT);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meters.json"), JSON.stringify(meterDocs));
    fs.writeFileSync(path.join(dir, "poles.json"), JSON.stringify(poleDocs));
    fs.writeFileSync(path.join(dir, "consumerMaster.json"), JSON.stringify(exp.wardConsumers));
    fs.writeFileSync(path.join(dir, "masterData.json"), JSON.stringify(exp.master));
    fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify(users.map(({ password, ...u }) => u)));
    console.log(`💾 JSON → ${dir}`);
  }

  // ── Report ──
  const reportPath = path.join(__dirname, "..", "import-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const r = report;
  console.log("\n════════ IMPORT REPORT ════════");
  console.log("Sources :", Object.keys(r.sources).join(", "));
  console.log(`Meters  : json=${r.meters.fromJson} csv-merged=${r.meters.csvMerged} csv-extra=${r.meters.fromCsvExtra} valid=${r.meters.valid} skipped=${r.meters.skipped.length} photos=${r.meters.photosWritten}`);
  console.log("  per ward:", r.meters.perWard);
  console.log("  flags   :", r.meters.flags);
  console.log(`Poles   : json=${r.poles.fromJson} csv=${r.poles.fromCsv} valid=${r.poles.valid} skipped=${r.poles.skipped.length} photos=${r.poles.photosWritten}`);
  console.log("  flags   :", r.poles.flags);
  console.log(`Master  : consumers=${r.master.consumers} (duplicates dropped ${r.master.duplicatesDropped}, junk IDs flagged ${r.master.suspicious})`);
  console.log(`Users   : found=${r.users.found} import=${r.users.imported} existing=${r.users.skippedExisting}`);
  const skipped = [...r.meters.skipped, ...r.poles.skipped];
  if (skipped.length) console.log("Skipped (first 15):", skipped.slice(0, 15));
  console.log(`📝 Full report → ${reportPath}   (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  process.exit(0);
})().catch(async (err) => {
  console.error("❌ Import failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
