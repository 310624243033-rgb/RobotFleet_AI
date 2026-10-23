const PRIORITY = { Urgent: 4, High: 3, Normal: 2, Low: 1 };
const DEFAULT_WEIGHTS = Object.freeze({ distance: 0.5, battery: 0.25, duration: 0.15, loadFit: 0.1 });

function comparePending(a, b) {
  const priorityDiff = (PRIORITY[b.priority] || PRIORITY.Normal) - (PRIORITY[a.priority] || PRIORITY.Normal);
  if (priorityDiff) return priorityDiff;
  const createdDiff = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  return createdDiff || String(a.id).localeCompare(String(b.id));
}
function normalizeWeights(weights = {}) {
  const result = {};
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const value = Number(weights[key] ?? DEFAULT_WEIGHTS[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Scheduling weight ${key} must be between 0 and 1`);
    result[key] = value;
  }
  if (Object.values(result).reduce((sum, value) => sum + value, 0) <= 0) throw new Error("At least one scheduling weight must be greater than zero");
  return result;
}

function evaluateCandidates(task, robots, inventory, options = {}) {
  const { findPath, staticBlocked = () => new Set(), canWalk = () => true, tickMs = 700, batteryPerCell = 1, reserveBattery = 15, handlingSeconds = 6 } = options;
  if (!findPath) throw new Error("A* route planner is required for scheduling");
  const stock = inventory.find((item) => item.material === task.material && item.location === task.pickupLocation);
  const availableStock = stock ? stock.quantity - (stock.reserved || 0) : 0;
  const eligible = [];
  const excluded = [];

  for (const [inputOrder, robot] of robots.entries()) {
    const status = robot.status || "Unknown";
    let reason = null;
    if (!robot.position || !canWalk(robot.position)) reason = "Robot has no valid walkable grid position";
    else if (robot.currentTask) reason = `Already assigned to ${robot.currentTask}`;
    else if (!["Available", "Idle"].includes(status)) reason = status === "Charging" ? "Robot is charging and cannot accept a task" : `Robot status ${status} is not available`;
    else if (Number(robot.currentLoad || 0) + Number(task.loadUnits ?? task.quantity) > Number(robot.maxLoadCapacity ?? 100)) reason = `Load ${task.loadUnits ?? task.quantity} exceeds remaining capacity ${Number(robot.maxLoadCapacity ?? 100) - Number(robot.currentLoad || 0)}`;
    else if (availableStock < Number(task.quantity)) reason = `Insufficient unreserved stock (${availableStock} available)`;

    let pickupRoute;
    let deliveryRoute;
    if (!reason) {
      const blocked = staticBlocked(robot.robotId);
      pickupRoute = findPath(robot.position, task.pickupPosition, blocked);
      deliveryRoute = findPath(task.pickupPosition, task.destinationPosition, blocked);
      if (!pickupRoute || !deliveryRoute) reason = "No collision-free A* route for both task legs";
    }
    if (!reason) {
      const distanceToPickup = pickupRoute.length;
      const distanceToDelivery = deliveryRoute.length;
      const totalDistance = distanceToPickup + distanceToDelivery;
      const batteryRequired = Math.ceil(totalDistance * batteryPerCell);
      const safeBatteryRequired = batteryRequired + reserveBattery;
      if (Number(robot.battery) < safeBatteryRequired) reason = `Battery ${robot.battery}% is below ${safeBatteryRequired}% required including ${reserveBattery}% reserve`;
      else {
        const estimatedDurationSeconds = Number((totalDistance * tickMs / 1000 + handlingSeconds).toFixed(1));
        eligible.push({
          robot,
          inputOrder,
          pickupRoute,
          deliveryRoute,
          distanceToPickup,
          distanceToDelivery,
          totalDistance,
          batteryRequired,
          safeBatteryRequired,
          batteryAfterTask: Number(robot.battery) - batteryRequired,
          estimatedDurationSeconds,
          capacity: Number(robot.maxLoadCapacity ?? 100),
          loadUtilization: (Number(robot.currentLoad || 0) + Number(task.loadUnits ?? task.quantity)) / Math.max(1, Number(robot.maxLoadCapacity ?? 100)),
          scoreParts: null,
          score: null
        });
      }
    }
    if (reason) excluded.push({ robotId: robot.robotId, reason });
  }
  return { eligible, excluded, availableStock };
}

function scoreCandidates(candidates, weights = DEFAULT_WEIGHTS, { maxDistance = 40, maxDurationSeconds = 60 } = {}) {
  const normalized = normalizeWeights(weights);
  return candidates.map((candidate) => {
    const scoreParts = {
      distance: candidate.totalDistance / maxDistance,
      battery: 1 - Number(candidate.robot.battery) / 100,
      duration: candidate.estimatedDurationSeconds / maxDurationSeconds,
      loadFit: candidate.loadUtilization
    };
    const score = Object.keys(normalized).reduce((sum, key) => sum + normalized[key] * scoreParts[key], 0);
    return { ...candidate, scoreParts, score: Number(score.toFixed(6)) };
  }).sort((a, b) => a.score - b.score || a.totalDistance - b.totalDistance || b.robot.battery - a.robot.battery || String(a.robot.robotId).localeCompare(String(b.robot.robotId)));
}

function explainDecision(task, candidate, weights) {
  return {
    selectedRobot: candidate.robot.robotId,
    reason: [
      `Distance to pickup: ${candidate.distanceToPickup} cells`,
      `Total route: ${candidate.totalDistance} cells (${candidate.distanceToDelivery} after pickup)`,
      `Battery: ${candidate.robot.battery}% available; estimated ${candidate.batteryRequired}% required plus ${candidate.safeBatteryRequired - candidate.batteryRequired}% reserve`,
      `Load capacity: ${task.loadUnits ?? task.quantity} units of ${candidate.capacity} available`,
      `Current status: ${candidate.robot.status}`,
      `Estimated completion time: ${candidate.estimatedDurationSeconds} seconds`
    ],
    score: candidate.score,
    scoreParts: candidate.scoreParts,
    weights: { ...weights },
    distanceToPickup: candidate.distanceToPickup,
    distanceToDelivery: candidate.distanceToDelivery,
    totalDistance: candidate.totalDistance,
    batteryRequired: candidate.batteryRequired,
    batteryReserve: candidate.safeBatteryRequired - candidate.batteryRequired,
    estimatedDurationSeconds: candidate.estimatedDurationSeconds,
    evaluatedAt: new Date()
  };
}

function schedulingAnalytics(tasks) {
  const assigned = tasks.filter((task) => task.assignedAt || task.robotId);
  const assignmentTimes = assigned.map((task) => Number(task.assignmentTimeMs ?? (task.assignedAt && task.createdAt ? new Date(task.assignedAt) - new Date(task.createdAt) : NaN))).filter(Number.isFinite);
  const distances = assigned.map((task) => Number(task.estimatedDistance)).filter(Number.isFinite);
  const priorities = { Urgent: 0, High: 0, Normal: 0, Low: 0 };
  for (const task of tasks) priorities[priorities[task.priority] === undefined ? "Normal" : task.priority]++;
  return {
    averageAssignmentTimeMs: assignmentTimes.length ? Number((assignmentTimes.reduce((a, b) => a + b, 0) / assignmentTimes.length).toFixed(1)) : 0,
    pendingQueueLength: tasks.filter((task) => task.status === "Pending").length,
    assignmentSuccessRate: tasks.length ? Number((assigned.length / tasks.length * 100).toFixed(1)) : 0,
    tasksByPriority: priorities,
    averageEstimatedTravelDistance: distances.length ? Number((distances.reduce((a, b) => a + b, 0) / distances.length).toFixed(1)) : 0,
    totalTasks: tasks.length,
    assignedTasks: assigned.length
  };
}

function baselineFirstAvailable(task, eligibleCandidates) {
  const candidate = [...eligibleCandidates].sort((a, b) => Number(a.inputOrder || 0) - Number(b.inputOrder || 0) || String(a.robot.robotId).localeCompare(String(b.robot.robotId)))[0];
  return candidate || null;
}

module.exports = { PRIORITY, DEFAULT_WEIGHTS, comparePending, normalizeWeights, evaluateCandidates, scoreCandidates, explainDecision, schedulingAnalytics, baselineFirstAvailable };
