import axios from "axios";
import { getAuth, clearAuth } from "../auth/authStore";

const envBase = import.meta.env.VITE_API_BASE;
// Keep a single source of truth for the API base URL.
// `LoginPage.jsx` appends `/auth/ping` to this value.
export function getApiBaseUrl() {
  const trimmed = envBase && String(envBase).trim().length > 0 ? String(envBase).replace(/\/$/, "") : "";
  if (trimmed) return trimmed;
  // In dev, prefer same-origin `/api/v1` when VITE_API_BASE is unset (uses Vite proxy to uvicorn).
  return import.meta.env.DEV ? "/api/v1" : "http://localhost:8010/api/v1";
}

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  // Without a timeout, a dead proxy/backend leaves login stuck on "Signing in..." forever.
  timeout: 30_000
});

api.interceptors.request.use((config) => {
  const url = typeof config.url === "string" ? config.url : "";
  const isAuthLogin = url.includes("/auth/login") || url.endsWith("login");
  const auth = getAuth();
  if (auth?.access_token && !isAuthLogin) {
    config.headers.Authorization = `Bearer ${auth.access_token}`;
  }
  config.headers["Cache-Control"] = "no-cache";
  config.headers.Pragma = "no-cache";
  const method = (config.method || "get").toLowerCase();
  if (method === "get") {
    config.params = { ...(config.params || {}), _t: Date.now() };
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      clearAuth();
    }
    return Promise.reject(err);
  }
);

