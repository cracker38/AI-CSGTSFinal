export function getChartTheme(mode = "light") {
  if (mode === "dark") {
    return {
      colors: {
        primary: "#60a5fa",
        warning: "#f59e0b",
        success: "#34d399",
        danger: "#f87171",
        grid: "#334155"
      },
      tooltipStyle: {
        borderRadius: 8,
        border: "1px solid #475569",
        background: "#0f172a",
        color: "#e2e8f0",
        fontSize: 12
      }
    };
  }
  return {
    colors: {
      primary: "#2563eb",
      warning: "#d97706",
      success: "#16a34a",
      danger: "#dc2626",
      grid: "#e5e7eb"
    },
    tooltipStyle: {
      borderRadius: 8,
      border: "1px solid #d1d5db",
      background: "#ffffff",
      color: "#111827",
      fontSize: 12
    }
  };
}

