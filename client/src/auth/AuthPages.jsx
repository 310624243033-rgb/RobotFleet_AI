import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, ArrowRight, Bot, Boxes, Check, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UserRound, Zap } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "./useAuth";
import { loginSchema, registerSchema } from "./schemas";
import "./auth.css";

function Brand() { return <div className="auth-brand"><span className="auth-brand-mark"><Bot size={22} strokeWidth={1.8} /></span><span>RoboFleet <b>AI</b></span></div>; }

function WarehouseVisual() {
  return <div className="warehouse-art" aria-hidden="true">
    <div className="art-glow" /><div className="art-grid" />
    <div className="warehouse-horizon"><div className="rack rack-a"><i /><i /><i /><i /></div><div className="rack rack-b"><i /><i /><i /><i /></div><div className="rack rack-c"><i /><i /><i /><i /></div></div>
    <svg className="robot-route" viewBox="0 0 640 300" fill="none"><path d="M68 238H210V185H342V220H525V122" stroke="url(#routeGlow)" strokeWidth="2" strokeDasharray="6 8" /><circle cx="68" cy="238" r="5" fill="#22D3EE" /><circle cx="525" cy="122" r="5" fill="#60A5FA" /><defs><linearGradient id="routeGlow"><stop stopColor="#22D3EE" /><stop offset="1" stopColor="#3B82F6" /></linearGradient></defs></svg>
    <motion.div className="art-robot" animate={{ x: [0, 110, 110, 0], y: [0, 0, -30, 0] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}><Bot size={28} /><span>AMR-04</span></motion.div>
    <div className="art-coordinate">ZONE 04 <span>·</span> LIVE ROUTE</div>
    <div className="art-telemetry"><span className="telemetry-pulse" /> Fleet operating <strong>98.4%</strong><small>Autonomous uptime</small></div>
  </div>;
}

function AuthLayout({ children, mode = "login" }) {
  return <main className="auth-page">
    <section className="auth-showcase"><div className="auth-showcase-inner"><Brand /><div className="showcase-copy"><div className="eyebrow"><span /> INTELLIGENCE IN MOTION</div><h1>Intelligent Warehouses.<br /><em>Smarter Operations.</em></h1><p>Manage, monitor, and optimize your autonomous warehouse robots from one intelligent platform.</p><WarehouseVisual /><div className="auth-features"><span><Activity />Real-time robot monitoring</span><span><Zap />Intelligent task scheduling</span><span><Boxes />Smart inventory management</span></div></div><div className="showcase-footer">ROBOFLEET SYSTEMS <span>·</span> BUILT FOR WHAT MOVES NEXT</div></div></section>
    <section className="auth-side"><div className="auth-mobile-brand"><Brand /></div><motion.div className="auth-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }} key={mode}>{children}</motion.div><div className="auth-footnote"><ShieldCheck size={14} /> Secure, encrypted access to your operations</div></section>
  </main>;
}

export function LoginPage() {
  const { user, login, notice, clearNotice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "", rememberMe: false } });
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async (values) => { setSubmitError(""); clearNotice(); try { await login(values); navigate("/dashboard", { replace: true }); } catch (error) { setSubmitError(error.response?.data?.message || (error.request ? "RoboFleet API is unreachable. Start the app with npm run dev from the project root and confirm MongoDB is running." : "Invalid email or password.")); } };
  return <AuthLayout><div className="auth-card-logo"><Brand /></div><div className="auth-heading"><span>CONTROL ROOM ACCESS</span><h2>Welcome back</h2><p>Sign in to continue to your warehouse.</p></div>
    {(notice || location.state?.registrationComplete) && <div className="auth-success" role="status"><Check size={15} />{notice || "Account created. Sign in to continue."}</div>}{submitError && <div className="auth-error-banner" role="alert">{submitError}</div>}
    <form className="auth-form" onSubmit={handleSubmit(submit)} noValidate>
      <label htmlFor="login-email">Email address</label><div className={`auth-input ${errors.email ? "invalid" : ""}`}><Mail size={17} /><input id="login-email" type="email" autoComplete="email" placeholder="you@company.com" {...register("email")} /></div>{errors.email && <small className="field-error">{errors.email.message}</small>}
      <div className="auth-label-row"><label htmlFor="login-password">Password</label><a href="#password-help" onClick={(event) => { event.preventDefault(); setSubmitError("Ask your RoboFleet administrator to reset your password."); }}>Forgot password?</a></div><div className={`auth-input ${errors.password ? "invalid" : ""}`}><LockKeyhole size={17} /><input id="login-password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" {...register("password")} /><button type="button" className="visibility-button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{errors.password && <small className="field-error">{errors.password.message}</small>}
      <label className="remember-row"><input type="checkbox" {...register("rememberMe")} /><span>Remember me</span><small>Keep me signed in for 7 days</small></label>
      <button className="auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? <span className="auth-spinner" /> : <>Sign in to RoboFleet <ArrowRight size={17} /></>}</button>
    </form><div className="auth-switch">New to RoboFleet? <Link to="/register">Create an account</Link></div><div className="auth-divider"><span /> <small>AUTHORIZED PERSONNEL ONLY</small> <span /></div>
  </AuthLayout>;
}

