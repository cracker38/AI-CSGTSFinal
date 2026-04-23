export function getApiErrorMessage(err, fallback = "Request failed") {
  if (err?.code === "ECONNABORTED" || String(err?.message || "").toLowerCase().includes("timeout")) {
    return "Request timed out. Check that the API server is running and reachable.";
  }
  if (!err?.response) {
    const msg = err?.message;
    if (msg === "Network Error" || err?.code === "ERR_NETWORK") {
      return "Network error — the API did not respond. Start the FastAPI backend and ensure Vite’s dev proxy target matches its port (see vite.config.js).";
    }
    if (typeof msg === "string" && msg.trim()) return msg;
    return fallback;
  }

  const detail = err?.response?.data?.detail;
  if (!detail) return fallback;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const field = Array.isArray(item.loc) ? item.loc.join(".") : "";
          const msg = item.msg || JSON.stringify(item);
          return field ? `${field}: ${msg}` : msg;
        }
        return "";
      })
      .filter(Boolean);
    return parts.length ? parts.join(" | ") : fallback;
  }

  if (typeof detail === "object") {
    if (detail.msg && typeof detail.msg === "string") return detail.msg;
    try {
      return JSON.stringify(detail);
    } catch {
      return fallback;
    }
  }

  return fallback;
}
