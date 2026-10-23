const GRID = { width: 24, height: 16 };
const OBSTACLES = [
  ...Array.from({ length: 7 }, (_, i) => ({ x: 5, y: i + 3 })),
  ...Array.from({ length: 7 }, (_, i) => ({ x: 9, y: i + 3 })),
  ...Array.from({ length: 7 }, (_, i) => ({ x: 14, y: i + 3 })),
  ...Array.from({ length: 7 }, (_, i) => ({ x: 18, y: i + 3 }))
];
const { DEFAULT_WEIGHTS, comparePending, normalizeWeights, evaluateCandidates, scoreCandidates, explainDecision, schedulingAnalytics } = require("./Scheduler");
const key = ({ x, y }) => `${x},${y}`;
const same = (a, b) => a && b && a.x === b.x && a.y === b.y;
const locToPosition = (location) => ({ A1: { x: 2, y: 3 }, B2: { x: 10, y: 5 }, C1: { x: 18, y: 12 }, D1: { x: 2, y: 12 } }[location] || null);

function findPath(start, goal, blocked = new Set()) {
  if (!start || !goal || !inBounds(goal) || blocked.has(key(goal))) return null;
  const open = new Map([[key(start), { pos: start, g: 0, f: distance(start, goal), parent: null }]]);
  const closed = new Set();
  while (open.size) {
    const current = [...open.values()].sort((a, b) => a.f - b.f || a.g - b.g)[0];
    open.delete(key(current.pos));
    if (same(current.pos, goal)) {
      const route = [];
      let node = current;
      while (node.parent) { route.unshift(node.pos); node = node.parent; }
      return route;
    }
    closed.add(key(current.pos));
    for (const pos of neighbors(current.pos)) {
      const k = key(pos);
      if (closed.has(k) || blocked.has(k)) continue;
      const g = current.g + 1;
      const old = open.get(k);
      if (!old || g < old.g) open.set(k, { pos, g, f: g + distance(pos, goal), parent: current });
    }
  }
  return null;
}
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function inBounds({ x, y }) { return x >= 0 && y >= 0 && x < GRID.width && y < GRID.height; }
function neighbors({ x, y }) { return [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }].filter(inBounds); }

class SimulationEngine {
  constructor({ robots = [], tasks = [], inventory = [], emit = () => {}, persist = () => {}, tickMs = 700, schedulingWeights = DEFAULT_WEIGHTS, clock = () => new Date() } = {}) {
    this.robots = robots;
    this.tasks = tasks;
    this.inventory = inventory;
    this.obstacles = OBSTACLES.map((cell) => ({ ...cell }));
    this.normalizePositions();
    for (const robot of this.robots) {
      robot.maxLoadCapacity = Number(robot.maxLoadCapacity ?? 100);
      robot.currentLoad = Number(robot.currentLoad ?? 0);
    }
    this.emit = emit;
    this.persist = persist;
    this.tickMs = tickMs;
    this.clock = clock;
    this.schedulingWeights = normalizeWeights(schedulingWeights);
    this._schedulePromise = Promise.resolve();
    this.running = false;
    this.timer = null;
    this._ticking = false;
    this.restoreActiveTasks();
  }

  static get grid() { return { ...GRID, obstacles: OBSTACLES }; }
  static findPath(start, goal, blocked) { return findPath(start, goal, blocked); }

  restoreActiveTasks() {
    for (const task of this.tasks.filter((item) => !["Completed", "Failed"].includes(item.status))) {
      const robot = this.robot(task.robotId);
      if (!robot || ["Offline", "Error", "Maintenance"].includes(robot.status)) {
        task.status = "Failed"; task.error = "Assigned robot unavailable after restart"; task.completedAt = new Date();
        this.emit("simulation:error", { taskId: task.id, robotId: task.robotId, code: "ROBOT_UNAVAILABLE", message: task.error });
        continue;
      }
      robot.currentTask = task.id; robot.status = "Busy";
      const goal = task.stage === "toDelivery" ? task.destinationPosition : task.pickupPosition;
      task.route = findPath(robot.position, goal, this.staticBlocked(robot.robotId));
      if (!task.route) this.failTask(task, robot, "No valid route found while restoring active task", "NO_PATH");
    }
  }