function passwordStrength(password) { if (!password) return 0; return [password.length >= 8, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length; }

export function RegisterPage() {
  const { user, register: createAccount, clearNotice } = useAuth();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(registerSchema), defaultValues: { name: "", email: "", password: "", confirmPassword: "" } });
  const currentPassword = useWatch({ control, name: "password", defaultValue: "" });
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async ({ confirmPassword, ...values }) => { void confirmPassword; setSubmitError(""); clearNotice(); try { await createAccount(values); navigate("/login", { replace: true, state: { registrationComplete: true } }); } catch (error) { setSubmitError(error.response?.data?.message || (error.request ? "RoboFleet API is unreachable. Start the app with npm run dev from the project root and confirm MongoDB is running." : "Unable to create your account. Please try again.")); } };
  const strengthValue = passwordStrength(currentPassword);
  return <AuthLayout mode="register"><div className="auth-card-logo"><Brand /></div><div className="auth-heading"><span>GET STARTED</span><h2>Create your account</h2><p>Join your warehouse operations workspace.</p></div>{submitError && <div className="auth-error-banner" role="alert">{submitError}</div>}
    <form className="auth-form register-form" onSubmit={handleSubmit(submit)} noValidate>
      <label htmlFor="register-name">Full name</label><div className="auth-input"><UserRound size={17} /><input id="register-name" autoComplete="name" placeholder="Your full name" {...register("name")} /></div>{errors.name && <small className="field-error">{errors.name.message}</small>}
      <label htmlFor="register-email">Email address</label><div className="auth-input"><Mail size={17} /><input id="register-email" type="email" autoComplete="email" placeholder="you@company.com" {...register("email")} /></div>{errors.email && <small className="field-error">{errors.email.message}</small>}
      <label htmlFor="register-password">Password</label><div className="auth-input"><LockKeyhole size={17} /><input id="register-password" type={visible ? "text" : "password"} autoComplete="new-password" placeholder="At least 8 characters" {...register("password")} /><button type="button" className="visibility-button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{errors.password && <small className="field-error">{errors.password.message}</small>}
      <div className={`strength-meter strength-${strengthValue}`}><span /><span /><span /><span /><small>{!currentPassword ? "Password strength" : ["Weak", "Fair", "Good", "Strong"][strengthValue - 1]}</small></div>
      <label htmlFor="register-confirm">Confirm password</label><div className="auth-input"><LockKeyhole size={17} /><input id="register-confirm" type={visible ? "text" : "password"} autoComplete="new-password" placeholder="Repeat your password" {...register("confirmPassword")} /></div>{errors.confirmPassword && <small className="field-error">{errors.confirmPassword.message}</small>}
      <div className="viewer-note"><ShieldCheck size={15} /><span>Your new account starts with <b>Viewer</b> access. An administrator can update your role.</span></div>
      <button className="auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? <span className="auth-spinner" /> : <>Create account <ArrowRight size={17} /></>}</button>
    </form><div className="auth-switch">Already have access? <Link to="/login">Sign in</Link></div>
  </AuthLayout>;
}
