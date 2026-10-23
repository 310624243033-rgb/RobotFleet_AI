const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const User = require("../models/User");
const { authenticate, cookieName, csrfCookieName, cookieOptions, secret } = require("../middleware/auth");
const dummyPasswordHash = bcrypt.hashSync("unknown-account-password", 12);

const csrfOptions = { httpOnly: false, secure: process.env.NODE_ENV === "production" || process.env.AUTH_COOKIE_SAME_SITE === "none", sameSite: process.env.AUTH_COOKIE_SAME_SITE || "lax", path: "/" };
const publicUser = ({ _id, name, email, role }) => ({ id: String(_id), name, email, role });

function createAuthRouter({ UserModel = User, authenticateMiddleware = authenticate } = {}) {
  const router = express.Router();
  router.get("/csrf", (req, res) => {
    const token = req.cookies?.[csrfCookieName] || crypto.randomBytes(32).toString("hex");
    res.cookie(csrfCookieName, token, csrfOptions);
    res.json({ csrfToken: token });
  });

  router.post("/register", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (name.length < 2 || name.length > 100) return res.status(400).json({ message: "Enter a name between 2 and 100 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ message: "Password must be at least 8 characters." });
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await UserModel.create({ name, email, passwordHash, role: "Viewer" });
      return res.status(201).json({ user: publicUser(user), message: "Account created. You can now sign in." });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ message: "An account with this email already exists." });
      if (error?.name === "ValidationError") return res.status(400).json({ message: "Please check your account details." });
      if (/^(Mongo|Mongoose)/.test(error?.name || "") || UserModel.db?.readyState === 0) {
        return res.status(503).json({ message: "The account service is temporarily unavailable. Please try again shortly." });
      }
      console.error("Account registration failed:", error?.name || "UnexpectedError");
      return res.status(500).json({ message: "Unable to create account right now. Please try again." });
    }
  });

  router.post("/login", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const rememberMe = req.body?.rememberMe === true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 72) return res.status(400).json({ message: "Invalid email or password." });
    try {
      const user = await UserModel.findOne({ email }).select("+passwordHash");
      const matches = await bcrypt.compare(password, user ? user.passwordHash : dummyPasswordHash);
      if (!user || !matches) return res.status(401).json({ message: "Invalid email or password." });
      const csrf = req.cookies?.[csrfCookieName];
      if (!csrf) return res.status(403).json({ message: "Refresh the page and try signing in again." });
      const maxAge = rememberMe ? 7 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
      const token = jwt.sign({ sub: String(user._id), role: user.role, csrf }, secret(), { expiresIn: rememberMe ? "7d" : "12h", issuer: "robofleet-ai", audience: "robofleet-client" });
      res.cookie(cookieName, token, cookieOptions(maxAge));
      return res.json({ user: publicUser(user), message: "Welcome back." });
    } catch {
      return res.status(500).json({ message: "Unable to sign in right now." });
    }
  });

  router.get("/me", authenticateMiddleware, (req, res) => res.json({ user: req.user }));
  router.post("/logout", (req, res) => {
    res.clearCookie(cookieName, cookieOptions());
    res.clearCookie(csrfCookieName, { ...csrfOptions, maxAge: 0 });
    res.status(204).end();
  });
  return router;
}

module.exports = createAuthRouter();
module.exports.createAuthRouter = createAuthRouter;