  robot(id) { return this.robots.find((robot) => robot.robotId === id); }
  task(id) { return this.tasks.find((task) => String(task.id) === String(id)); }
  publish(event, payload) { if (this._eventBuffer) this._eventBuffer.push([event, payload]); else this.emit(event, payload); }
  staticBlocked(exceptRobotId) {
    const blocked = new Set(this.obstacles.map(key));
    for (const robot of this.robots) if (robot.robotId !== exceptRobotId && robot.position) blocked.add(key(robot.position));
    return blocked;
  }
  canWalk(pos) { return inBounds(pos) && !this.obstacles.some((obstacle) => same(obstacle, pos)); }
  async createRobot({ robotId, name, model = "AMR", battery = 100, maxLoadCapacity = 100, position, status = "Available" }) {
    const id = String(robotId || "").trim();
    const robotName = String(name || "").trim();
    const cell = position && { x: Number(position.x), y: Number(position.y) };
    const batteryLevel = Number(battery);
    const capacity = Number(maxLoadCapacity);
    if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/i.test(id)) throw new Error("Robot ID must be 2–32 letters, numbers, or hyphens.");
    if (!robotName || robotName.length > 100) throw new Error("Enter a robot name up to 100 characters.");
    if (typeof model !== "string" || !model.trim() || model.trim().length > 100) throw new Error("Enter a robot model up to 100 characters.");
    if (!Number.isFinite(batteryLevel) || batteryLevel < 0 || batteryLevel > 100) throw new Error("Battery must be between 0 and 100%.");
    if (!Number.isFinite(capacity) || capacity <= 0) throw new Error("Load capacity must be greater than zero.");
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !this.canWalk(cell)) throw new Error("Starting position must be a walkable warehouse grid cell.");
    if (this.robots.some((robot) => robot.robotId.toLowerCase() === id.toLowerCase())) { const error = new Error("Robot ID already exists."); error.status = 409; throw error; }
    if (this.robots.some((robot) => same(robot.position, cell))) throw new Error("Starting position is occupied by another robot.");
    if (!new Set(["Available", "Idle", "Charging", "Offline", "Maintenance"]).has(status)) throw new Error("Choose a valid initial robot status.");
    const robot = { robotId: id, name: robotName, model: model.trim(), battery: batteryLevel, maxLoadCapacity: capacity, currentLoad: 0, status, location: `(${cell.x},${cell.y})`, position: cell, currentTask: null, cargo: null, distanceTravelled: 0 };
    this.robots.push(robot);
    try {
      await this.persist("robot:created", { robots: this.robots, tasks: this.tasks, inventory: this.inventory });
    } catch (error) {
      this.robots.splice(this.robots.indexOf(robot), 1);
      throw error;
    }
    this.emit("robot:created", robot);
    return robot;
  }
  normalizePositions() {
    const occupied = new Set();
    for (const robot of this.robots) {
      const position = robot.position;
      if (!position || !Number.isInteger(position.x) || !Number.isInteger(position.y) || !this.canWalk(position) || occupied.has(key(position))) {
        const candidates = [];
        for (let y = 0; y < GRID.height; y++) for (let x = 0; x < GRID.width; x++) {
          const candidate = { x, y };
          if (this.canWalk(candidate) && !occupied.has(key(candidate))) candidates.push(candidate);
        }
        candidates.sort((a, b) => distance(a, position || { x: 0, y: 0 }) - distance(b, position || { x: 0, y: 0 }));
        if (!candidates.length) throw new Error("Warehouse grid has no unoccupied walkable cell for robot placement");
        robot.position = candidates[0];
      }
      occupied.add(key(robot.position));
      robot.location = `(${robot.position.x},${robot.position.y})`;
    }
  }

  async createTask({ material, pickupLocation, destination, quantity, priority = "Normal", loadUnits = quantity }) {
    const pickupPosition = locToPosition(pickupLocation);
    const destinationPosition = locToPosition(destination);
    if (!pickupPosition || !destinationPosition) throw new Error("Pickup and destination must be configured warehouse locations");
    if (same(pickupPosition, destinationPosition)) throw new Error("Pickup and destination must differ");
    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1) throw new Error("Quantity must be a positive integer");
    if (!Object.hasOwn({ Urgent: 1, High: 1, Normal: 1, Low: 1 }, priority)) throw new Error("Priority must be Urgent, High, Normal, or Low");
    if (!Number.isFinite(Number(loadUnits)) || Number(loadUnits) <= 0) throw new Error("Load must be a positive number of units");
    const now = this.clock();
    const task = { id: `TASK-${now.getTime()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, material, pickupLocation, destination, quantity: Number(quantity), loadUnits: Number(loadUnits), priority, robotId: null, status: "Pending", stage: "queued", pickupPosition, destinationPosition, route: [], createdAt: now, updatedAt: now, schedulingAttempts: 0 };
    this.tasks.push(task);
    try {
      await this.persist("task:queued", { robots: this.robots, tasks: this.tasks, inventory: this.inventory });
    } catch (error) {
      this.tasks.splice(this.tasks.indexOf(task), 1);
      throw error;
    }
    try { await this.schedulePending(); }
    catch (error) {
      const pending = this.task(task.id);
      if (pending) pending.schedulingExplanation = { selectedRobot: null, pending: true, reason: [`Assignment persistence failed: ${error.message}`], evaluatedAt: this.clock(), weights: { ...this.schedulingWeights } };
      this.emit("simulation:error", { taskId: task.id, code: "SCHEDULING_PERSISTENCE_FAILURE", message: error.message });
    }
    return this.task(task.id);
  }

  getSchedulingReport() {
    return { weights: { ...this.schedulingWeights }, analytics: schedulingAnalytics(this.tasks), decisions: this.tasks.filter((task) => task.schedulingExplanation).slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 20).map((task) => ({ taskId: task.id, priority: task.priority, status: task.status, ...task.schedulingExplanation })) };
  }

  setSchedulingWeights(weights) { this.schedulingWeights = normalizeWeights(weights); }

  schedulePending() {
    const job = this._schedulePromise.then(() => this.runScheduler());
    this._schedulePromise = job.catch(() => {});
    return job;
  }

  async runScheduler() {
    const ordered = this.tasks.filter((task) => task.status === "Pending").sort(comparePending);
    const decisions = [];
    let pendingChanged = false;
    for (const task of ordered) {
      const options = { findPath, staticBlocked: (robotId) => this.staticBlocked(robotId), canWalk: (position) => this.canWalk(position), tickMs: this.tickMs };
      const result = evaluateCandidates(task, this.robots, this.inventory, options);
      const candidates = scoreCandidates(result.eligible, this.schedulingWeights);
      task.schedulingAttempts = (task.schedulingAttempts || 0) + 1;
      if (!candidates.length) {
        const reason = result.excluded.map((entry) => `${entry.robotId}: ${entry.reason}`);
        task.schedulingExplanation = { selectedRobot: null, reason: reason.length ? reason : ["No robots are currently registered"], excludedRobots: result.excluded, weights: { ...this.schedulingWeights }, evaluatedAt: this.clock(), pending: true };
        task.updatedAt = this.clock(); pendingChanged = true;
        continue;
      }
      const selected = candidates[0];
      const robot = selected.robot;
      const stock = this.inventory.find((item) => item.material === task.material && item.location === task.pickupLocation);
      const rollback = structuredClone({ robots: this.robots, tasks: this.tasks, inventory: this.inventory });
      const assignedAt = this.clock();
      task.robotId = robot.robotId; task.status = "Assigned"; task.stage = "toPickup"; task.route = selected.pickupRoute;
      task.assignedAt = assignedAt; task.assignmentTimeMs = Math.max(0, assignedAt.getTime() - new Date(task.createdAt).getTime());
      task.estimatedDistance = selected.totalDistance; task.estimatedDurationSeconds = selected.estimatedDurationSeconds; task.estimatedBatteryRequired = selected.batteryRequired;
      task.schedulingExplanation = explainDecision(task, selected, this.schedulingWeights);
      task.schedulingExplanation.excludedRobots = result.excluded;
      task.schedulingExplanation.alternatives = candidates.slice(1).map((candidate) => ({ robotId: candidate.robot.robotId, score: candidate.score, totalDistance: candidate.totalDistance, estimatedDurationSeconds: candidate.estimatedDurationSeconds }));
      task.updatedAt = assignedAt;
      robot.status = "Busy"; robot.currentTask = task.id;
      stock.reserved = (stock.reserved || 0) + task.quantity;
      try {
        await this.persist("task:assigned", { robots: this.robots, tasks: this.tasks, inventory: this.inventory });
      } catch (error) {
        this.robots.splice(0, this.robots.length, ...rollback.robots);
        this.tasks.splice(0, this.tasks.length, ...rollback.tasks);
        this.inventory.splice(0, this.inventory.length, ...rollback.inventory);
        throw error;
      }
      const decision = { taskId: task.id, robotId: robot.robotId, explanation: task.schedulingExplanation };
      decisions.push(decision);
      this.emit("scheduling:decision", decision);
      this.emit("task:update", task);
    }
    if (pendingChanged) {
      await this.persist("scheduling:pending", { robots: this.robots, tasks: this.tasks, inventory: this.inventory });
      for (const task of ordered.filter((item) => item.status === "Pending")) this.emit("task:update", task);
    }
    return decisions;
  }

  start() {
    if (this.running) return;
    this.running = true; this.emit("simulation:state", { running: true, tickMs: this.tickMs });
    this.timer = setInterval(() => { this.tick().catch((error) => { this.pause(); this.emit("simulation:error", { code: "PERSISTENCE_FAILURE", message: `Simulation paused because its latest tick could not be persisted: ${error.message}` }); }); }, this.tickMs);
    this.schedulePending().catch((error) => this.emit("simulation:error", { code: "SCHEDULING_PERSISTENCE_FAILURE", message: error.message }));
  }
  pause() {
    this.running = false; clearInterval(this.timer); this.timer = null;
    this.emit("simulation:state", { running: false, tickMs: this.tickMs });
  }
  resume() { this.start(); }
  async reset() {
    this.pause();
    for (const task of this.tasks.filter((item) => !["Completed", "Failed"].includes(item.status))) this.failTask(task, this.robot(task.robotId), "Task cancelled by simulation reset", "SIMULATION_RESET");
    await this.persist("simulation:reset", { robots: this.robots, tasks: this.tasks });
  }

  async tick() {
    if (!this.running || this._ticking) return;
    this._ticking = true;
    const rollback = structuredClone({ robots: this.robots, tasks: this.tasks, inventory: this.inventory });
    this._eventBuffer = [];
    try {
      const proposals = [];
      for (const task of this.tasks.filter((item) => !["Completed", "Failed"].includes(item.status))) {
        const robot = this.robot(task.robotId);
        if (!robot || robot.status !== "Busy" || robot.currentTask !== task.id) {
          this.failTask(task, robot, "Assigned robot became unavailable during task", "ROBOT_UNAVAILABLE"); continue;
        }
        if (robot.battery <= 0) { this.failTask(task, robot, "Robot battery depleted before reaching next waypoint", "BATTERY_DEPLETED"); continue; }
        const goal = task.stage === "toPickup" ? task.pickupPosition : task.destinationPosition;
        if (same(robot.position, goal)) { this.arrive(task, robot); continue; }
        if (!Array.isArray(task.route) || !task.route.length || !same(task.route[task.route.length - 1], goal)) {
          task.route = findPath(robot.position, goal, this.staticBlocked(robot.robotId));
        }
        if (!task.route) { this.failTask(task, robot, "No walkable route exists to the current waypoint", "NO_PATH"); continue; }
        if (task.route.length && !this.canWalk(task.route[0])) task.route = null;
        if (!task.route) { this.publish("simulation:error", { taskId: task.id, robotId: robot.robotId, code: "PATH_BLOCKED", message: "Route blocked; replanning" }); task.route = findPath(robot.position, goal, this.staticBlocked(robot.robotId)); }
        if (!task.route) { this.failTask(task, robot, "Route became blocked and no alternate route exists", "NO_PATH"); continue; }
        const next = task.route[0];
        if (!this.canWalk(next)) { this.failTask(task, robot, "Planner proposed a non-walkable step", "INVALID_STEP"); continue; }
        proposals.push({ robot, task, from: robot.position, to: next });
      }
      const allowed = [];
      const byDestination = new Map();
      for (const proposal of proposals) {
        const k = key(proposal.to);
        if (!byDestination.has(k)) byDestination.set(k, []);
        byDestination.get(k).push(proposal);
      }
      for (const group of byDestination.values()) {
        group.sort((a, b) => a.robot.robotId.localeCompare(b.robot.robotId));
        if (group.length > 1) {
          for (const proposal of group.slice(1)) this.publish("simulation:error", { taskId: proposal.task.id, robotId: proposal.robot.robotId, code: "CELL_CONFLICT", message: `Cell ${key(proposal.to)} reserved by ${group[0].robot.robotId} this tick; waiting` });
        }
        allowed.push(group[0]);
      }
      const swaps = new Set();
      for (let i = 0; i < allowed.length; i++) for (let j = i + 1; j < allowed.length; j++) {
        if (same(allowed[i].to, allowed[j].from) && same(allowed[j].to, allowed[i].from)) { swaps.add(allowed[i]); swaps.add(allowed[j]); }
      }
      const accepted = new Set(allowed.filter((proposal) => !swaps.has(proposal)));
      let removed;
      do {
        removed = false;
        for (const proposal of [...accepted]) {
          const occupant = this.robots.find((robot) => robot !== proposal.robot && same(robot.position, proposal.to));
          if (occupant && ![...accepted].some((other) => other.robot === occupant)) { accepted.delete(proposal); removed = true; }
        }
      } while (removed);
      for (const proposal of allowed) {
        if (swaps.has(proposal)) { this.publish("simulation:error", { taskId: proposal.task.id, robotId: proposal.robot.robotId, code: "HEAD_ON_CONFLICT", message: "Head-on cell swap prevented" }); continue; }
        if (!accepted.has(proposal)) { this.publish("simulation:error", { taskId: proposal.task.id, robotId: proposal.robot.robotId, code: "OCCUPIED_CELL", message: `Cell ${key(proposal.to)} remains occupied` }); continue; }
        proposal.robot.position = proposal.to; proposal.robot.location = `(${proposal.to.x},${proposal.to.y})`;
        proposal.robot.battery = Math.max(0, Number(proposal.robot.battery) - 1);
        proposal.robot.distanceTravelled = (proposal.robot.distanceTravelled || 0) + 1;
        proposal.task.route.shift(); proposal.task.status = proposal.task.stage === "toPickup" ? "To pickup" : "In transit"; proposal.task.updatedAt = new Date();
        this.publish("robot:position", { robotId: proposal.robot.robotId, position: proposal.robot.position, location: proposal.robot.location, battery: proposal.robot.battery, status: proposal.robot.status, taskId: proposal.task.id, stage: proposal.task.stage });
        this.publish("task:update", proposal.task);
      }
      for (const task of this.tasks.filter((item) => !["Completed", "Failed"].includes(item.status))) {
        const robot = this.robot(task.robotId); const goal = task.stage === "toPickup" ? task.pickupPosition : task.destinationPosition;
        if (robot && same(robot.position, goal)) this.arrive(task, robot);
      }
      await this.persist("simulation:tick", { robots: this.robots, tasks: this.tasks, inventory: this.inventory });
      for (const [event, payload] of this._eventBuffer) this.emit(event, payload);
      this._eventBuffer = null;
    } catch (error) {
      this.robots.splice(0, this.robots.length, ...rollback.robots);
      this.tasks.splice(0, this.tasks.length, ...rollback.tasks);
      this.inventory.splice(0, this.inventory.length, ...rollback.inventory);
      this._eventBuffer = null;
      throw error;
    } finally { this._ticking = false; }
    await this.schedulePending();
  }

  arrive(task, robot) {
    if (task.stage === "toPickup") {
      const stock = this.inventory.find((item) => item.material === task.material && item.location === task.pickupLocation);
      if (!stock || stock.quantity < task.quantity || (stock.reserved || 0) < task.quantity) { this.failTask(task, robot, "Reserved inventory became unavailable before pickup", "INVENTORY_UNAVAILABLE"); return; }
      task.route = findPath(robot.position, task.destinationPosition, this.staticBlocked(robot.robotId));
      if (!task.route) { this.failTask(task, robot, "No valid route to delivery location", "NO_PATH"); return; }
      stock.quantity -= task.quantity; stock.reserved -= task.quantity; task.inventoryPickedUp = true; task.stage = "toDelivery"; task.status = "In transit";
      robot.cargo = { taskId: task.id, material: task.material, quantity: task.quantity };
      this.publish("task:update", task);
    } else {
      let destinationStock = this.inventory.find((item) => item.material === task.material && item.location === task.destination);
      if (!destinationStock) { destinationStock = { id: `INV-${Date.now()}`, material: task.material, quantity: 0, location: task.destination }; this.inventory.push(destinationStock); }
      destinationStock.quantity += task.quantity;
      robot.cargo = null;
      task.status = "Completed"; task.stage = "completed"; task.completedAt = new Date(); task.updatedAt = new Date();
      robot.status = "Available"; robot.currentTask = null;
      this.publish("task:update", task); this.publish("task:completed", task);
    }
  }

  failTask(task, robot, message, code) {
    task.status = "Failed"; task.stage = "failed"; task.error = message; task.errorCode = code; task.updatedAt = new Date(); task.completedAt = new Date();
    if (!task.inventoryPickedUp) {
      const stock = this.inventory.find((item) => item.material === task.material && item.location === task.pickupLocation);
      if (stock) stock.reserved = Math.max(0, (stock.reserved || 0) - task.quantity);
    }
    if (robot && robot.currentTask === task.id) { robot.currentTask = null; if (robot.status === "Busy") robot.status = "Error"; }
    this.publish("simulation:error", { taskId: task.id, robotId: robot?.robotId || task.robotId, code, message }); this.publish("task:update", task);
  }
}
module.exports = { SimulationEngine, GRID, OBSTACLES, findPath, locToPosition, key };
