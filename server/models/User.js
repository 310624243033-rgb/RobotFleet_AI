const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["Viewer", "Warehouse Manager", "Admin"], default: "Viewer", required: true }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
