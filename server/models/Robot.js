const mongoose = require("mongoose");

const robotSchema = new mongoose.Schema({
  robotId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  model: { type: String, required: true, default: "AMR" },
  battery: { type: Number, required: true, min: 0, max: 100, default: 100 },
  maxLoadCapacity: { type: Number, required: true, min: 1, default: 100 },
  currentLoad: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ["Available", "Idle", "Busy", "Charging", "Offline", "Error", "Maintenance"], default: "Available" },
  location: { type: String, required: true },
  position: { x: { type: Number, required: true, min: 0 }, y: { type: Number, required: true, min: 0 } },
  currentTask: { type: String, default: null },
  cargo: { type: mongoose.Schema.Types.Mixed, default: null },
  distanceTravelled: { type: Number, default: 0 }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Robot || mongoose.model("Robot", robotSchema);
