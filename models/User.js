const mongoose = require("mongoose");
const { ROLES, WARDS } = require("../utils/constants");

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true, required: true },
    userName: { type: String, trim: true, lowercase: true, required: true, unique: true },
    mobileNumber: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    legacyId: { type: String, default: undefined }, // जुन्या VVCM logindatas चा _id
    password: { type: String, required: true, select: false },

    role: { type: String, enum: ROLES, default: "viewer" },

    // ward_engineer साठी compulsory — फक्त स्वतःच्या ward चा data
    ward: { type: String, enum: [...WARDS, ""], default: "" },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { sparse: true });
userSchema.index({ legacyId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("User", userSchema);
