const mongoose = require("mongoose");
const inventorySchema = new mongoose.Schema({
  material: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0 },
  reserved: { type: Number, required: true, min: 0, default: 0 },
  location: { type: String, required: true }
}, { timestamps: true, versionKey: false });
inventorySchema.index({ material: 1, location: 1 }, { unique: true });
module.exports = mongoose.models.Inventory || mongoose.model("Inventory", inventorySchema);
