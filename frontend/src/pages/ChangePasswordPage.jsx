import React, { useState } from "react";
import { Alert, Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../api/client";
import { getAuth, setAuth } from "../auth/authStore";
import { dashboardPathForRole } from "../auth/roleRouting";
import { getApiErrorMessage } from "../utils/apiError";

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setOk("");
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: currentPassword, new_password: newPassword });
      setAuth({ ...auth, must_change_password: false });
      setOk("Password updated.");
      navigate(dashboardPathForRole(auth?.role));
    } catch (err) {
      setError(getApiErrorMessage(err, "Password change failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Security">
      <Stack spacing={2} sx={{ maxWidth: 520, mx: "auto" }}>
        <Typography variant="h5" fontWeight={800}>
          Change your password
        </Typography>
        <Typography color="text.secondary">
          First login requires a password change before accessing the platform.
        </Typography>
        <Card variant="outlined">
          <CardContent>
            <Stack component="form" spacing={2} onSubmit={onSubmit}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              {ok ? <Alert severity="success">{ok}</Alert> : null}
              <TextField
                label="Current password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
              <TextField
                label="New password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                helperText="Minimum 8 characters."
              />
              <Button type="submit" variant="contained" disabled={busy}>
                {busy ? "Updating..." : "Update password"}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </AppShell>
  );
}

