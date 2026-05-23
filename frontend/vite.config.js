import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where FastAPI runs in dev. Set API_PROXY_TARGET in frontend/.env (next to this file).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const apiProxyTarget = (env.API_PROXY_TARGET || "http://127.0.0.1:8010").replace(/\/$/, "");

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor_react: ["react", "react-dom", "react-router-dom"],
            vendor_mui: ["@mui/material", "@mui/icons-material", "@emotion/react", "@emotion/styled"],
            vendor_charts: ["recharts"],
            vendor_jspdf: ["jspdf"],
            vendor_html2canvas: ["html2canvas"]
          }
        }
      }
    },
    server: {
      port: 5173,
      strictPort: false,
      headers: {
        "Cache-Control": "no-store"
      },
      // Browser → same origin /api/v1 → forwarded here (see README: uvicorn --port 8010).
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    }
  };
});
