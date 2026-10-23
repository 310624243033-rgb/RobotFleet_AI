require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });
const http = require("node:http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const Robot = require("./models/Robot");
const Task = require("./models/Task");
const Inventory = require("./models/Inventory");
const SimulationState = require("./models/SimulationState");
const User = require("./models/User");
const authRoutes = require("./routes/authRoutes");
const { authenticate, authorize, csrfProtection, cookieName, secret } = require("./middleware/auth");
const { SimulationEngine } = require("./services/SimulationEngine");

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((origin) => origin.trim());
const corsOptions = { origin: (origin, callback) => !origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error("Origin is not allowed by CORS")), credentials: true, methods: ["GET", "POST", "PUT", "OPTIONS"] };
const io = new Server(server, { cors: corsOptions });
app.use(cors(corsOptions));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use("/api", csrfProtection);

let engine;
let ready = false;
const emit = (event, payload) => io.emit(event, payload);
app.get("/", (_req, res) => res.send("RoboFleet AI simulation server is running"));
app.get("/api/health", (_req, res) => res.json({ ready, database: mongoose.connection.readyState === 1 ? "connected" : "disconnected", simulationRunning: Boolean(engine?.running) }));
const requireReady = (req, res, next) => ready ? next() : res.status(503).json({ message: "Simulation is initializing" });

app.use("/api/auth", authRoutes);
app.use("/api", authenticate);

app.get("/api/robots", requireReady, (_req, res) => res.json(engine.robots));
app.post("/api/robots", requireReady, authorize("Admin", "Warehouse Manager"), async (req, res) => {
  try {
    const robot = await engine.createRobot(req.body || {});
    res.status(201).json(robot);
  } catch (error) {
    res.status(error.status || (mongoose.connection.readyState === 1 ? 400 : 503)).json({ message: error.status === 409 ? error.message : mongoose.connection.readyState === 1 ? error.message : "The robot service is temporarily unavailable. Please try again shortly." });
  }
});
app.get("/api/inventory", requireReady, (_req, res) => res.json(engine.inventory));
app.get("/api/tasks", requireReady, (_req, res) => res.json(engine.tasks));
app.get("/api/scheduling", requireReady, (_req, res) => res.json(engine.getSchedulingReport()));
app.put("/api/scheduling/weights", requireReady, authorize("Admin", "Warehouse Manager"), async (req, res) => {
  const previous = engine.schedulingWeights;
  try {
    engine.setSchedulingWeights(req.body?.weights || req.body);
    await persistState("scheduling:weights");
    const assignments = await engine.schedulePending();
    emit("scheduling:settings", engine.schedulingWeights);
    res.json({ ...engine.getSchedulingReport(), assignments });
  } catch (error) {
    engine.setSchedulingWeights(previous);
    res.status(400).json({ message: error.message });
  }
});
app.get("/api/simulation", requireReady, (_req, res) => res.json({ running: engine.running, tickMs: engine.tickMs, grid: SimulationEngine.grid, robots: engine.robots }));
app.post("/api/simulation/start", requireReady, authorize("Admin", "Warehouse Manager"), (_req, res) => { engine.start(); res.json({ running: true }); });
app.post("/api/simulation/pause", requireReady, authorize("Admin", "Warehouse Manager"), (_req, res) => { engine.pause(); res.json({ running: false }); });
app.post("/api/simulation/resume", requireReady, authorize("Admin", "Warehouse Manager"), (_req, res) => { engine.resume(); res.json({ running: true }); });
app.post("/api/simulation/reset", requireReady, authorize("Admin", "Warehouse Manager"), async (_req, res) => { await engine.reset(); res.json({ running: false, message: "Active tasks cancelled; robot cells retained" }); });

app.post("/api/tasks", requireReady, authorize("Admin", "Warehouse Manager"), async (req, res) => {
  try {
    const task = await engine.createTask(req.body || {});
    res.status(201).json(task);
  } catch (error) {
    return res.status(mongoose.connection.readyState === 1 ? 400 : 503).json({ message: error.message });
  }
});
app.put("/api/tasks/:id/complete", requireReady, authorize("Admin", "Warehouse Manager"), (req, res) => {
  const task = engine.task(req.params.id);
  if (!task) return res.status(404).json({ message: "Task not found" });
  if (task.status !== "Completed") return res.status(409).json({ message: "Tasks complete only when the simulation reaches the delivery cell" });
  return res.json(task);
});

app.use((error, _req, res, _next) => {
  console.error("Request failed:", error?.name || "UnexpectedError");
  if (res.headersSent) return;
  res.status(error?.status === 413 ? 413 : 500).json({ message: error?.status === 413 ? "Request is too large." : "Something went wrong. Please try again." });
});

