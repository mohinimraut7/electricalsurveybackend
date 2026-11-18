const bcrypt = require("bcryptjs");
const User = require("../models/User");
const generateJwt = require("../utils/generateJwt");

// ═══════════════════════════════════════════════════════
//  1) LOGIN — userName + password
// ═══════════════════════════════════════════════════════
exports.login = async (req, res) => {
  try {
    const { userName, password } = req.body;
    if (!userName || !password) {
      return res.status(400).json({ success: false, message: "Username आणि password आवश्यक ❌" });
    }

    // username किंवा email दोन्हीने login (जुने VVCM users email वापरायचे)
    const id = String(userName).toLowerCase().trim();
    const user = await User.findOne(id.includes("@") ? { email: id } : { userName: id }).select("+password");
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: "Invalid credentials ❌" });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: "Account अजून approve झाला नाही / inactive आहे ❌" });
    }

    return res.status(200).json({
      success: true,
      message: "Login Successful ✅",
      token: generateJwt(user),
      user: { id: user._id, fullName: user.fullName, userName: user.userName, email: user.email, role: user.role, ward: user.ward },
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  1b) REGISTER — public self-registration (role नेहमी "viewer")
//      REGISTRATION_AUTO_APPROVE=false असेल तर super_admin ने activate करेपर्यंत login होणार नाही
// ═══════════════════════════════════════════════════════
exports.register = async (req, res) => {
  try {
    const { fullName, userName, mobileNumber, password } = req.body;
    if (!fullName || !userName || !password) {
      return res.status(400).json({ success: false, message: "Full name, username, password आवश्यक ❌" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: "Password किमान 6 characters ❌" });
    }
    if (mobileNumber && !/^[6-9]\d{9}$/.test(mobileNumber)) {
      return res.status(400).json({ success: false, message: "Valid 10-digit mobile number द्या ❌" });
    }
    const uname = String(userName).toLowerCase().trim();
    if (!/^[a-z0-9_.]{3,30}$/.test(uname)) {
      return res.status(400).json({ success: false, message: "Username: 3-30 letters/numbers/_/. ❌" });
    }
    if (await User.exists({ userName: uname })) {
      return res.status(409).json({ success: false, message: "Username already exists ❌" });
    }

    const autoApprove = process.env.REGISTRATION_AUTO_APPROVE !== "false";
    const user = await User.create({
      fullName,
      userName: uname,
      mobileNumber: mobileNumber || "",
      password: await bcrypt.hash(password, 10),
      role: "viewer",
      isActive: autoApprove,
    });

    return res.status(201).json({
      success: true,
      message: autoApprove ? "Registration Successful ✅ — आता login करा" : "Registration Successful ✅ — Admin approval नंतर login करता येईल",
      approved: autoApprove,
      data: { id: user._id, userName: user.userName },
    });
  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  2) ME — current logged-in user
// ═══════════════════════════════════════════════════════
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found ❌" });
    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  3) CREATE USER — super_admin only
// ═══════════════════════════════════════════════════════
exports.createUser = async (req, res) => {
  try {
    const { fullName, userName, mobileNumber, email, password, role, ward } = req.body;
    if (!fullName || !userName || !password) {
      return res.status(400).json({ success: false, message: "fullName, userName, password आवश्यक ❌" });
    }
    if (["ward_engineer", "surveyor"].includes(role) && !ward) {
      return res.status(400).json({ success: false, message: "Ward Engineer / Surveyor साठी ward आवश्यक ❌" });
    }
    const exists = await User.findOne({ userName: userName.toLowerCase().trim() });
    if (exists) return res.status(409).json({ success: false, message: "Username already exists ❌" });

    const user = await User.create({
      fullName,
      userName,
      mobileNumber: mobileNumber || "",
      email: email || "",
      password: await bcrypt.hash(password, 10),
      role: role || "viewer",
      ward: ward || "",
    });

    const out = user.toObject();
    delete out.password;
    return res.status(201).json({ success: true, message: "User Created ✅", data: out });
  } catch (error) {
    console.error("Create User Error:", error);
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  4) GET ALL USERS — super_admin only
// ═══════════════════════════════════════════════════════
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data: users });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server Error ❌", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════
//  5) UPDATE USER — role / ward / isActive (super_admin only)
// ═══════════════════════════════════════════════════════
exports.updateUser = async (req, res) => {
  try {
    const { role, ward, isActive } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found ❌" });
    if (String(user._id) === String(req.user.id) && (isActive === false || (role && role !== user.role))) {
      return res.status(400).json({ success: false, message: "स्वतःचा role/status बदलता येत नाही ❌" });
    }

    if (role !== undefined) user.role = role;
    if (ward !== undefined) user.ward = ward;
    if (isActive !== undefined) user.isActive = !!isActive;
    if (["ward_engineer", "surveyor"].includes(user.role) && !user.ward) {
      return res.status(400).json({ success: false, message: "Ward Engineer / Surveyor साठी ward आवश्यक ❌" });
    }
    if (user.role === "super_admin" || user.role === "viewer") user.ward = "";
    await user.save();
    return res.status(200).json({ success: true, message: "User Updated ✅", data: user });
  } catch (error) {
    const code = error.name === "ValidationError" ? 400 : 500;
    return res.status(code).json({ success: false, message: "Update failed ❌", error: error.message });
  }
};
