import React, { useEffect, useMemo, useRef, useState } from "react";
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
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import AppShell from "../components/AppShell";
import CourseMaterialViewerModal from "../components/CourseMaterialViewerModal";
import { api } from "../api/client";
import { useSearchParams } from "react-router-dom";
import { exportRowsToCsv } from "../utils/csvExport";
import { exportElementToPdf } from "../utils/pdfExport";
import { getApiErrorMessage } from "../utils/apiError";

const SECTIONS = [
  { key: "home", label: "Dashboard home" },
  { key: "profile", label: "Personal profile" },
  { key: "skills", label: "Skill inventory" },
  { key: "assessment", label: "Self-assessment" },
  { key: "gaps", label: "Skill gaps" },
  { key: "projects", label: "My projects" },
  { key: "recs", label: "Training recommendations" },
  { key: "progress", label: "Training progress" },
  { key: "career", label: "Career paths" },
  { key: "goals", label: "Goals & development plan" },
  { key: "notifications", label: "Notifications" }
];

export default function EmployeeDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = useMemo(() => {
    const s = searchParams.get("section");
    if (SECTIONS.some((x) => x.key === s)) return s;
    return "home";
  }, [searchParams]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(null);
  const [profile, setProfile] = useState(null);
  const [skills, setSkills] = useState([]);
  const [gaps, setGaps] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectReports, setProjectReports] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [trainingProgress, setTrainingProgress] = useState({ active_courses: [], completed_courses: [] });
  const [careerPaths, setCareerPaths] = useState([]);
  const [goals, setGoals] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [profileEdit, setProfileEdit] = useState({ phone_number: "", country: "", primary_skill: "", headline: "" });
  const [skillForm, setSkillForm] = useState({ skill: "", level: 1 });
  const [assessmentForm, setAssessmentForm] = useState({ skill: "", self_score: 3, confidence: 3, years: 1 });
  const [goalForm, setGoalForm] = useState({ title: "", status: "Not started" });
  const [projectReportForm, setProjectReportForm] = useState({
    work_date: new Date().toISOString().slice(0, 10),
    hours_spent: 8,
    progress_pct: 0,
    status: "in_progress",
    summary: "",
    blockers: "",
    next_plan: ""
  });
  const reportsTableRef = useRef(null);
  const [empTrainPct, setEmpTrainPct] = useState({});
  const [courseViewer, setCourseViewer] = useState(null);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    const activeIds = (trainingProgress.active_courses || []).filter((c) => c.session_active).map((c) => c.id);
    if (activeIds.length === 0) return undefined;
    const tick = () => {
      activeIds.forEach((id) => {
        api.post(`/analytics/employee/training-assignments/${id}/heartbeat`).catch(() => {});
      });
    };
    const intervalMs = 90_000;
    const handle = setInterval(tick, intervalMs);
    tick();
    return () => clearInterval(handle);
  }, [trainingProgress.active_courses]);

  useEffect(() => {
    const s = searchParams.get("section");
    if (!s || !SECTIONS.some((x) => x.key === s)) {
      setSearchParams({ section: "home" }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function refreshTrainingProgress() {
    try {
      const prog = await api.get("/analytics/employee/training-progress");
      setTrainingProgress(prog.data || { active_courses: [], completed_courses: [] });
    } catch {
      /* ignore — viewer still works */
    }
  }

  async function loadAll() {
      setLoading(true);
    setError("");
    try {
      const [ov, pr, sk, gp, proj, rec, prog, car, gl, noti] = await Promise.all([
        api.get("/analytics/employee/overview"),
        api.get("/analytics/employee/profile"),
        api.get("/analytics/employee/skills"),
        api.get("/analytics/my-skill-gaps"),
        api.get("/analytics/employee/projects"),
        api.get("/analytics/employee/training-recommendations"),
        api.get("/analytics/employee/training-progress"),
        api.get("/analytics/employee/career-paths"),
        api.get("/analytics/employee/goals"),
        api.get("/analytics/employee/notifications")
      ]);
      setOverview(ov.data);
      setProfile(pr.data);
      setSkills(sk.data || []);
      setGaps(gp.data);
      const loadedProjects = proj.data || [];
      setProjects(loadedProjects);
      if (loadedProjects.length > 0) {
        const initialId = selectedProjectId || loadedProjects[0].project_id;
        setSelectedProjectId(initialId);
        try {
          const reportsRes = await api.get(`/analytics/employee/projects/${initialId}/daily-reports`);
          setProjectReports(reportsRes.data || []);
        } catch {
          setProjectReports([]);
        }
      } else {
        setSelectedProjectId("");
        setProjectReports([]);
      }
      setRecommendations(rec.data || []);
      setTrainingProgress(prog.data || { active_courses: [], completed_courses: [] });
      setCareerPaths(car.data || []);
      setGoals(gl.data || []);
      setNotifications(noti.data || []);
      setProfileEdit({
        phone_number: pr.data?.basic?.phone || "",
        country: pr.data?.basic?.country || "",
        primary_skill: pr.data?.basic?.primary_skill || "",
        headline: pr.data?.basic?.headline || ""
      });
      } catch (err) {
      setError(err?.response?.data?.detail || "Failed to load employee analytics");
      } finally {
        setLoading(false);
      }
  }

  async function saveProfile() {
    try {
      await api.put("/analytics/employee/profile", { basic: profileEdit });
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to save profile");
    }
  }

  async function addSkill() {
    try {
      await api.post("/analytics/employee/skills", skillForm);
      setSkillForm({ skill: "", level: 1 });
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to add skill");
    }
  }

  async function updateSkill(skillRowId, level) {
    try {
      await api.patch(`/analytics/employee/skills/${skillRowId}`, { level });
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to update skill");
    }
  }

  async function removeSkill(skillRowId) {
    try {
      await api.delete(`/analytics/employee/skills/${skillRowId}`);
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to remove skill");
    }
  }

  async function submitAssessment() {
    try {
      await api.post("/analytics/employee/self-assessment", assessmentForm);
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to submit self-assessment");
    }
  }

  async function saveGoal() {
    try {
      await api.post("/analytics/employee/goals", goalForm);
      setGoalForm({ title: "", status: "Not started" });
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to save goal");
    }
  }

  async function enrollInTraining(course, skill) {
    try {
      await api.post("/analytics/employee/training-enroll", { course, skill });
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to enroll in training");
    }
  }

  async function saveTrainingProgress(actionId, fallbackPct) {
    setError("");
    try {
      const pct = Number(empTrainPct[actionId] ?? fallbackPct);
      await api.patch(`/analytics/employee/training-assignments/${actionId}`, { progress_pct: pct });
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to update training progress");
    }
  }

  async function markTrainingComplete(actionId) {
    setError("");
    try {
      await api.patch(`/analytics/employee/training-assignments/${actionId}`, {
        mark_completed: true,
        certificate_status: "Issued"
      });
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to complete training");
    }
  }

  async function startLearningSession(actionId) {
    setError("");
    try {
      await api.post(`/analytics/employee/training-assignments/${actionId}/session/start`);
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to start learning session");
    }
  }

  async function endLearningSession(actionId) {
    setError("");
    try {
      await api.post(`/analytics/employee/training-assignments/${actionId}/session/end`);
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to end learning session");
    }
  }

  async function loadProjectReports(projectId) {
    setSelectedProjectId(projectId);
    try {
      const res = await api.get(`/analytics/employee/projects/${projectId}/daily-reports`);
      setProjectReports(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to load project reports");
    }
  }

  async function saveDailyProjectReport() {
    if (!selectedProjectId) {
      setError("Please select a project");
      return;
    }
    if (!projectReportForm.summary?.trim()) {
      setError("Daily summary is required");
      return;
    }
    try {
      await api.post(`/analytics/employee/projects/${selectedProjectId}/daily-reports`, {
        ...projectReportForm,
        hours_spent: Number(projectReportForm.hours_spent),
        progress_pct: Number(projectReportForm.progress_pct)
      });
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to save daily report");
    }
  }

  function exportWeeklyReportsCsv() {
    if (!projectReports.length) return;
    const selectedProject = projects.find((p) => p.project_id === selectedProjectId);
    const weeklyRows = projectReports.filter((r) => {
      const d = new Date(r.work_date);
      const diffMs = Date.now() - d.getTime();
      return diffMs >= 0 && diffMs <= 7 * 24 * 60 * 60 * 1000;
    });
    exportRowsToCsv(
      `weekly-report-${(selectedProject?.name || "project").replace(/\s+/g, "-").toLowerCase()}.csv`,
      weeklyRows.length ? weeklyRows : projectReports,
      [
        { header: "Date", value: (r) => r.work_date },
        { header: "Hours", value: (r) => r.hours_spent },
        { header: "Progress %", value: (r) => r.progress_pct },
        { header: "Status", value: (r) => r.status },
        { header: "Summary", value: (r) => r.summary },
        { header: "Blockers", value: (r) => r.blockers || "" },
        { header: "Next Plan", value: (r) => r.next_plan || "" }
      ]
    );
  }

  async function exportWeeklyReportsPdf() {
    if (!reportsTableRef.current) return;
    const selectedProject = projects.find((p) => p.project_id === selectedProjectId);
    await exportElementToPdf(
      reportsTableRef.current,
      `weekly-report-${(selectedProject?.name || "project").replace(/\s+/g, "-").toLowerCase()}.pdf`,
      {
        title: "Employee Weekly Project Report",
        role: "employee",
        section: "my-projects"
      }
    );
  }

  return (
    <AppShell title="Employee Dashboard">
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Grid container spacing={2}>
          <Grid item xs={12}>
            {loading ? (
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <CircularProgress size={22} />
                    <Typography>Loading employee insights...</Typography>
                  </Stack>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "home" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Dashboard home</Typography>
                <Divider sx={{ my: 2 }} />
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}><Alert severity="info">Welcome {overview?.welcome_name || "Employee"}</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity="success">Profile completion: {overview?.profile_completion_pct || 0}%</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity="info">Skill strength: {overview?.skill_strength_score || 0}</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity="warning">Gap score: {overview?.skill_gap_score || 0}</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity="info">Active trainings: {overview?.active_trainings || 0}</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity={overview?.actively_learning_now > 0 ? "success" : "info"}>Actively learning now: {overview?.actively_learning_now ?? 0}</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity="info">Notifications: {overview?.notifications_count || 0}</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity="success">Assigned projects: {overview?.assigned_projects_count || 0}</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity="info">Active assigned projects: {overview?.active_assigned_projects || 0}</Alert></Grid>
                </Grid>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "profile" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Personal profile (with CV data)
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}><TextField size="small" label="Name" fullWidth value={profile?.basic?.name || ""} disabled /></Grid>
                    <Grid item xs={12} md={6}><TextField size="small" label="Email" fullWidth value={profile?.basic?.email || ""} disabled /></Grid>
                    <Grid item xs={12} md={4}><TextField size="small" label="Phone" fullWidth value={profileEdit.phone_number} onChange={(e) => setProfileEdit((p) => ({ ...p, phone_number: e.target.value }))} /></Grid>
                    <Grid item xs={12} md={4}><TextField size="small" label="Department" fullWidth value={profile?.basic?.department || ""} disabled /></Grid>
                    <Grid item xs={12} md={4}><TextField size="small" label="Job Title" fullWidth value={profile?.basic?.job_title || ""} disabled /></Grid>
                    <Grid item xs={12} md={6}><TextField size="small" label="Country" fullWidth value={profileEdit.country} onChange={(e) => setProfileEdit((p) => ({ ...p, country: e.target.value }))} /></Grid>
                    <Grid item xs={12} md={6}><TextField size="small" label="Primary Skill" fullWidth value={profileEdit.primary_skill} onChange={(e) => setProfileEdit((p) => ({ ...p, primary_skill: e.target.value }))} /></Grid>
                    <Grid item xs={12}><TextField size="small" label="Headline" fullWidth value={profileEdit.headline} onChange={(e) => setProfileEdit((p) => ({ ...p, headline: e.target.value }))} /></Grid>
                  </Grid>
                  <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
                    <Button variant="contained" onClick={saveProfile}>Save profile</Button>
                  </Stack>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle1" fontWeight={700}>CV extracted preview</Typography>
                  <Typography variant="body2" color="text.secondary">{(profile?.cv_preview?.skills || []).join(", ") || "No CV skills found yet."}</Typography>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "skills" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Skill inventory
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                    <TextField size="small" label="Skill" value={skillForm.skill} onChange={(e) => setSkillForm((s) => ({ ...s, skill: e.target.value }))} />
                    <TextField select size="small" label="Level" value={skillForm.level} onChange={(e) => setSkillForm((s) => ({ ...s, level: Number(e.target.value) }))}>
                      <MenuItem value={1}>Beginner</MenuItem><MenuItem value={2}>Intermediate</MenuItem><MenuItem value={3}>Advanced</MenuItem><MenuItem value={4}>Expert</MenuItem>
                    </TextField>
                    <Button variant="contained" onClick={addSkill}>Add Skill</Button>
                  </Stack>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Skill</TableCell>
                          <TableCell align="right">Level</TableCell>
                          <TableCell>Last Updated</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {skills.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>{r.skill}</TableCell>
                            <TableCell align="right">{r.level}</TableCell>
                            <TableCell>{String(r.last_updated).slice(0, 19)}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button size="small" variant="outlined" onClick={() => updateSkill(r.id, Math.min(4, r.level + 1))}>+Level</Button>
                                <Button size="small" color="error" variant="outlined" onClick={() => removeSkill(r.id)}>Remove</Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "assessment" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Self-assessment</Typography>
                <Divider sx={{ my: 2 }} />
                <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                  <TextField size="small" label="Skill" value={assessmentForm.skill} onChange={(e) => setAssessmentForm((f) => ({ ...f, skill: e.target.value }))} />
                  <TextField size="small" type="number" label="Rate (1-5)" value={assessmentForm.self_score} onChange={(e) => setAssessmentForm((f) => ({ ...f, self_score: Number(e.target.value) }))} />
                  <TextField size="small" type="number" label="Confidence (1-5)" value={assessmentForm.confidence} onChange={(e) => setAssessmentForm((f) => ({ ...f, confidence: Number(e.target.value) }))} />
                  <TextField size="small" type="number" label="Experience years" value={assessmentForm.years} onChange={(e) => setAssessmentForm((f) => ({ ...f, years: Number(e.target.value) }))} />
                  <Button variant="contained" onClick={submitAssessment}>Submit</Button>
                </Stack>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "gaps" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Individual skill gap visualization
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Gaps use normalized skill names. Importance weights emphasize your primary domain and role-specific skills; weighted impact drives training priority.
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Skill</TableCell>
                          <TableCell align="right">Required</TableCell>
                          <TableCell align="right">Current</TableCell>
                          <TableCell align="right">Gap</TableCell>
                          <TableCell align="right">Weight</TableCell>
                          <TableCell align="right">Weighted impact</TableCell>
                          <TableCell>Severity</TableCell>
                          <TableCell>Why</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(gaps?.gaps || []).map((g) => (
                          <TableRow key={g.skill}>
                            <TableCell>{g.skill}</TableCell>
                            <TableCell align="right">{g.required_level}</TableCell>
                            <TableCell align="right">{g.current_level}</TableCell>
                            <TableCell align="right">{g.gap}</TableCell>
                            <TableCell align="right">{g.importance_weight != null ? Number(g.importance_weight).toFixed(2) : "—"}</TableCell>
                            <TableCell align="right">{g.weighted_gap_impact != null ? Number(g.weighted_gap_impact).toFixed(2) : "—"}</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                color={
                                  g.severity === "high"
                                    ? "error"
                                    : g.severity === "medium"
                                      ? "warning"
                                      : g.severity === "low"
                                        ? "warning"
                                        : "success"
                                }
                                label={g.severity === "none" ? "meets target" : g.severity}
                                variant={g.severity === "none" ? "outlined" : "filled"}
                              />
                            </TableCell>
                            <TableCell sx={{ maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={g.explanation}>
                              {g.explanation || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "projects" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    My assigned projects and daily reports
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  {projects.length === 0 ? (
                    <Alert severity="info">No project has been assigned to you yet.</Alert>
                  ) : (
                    <>
                      <TableContainer sx={{ mb: 2 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Project</TableCell>
                              <TableCell>Status</TableCell>
                              <TableCell align="right">Allocation</TableCell>
                              <TableCell align="right">Progress</TableCell>
                              <TableCell align="right">Report Days</TableCell>
                              <TableCell>Last Report</TableCell>
                              <TableCell align="right">Action</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {projects.map((p) => (
                              <TableRow key={p.project_id} selected={selectedProjectId === p.project_id}>
                                <TableCell>
                                  <Typography fontWeight={700}>{p.name}</Typography>
                                  <Typography variant="body2" color="text.secondary">{p.manager_name}</Typography>
                                </TableCell>
                                <TableCell>{p.status}</TableCell>
                                <TableCell align="right">{p.allocation_pct}%</TableCell>
                                <TableCell align="right">{p.current_progress_pct}%</TableCell>
                                <TableCell align="right">{p.days_reported}</TableCell>
                                <TableCell>{p.last_report_date || "-"}</TableCell>
                                <TableCell align="right">
                                  <Button size="small" variant="outlined" onClick={() => loadProjectReports(p.project_id)}>
                                    Manage
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>

                      <Divider sx={{ my: 2 }} />
                      <Typography variant="subtitle1" fontWeight={700}>Submit daily report</Typography>
                      <Grid container spacing={1} sx={{ mb: 2 }}>
                        <Grid item xs={12} md={3}>
                          <TextField
                            type="date"
                            size="small"
                            label="Work date"
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                            value={projectReportForm.work_date}
                            onChange={(e) => setProjectReportForm((f) => ({ ...f, work_date: e.target.value }))}
                          />
                        </Grid>
                        <Grid item xs={12} md={3}>
                          <TextField
                            type="number"
                            size="small"
                            label="Hours spent"
                            fullWidth
                            value={projectReportForm.hours_spent}
                            onChange={(e) => setProjectReportForm((f) => ({ ...f, hours_spent: e.target.value }))}
                          />
                        </Grid>
                        <Grid item xs={12} md={3}>
                          <TextField
                            type="number"
                            size="small"
                            label="Progress %"
                            fullWidth
                            value={projectReportForm.progress_pct}
                            onChange={(e) => setProjectReportForm((f) => ({ ...f, progress_pct: e.target.value }))}
                          />
                        </Grid>
                        <Grid item xs={12} md={3}>
                          <TextField
                            select
                      size="small"
                            label="Status"
                            fullWidth
                            value={projectReportForm.status}
                            onChange={(e) => setProjectReportForm((f) => ({ ...f, status: e.target.value }))}
                          >
                            <MenuItem value="in_progress">In progress</MenuItem>
                            <MenuItem value="blocked">Blocked</MenuItem>
                            <MenuItem value="completed">Completed</MenuItem>
                          </TextField>
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            size="small"
                            label="Summary of today"
                            fullWidth
                            value={projectReportForm.summary}
                            onChange={(e) => setProjectReportForm((f) => ({ ...f, summary: e.target.value }))}
                          />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <TextField
                            size="small"
                            label="Blockers"
                            fullWidth
                            value={projectReportForm.blockers}
                            onChange={(e) => setProjectReportForm((f) => ({ ...f, blockers: e.target.value }))}
                          />
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <TextField
                            size="small"
                            label="Next day plan"
                            fullWidth
                            value={projectReportForm.next_plan}
                            onChange={(e) => setProjectReportForm((f) => ({ ...f, next_plan: e.target.value }))}
                          />
                        </Grid>
                      </Grid>
                      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
                        <Button variant="contained" onClick={saveDailyProjectReport}>Save Daily Report</Button>
                      </Stack>

                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                        <Typography variant="subtitle1" fontWeight={700}>Daily report history</Typography>
                        <Stack direction="row" spacing={1}>
                          <Button size="small" variant="outlined" onClick={exportWeeklyReportsCsv} disabled={!projectReports.length}>
                      Export CSV
                    </Button>
                          <Button size="small" variant="outlined" onClick={exportWeeklyReportsPdf} disabled={!projectReports.length}>
                            Export PDF
                          </Button>
                        </Stack>
                  </Stack>
                      <TableContainer ref={reportsTableRef}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Date</TableCell>
                              <TableCell align="right">Hours</TableCell>
                              <TableCell align="right">Progress %</TableCell>
                              <TableCell>Status</TableCell>
                              <TableCell>Summary</TableCell>
                              <TableCell>Blockers</TableCell>
                              <TableCell>Next Plan</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {projectReports.map((r) => (
                              <TableRow key={r.id}>
                                <TableCell>{r.work_date}</TableCell>
                                <TableCell align="right">{r.hours_spent}</TableCell>
                                <TableCell align="right">{r.progress_pct}</TableCell>
                                <TableCell>{r.status}</TableCell>
                                <TableCell>{r.summary}</TableCell>
                                <TableCell>{r.blockers || "-"}</TableCell>
                                <TableCell>{r.next_plan || "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "recs" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    AI training recommendations
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <TableContainer><Table size="small"><TableHead><TableRow>
                  <TableCell>Course</TableCell><TableCell>Skill</TableCell><TableCell>Match %</TableCell><TableCell>Evidence</TableCell><TableCell>Cert Fit</TableCell><TableCell>CV Fit</TableCell><TableCell>Projected Gap Reduction</TableCell><TableCell>Why Recommended</TableCell><TableCell>Mode</TableCell><TableCell>Duration</TableCell><TableCell align="right">Action</TableCell>
                  </TableRow></TableHead><TableBody>
                    {recommendations.map((r, idx) => (
                      <TableRow key={`${r.course}-${idx}`}>
                        <TableCell>{r.course}</TableCell>
                        <TableCell>{r.skill}</TableCell>
                        <TableCell>{r.match_pct}</TableCell>
                      <TableCell>{r.evidence_confidence_pct ?? 0}%</TableCell>
                      <TableCell>{r.cert_relevance_pct ?? 0}%</TableCell>
                      <TableCell>{r.cv_relevance_pct ?? 0}%</TableCell>
                      <TableCell>{r.projected_gap_reduction_pct ?? 0}%</TableCell>
                      <TableCell sx={{ maxWidth: 300, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.rationale || "-"}
                      </TableCell>
                        <TableCell>{r.mode}</TableCell>
                        <TableCell>{r.duration_weeks} weeks</TableCell>
                        <TableCell align="right">
                          <Button size="small" variant="contained" onClick={() => enrollInTraining(r.course, r.skill)}>
                            Enroll
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table></TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "progress" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Training progress tracking</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Start a <strong>learning session</strong> while you study. Open <strong>View course</strong> to read the PDF page by page (each page counts after you spend a few seconds on it) or watch the video with watch-time tracking — when a session is active, that progress can update your official course %. You still need <strong>minimum verified session time</strong> before marking complete.
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle1" fontWeight={700}>Active courses</Typography>
                <Stack spacing={1} sx={{ mb: 2 }}>
                  {trainingProgress.active_courses.length === 0 ? (
                    <Alert severity="info">No active training assignments. Enroll from recommendations or wait for HR to assign a program.</Alert>
                  ) : null}
                  {trainingProgress.active_courses.map((c) => (
                    <Card variant="outlined" key={c.id}><CardContent>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                        <Box>
                          <Typography fontWeight={700}>{c.course}</Typography>
                          <Typography variant="body2" color="text.secondary">{c.skill}</Typography>
                          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Chip size="small" label={c.status || "assigned"} />
                            <Chip size="small" color={c.session_active ? "success" : "default"} label={c.session_active ? "In session" : (c.learning_state || "not_attending").replace(/_/g, " ")} />
                            <Chip size="small" variant="outlined" label={(c.attendance_tier || "enrolled").replace(/_/g, " ")} />
                            {c.source ? <Chip size="small" variant="outlined" label={c.source} /> : null}
                          </Stack>
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                            Verified time on course: <strong>{c.total_learning_display || "0s"}</strong>
                            {c.sessions_completed != null ? ` · Sessions logged: ${c.sessions_completed}` : null}
                            {c.session_active ? " · Heartbeat active (idle 30m auto-pauses)" : null}
                          </Typography>
                          {c.course_material_available ? (
                            <Box sx={{ mt: 1.5, p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
                              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                                Official course (from HR)
                              </Typography>
                              <Typography variant="body2" sx={{ mb: 1 }}>
                                {c.course_material_filename || "Course material"}{" "}
                                <Chip size="small" label={c.course_material_kind === "video" ? "Video" : "PDF"} sx={{ ml: 0.5 }} />
                              </Typography>
                              {c.material_progress_pct != null && c.material_progress_pct !== undefined ? (
                                <Box sx={{ mb: 1.5, maxWidth: 400 }}>
                                  <Typography variant="caption" color="text.secondary" display="block">
                                    Content progress (pages watched / video seen)
                                  </Typography>
                                  <LinearProgress variant="determinate" value={Number(c.material_progress_pct) || 0} sx={{ height: 8, borderRadius: 1, my: 0.5 }} />
                                  <Typography variant="caption" fontWeight={700}>
                                    {Number(c.material_progress_pct) || 0}%
                                    {c.material_pdf_total_pages
                                      ? ` · ${c.material_pdf_pages_done_count ?? 0} / ${c.material_pdf_total_pages} pages studied`
                                      : c.course_material_kind === "video"
                                        ? " · video watch tracked in viewer"
                                        : null}
                                  </Typography>
                                </Box>
                              ) : null}
                              <Button
                                size="small"
                                variant="contained"
                                color="secondary"
                                onClick={() =>
                                  setCourseViewer({
                                    id: c.id,
                                    kind: c.course_material_kind,
                                    title: c.course,
                                    filename: c.course_material_filename,
                                    sessionActive: Boolean(c.session_active),
                                    materialPct: Number(c.material_progress_pct) || 0,
                                    videoMaxPositionSec:
                                      c.material_video_max_position_sec != null &&
                                      Number.isFinite(Number(c.material_video_max_position_sec))
                                        ? Number(c.material_video_max_position_sec)
                                        : 0
                                  })
                                }
                              >
                                View course
                              </Button>
                            </Box>
                          ) : (
                            <Alert severity="info" sx={{ mt: 1.5 }} icon={false}>
                              HR has not uploaded a course PDF or video yet. Ask HR to attach the official file from their HR dashboard.
                            </Alert>
                          )}
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          {!c.session_active ? (
                            <Button size="small" variant="contained" color="primary" onClick={() => startLearningSession(c.id)}>Start learning session</Button>
                          ) : (
                            <Button size="small" variant="outlined" color="warning" onClick={() => endLearningSession(c.id)}>Pause / end session</Button>
                          )}
                          <TextField
                            size="small"
                            type="number"
                            label="Progress %"
                            inputProps={{ min: 0, max: 100 }}
                            sx={{ width: 110 }}
                            value={empTrainPct[c.id] ?? c.progress_pct}
                            onChange={(e) => setEmpTrainPct((prev) => ({ ...prev, [c.id]: Number(e.target.value) }))}
                          />
                          <Button size="small" variant="outlined" onClick={() => saveTrainingProgress(c.id, c.progress_pct)}>Save</Button>
                          <Button size="small" variant="contained" color="success" onClick={() => markTrainingComplete(c.id)}>Mark complete</Button>
                        </Stack>
                      </Stack>
                      <Stack spacing={0.5} sx={{ mt: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          Course progress %
                        </Typography>
                        <LinearProgress variant="determinate" value={Number(empTrainPct[c.id] ?? c.progress_pct)} sx={{ height: 8, borderRadius: 1 }} />
                      </Stack>
                    </CardContent></Card>
                  ))}
                </Stack>
                <Typography variant="subtitle1" fontWeight={700}>Completed courses</Typography>
                <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Course</TableCell><TableCell>Skill</TableCell><TableCell>Certificate</TableCell><TableCell>Completed</TableCell></TableRow></TableHead><TableBody>
                  {trainingProgress.completed_courses.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.course}</TableCell>
                      <TableCell>{c.skill}</TableCell>
                      <TableCell>{c.certificate_status}</TableCell>
                      <TableCell>{c.completed_at ? String(c.completed_at).slice(0, 19) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody></Table></TableContainer>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "career" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Career path suggestions</Typography>
                <Divider sx={{ my: 2 }} />
                <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Role</TableCell><TableCell>Career Match %</TableCell><TableCell>Required Skills</TableCell></TableRow></TableHead><TableBody>
                  {careerPaths.map((r) => <TableRow key={r.role}><TableCell>{r.role}</TableCell><TableCell>{r.career_match_pct}</TableCell><TableCell>{Object.entries(r.required_skills || {}).map(([k,v]) => `${k}(${v})`).join(", ")}</TableCell></TableRow>)}
                </TableBody></Table></TableContainer>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "goals" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Goals & development plan</Typography>
                <Divider sx={{ my: 2 }} />
                <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mb: 2 }}>
                  <TextField size="small" label="Goal" value={goalForm.title} onChange={(e) => setGoalForm((g) => ({ ...g, title: e.target.value }))} fullWidth />
                  <TextField select size="small" label="Status" value={goalForm.status} onChange={(e) => setGoalForm((g) => ({ ...g, status: e.target.value }))} sx={{ minWidth: 160 }}>
                    <MenuItem value="Not started">Not started</MenuItem>
                    <MenuItem value="In progress">In progress</MenuItem>
                    <MenuItem value="Completed">Completed</MenuItem>
                  </TextField>
                  <Button variant="contained" onClick={saveGoal}>Save Goal</Button>
                </Stack>
                <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Goal</TableCell><TableCell>Status</TableCell><TableCell>Updated</TableCell></TableRow></TableHead><TableBody>
                  {goals.map((g, idx) => <TableRow key={`${g.title}-${idx}`}><TableCell>{g.title}</TableCell><TableCell>{g.status}</TableCell><TableCell>{String(g.updated_at || "").slice(0, 19)}</TableCell></TableRow>)}
                </TableBody></Table></TableContainer>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "notifications" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Notifications</Typography>
                <Divider sx={{ my: 2 }} />
                <Stack spacing={1}>
                  {notifications.map((n, idx) => <Alert key={`${n.type}-${idx}`} severity={n.type?.includes("warning") ? "warning" : "info"}>{n.message}</Alert>)}
                </Stack>
              </CardContent></Card>
            ) : null}
          </Grid>
        </Grid>
      </Stack>
      <CourseMaterialViewerModal
        open={Boolean(courseViewer)}
        onClose={() => {
          setCourseViewer(null);
          loadAll();
        }}
        assignmentId={courseViewer?.id}
        kind={courseViewer?.kind}
        title={courseViewer?.title}
        filename={courseViewer?.filename}
        sessionActive={Boolean(courseViewer?.sessionActive)}
        initialMaterialPct={Number(courseViewer?.materialPct) || 0}
        initialVideoMaxPositionSec={Number(courseViewer?.videoMaxPositionSec) || 0}
        onAfterSync={refreshTrainingProgress}
      />
    </AppShell>
  );
}

