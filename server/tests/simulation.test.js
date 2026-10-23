const test = require("node:test");
const assert = require("node:assert/strict");
const { SimulationEngine, findPath, OBSTACLES, key } = require("../services/SimulationEngine");

const makeRobot = (robotId, position, battery = 100) => ({ robotId, name: robotId, position: { ...position }, location: `(${position.x},${position.y})`, battery, status: "Available", currentTask: null });
const makeEngine = ({ robots = [makeRobot("AMR-001", { x: 2, y: 3 })], stock = 50, emit = () => {}, persist = () => {} } = {}) => new SimulationEngine({ robots, tasks: [], inventory: [{ material: "Steel", quantity: stock, location: "B2" }], emit, persist });
async function runToCompletion(engine, task, maxTicks = 100) {
  engine.running = true;
  for (let i = 0; i < maxTicks && !["Completed", "Failed"].includes(task.status); i++) await engine.tick();
  engine.running = false;
}

test("robot creation validates walkable unique cells and persists the live fleet", async () => {
  const saved = [];
  const events = [];
  const engine = makeEngine({ persist: async (reason, state) => saved.push({ reason, state }), emit: (event, payload) => events.push({ event, payload }) });
  const robot = await engine.createRobot({ robotId: "AMR-002", name: "Second unit", model: "XR-2", battery: 88, maxLoadCapacity: 45, position: { x: 3, y: 3 } });
  assert.equal(robot.model, "XR-2");
  assert.equal(saved.at(-1).reason, "robot:created");
  assert.equal(saved.at(-1).state.robots.includes(robot), true);
  assert.equal(events.at(-1).event, "robot:created");
  await assert.rejects(engine.createRobot({ robotId: "AMR-002", name: "Duplicate", position: { x: 4, y: 3 } }), /already exists/);
  await assert.rejects(engine.createRobot({ robotId: "AMR-003", name: "Rack cell", position: { x: 5, y: 3 } }), /walkable/);
  await assert.rejects(engine.createRobot({ robotId: "AMR-004", name: "Occupied", position: { x: 2, y: 3 } }), /occupied/);
});

test("AMR-001 plans A* legs, picks up, delivers, transfers inventory, persists completion, and returns idle", async () => {
  const persisted = [];
  const engine = makeEngine({ persist: async (reason) => persisted.push(reason) });
  const task = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 7 });
  const robot = engine.robot("AMR-001");
  assert.deepEqual(robot.position, { x: 2, y: 3 });
  assert.ok(task.route.length > 0);
  assert.ok(task.route.every((cell) => !OBSTACLES.some((obstacle) => key(obstacle) === key(cell))));
  const oldBattery = robot.battery;
  await runToCompletion(engine, task);
  assert.equal(task.status, "Completed");
  assert.equal(task.stage, "completed");
  assert.deepEqual(robot.position, { x: 18, y: 12 });
  assert.equal(robot.status, "Available");
  assert.equal(robot.currentTask, null);
  assert.equal(robot.battery < oldBattery, true);
  assert.equal(engine.inventory.find((item) => item.location === "B2").quantity, 43);
  assert.equal(engine.inventory.find((item) => item.location === "B2").reserved, 0);
  assert.equal(engine.inventory.find((item) => item.location === "C1").quantity, 7);
  assert.equal(robot.cargo, null);
  assert.ok(persisted.length > 0);
});

test("two robots cannot enter the same cell in one tick", async () => {
  const robots = [makeRobot("A", { x: 2, y: 1 }), makeRobot("B", { x: 4, y: 1 })];
  const errors = [];
  const engine = makeEngine({ robots, emit: (event, payload) => event === "simulation:error" && errors.push(payload) });
  engine.tasks.push(
    { id: "a", robotId: "A", stage: "toPickup", status: "To pickup", pickupPosition: { x: 3, y: 1 }, destinationPosition: { x: 2, y: 2 }, route: [{ x: 3, y: 1 }] },
    { id: "b", robotId: "B", stage: "toPickup", status: "To pickup", pickupPosition: { x: 3, y: 1 }, destinationPosition: { x: 4, y: 2 }, route: [{ x: 3, y: 1 }] }
  );
  robots.forEach((robot) => { robot.status = "Busy"; robot.currentTask = robot.robotId.toLowerCase(); });
  engine.running = true; await engine.tick();
  assert.deepEqual(robots.map((robot) => robot.position), [{ x: 3, y: 1 }, { x: 4, y: 1 }]);
  assert.ok(errors.some((event) => event.code === "CELL_CONFLICT"));
});

