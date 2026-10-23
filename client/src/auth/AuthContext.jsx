import { useEffect, useMemo, useState } from "react";
import { AuthContext } from "./context";
import { api } from "./api";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    api.get("/auth/csrf").then(() => api.get("/auth/me")).then(({ data }) => { if (mounted) setUser(data.user); }).catch(() => { if (mounted) setUser(null); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const value = useMemo(() => ({
    user, loading, notice, clearNotice: () => setNotice(""),
    async login(credentials) { const { data } = await api.post("/auth/login", credentials); setUser(data.user); setNotice("Welcome back."); return data.user; },
    async register(details) { const { data } = await api.post("/auth/register", details); setNotice(data.message); return data.user; },
    async logout() { await api.post("/auth/logout"); setUser(null); setNotice("You have been signed out."); }
  }), [user, loading, notice]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
