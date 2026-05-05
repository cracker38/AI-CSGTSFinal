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

  const { status, data } = err.response;

  const detail =
    data && typeof data === "object" && !Array.isArray(data) && "detail" in data ? data.detail : undefined;

  if (detail != null && detail !== "") {
    if (typeof detail === "string") return detail;

    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const field = Array.isArray(item.loc) ? item.loc.join(".") : "";
            const m = item.msg || JSON.stringify(item);
            return field ? `${field}: ${m}` : m;
          }
          return "";
        })
        .filter(Boolean);
      if (parts.length) return parts.join(" | ");
    }

    if (typeof detail === "object") {
      if (detail.msg && typeof detail.msg === "string") return detail.msg;
      try {
        return JSON.stringify(detail);
      } catch {
        /* fall through */
      }
    }
  }

  if (typeof data === "string" && data.trim()) {
    const plain = data.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (plain.length) {
      return `Unexpected response (HTTP ${status}): ${plain.slice(0, 200)}${plain.length > 200 ? "…" : ""}`;
    }
  }

  if (status === 502 || status === 504) {
    return `Bad gateway (HTTP ${status}). Start the API on http://127.0.0.1:8010 (Vite proxies /api there; set API_PROXY_TARGET in frontend/.env if needed).`;
  }
  if (status === 503) {
    return "Service temporarily unavailable (HTTP 503). If you use OTP login, check SMTP/Resend configuration in backend/.env.";
  }
  if (status === 500) {
    return "Server error (HTTP 500). Check the uvicorn terminal for a Python traceback.";
  }
  if (status) {
    return `${fallback} (HTTP ${status}).`;
  }
  return fallback;
}
