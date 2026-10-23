require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

async function seedDemo() {
  if (process.env.NODE_ENV !== "development") throw new Error("Demo users can only be seeded when NODE_ENV=development");
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!password || password.length < 8) throw new Error("Set DEMO_ADMIN_PASSWORD (at least 8 characters) for this one-time development seed command");
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/robofleet-ai");
  const email = "admin@robofleet.ai";
  const passwordHash = await bcrypt.hash(password, 12);
  await User.updateOne({ email }, { $set: { name: "RoboFleet Development Admin", email, passwordHash, role: "Admin" } }, { upsert: true, runValidators: true });
  console.log(`Development admin account is ready for ${email}.`);
}

seedDemo().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
