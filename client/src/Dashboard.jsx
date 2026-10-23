import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { api as axios, API } from "./auth/api";
import { useAuth } from "./auth/useAuth";
import { io } from "socket.io-client";
import {
  LayoutDashboard,
  Bot,
  Package,
  Truck,
  Activity,
  BatteryCharging,
  MapPin,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Search,
  Bell,
  Menu,
  Plus,
  ArrowUpRight,
  Circle
} from "lucide-react";
import "./App.css";
import "./premium.css";

const pathForPage = { Dashboard: "/dashboard", "Warehouse Map": "/warehouse", Robots: "/robots", Tasks: "/tasks", Inventory: "/inventory", Battery: "/charging", Monitoring: "/analytics" };
const pageForPath = { "/dashboard": "Dashboard", "/warehouse": "Warehouse Map", "/robots": "Robots", "/tasks": "Tasks", "/inventory": "Inventory", "/charging": "Battery", "/analytics": "Monitoring", "/alerts": "Monitoring", "/logs": "Monitoring", "/settings": "Monitoring", "/profile": "Monitoring" };

function DashboardApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, notice, clearNotice } = useAuth();
  const [robots, setRobots] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [tasks, setTasks] = useState([]);
  const activePage = pageForPath[location.pathname] || "Dashboard";
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedRobot, setSelectedRobot] = useState(null);
  const [taskStatusFilter, setTaskStatusFilter] = useState("All");
  const [simulation, setSimulation] = useState({ running: false, grid: { width: 24, height: 16, obstacles: [] } });
  const [simulationError, setSimulationError] = useState("");
  const [scheduling, setScheduling] = useState({ weights: null, analytics: null, decisions: [] });
  const goToPage = (page) => { navigate(pathForPage[page] || "/dashboard"); setMobileNavOpen(false); };

  const loadData = async () => {
    try {
      const [robotsRes, inventoryRes, tasksRes, simulationRes, schedulingRes] = await Promise.all([
        axios.get(`${API}/robots`),
        axios.get(`${API}/inventory`),
        axios.get(`${API}/tasks`),
        axios.get(`${API}/simulation`),
        axios.get(`${API}/scheduling`)
      ]);

      setRobots(robotsRes.data);
      setSelectedRobot((current) => current ? robotsRes.data.find((robot) => robot.robotId === current.robotId) || null : null);
      setInventory(inventoryRes.data);
      setTasks(tasksRes.data);
      setSimulation((current) => ({ ...current, running: simulationRes.data.running, grid: simulationRes.data.grid }));
      setScheduling(schedulingRes.data);
    } catch (error) {
      console.error("Unable to load dashboard data:", error);
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadData(); }, 0);
    const interval = setInterval(loadData, 5000);
    return () => { window.clearTimeout(initialLoad); clearInterval(interval); };
  }, []);

  useEffect(() => {
    const socket = io(API.replace(/\/api$/, ""), { transports: ["websocket", "polling"], withCredentials: true });
    socket.on("simulation:snapshot", (snapshot) => {
      setRobots(snapshot.robots || []);
      setTasks(snapshot.tasks || []);
      setSimulation({ running: snapshot.running, grid: snapshot.grid });
      if (snapshot.scheduling) setScheduling(snapshot.scheduling);
    });
    socket.on("robot:position", (update) => {
      setRobots((current) => current.map((robot) => robot.robotId === update.robotId ? { ...robot, ...update } : robot));
      setSelectedRobot((current) => current?.robotId === update.robotId ? { ...current, ...update } : current);
    });
    socket.on("robot:created", (robot) => setRobots((current) => current.some((item) => item.robotId === robot.robotId) ? current : [...current, robot]));
    socket.on("task:update", (update) => {
      setTasks((current) => current.some((task) => task.id === update.id) ? current.map((task) => task.id === update.id ? update : task) : [...current, update]);
      axios.get(`${API}/scheduling`).then((response) => setScheduling(response.data)).catch(() => {});
    });
    socket.on("scheduling:decision", () => axios.get(`${API}/scheduling`).then((response) => setScheduling(response.data)).catch(() => {}));
    socket.on("simulation:state", (state) => setSimulation((current) => ({ ...current, running: state.running })));
    socket.on("simulation:error", (event) => {
      setSimulationError(event.message || "Robot movement error");
      window.setTimeout(() => setSimulationError(""), 4500);
    });
    socket.on("task:completed", () => loadData());
    return () => socket.disconnect();
  }, []);

  const controlSimulation = async (action) => {
    try {
      await axios.post(`${API}/simulation/${action}`);
      if (action === "reset") await loadData();
    } catch (error) {
      setSimulationError(error.response?.data?.message || "Unable to control simulation");
    }
  };

  const available = robots.filter(
    (robot) => robot.status === "Available"
  ).length;

  const charging = robots.filter(
    (robot) => robot.status === "Charging"
  ).length;

  const activeTasks = tasks.filter(
    (task) => task.status !== "Completed"
  ).length;

  const filteredRobots = robots.filter((robot) =>
    `${robot.robotId} ${robot.name} ${robot.location}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="app-shell">

      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarCollapsed ? "is-collapsed" : ""} ${mobileNavOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">
            <Bot size={24} />
          </div>

          <div>
            <h2>ROBOFLOW</h2>
            <span>WAREHOUSE CONTROL</span>
          </div>
        </div>

        <div className="nav-label">OPERATIONS</div>

        <nav aria-label="Operations">
          <button
            className={activePage === "Dashboard" ? "nav-item active" : "nav-item"}
            onClick={() => goToPage("Dashboard")}
          >
            <LayoutDashboard size={19} />
            Dashboard
          </button>

          <button
            className={activePage === "Robots" ? "nav-item active" : "nav-item"}
            onClick={() => goToPage("Robots")}
          >
            <Bot size={19} />
            Robots
            <span className="nav-count">{robots.length}</span>
          </button>

          <button className={activePage === "Warehouse Map" ? "nav-item active" : "nav-item"} onClick={() => goToPage("Warehouse Map")}>
            <MapPin size={19} /> Warehouse Map
          </button>

          <button
            className={activePage === "Inventory" ? "nav-item active" : "nav-item"}
            onClick={() => goToPage("Inventory")}
          >
            <Package size={19} />
            Inventory
          </button>

          <button
            className={activePage === "Tasks" ? "nav-item active" : "nav-item"}
            onClick={() => goToPage("Tasks")}
          >
            <Truck size={19} />
            Material Tasks
            {activeTasks > 0 && (
              <span className="nav-count">{activeTasks}</span>
            )}
          </button>
        </nav>

        <div className="nav-label">SYSTEM</div>

        <nav aria-label="System">
          <button className={activePage === "Monitoring" ? "nav-item active" : "nav-item"} onClick={() => goToPage("Monitoring")}>
            <Activity size={19} />
            Monitoring
          </button>

          <button className={activePage === "Battery" ? "nav-item active" : "nav-item"} onClick={() => goToPage("Battery")}>
            <BatteryCharging size={19} />
            Battery
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="system-status">
            <span className="status-dot"></span>
            <div>
              <strong>System Online</strong>
              <small>All services operational</small>
            </div>
          </div>

          <div className="version">
            ROBOFLEET AI · v1.0
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        {notice && <div className="auth-toast" role="status">{notice}<button type="button" aria-label="Dismiss notification" onClick={clearNotice}>×</button></div>}

        {/* TOPBAR */}
        <header className="topbar">

          <button className="mobile-menu" aria-label="Toggle navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
            <Menu size={22} />
          </button>
          <button className="sidebar-toggle" aria-label="Collapse or expand sidebar" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><Menu size={18} /></button>

          <div className="page-title">
            <span>CONTROL CENTER</span>
            <h1>{activePage}</h1>
          </div>

          <div className="top-actions">

            <div className="search-box">
              <Search size={17} />
              <input
                placeholder="Search robots..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button className="icon-button">
              <Bell size={19} />
              <span className="notification-dot"></span>
            </button>

            <div className="profile">
              <div className="profile-avatar">{user?.name?.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "RF"}</div>
              <div>
                <strong>{user?.name || "RoboFleet user"}</strong>
                <span>{user?.role || "Viewer"}</span>
              </div>
              <button className="logout-button" onClick={async () => { try { await logout(); navigate("/login", { replace: true }); } catch { setSimulationError("Unable to sign out. Check your connection and retry."); } }} aria-label="Sign out"><LogOut size={16} /></button>
            </div>

          </div>
        </header>

        {/* CONTENT */}
        <div className="content">

          {(activePage === "Dashboard" || activePage === "Warehouse Map") && (
            <>
              <div className="welcome-row">
                <div>
                  <h2>{activePage === "Warehouse Map" ? "Live warehouse map" : "Warehouse Overview"}</h2>
                  <p>
                    Real-time monitoring of autonomous material movement.
                  </p>
                </div>

                <button
                  className="primary-button"
                  onClick={() => goToPage("Tasks")}
                >
                  <Plus size={18} />
                  New Material Task
                </button>
                <button className="simulation-toggle" onClick={() => controlSimulation(simulation.running ? "pause" : "start")} aria-pressed={simulation.running}>
                  <span className={simulation.running ? "sim-indicator running" : "sim-indicator"} />
                  {simulation.running ? "Pause simulation" : "Start simulation"}
                </button>
              </div>

              {/* KPI CARDS */}
              <section className="kpi-grid">

                <div className="kpi-card">
                  <div className="kpi-top">
                    <span>Total Robots</span>
                    <div className="kpi-icon blue">
                      <Bot size={20} />
                    </div>
                  </div>

                  <strong>{robots.length}</strong>

                  <div className="kpi-footer">
                    <span className="positive">
                      <ArrowUpRight size={14} />
                      Fleet
                    </span>
                    <span>registered units</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-top">
                    <span>Available</span>
                    <div className="kpi-icon green">
                      <CheckCircle2 size={20} />
                    </div>
                  </div>

                  <strong>{available}</strong>

                  <div className="kpi-footer">
                    <span className="positive">
                      <Circle size={9} fill="currentColor" />
                      Ready
                    </span>
                    <span>for assignment</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-top">
                    <span>Active Tasks</span>
                    <div className="kpi-icon orange">
                      <Truck size={20} />
                    </div>
                  </div>

                  <strong>{activeTasks}</strong>

                  <div className="kpi-footer">
                    <span className="warning">
                      <Clock3 size={14} />
                      Live
                    </span>
                    <span>movement orders</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-top">
                    <span>Charging</span>
                    <div className="kpi-icon purple">
                      <BatteryCharging size={20} />
                    </div>
                  </div>

                  <strong>{charging}</strong>

                  <div className="kpi-footer">
                    <span>Battery</span>
                    <span>charging units</span>
                  </div>
                </div>

              </section>

              {/* MAIN GRID */}
              <section className={`dashboard-grid ${activePage === "Warehouse Map" ? "map-focus" : ""}`}>

                {/* ROBOT TABLE */}
                <div className="panel robot-panel">

                  <div className="panel-header">
                    <div>
                      <h3>Robot Fleet</h3>
                      <p>Live fleet status</p>
                    </div>

                    <button
                      className="text-button"
                      onClick={() => goToPage("Robots")}
                    >
                      View all →
                    </button>
                  </div>

                  <div className="robot-table">

                    <div className="table-head">
                      <span>ROBOT</span>
                      <span>STATUS</span>
                      <span>BATTERY</span>
                      <span>LOCATION</span>
                    </div>

                    {filteredRobots.map((robot) => (
                      <div className="table-row" key={robot.robotId}>

                        <div className="robot-name">
                          <div className="robot-mini">
                            <Bot size={17} />
                          </div>

                          <div>
                            <strong>{robot.robotId}</strong>
                            <small>{robot.name}</small>
                          </div>
                        </div>

                        <div>
                          <span
                            className={`status-pill ${robot.status
                              .toLowerCase()
                              .replace(" ", "-")}`}
                          >
                            <span></span>
                            {robot.status}
                          </span>
                        </div>

                        <div className="battery-cell">
                          <div className="battery-track">
                            <div
                              className={`battery-level ${
                                robot.battery < 30 ? "low" : ""
                              }`}
                              style={{
                                width: `${robot.battery}%`
                              }}
                            ></div>
                          </div>

                          <span>{robot.battery}%</span>
                        </div>

                        <div className="location-cell">
                          <MapPin size={14} />
                          {robot.location}
                        </div>

                      </div>
                    ))}

                  </div>
                </div>

                {/* WAREHOUSE MAP */}
                <div className="panel map-panel">

                  <div className="panel-header">
                    <div>
                      <h3>Warehouse Map</h3>
                      <p>Robot positions</p>
                    </div>

                    <span className="live-label">
                      <span></span>
                      LIVE
                    </span>
                  </div>

                  <div className="warehouse-map">

                    <div className="map-grid"></div>

                    <div className="map-obstacles" aria-label="Warehouse rack obstacles">
                      {(simulation.grid?.obstacles || []).map((cell) => <i key={`${cell.x},${cell.y}`} className="map-obstacle" style={{ left: `${((cell.x + 0.5) / simulation.grid.width) * 100}%`, top: `${((cell.y + 0.5) / simulation.grid.height) * 100}%` }} />)}
                    </div>

                    {tasks.filter((task) => !["Completed", "Failed"].includes(task.status)).map((task) => {
                      const robot = robots.find((item) => item.robotId === task.robotId);
                      if (!robot?.position || !task.route?.length) return null;
                      const points = [robot.position, ...task.route].map((point) => `${point.x + 0.5},${point.y + 0.5}`).join(" ");
                      return <svg key={`route-${task.id}`} className="route-overlay" viewBox={`0 0 ${simulation.grid.width} ${simulation.grid.height}`} preserveAspectRatio="none" aria-label={`Route for ${robot.robotId}`}><polyline points={points} /><circle cx={task.pickupPosition.x + 0.5} cy={task.pickupPosition.y + 0.5} r=".28" className="pickup-marker" /><circle cx={task.destinationPosition.x + 0.5} cy={task.destinationPosition.y + 0.5} r=".28" className="delivery-marker" /></svg>;
                    })}

                    {robots.map((robot) => (
                      <div
                        className={`map-robot ${selectedRobot?.robotId === robot.robotId ? "selected" : ""} ${robot.status.toLowerCase()}`}
                        key={robot.robotId}
                        title={`${robot.robotId} - ${robot.location}`}
                        style={robot.position ? { left: `${((robot.position.x + 0.5) / simulation.grid.width) * 100}%`, top: `${((robot.position.y + 0.5) / simulation.grid.height) * 100}%` } : undefined}
                        onClick={() => setSelectedRobot(robot)}
                        aria-label={`Inspect ${robot.robotId} at ${robot.location}`}
                        role="button"
                        tabIndex={0}
                      >
                        <Bot size={15} />
                      </div>
                    ))}

                    <div className="map-legend">
                      <span>
                        <i className="legend-available"></i>
                        Available
                      </span>

                      <span>
                        <i className="legend-busy"></i>
                        Busy
                      </span>

                      <span>
                        <i className="legend-charge"></i>
                        Charging
                      </span>
                    </div>

                    <div className="map-controls">
                      <button onClick={() => controlSimulation("start")} disabled={simulation.running}>Start</button>
                      <button onClick={() => controlSimulation("pause")} disabled={!simulation.running}>Pause</button>
                      <button onClick={() => controlSimulation("resume")} disabled={simulation.running}>Resume</button>
                    </div>

                    {selectedRobot && <aside className="robot-inspector">
                      <button className="inspector-close" aria-label="Close robot details" onClick={() => setSelectedRobot(null)}>×</button>
                      <span className="eyebrow">ROBOT INSPECTION</span>
                      <strong>{selectedRobot.name}</strong>
                      <small>{selectedRobot.robotId} · {selectedRobot.status}</small>
                      <span>Battery <b>{selectedRobot.battery}%</b></span>
                      <span>Position <b>{selectedRobot.location}</b></span>
                      <span>Task <b>{selectedRobot.currentTask || "None assigned"}</b></span>
                    </aside>}

                  </div>
                  {simulationError && <div className="simulation-error" role="status"><AlertTriangle size={14} />{simulationError}</div>}
                </div>

              </section>

              {/* LOWER GRID */}
              <section className="lower-grid">

                <div className="panel">

                  <div className="panel-header">
                    <div>
                      <h3>Inventory Snapshot</h3>
                      <p>Current warehouse materials</p>
                    </div>

                    <button
                      className="text-button"
                      onClick={() => goToPage("Inventory")}
                    >
                      Manage →
                    </button>
                  </div>

                  <div className="inventory-list">

                    {inventory.map((item) => (
                      <div className="inventory-item" key={item.id}>

                        <div className="inventory-icon">
                          <Package size={18} />
                        </div>

                        <div className="inventory-info">
                          <strong>{item.material}</strong>
                          <span>{item.location}</span>
                        </div>

                        <div className="inventory-quantity">
                          <strong>{item.quantity}</strong>
                          <span>units</span>
                        </div>

                      </div>
                    ))}

                  </div>
                </div>

                <div className="panel">

                  <div className="panel-header">
                    <div>
                      <h3>Recent Activity</h3>
                      <p>System events</p>
                    </div>
                  </div>

                  <div className="activity-list">

                    <div className="activity-item">
                      <div className="activity-icon green">
                        <CheckCircle2 size={16} />
                      </div>

                      <div>
                        <strong>Fleet system online</strong>
                        <span>All robot services operational</span>
                      </div>

                      <small>Now</small>
                    </div>

                    <div className="activity-item">
                      <div className="activity-icon blue">
                        <Bot size={16} />
                      </div>

                      <div>
                        <strong>{robots.length} robots detected</strong>
                        <span>Fleet synchronization completed</span>
                      </div>

                      <small>Live</small>
                    </div>

                    <div className="activity-item">
                      <div className="activity-icon orange">
                        <AlertTriangle size={16} />
                      </div>

                      <div>
                        <strong>Battery monitoring active</strong>
                        <span>Low-battery protection enabled</span>
                      </div>

                      <small>Live</small>
                    </div>

                  </div>

                </div>

              </section>
            </>
          )}

          {activePage === "Robots" && (
            <RobotPage robots={filteredRobots} user={user} onCreated={loadData} />
          )}

          {(activePage === "Monitoring" || activePage === "Battery") && (
            <section className="page-section">
              <div className="welcome-row"><div><h2>{activePage === "Battery" ? "Fleet energy" : "System monitoring"}</h2><p>Live telemetry from the connected robot fleet.</p></div></div>
              <div className="robot-cards">{robots.map((robot) => <article className="large-robot-card" key={robot.robotId}><div className="large-robot-top"><div className="robot-large-icon"><BatteryCharging size={24} /></div><span className={`status-pill ${robot.status.toLowerCase().replace(" ", "-")}`}><span />{robot.status}</span></div><h3>{robot.name}</h3><p className="robot-id">{robot.robotId} · {robot.location}</p><div className="battery-track large"><div className={`battery-level ${robot.battery < 30 ? "low" : ""}`} style={{ width: `${robot.battery}%` }} /></div><div className="robot-details"><div><span>Battery</span><strong>{robot.battery}%</strong></div><div><span>Current task</span><strong>{robot.currentTask || "Unassigned"}</strong></div></div></article>)}</div>
            </section>
          )}

          {activePage === "Inventory" && (
            <InventoryPage inventory={inventory} />
          )}

          {activePage === "Tasks" && (
            <TaskPage
              tasks={tasks}
              onTaskCreated={loadData}
              taskStatusFilter={taskStatusFilter}
              setTaskStatusFilter={setTaskStatusFilter}
              simulation={simulation}
              controlSimulation={controlSimulation}
              scheduling={scheduling}
              onWeightsSaved={async (weights) => {
                const response = await axios.put(`${API}/scheduling/weights`, { weights });
                setScheduling(response.data);
              }}
            />
          )}

        </div>
      </main>
    </div>
  );
}


/* ROBOTS PAGE */

function RobotPage({ robots, user, onCreated }) {
  const [form, setForm] = useState({ robotId: "", name: "", model: "AMR", battery: 100, maxLoadCapacity: 100, x: 1, y: 1, status: "Available" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const canManage = ["Admin", "Warehouse Manager"].includes(user?.role);
  const createRobot = async (event) => {
    event.preventDefault(); setError(""); setSuccess(""); setSaving(true);
    try {
      await axios.post(`${API}/robots`, { ...form, position: { x: Number(form.x), y: Number(form.y) } });
      setForm({ robotId: "", name: "", model: "AMR", battery: 100, maxLoadCapacity: 100, x: 1, y: 1, status: "Available" });
      setSuccess("Robot added to the live fleet."); await onCreated();
    } catch (requestError) {
      setError(requestError.response?.data?.message || (requestError.request ? "Can't reach the robot service. Check the server connection and try again." : "Unable to add robot."));
    } finally { setSaving(false); }
  };
  return (
    <div className="page-section">

      <div className="welcome-row">
        <div>
          <h2>Robot Fleet</h2>
          <p>Monitor every autonomous robot in the warehouse.</p>
        </div>
      </div>

      {canManage && <form className="panel robot-create-form" onSubmit={createRobot}>
        <div className="panel-header"><div><h3>Add robot</h3><p>Register a robot at an unoccupied, walkable warehouse cell.</p></div></div>
        <div className="robot-create-fields">
          <label>Robot ID<input required maxLength="32" value={form.robotId} onChange={(e) => setForm({ ...form, robotId: e.target.value })} placeholder="AMR-004" /></label>
          <label>Name<input required maxLength="100" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Warehouse Robot 4" /></label>
          <label>Model<input required maxLength="100" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></label>
          <label>Battery %<input type="number" min="0" max="100" required value={form.battery} onChange={(e) => setForm({ ...form, battery: Number(e.target.value) })} /></label>
          <label>Load capacity<input type="number" min="1" required value={form.maxLoadCapacity} onChange={(e) => setForm({ ...form, maxLoadCapacity: Number(e.target.value) })} /></label>
          <label>Grid X<input type="number" min="0" max="23" required value={form.x} onChange={(e) => setForm({ ...form, x: Number(e.target.value) })} /></label>
          <label>Grid Y<input type="number" min="0" max="15" required value={form.y} onChange={(e) => setForm({ ...form, y: Number(e.target.value) })} /></label>
          <label>Initial status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Available</option><option>Idle</option><option>Charging</option><option>Offline</option><option>Maintenance</option></select></label>
        </div>
        {(error || success) && <p role={error ? "alert" : "status"} className={error ? "form-message error" : "form-message"}>{error || success}</p>}
        <button className="primary-button" type="submit" disabled={saving}>{saving ? "Adding…" : "Add robot"}</button>
      </form>}

      <div className="robot-cards">

        {robots.map((robot) => (
          <div className="large-robot-card" key={robot.robotId}>

            <div className="large-robot-top">
              <div className="robot-large-icon">
                <Bot size={28} />
              </div>

              <span
                className={`status-pill ${robot.status
                  .toLowerCase()
                  .replace(" ", "-")}`}
              >
                <span></span>
                {robot.status}
              </span>
            </div>

            <h3>{robot.name}</h3>
            <p className="robot-id">{robot.robotId}</p>

            <div className="robot-details">
              <div>
                <span>Battery</span>
                <strong>{robot.battery}%</strong>
              </div>

              <div>
                <span>Location</span>
                <strong>{robot.location}</strong>
              </div>
            </div>

            <div className="battery-track large">
              <div
                className="battery-level"
                style={{ width: `${robot.battery}%` }}
              ></div>
            </div>

          </div>
        ))}

      </div>
    </div>
  );
}


/* INVENTORY PAGE */

function InventoryPage({ inventory }) {
  return (
    <div className="page-section">

      <div className="welcome-row">
        <div>
          <h2>Inventory Management</h2>
          <p>Monitor material quantities and warehouse locations.</p>
        </div>
      </div>

      <div className="panel">

        <div className="inventory-full-list">

          {inventory.map((item) => (
            <div className="inventory-full-item" key={item.id}>

              <div className="inventory-icon large">
                <Package size={22} />
              </div>

              <div>
                <strong>{item.material}</strong>
                <span>Storage location: {item.location}</span>
              </div>

              <div className="inventory-big-number">
                {item.quantity}
                <small>units</small>
              </div>

            </div>
          ))}

        </div>

      </div>
    </div>
  );
}


/* TASK PAGE */

function TaskPage({ tasks, onTaskCreated, taskStatusFilter, setTaskStatusFilter, simulation, controlSimulation, scheduling, onWeightsSaved }) {

  const [form, setForm] = useState({
    material: "Steel Components",
    pickupLocation: "A1",
    destination: "C1",
    quantity: 10,
    priority: "Normal"
  });

  const [message, setMessage] = useState("");
  const [weights, setWeights] = useState(scheduling.weights || { distance: 0.5, battery: 0.25, duration: 0.15, loadFit: 0.1 });
  const [weightMessage, setWeightMessage] = useState("");
  const [weightsDirty, setWeightsDirty] = useState(false);
  const activeWeights = weightsDirty ? weights : (scheduling.weights || weights);

  const createTask = async (e) => {
    e.preventDefault();

    try {
      const response = await axios.post(
        `${API}/tasks`,
        form
      );

      setMessage(response.data.robotId ? `Task assigned to ${response.data.robotId}` : "Task queued. The scheduler will retry when an eligible robot is available.");

      onTaskCreated();

    } catch (error) {
      setMessage(
        error.response?.data?.message ||
        "Unable to create task"
      );
    }
  };

  return (
    <div className="page-section">

      <div className="welcome-row">
        <div>
          <h2>Material Movement</h2>
          <p>Create and manage autonomous material movement tasks.</p>
        </div>
        <button className="simulation-toggle" onClick={() => controlSimulation(simulation.running ? "pause" : "start")} aria-pressed={simulation.running}>
          <span className={simulation.running ? "sim-indicator running" : "sim-indicator"} />{simulation.running ? "Pause simulation" : "Start simulation"}
        </button>
      </div>

      <div className="task-layout">

        <div className="panel task-form-panel">

          <div className="panel-header">
            <div>
              <h3>Create Movement Task</h3>
              <p>The scheduler will select an available robot.</p>
            </div>
          </div>

          <form onSubmit={createTask}>

            <label>Material</label>

            <select
              value={form.material}
              onChange={(e) =>
                setForm({
                  ...form,
                  material: e.target.value
                })
              }
            >
              <option>Steel Components</option>
              <option>Electronic Parts</option>
              <option>Packaging Boxes</option>
            </select>

            <label>Pickup Location</label>

            <select
              value={form.pickupLocation}
              onChange={(e) =>
                setForm({
                  ...form,
                  pickupLocation: e.target.value
                })
              }
            >
              <option>A1</option>
              <option>B2</option>
              <option>C1</option>
            </select>

            <label>Destination</label>

            <select
              value={form.destination}
              onChange={(e) =>
                setForm({
                  ...form,
                  destination: e.target.value
                })
              }
            >
              <option>A1</option>
              <option>B2</option>
              <option>C1</option>
            </select>

            <label>Quantity</label>

            <input
              type="number"
              min="1"
              value={form.quantity}
              onChange={(e) =>
                setForm({
                  ...form,
                  quantity: Number(e.target.value)
                })
              }
            />

            <label>Priority</label>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option>Urgent</option><option>High</option><option>Normal</option><option>Low</option>
            </select>

            <button className="primary-button full" type="submit">
              <Truck size={18} />
              Create and assign task
            </button>

          </form>

          {message && (
            <div className="form-message">
              {message}
            </div>
          )}

        </div>


        <div className="panel">

          <div className="scheduling-analytics">
            <div className="panel-header"><div><h3>Scheduler performance</h3><p>Live metrics from recorded task decisions</p></div></div>
            <div className="schedule-metrics">
              <div><span>Avg. assignment</span><strong>{scheduling.analytics?.averageAssignmentTimeMs ?? 0} ms</strong></div>
              <div><span>Pending queue</span><strong>{scheduling.analytics?.pendingQueueLength ?? tasks.filter((item) => item.status === "Pending").length}</strong></div>
              <div><span>Assignment success</span><strong>{scheduling.analytics?.assignmentSuccessRate ?? 0}%</strong></div>
              <div><span>Avg. route</span><strong>{scheduling.analytics?.averageEstimatedTravelDistance ?? 0} cells</strong></div>
            </div>
            <div className="priority-counts">{Object.entries(scheduling.analytics?.tasksByPriority || {}).map(([priority, count]) => <span key={priority}>{priority}<b>{count}</b></span>)}</div>
            <form className="weight-controls" onSubmit={async (event) => { event.preventDefault(); try { await onWeightsSaved(activeWeights); setWeights(activeWeights); setWeightsDirty(false); setWeightMessage("Weights saved; pending tasks were reevaluated."); } catch (error) { setWeightMessage(error.response?.data?.message || "Unable to save weights"); } }}>
              <strong>Assignment weights</strong>
              {Object.entries(activeWeights).map(([key, value]) => <label key={key}>{key}<input type="number" min="0" max="1" step="0.05" value={value} onChange={(event) => { setWeightsDirty(true); setWeights({ ...activeWeights, [key]: Number(event.target.value) }); }} /></label>)}
              <button className="secondary-button" type="submit">Save weights</button>{weightMessage && <small>{weightMessage}</small>}
            </form>
          </div>

          <div className="panel-header">
            <div>
              <h3>Movement Orders</h3>
              <p>Current and completed tasks</p>
            </div>
          </div>

          <div className="task-tabs" role="tablist" aria-label="Filter movement tasks">
            {["All", "Active", "Completed"].map((tab) => <button key={tab} type="button" role="tab" aria-selected={taskStatusFilter === tab} className={taskStatusFilter === tab ? "selected" : ""} onClick={() => setTaskStatusFilter(tab)}>{tab}<span>{tab === "All" ? tasks.length : tasks.filter((task) => tab === "Completed" ? task.status === "Completed" : task.status !== "Completed").length}</span></button>)}
          </div>

          {tasks.length === 0 ? (
            <div className="empty-state">
              <Truck size={30} />
              <strong>No movement tasks</strong>
              <span>Create a task to assign a robot.</span>
            </div>
          ) : (
            <div className="task-list">

              {tasks.filter((task) => taskStatusFilter === "All" || (taskStatusFilter === "Completed" ? task.status === "Completed" : task.status !== "Completed")).map((task) => (

                <div className="task-item" key={task.id}>

                  <div className="task-number">
                    #{String(task.id).slice(-5).toUpperCase()}
                  </div>

                  <div className="task-info">
                    <strong>{task.material}</strong>
                    <span>
                      {task.pickupLocation} → {task.destination}
                    </span>
                    <small>{task.priority || "Normal"} priority · {task.estimatedDistance != null ? `${task.estimatedDistance} cells · ${task.estimatedDurationSeconds}s` : "Awaiting eligible robot"}</small>
                    {task.schedulingExplanation?.reason?.slice(0, 3).map((reason) => <small key={reason}>{reason}</small>)}
                  </div>

                  <div className="task-robot">
                    <Bot size={15} />
                    {task.robotId || "Unassigned"}
                  </div>

                  <span
                    className={`status-pill ${
                      task.status === "Completed"
                        ? "available"
                        : "busy"
                    }`}
                  >
                    <span></span>
                    {task.status}
                  </span>

                </div>

              ))}

            </div>
          )}

        </div>

      </div>
    </div>
  );
}

export default DashboardApp;
