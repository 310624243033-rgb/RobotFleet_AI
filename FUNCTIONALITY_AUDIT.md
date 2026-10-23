# RoboFleet AI Functionality Audit

Audit date: 2026-10-21

## Executive summary

The reported failures had distinct causes. Registration was already connected to the matching `/api/auth/register` endpoint and its payload matched the backend (`name`, `email`, `password`); registration errors did not distinguish infrastructure failures from application failures. The active local environment currently has no `MONGODB_URI` or `JWT_SECRET`, MongoDB is not reachable on `127.0.0.1:27017`, and server initialization requires a valid JWT secret and a working Mongo connection. With those prerequisites missing, the local app cannot start and create persistent accounts.

Robot creation was not implemented in the actual dashboard API path: there was no Add Robot UI or mounted `POST /api/robots` endpoint. The legacy `server/routes/robotRoutes.js` was not mounted. The Task page's “Assign Robot” action created a task and invoked automatic scheduling; there was no separate manual robot assignment endpoint. This audit adds robot creation with authorization, validation, persistence, and a live event, and renames the task action to state what it does.

## Original errors and fixes

### Registration

- Confirmed matching frontend and backend fields and URL. CSRF is bootstrapped by `AuthProvider`, Axios sends cookies and the CSRF header, and CORS allows the configured client origin.
- Backend infrastructure failures from account creation were returned as generic HTTP 500 responses. Mongo/Mongoose failures are now returned as HTTP 503 with a safe service-unavailable message; unexpected failures are logged by error name and remain non-sensitive to clients.
- Registration page now distinguishes network failures from backend validation/service responses and carries a clear account-created notice to login.
- API URL defaults to localhost only in Vite development; production builds default to `/api` on the current host. `VITE_API_URL` remains available for a separately hosted API.
- **Live account creation was not verifiable:** active environment variables are missing and MongoDB is unreachable. The auth tests use a test UserModel and prove route behavior/password hashing, not Mongo persistence.

### Robot creation and task assignment

- Added manager/admin protected `POST /api/robots`; validates ID, name, model, battery, capacity, initial status, walkable in-bounds starting cell, duplicate ID and occupied cell. Adds to the engine, persists through the existing state writer, rolls back memory if persistence fails, and broadcasts `robot:created` after persistence.
- Added a robot-create form on Robot Fleet and live Socket.IO list update. Viewer users do not see the manager-only form; backend role checks remain authoritative.
- Task creation remains automatic scheduling. Updated the button label to “Create and assign task”; there is no separate manual assignment workflow or endpoint, so the UI no longer suggests that a second assignment action exists.
- Registration uses the existing Viewer role, and task/simulation mutations require Admin or Warehouse Manager. A Viewer trying to create tasks will receive HTTP 403 by design.

## Files modified

- `server/routes/authRoutes.js` — map database registration failures to 503; safe logging for unexpected errors.
- `server/models/Robot.js` — persist robot model.
- `server/services/SimulationEngine.js` — validated and persistent robot creation.
- `server/server.js` — protected robot creation API, model persistence, centralized safe Express error response.
- `client/src/Dashboard.jsx` — fleet-create form, event subscription, explicit task action label.
- `client/src/auth/AuthPages.jsx` — clear network/registration errors and success notice.
- `client/src/premium.css` — responsive layout for robot-create form.
- `server/tests/simulation.test.js` — robot creation validation/persistence/event test.

## API and current capability audit

Current operational endpoints are mounted in `server/server.js` and protected by cookie authentication, except health and auth routes:

| Method and path | Capability |
|---|---|
| `GET /api/health` | Service and database status |
| `GET /api/auth/csrf` | CSRF token bootstrap |
| `POST /api/auth/register` | Account registration |
| `POST /api/auth/login` | Login and session cookie |
| `GET /api/auth/me` | Current profile read |
| `POST /api/auth/logout` | Logout |
| `GET /api/robots` | Fleet read |
| `POST /api/robots` | New manager/admin robot creation (added) |
| `GET /api/tasks` | Task read |
| `POST /api/tasks` | Create task and automatically schedule |
| `PUT /api/tasks/:id/complete` | Verify completion reached through simulation; does not force-complete |
| `GET /api/inventory` | Inventory read |
| `GET /api/scheduling` | Scheduler metrics/decisions |
| `PUT /api/scheduling/weights` | Manager/admin weight update and pending-task retry |
| `GET /api/simulation` | Simulation status and authoritative snapshot |
| `POST /api/simulation/start`, `/pause`, `/resume`, `/reset` | Simulation controls |

Socket.IO is authenticated with the session cookie. Simulation movement, task progress, and robot positions originate from backend state.

The requested broad CRUD surface is **not fully implemented** in this project. There are no robot edit/delete routes, task edit/delete/cancel/retry or manual assignment routes, inventory create/edit/delete/transfer routes, profile edit/password-change routes, or user management UI. Dashboard navigation entries for Settings/Profile route to the Monitoring view rather than implementing those management features. They are recorded here rather than represented as verified capabilities.

## Verification results

Commands executed from the repository root:

| Command | Result |
|---|---|
| `npm test` | **Pass** — 28 backend tests; 4 frontend tests; 32 total, 0 failed. Requires local loopback permission for Supertest in this environment. |
| `npm run lint --workspace client` | **Pass** — ESLint clean. |
| `npm run build` | **Pass** — Vite production build completed. |

Backend tests cover registration hashing/duplicate handling/login/logout/protected access/CSRF and role checks; scheduling priority, battery, capacity, retry, concurrency, analytics and baseline comparisons; robot creation validation/persistence/event; and the real grid simulation workflow, movement conflicts, obstacle rerouting, pause/resume, unavailable robot, restart recovery and persistence rollback.

The first sandboxed test attempt failed 9 HTTP-backed auth tests with `EACCES` opening Supertest ephemeral localhost sockets. Rerunning `npm test` with approved local loopback access passed all tests. No test remains failing.

## Not verified / remaining issues

- MongoDB connectivity was configured with the supplied Atlas cluster. A later backend startup completed successfully, and `GET /api/health` returned `ready: true` and `database: connected`. Registration against MongoDB and browser end-to-end workflows were not submitted as part of the API health check and still need the user to retry from the registration page.
- Existing auth tests use an in-memory test double; simulation/scheduler service tests use in-memory fixture state. They do not substitute for a Mongo integration test.
- Editing/deleting robots, manual assignment, broader task lifecycle CRUD, inventory CRUD/transfers, and account profile/password management remain absent as listed above.
- Network package audit was not re-run in this audit; prior project notes report dependency advisories and a failed online audit due DNS restrictions. Re-run `npm audit` with network access to check current advisories.

## Local run instructions

1. Install Node.js 20+ and run `npm install` at the project root.
2. Start MongoDB (or use an Atlas URI).
3. Copy `server/.env.example` to `server/.env`. Set `MONGODB_URI` and a private `JWT_SECRET` of at least 32 characters. Set `CLIENT_ORIGIN=http://localhost:5173` for local Vite.
4. If using a non-default API URL, create `client/.env` with `VITE_API_URL=http://localhost:5000/api`.
5. Run `npm run dev` from the root. Vite serves the client at port 5173 and the API at port 5000 by default.
6. Register a Viewer account. Task creation and simulation controls require an Admin or Warehouse Manager. For local development, seed the documented development admin with `NODE_ENV=development` and `DEMO_ADMIN_PASSWORD` set before running `npm run seed:demo --workspace server` against a development database.
