const test = require("node:test");
const assert = require("node:assert/strict");
const { SimulationEngine, findPath } = require("../services/SimulationEngine");
const { comparePending, evaluateCandidates, scoreCandidates, baselineFirstAvailable, schedulingAnalytics } = require("../services/Scheduler");

const robot = (robotId, position, battery = 100, extra = {}) => ({ robotId, name: robotId, position, location: `(${position.x},${position.y})`, battery, status: "Available", currentTask: null, maxLoadCapacity: 100, currentLoad: 0, ...extra });
const task = (id, priority, createdAt) => ({ id, priority, createdAt });
const engineFor = (robots, stock = 100) => new SimulationEngine({ robots, tasks: [], inventory: [{ material: "Steel", quantity: stock, reserved: 0, location: "B2" }], persist: async () => {} });

test("pending tasks order by priority then oldest creation time", () => {
  const list = [task("low", "Low", "2026-01-01"), task("new-high", "High", "2026-01-03"), task("urgent", "Urgent", "2026-01-04"), task("old-high", "High", "2026-01-02")];
  assert.deepEqual(list.sort(comparePending).map(({ id }) => id), ["urgent", "old-high", "new-high", "low"]);
});

test("distance score chooses nearer eligible robot over first-available baseline with computed improvement", () => {
  const robots = [robot("FAR", { x: 2, y: 3 }), robot("NEAR", { x: 10, y: 4 })];
  const engine = engineFor(robots);
  const request = { material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 1, loadUnits: 1, pickupPosition: { x: 10, y: 5 }, destinationPosition: { x: 18, y: 12 } };
  const evaluated = evaluateCandidates(request, robots, engine.inventory, { findPath, staticBlocked: (id) => engine.staticBlocked(id), canWalk: engine.canWalk.bind(engine), tickMs: 700 });
  const intelligent = scoreCandidates(evaluated.eligible)[0];
  const baseline = baselineFirstAvailable(request, evaluated.eligible);
  assert.equal(intelligent.robot.robotId, "NEAR");
  assert.equal(baseline.robot.robotId, "FAR");
  assert.ok(intelligent.totalDistance < baseline.totalDistance);
  assert.equal(baseline.totalDistance - intelligent.totalDistance, 13);
});

test("scheduler filters unavailable, charging, insufficient-capacity, blocked, and unsafe-battery robots", async () => {
  const robots = [
    robot("OFF", { x: 2, y: 3 }, 100, { status: "Offline" }),
    robot("CHARGE", { x: 3, y: 3 }, 100, { status: "Charging" }),
    robot("SMALL", { x: 4, y: 3 }, 100, { maxLoadCapacity: 2 }),
    robot("LOW", { x: 2, y: 5 }, 20)
  ];
  const engine = engineFor(robots);
  const created = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 4 });
  assert.equal(created.status, "Pending");
  const reasons = created.schedulingExplanation.excludedRobots.map((item) => item.reason).join(" | ");
  assert.match(reasons, /Offline/);
  assert.match(reasons, /charging/);
  assert.match(reasons, /capacity/);
  assert.match(reasons, /Battery/);
});

test("load capacity validates quantity and explanations include measured assignment details", async () => {
  const engine = engineFor([robot("AMR-004", { x: 10, y: 4 }, 91, { maxLoadCapacity: 20 })]);
  const created = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 5 });
  assert.equal(created.status, "Assigned");
  assert.equal(created.robotId, "AMR-004");
  assert.equal(created.schedulingExplanation.distanceToPickup, 1);
  assert.equal(created.schedulingExplanation.reason.some((line) => line.includes("Battery: 91%")), true);
  assert.equal(created.schedulingExplanation.reason.some((line) => line.includes("Load capacity: 5 units of 20")), true);
  assert.ok(created.estimatedDurationSeconds > 0);
});

test("pending tasks retry automatically when a suitable robot becomes available", async () => {
  const charging = robot("AMR-001", { x: 2, y: 3 }, 100, { status: "Charging" });
  const engine = engineFor([charging]);
  const created = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 1 });
  assert.equal(created.status, "Pending");
  charging.status = "Available";
  await engine.schedulePending();
  assert.equal(created.status, "Assigned");
  assert.equal(created.robotId, "AMR-001");
});

test("concurrent scheduling never assigns one robot to two active tasks", async () => {
  const engine = engineFor([robot("SOLO", { x: 2, y: 3 })]);
  const requests = ["B2", "A1"].map((pickupLocation) => engine.createTask({ material: "Steel", pickupLocation, destination: "C1", quantity: 1, priority: "High" }));
  const created = await Promise.all(requests);
  const assigned = created.filter((item) => item.status === "Assigned");
  assert.equal(assigned.length, 1);
  assert.equal(engine.robots.filter((item) => item.currentTask).length, 1);
  assert.equal(created.filter((item) => item.status === "Pending").length, 1);
});

test("analytics are calculated from actual task assignment records", async () => {
  const engine = engineFor([robot("AMR", { x: 10, y: 4 })]);
  const created = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 1, priority: "Urgent" });
  const metrics = schedulingAnalytics([created]);
  assert.equal(metrics.totalTasks, 1);
  assert.equal(metrics.assignedTasks, 1);
  assert.equal(metrics.assignmentSuccessRate, 100);
  assert.equal(metrics.tasksByPriority.Urgent, 1);
  assert.equal(metrics.averageEstimatedTravelDistance, created.estimatedDistance);
  assert.equal(metrics.pendingQueueLength, 0);
});
