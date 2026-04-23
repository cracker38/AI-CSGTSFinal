import React, { useState } from "react";
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../api/client";
import { setAuth } from "../auth/authStore";
import { dashboardPathForRole } from "../auth/roleRouting";
import { getApiErrorMessage } from "../utils/apiError";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function doLogin() {
    setError("");
    setBusy(true);
    try {
      const emailNorm = String(email).trim().toLowerCase();
      const res = await api.post("/auth/login", { email: emailNorm, password });
      setAuth({ ...res.data, email: emailNorm });
      if (res.data.must_change_password) navigate("/change-password");
      else navigate(dashboardPathForRole(res.data.role));
    } catch (err) {
      const msg = getApiErrorMessage(err, "Login failed");
      const extra =
        err?.response?.status === 401
          ? " Confirm email/password. Start the API (uvicorn) and match the Vite proxy port in vite.config.js (often 8010 or 8888). Pending employees see 403 until approved."
          : "";
      setError(msg + extra);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    void doLogin();
  }

  return (
    <AppShell title="AI-CSGTS">
      <Stack spacing={3} sx={{ maxWidth: 520, mx: "auto" }}>
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Workforce Intelligence Platform
          </Typography>
          <Typography color="text.secondary">
            Sign in to assess competencies, detect skill gaps, and get explainable recommendations.
          </Typography>
        </Box>

        <Card variant="outlined">
          <CardContent>
            {/* Native <form> so submit + Enter work reliably; MUI Stack as form can miss submits in some cases. */}
            <form onSubmit={onSubmit}>
              <Stack spacing={2}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                  label="Email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  fullWidth
                />
                <TextField
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  fullWidth
                />
                <Button type="submit" variant="contained" disabled={busy}>
                  {busy ? "Signing in..." : "Sign in"}
                </Button>
                <Button type="button" variant="text" onClick={() => navigate("/register")}>
                  Employee registration
                </Button>
              </Stack>
            </form>
          </CardContent>
        </Card>

        <Alert severity="info">
          Default System Admin: <b>shema@gmail.com</b> / <b>Shema@123</b> (first login forces password change)
        </Alert>
      </Stack>
    </AppShell>
  );
}

