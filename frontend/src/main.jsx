import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ThemeModeContext } from "./theme/ThemeModeContext";

function Root() {
  const [mode, setMode] = React.useState(() => localStorage.getItem("aicsgts_theme_mode") || "light");
  const toggleMode = React.useCallback(() => {
    setMode((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem("aicsgts_theme_mode", next);
      return next;
    });
  }, []);

  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: { main: "#1b5e20" },
          secondary: { main: "#0d47a1" }
        },
        shape: { borderRadius: 12 }
      }),
    [mode]
  );

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

