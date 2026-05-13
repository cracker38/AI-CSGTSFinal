import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../api/client";
import { getApiErrorMessage } from "../utils/apiError";

const experienceOptions = ["Junior", "Mid", "Senior", "Expert"];

export default function RegisterEmployeePage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [catalog, setCatalog] = useState({ departments: [], job_titles: [], primary_skills: [] });

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    phone_number: "",
    country: "",
    department: "",
    job_title: "",
    experience_level: "Junior",
    primary_skill: ""
  });
  const [cv, setCv] = useState(null);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setLoadingOptions(true);
      try {
        const res = await api.get("/registration/options");
        if (!active) return;
        setCatalog(res.data);
        setForm((prev) => ({
          ...prev,
          department: res.data.departments[0] || "",
          job_title: res.data.job_titles[0] || "",
          primary_skill: res.data.primary_skills[0] || ""
        }));
      } catch (err) {
        if (!active) return;
        setError(getApiErrorMessage(err, "Failed to load registration catalog"));
      } finally {
        if (active) setLoadingOptions(false);
      }
    }
    loadOptions();
    return () => {
      active = false;
    };
  }, []);

  const canSubmit = useMemo(() => {
    return (
      !loadingOptions &&
      catalog.departments.length > 0 &&
      catalog.job_titles.length > 0 &&
      catalog.primary_skills.length > 0 &&
      Object.values(form).every(Boolean) &&
      cv &&
      cv.type === "application/pdf"
    );
  }, [form, cv, loadingOptions, catalog]);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setOk("");
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append("cv", cv);
      await api.post("/registration/employee", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setOk("Registration submitted. Your account is pending approval by HR Admin or System Admin. Redirecting to login…");
      sessionStorage.setItem("aicsgts_registration_submitted", "1");
      window.setTimeout(() => {
        navigate("/login", { replace: true });
      }, 2200);
    } catch (err) {
      setError(getApiErrorMessage(err, "Registration failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Employee Registration">
      <Stack spacing={2} sx={{ maxWidth: 980, mx: "auto" }}>
        <Card
          variant="outlined"
          sx={{
            borderRadius: 3,
            background: "linear-gradient(135deg, rgba(25,118,210,0.10) 0%, rgba(46,125,50,0.08) 100%)"
          }}
        >
          <CardContent sx={{ p: { xs: 2, md: 2.6 } }}>
            <Stack spacing={1.2} alignItems="center">
              <Chip label="AI-CSGTS Employee Portal" color="primary" size="small" />
              <Typography variant="h5" fontWeight={800} textAlign="center">
                Employee Registration
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack component="form" spacing={2} onSubmit={onSubmit}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              {ok ? <Alert severity="success">{ok}</Alert> : null}
              {loadingOptions ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2">Loading catalog values from database...</Typography>
                </Stack>
              ) : null}
              {!loadingOptions &&
              (catalog.departments.length === 0 || catalog.job_titles.length === 0 || catalog.primary_skills.length === 0) ? (
                <Alert severity="warning">
                  Registration catalog is incomplete. Ask an administrator to add departments, job titles, and skills in the database.
                </Alert>
              ) : null}
              <Divider />

              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Full Name"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    fullWidth
                    required
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Email Address (Login ID)"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    fullWidth
                    required
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Password"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    fullWidth
                    required
                    helperText="Minimum 8 characters."
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Phone Number"
                    value={form.phone_number}
                    onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                    fullWidth
                    required
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Country / Location"
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    fullWidth
                    required
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Department"
                    select
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    fullWidth
                    required
                  >
                    {catalog.departments.map((dep) => (
                      <MenuItem key={dep} value={dep}>
                        {dep}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Job Title"
                    select
                    value={form.job_title}
                    onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                    fullWidth
                    required
                  >
                    {catalog.job_titles.map((job) => (
                      <MenuItem key={job} value={job}>
                        {job}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Experience Level (Junior / Mid / Senior / Expert)"
                    value={form.experience_level}
                    onChange={(e) => setForm({ ...form, experience_level: e.target.value })}
                    fullWidth
                    required
                    select
                    SelectProps={{ native: true }}
                  >
                    {experienceOptions.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Primary Skill"
                    select
                    value={form.primary_skill}
                    onChange={(e) => setForm({ ...form, primary_skill: e.target.value })}
                    fullWidth
                    required
                  >
                    {catalog.primary_skills.map((skill) => (
                      <MenuItem key={skill} value={skill}>
                        {skill}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Button variant="outlined" component="label" fullWidth sx={{ height: 56 }}>
                    {cv ? `CV Selected: ${cv.name}` : "Upload CV (PDF)"}
                    <input
                      type="file"
                      hidden
                      accept="application/pdf"
                      onChange={(e) => setCv(e.target.files?.[0] || null)}
                    />
                  </Button>
                  {cv && cv.type !== "application/pdf" ? (
                    <Typography variant="caption" color="error">
                      Please upload a PDF file.
                    </Typography>
                  ) : null}
                </Grid>
              </Grid>

              <Stack direction="row" spacing={2} justifyContent="flex-end">
                <Button variant="text" onClick={() => navigate("/login")}>
                  Back to login
                </Button>
                <Button type="submit" variant="contained" disabled={!canSubmit || busy}>
                  {busy ? "Submitting..." : "Submit registration"}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </AppShell>
  );
}