test("two robots cannot swap cells head-on", async () => {
  const robots = [makeRobot("A", { x: 2, y: 1 }), makeRobot("B", { x: 3, y: 1 })];
  const errors = [];
  const engine = makeEngine({ robots, emit: (event, payload) => event === "simulation:error" && errors.push(payload) });
  engine.tasks.push(
    { id: "a", robotId: "A", stage: "toPickup", status: "To pickup", pickupPosition: { x: 3, y: 1 }, destinationPosition: { x: 2, y: 2 }, route: [{ x: 3, y: 1 }] },
    { id: "b", robotId: "B", stage: "toPickup", status: "To pickup", pickupPosition: { x: 2, y: 1 }, destinationPosition: { x: 3, y: 2 }, route: [{ x: 2, y: 1 }] }
  );
  robots.forEach((robot) => { robot.status = "Busy"; robot.currentTask = robot.robotId.toLowerCase(); });
  engine.running = true; await engine.tick();
  assert.deepEqual(robots.map((robot) => robot.position), [{ x: 2, y: 1 }, { x: 3, y: 1 }]);
  assert.ok(errors.some((event) => event.code === "HEAD_ON_CONFLICT"));
});

test("startup corrects invalid or overlapping stored robot cells to unique walkable cells", () => {
  const robots = [makeRobot("A", { x: 5, y: 3 }), makeRobot("B", { x: 5, y: 3 }), makeRobot("C", { x: 1, y: 1 })];
  const engine = makeEngine({ robots });
  const positions = robots.map((robot) => key(robot.position));
  assert.equal(new Set(positions).size, robots.length);
  assert.ok(robots.every((robot) => engine.canWalk(robot.position)));
});

test("robot without enough battery leaves the task pending with an explanation", async () => {
  const engine = makeEngine({ robots: [makeRobot("LOW", { x: 2, y: 3 }, 5)] });
  const task = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 1 });
  assert.equal(task.status, "Pending");
  assert.match(task.schedulingExplanation.reason[0], /Battery/);
});

test("A* reports an unreachable blocked destination instead of routing through obstacles", () => {
  const blocked = new Set(["1,0", "0,1", "1,1"]);
  assert.equal(findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, blocked), null);
});

test("robot replans around an obstacle added onto its current route and emits an event", async () => {
  const errors = [];
  const engine = makeEngine({ emit: (event, payload) => event === "simulation:error" && errors.push(payload) });
  const task = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 1 });
  const robot = engine.robot(task.robotId);
  const blockedCell = { ...task.route[0] };
  engine.obstacles.push(blockedCell);
  engine.running = true; await engine.tick();
  assert.notDeepEqual(robot.position, blockedCell);
  assert.ok(errors.some((event) => event.code === "PATH_BLOCKED"));
  assert.notEqual(task.status, "Failed");
});

test("paused simulation does not move; resume advances exactly one cell per tick", async () => {
  const engine = makeEngine();
  const task = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 1 });
  const robot = engine.robot("AMR-001");
  const before = { ...robot.position };
  engine.pause(); await engine.tick();
  assert.deepEqual(robot.position, before);
  engine.resume(); await engine.tick();
  assert.equal(Math.abs(robot.position.x - before.x) + Math.abs(robot.position.y - before.y), 1);
  engine.pause();
  assert.equal(task.status, "To pickup");
});

test("a robot becoming unavailable mid-task fails with an operational error", async () => {
  const errors = [];
  const engine = makeEngine({ emit: (event, payload) => event === "simulation:error" && errors.push(payload) });
  const task = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 1 });
  engine.robot(task.robotId).status = "Offline";
  engine.running = true; await engine.tick();
  assert.equal(task.status, "Failed");
  assert.ok(errors.some((event) => event.code === "ROBOT_UNAVAILABLE"));
});

test("backend restart resumes an active task from the persisted cell and replans", async () => {
  const first = makeEngine();
  const task = await first.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 2 });
  first.running = true; await first.tick(); first.running = false;
  const savedRobot = structuredClone(first.robot(task.robotId));
  const savedTask = structuredClone(task);
  const savedInventory = structuredClone(first.inventory);
  const restarted = new SimulationEngine({ robots: [savedRobot], tasks: [savedTask], inventory: savedInventory });
  assert.equal(restarted.robot(task.robotId).currentTask, task.id);
  assert.equal(restarted.robot(task.robotId).status, "Busy");
  assert.ok(restarted.task(task.id).route.length > 0);
  await runToCompletion(restarted, restarted.task(task.id));
  assert.equal(restarted.task(task.id).status, "Completed");
  assert.deepEqual(restarted.robot(task.robotId).position, { x: 18, y: 12 });
});

test("failed persistence rolls back a movement and does not broadcast an uncommitted position", async () => {
  const events = [];
  let failPersistence = false;
  const engine = makeEngine({ persist: async () => { if (failPersistence) throw new Error("disk unavailable"); }, emit: (event, payload) => events.push({ event, payload }) });
  const task = await engine.createTask({ material: "Steel", pickupLocation: "B2", destination: "C1", quantity: 1 });
  const robotId = task.robotId;
  const position = { ...engine.robot(robotId).position };
  const battery = engine.robot(robotId).battery;
  failPersistence = true;
  engine.running = true;
  await assert.rejects(engine.tick(), /disk unavailable/);
  assert.deepEqual(engine.robot(robotId).position, position);
  assert.equal(engine.robot(robotId).battery, battery);
  assert.equal(events.some((item) => item.event === "robot:position"), false);
});
