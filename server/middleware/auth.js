const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const User = require("../models/User");

const isProduction = process.env.NODE_ENV === "production";
const sameSite = (process.env.AUTH_COOKIE_SAME_SITE || "lax").toLowerCase();
const cookieName = isProduction ? "__Host-robofleet" : "robofleet_auth";
const csrfCookieName = isProduction ? "__Host-rf-csrf" : "rf_csrf";
const cookieOptions = (maxAge) => ({ httpOnly: true, secure: isProduction || sameSite === "none", sameSite, path: "/", ...(maxAge ? { maxAge } : {}) });

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET must be configured with at least 32 characters");
  return value;
}

function createAuthenticate({ UserModel = User } = {}) {
  return async function authenticateRequest(req, res, next) {
    try {
      const token = req.cookies?.[cookieName];
      if (!token) return res.status(401).json({ message: "Authentication required" });
      const payload = jwt.verify(token, secret());
      const user = await UserModel.findById(payload.sub).select("name email role").lean();
      if (!user) return res.status(401).json({ message: "Authentication required" });
      req.user = user;
      req.authPayload = payload;
      return next();
    } catch {
      return res.status(401).json({ message: "Authentication required" });
    }
  };
}
const authenticate = createAuthenticate();

function authorize(...roles) {
  return (req, res, next) => req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ message: "You do not have permission to perform this action" });
}

function csrfProtection(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const cookieToken = req.cookies?.[csrfCookieName];
  const headerToken = req.get("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length || !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    return res.status(403).json({ message: "CSRF validation failed. Refresh and try again." });
  }
  const authToken = req.cookies?.[cookieName];
  if (authToken) {
    try {
      if (jwt.verify(authToken, secret()).csrf !== cookieToken) return res.status(403).json({ message: "CSRF validation failed. Refresh and try again." });
    } catch {
      if (!req.originalUrl.startsWith("/api/auth/")) return res.status(403).json({ message: "CSRF validation failed. Refresh and try again." });
    }
  }
  return next();
}

module.exports = { authenticate, createAuthenticate, authorize, csrfProtection, cookieName, csrfCookieName, cookieOptions, secret };
