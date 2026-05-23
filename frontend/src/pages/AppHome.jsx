import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import AppShell from "../components/AppShell";
import { api } from "../api/client";
import { getAuth } from "../auth/authStore";
import { dashboardPathForRole } from "../auth/roleRouting";

function RoleChip({ role }) {
  const map = {
    system_admin: { label: "System Admin", color: "error" },
    hr_admin: { label: "HR Admin", color: "secondary" },
    manager: { label: "Manager", color: "primary" },
    employee: { label: "Employee", color: "success" }
  };
  const m = map[role] || { label: role, color: "default" };
  return <Chip label={m.label} color={m.color} variant="outlined" />;
}

export default function AppHome() {
  const auth = getAuth();
  const [me, setMe] = useState(null);
  const [pending, setPending] = useState([]);
  const [gaps, setGaps] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const meRes = await api.get("/auth/me");
      setMe(meRes.data);
      if (["system_admin", "hr_admin", "manager"].includes(meRes.data.role)) {
        const pRes = await api.get("/admin/users/pending");
        setPending(pRes.data);
      }
      if (meRes.data.role === "employee") {
        const gRes = await api.get("/analytics/my-skill-gaps");
        setGaps(gRes.data);
      }
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to load dashboard");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(userId) {
    setError("");
    try {
      await api.post(`/admin/users/${userId}/approve`);
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || "Approval failed");
    }
  }

  return (
    <AppShell title="AI-CSGTS Intelligence Hub">
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h5" fontWeight={800}>
                Welcome{me?.full_name ? `, ${me.full_name}` : ""}!
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <RoleChip role={auth?.role} />
                <Typography variant="body2" color="text.secondary">
                  Role-based dashboards are enforced by backend RBAC.
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="flex-end" sx={{ pt: 1 }}>
                <Button variant="contained" onClick={() => (window.location.href = dashboardPathForRole(auth?.role))}>
                  Go to my dashboard
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {["system_admin", "hr_admin", "manager"].includes(auth?.role) ? (
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6" fontWeight={800}>
                  Pending employee approvals
                </Typography>
                {pending.length === 0 ? (
                  <Alert severity="info">No pending accounts.</Alert>
                ) : (
                  <Grid container spacing={2}>
                    {pending.map((u) => (
                      <Grid item xs={12} md={6} key={u.id}>
                        <Card variant="outlined">
                          <CardContent>
                            <Stack spacing={1}>
                              <Typography fontWeight={700}>{u.full_name}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {u.email} · {u.department} · {u.job_title}
                              </Typography>
                              <Divider />
                              <Stack direction="row" justifyContent="flex-end">
                                <Button variant="contained" onClick={() => approve(u.id)}>
                                  Approve
                                </Button>
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                )}
              </Stack>
            </CardContent>
          </Card>
        ) : null}

        {auth?.role === "employee" ? (
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6" fontWeight={800}>
                  Your skill gaps (AI explainable)
                </Typography>
                {!gaps ? (
                  <Alert severity="info">Loading analytics…</Alert>
                ) : (gaps.priority_gaps || []).length === 0 ? (
                  <Alert severity="success">No skill gaps vs your HR role profile.</Alert>
                ) : (
                  <>
                    <Typography variant="body2" color="text.secondary">
                      {gaps.explainability?.rule}
                    </Typography>
                    <Table size="small" sx={{ mt: 1 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Skill</TableCell>
                          <TableCell align="right">Gap</TableCell>
                          <TableCell>Severity</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(gaps.priority_gaps || []).slice(0, 6).map((g) => (
                          <TableRow key={g.skill}>
                            <TableCell>{g.skill}</TableCell>
                            <TableCell align="right">{g.gap}</TableCell>
                            <TableCell>{g.severity}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <Button size="small" sx={{ mt: 1 }} href="/app/employee?section=gaps">
                      Open full gap visualization
                    </Button>
                  </>
                )}
              </Stack>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </AppShell>
  );
}