io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const tokenPair = cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${cookieName}=`));
    if (!tokenPair) return next(new Error("Authentication required"));
    const token = decodeURIComponent(tokenPair.slice(cookieName.length + 1));
    const payload = jwt.verify(token, secret());
    const user = await User.findById(payload.sub).select("name email role").lean();
    if (!user) return next(new Error("Authentication required"));
    socket.data.user = user;
    return next();
  } catch { return next(new Error("Authentication required")); }
});
io.on("connection", (socket) => {
  if (!ready) return;
  socket.emit("simulation:snapshot", { running: engine.running, grid: SimulationEngine.grid, robots: engine.robots, tasks: engine.tasks, scheduling: engine.getSchedulingReport() });
});

async function persistState(_reason, { robots = engine.robots, tasks = engine.tasks, inventory = engine.inventory } = {}) {
  if (mongoose.connection.readyState !== 1) throw new Error("MongoDB is unavailable; simulation state was not persisted");
  // Materialized records are written before the atomic recovery checkpoint is advanced.
  const writes = [];
  if (robots.length) writes.push(Robot.bulkWrite(robots.map((robot) => ({ updateOne: { filter: { robotId: robot.robotId }, update: { $set: { name: robot.name, model: robot.model || "AMR", battery: robot.battery, maxLoadCapacity: robot.maxLoadCapacity ?? 100, currentLoad: robot.currentLoad ?? 0, status: robot.status, location: robot.location, position: robot.position, currentTask: robot.currentTask, cargo: robot.cargo || null, distanceTravelled: robot.distanceTravelled || 0 } }, upsert: true } }))));
  if (tasks.length) writes.push(Task.bulkWrite(tasks.map((task) => { const { _id, __v, ...fields } = task; return { updateOne: { filter: { id: task.id }, update: { $set: fields }, upsert: true } }; })));
  if (inventory.length) writes.push(Inventory.bulkWrite(inventory.map((item) => ({ updateOne: { filter: { material: item.material, location: item.location }, update: { $set: { quantity: item.quantity, reserved: item.reserved || 0 } }, upsert: true } }))));
  await Promise.all(writes);
  await SimulationState.updateOne({ _id: "warehouse" }, { $set: { state: { robots, tasks, inventory, schedulingWeights: engine?.schedulingWeights, running: false } } }, { upsert: true });
}

async function seedIfEmpty() {
  if (!(await Robot.exists({}))) {
    await Robot.insertMany([
    { robotId: "RB-001", name: "Warehouse Robot 1", battery: 95, status: "Available", maxLoadCapacity: 100, currentLoad: 0, location: "(2,3)", position: { x: 2, y: 3 } },
      { robotId: "RB-002", name: "Warehouse Robot 2", battery: 78, status: "Available", maxLoadCapacity: 100, currentLoad: 0, location: "(10,1)", position: { x: 10, y: 1 } },
      { robotId: "RB-003", name: "Warehouse Robot 3", battery: 45, status: "Charging", maxLoadCapacity: 100, currentLoad: 0, location: "(22,14)", position: { x: 22, y: 14 } }
    ]);
  }
  if (!(await Inventory.exists({}))) await Inventory.insertMany([
    { material: "Steel Components", quantity: 120, location: "A1" },
    { material: "Electronic Parts", quantity: 80, location: "B2" },
    { material: "Packaging Boxes", quantity: 200, location: "C1" }
  ]);
}

async function initialize() {
  secret();
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/robofleet-ai";
  await mongoose.connect(mongoUri);
  await seedIfEmpty();
  const checkpoint = await SimulationState.findById("warehouse").lean();
  const [storedRobots, storedTasks, storedInventory] = await Promise.all([Robot.find().lean(), Task.find().lean(), Inventory.find().lean()]);
  const robots = checkpoint?.state?.robots || storedRobots;
  const tasks = checkpoint?.state?.tasks || storedTasks;
  const inventory = checkpoint?.state?.inventory || storedInventory;
  for (const robot of robots) {
    if (!robot.position) {
      const grid = { A1: { x: 2, y: 3 }, B2: { x: 10, y: 1 }, C1: { x: 22, y: 14 } };
      robot.position = grid[robot.location] || { x: 1, y: 1 }; robot.location = `(${robot.position.x},${robot.position.y})`;
    }
  }
  engine = new SimulationEngine({ robots, tasks, inventory, tickMs: Number(process.env.SIMULATION_TICK_MS) || 700, schedulingWeights: checkpoint?.state?.schedulingWeights, emit, persist: persistState });
  await persistState("startup");
  ready = true;
  const port = Number(process.env.PORT) || 5000;
  server.listen(port, () => console.log(`RoboFleet simulation listening on http://localhost:${port}`));
}

if (require.main === module) initialize().catch((error) => { console.error("Failed to initialize RoboFleet simulation:", error.message); process.exitCode = 1; });
module.exports = { app, server, io, initialize, persistState };
