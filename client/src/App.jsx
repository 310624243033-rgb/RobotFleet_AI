import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";

const DashboardApp = lazy(() => import("./Dashboard"));
const LoginPage = lazy(() => import("./auth/AuthPages").then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import("./auth/AuthPages").then((module) => ({ default: module.RegisterPage })));

function ProtectedDashboard() {
  const { user, loading } = useAuth();
  if (loading) return <main className="auth-loading min-h-screen"><span className="auth-spinner" />Securing your workspace…</main>;
  return user ? <DashboardApp /> : <Navigate to="/login" replace />;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <main className="auth-loading min-h-screen"><span className="auth-spinner" />Securing your workspace…</main>;
  return user ? <Navigate to="/dashboard" replace /> : children;
}

export default function App() {
  return <AuthProvider><BrowserRouter><Suspense fallback={<main className="auth-loading min-h-screen"><span className="auth-spinner" />Loading RoboFleet…</main>}><Routes>
    <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
    <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
    <Route path="*" element={<ProtectedDashboard />} />
  </Routes></Suspense></BrowserRouter></AuthProvider>;
}
