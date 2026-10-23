import test from "node:test";
import assert from "node:assert/strict";
import { loginSchema, registerSchema } from "./schemas.js";

test("empty login form is rejected", () => { assert.equal(loginSchema.safeParse({ email: "", password: "" }).success, false); });
test("invalid email address is rejected", () => { assert.equal(loginSchema.safeParse({ email: "not-an-email", password: "password" }).success, false); });
test("registration rejects mismatched passwords", () => { const result = registerSchema.safeParse({ name: "Casey User", email: "casey@example.com", password: "StrongPass9!", confirmPassword: "OtherPass9!" }); assert.equal(result.success, false); assert.equal(result.error.issues[0].path[0], "confirmPassword"); });
test("registration validates required name and password strength minimum", () => { assert.equal(registerSchema.safeParse({ name: "", email: "casey@example.com", password: "123", confirmPassword: "123" }).success, false); });
