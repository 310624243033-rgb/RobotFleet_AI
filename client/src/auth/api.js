import axios from "axios";

const defaultApiRoot = import.meta.env.DEV ? "http://localhost:5000/api" : `${window.location.origin}/api`;
const API_ROOT = (import.meta.env.VITE_API_URL || defaultApiRoot).replace(/\/$/, "");
export const api = axios.create({ baseURL: API_ROOT, withCredentials: true });
axios.defaults.withCredentials = true;
let csrfTokenMemory = "";

function csrfCookie() {
  const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("rf_csrf=") || part.startsWith("__Host-rf-csrf="));
  return cookie ? decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)) : "";
}

api.interceptors.request.use((config) => {
  if (!["get", "head", "options"].includes((config.method || "get").toLowerCase())) {
    const token = csrfTokenMemory || csrfCookie();
    if (token) config.headers["X-CSRF-Token"] = token;
  }
  return config;
});
api.interceptors.response.use((response) => {
  if (response.config.url?.endsWith("/auth/csrf")) csrfTokenMemory = response.data.csrfToken || "";
  if (response.config.url?.endsWith("/auth/logout")) csrfTokenMemory = "";
  return response;
});
axios.interceptors.request.use((config) => {
  if (!["get", "head", "options"].includes((config.method || "get").toLowerCase())) {
    const token = csrfTokenMemory || csrfCookie();
    if (token) config.headers["X-CSRF-Token"] = token;
  }
  return config;
});

export const API = API_ROOT;
