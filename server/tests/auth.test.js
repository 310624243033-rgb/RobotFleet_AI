process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-secret-with-more-than-thirty-two-characters";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const cookieParser = require("cookie-parser");
const supertest = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const createAuthRouter = require("../routes/authRoutes").createAuthRouter;
const { createAuthenticate, authorize, csrfProtection, cookieName } = require("../middleware/auth");

function setup() {
  const users = new Map();
  let nextId = 1;
  const UserModel = {
    async create(fields) {
      if (users.has(fields.email)) { const error = new Error("duplicate"); error.code = 11000; throw error; }
      const user = { ...fields, _id: String(nextId++) };
      users.set(user.email, user);
      return user;
    },
    findOne({ email }) { return { select: async () => users.get(email) || null }; },
    findById(id) { return { select: () => ({ lean: async () => { const user = [...users.values()].find((item) => String(item._id) === String(id)); return user ? { _id: user._id, name: user.name, email: user.email, role: user.role } : null; } }) }; }
  };
  const app = express();
  app.use(express.json()); app.use(cookieParser()); app.use(csrfProtection);
  app.use("/api/auth", createAuthRouter({ UserModel, authenticateMiddleware: createAuthenticate({ UserModel }) }));
  app.get("/api/private", createAuthenticate({ UserModel }), (_req, res) => res.json({ ok: true }));
  app.post("/api/manage", createAuthenticate({ UserModel }), authorize("Admin", "Warehouse Manager"), (_req, res) => res.json({ ok: true }));
  return { app, users };
}

async function getCsrf(agent) { const response = await agent.get("/api/auth/csrf"); return response.body.csrfToken; }

test("successful registration hashes password and forces Viewer role", async () => {
  const { app, users } = setup(); const agent = supertest.agent(app); const csrf = await getCsrf(agent);
  const response = await agent.post("/api/auth/register").set("X-CSRF-Token", csrf).send({ name: "Casey User", email: "CASEY@example.com", password: "StrongPass9!", role: "Admin" });
  assert.equal(response.status, 201); assert.equal(response.body.user.role, "Viewer"); assert.equal(response.body.user.email, "casey@example.com");
  const stored = users.get("casey@example.com"); assert.notEqual(stored.passwordHash, "StrongPass9!"); assert.equal(await bcrypt.compare("StrongPass9!", stored.passwordHash), true);
});

test("duplicate registration returns a safe conflict response", async () => {
  const { app } = setup(); const agent = supertest.agent(app); const csrf = await getCsrf(agent);
  const payload = { name: "Casey User", email: "casey@example.com", password: "StrongPass9!" };
  assert.equal((await agent.post("/api/auth/register").set("X-CSRF-Token", csrf).send(payload)).status, 201);
  const duplicate = await agent.post("/api/auth/register").set("X-CSRF-Token", csrf).send(payload);
  assert.equal(duplicate.status, 409); assert.match(duplicate.body.message, /already exists/);
});

test("successful login sets an HttpOnly JWT cookie and supports session persistence", async () => {
  const { app } = setup(); const agent = supertest.agent(app); const csrf = await getCsrf(agent);
  await agent.post("/api/auth/register").set("X-CSRF-Token", csrf).send({ name: "Casey User", email: "casey@example.com", password: "StrongPass9!" });
  const login = await agent.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email: "casey@example.com", password: "StrongPass9!", rememberMe: true });
  assert.equal(login.status, 200); assert.equal(login.body.user.role, "Viewer");
  assert.ok(login.headers["set-cookie"].some((cookie) => cookie.startsWith(`${cookieName}=`) && /HttpOnly/i.test(cookie)));
  assert.equal((await agent.get("/api/auth/me")).status, 200);
  assert.equal((await agent.get("/api/private")).body.ok, true);
});

