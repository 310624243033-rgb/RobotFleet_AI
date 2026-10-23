const mongoose = require("mongoose");
const point = { x: { type: Number, required: true }, y: { type: Number, required: true } };
const taskSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  material: { type: String, required: true }, pickupLocation: { type: String, required: true }, destination: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 }, loadUnits: { type: Number, required: true, min: 0.01 },
  priority: { type: String, enum: ["Urgent", "High", "Normal", "Low"], default: "Normal" }, robotId: { type: String, index: true, default: null },
  status: { type: String, enum: ["Pending", "Assigned", "To pickup", "In transit", "Completed", "Failed"], required: true },
  stage: { type: String, enum: ["queued", "toPickup", "toDelivery", "completed", "failed"], required: true },
  pickupPosition: point, destinationPosition: point, route: [point], error: String, errorCode: String,
  inventoryPickedUp: { type: Boolean, default: false },
  assignedAt: Date, assignmentTimeMs: Number, estimatedDistance: Number, estimatedDurationSeconds: Number, estimatedBatteryRequired: Number,
  schedulingAttempts: { type: Number, default: 0 }, schedulingExplanation: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }, completedAt: Date
}, { versionKey: false });
taskSchema.index({ status: 1, updatedAt: 1 });
module.exports = mongoose.models.Task || mongoose.model("Task", taskSchema);
