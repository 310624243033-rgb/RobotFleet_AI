const mongoose = require("mongoose");
const simulationStateSchema = new mongoose.Schema({
  _id: { type: String, default: "warehouse" },
  state: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true, versionKey: false });
module.exports = mongoose.models.SimulationState || mongoose.model("SimulationState", simulationStateSchema);