test("invalid password uses the same generic response as an unknown account", async () => {
  const { app } = setup(); const agent = supertest.agent(app); const csrf = await getCsrf(agent);
  await agent.post("/api/auth/register").set("X-CSRF-Token", csrf).send({ name: "Casey User", email: "casey@example.com", password: "StrongPass9!" });
  const wrong = await agent.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email: "casey@example.com", password: "wrong-password" });
  const missing = await agent.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email: "missing@example.com", password: "wrong-password" });
  assert.equal(wrong.status, 401); assert.equal(missing.status, 401); assert.equal(wrong.body.message, "Invalid email or password."); assert.equal(wrong.body.message, missing.body.message);
});

test("login remember-me controls signed session lifetime", async () => {
  const { app } = setup(); const agent = supertest.agent(app); const csrf = await getCsrf(agent);
  await agent.post("/api/auth/register").set("X-CSRF-Token", csrf).send({ name: "Casey User", email: "casey@example.com", password: "StrongPass9!" });
  const session = await agent.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email: "casey@example.com", password: "StrongPass9!", rememberMe: false });
  const remember = await agent.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email: "casey@example.com", password: "StrongPass9!", rememberMe: true });
  const sessionToken = decodeURIComponent(session.headers["set-cookie"].find((cookie) => cookie.startsWith(`${cookieName}=`)).split(";")[0].slice(cookieName.length + 1));
  const rememberToken = decodeURIComponent(remember.headers["set-cookie"].find((cookie) => cookie.startsWith(`${cookieName}=`)).split(";")[0].slice(cookieName.length + 1));
  const short = jwt.decode(sessionToken); const long = jwt.decode(rememberToken);
  assert.equal(short.exp - short.iat, 12 * 60 * 60); assert.equal(long.exp - long.iat, 7 * 24 * 60 * 60);
});

test("protected access requires authentication", async () => {
  const { app } = setup(); const response = await supertest(app).get("/api/private");
  assert.equal(response.status, 401);
});

test("logout clears the server session cookie and invalidates subsequent access", async () => {
  const { app } = setup(); const agent = supertest.agent(app); const csrf = await getCsrf(agent);
  await agent.post("/api/auth/register").set("X-CSRF-Token", csrf).send({ name: "Casey User", email: "casey@example.com", password: "StrongPass9!" });
  await agent.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email: "casey@example.com", password: "StrongPass9!" });
  assert.equal((await agent.post("/api/auth/logout").set("X-CSRF-Token", csrf)).status, 204);
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});

test("expired sessions can still sign in again or clear the stale cookie", async () => {
  const { app, users } = setup(); const agent = supertest.agent(app); const csrf = await getCsrf(agent);
  await agent.post("/api/auth/register").set("X-CSRF-Token", csrf).send({ name: "Casey User", email: "casey@example.com", password: "StrongPass9!" });
  const user = users.get("casey@example.com");
  const stale = jwt.sign({ sub: user._id, role: user.role, csrf }, process.env.JWT_SECRET, { expiresIn: -1, issuer: "robofleet-ai", audience: "robofleet-client" });
  const cookie = `${cookieName}=${encodeURIComponent(stale)}; rf_csrf=${csrf}`;
  const relogin = await supertest(app).post("/api/auth/login").set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ email: "casey@example.com", password: "StrongPass9!" });
  assert.equal(relogin.status, 200);
  const staleLogout = await supertest(app).post("/api/auth/logout").set("Cookie", cookie).set("X-CSRF-Token", csrf);
  assert.equal(staleLogout.status, 204);
});

test("CSRF header is required and role authorization distinguishes Viewer from Manager", async () => {
  const { app, users } = setup(); const agent = supertest.agent(app); const csrf = await getCsrf(agent);
  const noCsrf = await agent.post("/api/auth/register").send({ name: "Casey User", email: "casey@example.com", password: "StrongPass9!" });
  assert.equal(noCsrf.status, 403);
  await agent.post("/api/auth/register").set("X-CSRF-Token", csrf).send({ name: "Casey User", email: "casey@example.com", password: "StrongPass9!" });
  await agent.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email: "casey@example.com", password: "StrongPass9!" });
  assert.equal((await agent.post("/api/manage").set("X-CSRF-Token", csrf)).status, 403);
  users.get("casey@example.com").role = "Warehouse Manager";
  assert.equal((await agent.post("/api/manage").set("X-CSRF-Token", csrf)).status, 200);
});
