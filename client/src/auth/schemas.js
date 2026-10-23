import { z } from "zod";

const emailRule = z.string().trim().email("Enter a valid email address.");
export const loginSchema = z.object({ email: emailRule, password: z.string().min(1, "Enter your password."), rememberMe: z.boolean().default(false) });
export const registerSchema = z.object({ name: z.string().trim().min(2, "Enter your full name.").max(100), email: emailRule, password: z.string().min(8, "Use at least 8 characters.").max(72), confirmPassword: z.string() }).refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });
