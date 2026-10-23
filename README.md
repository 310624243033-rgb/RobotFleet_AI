# RoboFleet AI

Intelligent scheduling and monitoring simulation for autonomous warehouse robots. The Express backend persists robot grid cells, active and completed tasks, and inventory in MongoDB. Socket.IO broadcasts authoritative movement steps to the React warehouse map.

## Stack

- React and Vite client
- Node.js and Express API
- MongoDB with Mongoose
- Socket.IO for real-time simulation updates
- React Router, React Hook Form, Zod, and Motion for the responsive authentication experience
- HttpOnly JWT sessions, bcrypt password hashing, and CSRF protection

## Prerequisites

Node.js 20+ and npm. MongoDB Community Server or Atlas is required.

## Setup

1. Run `npm install` from the repository root.
2. Copy `server/.env.example` to `server/.env`, generate a private `JWT_SECRET` with at least 32 characters, and configure the MongoDB connection.
3. Copy `client/.env.example` to `client/.env` if the API URL differs.
4. Run `npm run dev` from the root.

The API listens on port 5000 and Vite on port 5173. The backend seeds three robots and inventory when their collections are empty. Create an account from `/register`; new accounts have Viewer access. An administrator can promote accounts in MongoDB. Copy the environment examples and do not commit `.env` files.

Authentication uses an HttpOnly JWT cookie with a 12-hour session by default and a seven-day session when Remember Me is selected. A CSRF cookie and request header protect state-changing requests. If the client and API are deployed on different sites, use HTTPS, set `AUTH_COOKIE_SAME_SITE=none`, list the client origin in `CLIENT_ORIGIN`, and configure the frontend `VITE_API_URL` to the API origin. The server enables credentialed CORS only for configured client origins.

All operational API endpoints and Socket.IO snapshots require an authenticated session. Viewer accounts can inspect operations; Admin and Warehouse Manager accounts can create tasks and control the simulation. Only Admin and Warehouse Manager accounts can update scheduling weights.

To seed the optional development admin, run this only against a development database after creating `server/.env`:

```powershell
$env:NODE_ENV = "development"
$env:DEMO_ADMIN_PASSWORD = "choose-a-development-password"
npm run seed:demo --workspace server
```

The command refuses to run outside development and uses the supplied password. It creates or updates the development admin account at `admin@robofleet.ai`; no demo account is created at server startup.

## Grid simulation

Robots have persisted `{x, y}` grid positions on a 24 by 16 warehouse grid. Invalid or duplicated stored cells are normalized to unique walkable cells at startup. Rack cells are blocked. Movement uses four-direction A* routes and advances one cell per simulation tick (`SIMULATION_TICK_MS`). Battery decreases by one percentage point per step. Task assignment chooses an available robot with sufficient battery for both planned legs and reserves the pickup inventory. Inventory is removed at pickup and credited at delivery. Cell conflicts are arbitrated once per tick, head-on swaps are rejected, and a newly blocked route is replanned. A task only completes when its robot reaches the delivery cell. If a task fails after pickup, the cargo remains attached to the robot record for recovery.

Each movement tick updates the Robot, Task, and Inventory collections, then writes a single-document MongoDB simulation checkpoint before broadcasting. A failed write rolls back that tick in memory and pauses the simulation. On restart, the checkpoint restores exact robot positions and active task stages; routes are recalculated and simulation starts paused so an operator explicitly resumes it. This makes an interrupted task recoverable without advancing time while the process is down.

Socket.IO emits `simulation:snapshot`, `robot:position`, `task:update`, `task:completed`, `simulation:state`, and `simulation:error`. Start, pause, resume, and reset endpoints are under `/api/simulation`. Run `npm test --workspace server` for the grid engine scenarios.

## Scripts

- `npm run dev` starts client and server concurrently.
- `npm run build` builds the client.
- `npm test --workspace server` runs auth, scheduling, and simulation API/service tests.
- `npm test --workspace client` runs form validation tests.
- `npm run lint --workspace client` checks the frontend.
- `npm run seed:demo` creates the optional development admin when `NODE_ENV=development` and `DEMO_ADMIN_PASSWORD` are set.

