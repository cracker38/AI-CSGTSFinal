import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme
} from "@mui/material";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AppShell from "../components/AppShell";
import CourseMaterialViewerModal from "../components/CourseMaterialViewerModal";
import { api } from "../api/client";
import { useSearchParams } from "react-router-dom";
import { exportRowsToCsv } from "../utils/csvExport";
import { exportElementToPdf } from "../utils/pdfExport";
import { getChartTheme } from "../utils/chartTheme";
import { useThemeMode } from "../theme/ThemeModeContext";
import { getApiErrorMessage } from "../utils/apiError";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import LinkIcon from "@mui/icons-material/Link";

function AICourseLinkPanel({ course }) {
  if (!course?.official_url) return null;
  const label = course.provider
    ? `Open AI-recommended course (${course.provider})`
    : "Open AI-recommended course";

  return (
    <Alert
      severity="info"
      icon={<LinkIcon fontSize="inherit" />}
      sx={{ mt: 1.5, alignItems: "flex-start" }}
      action={
        <Button
          size="small"
          variant="contained"
          color="primary"
          href={course.official_url}
          target="_blank"
          rel="noopener noreferrer"
          endIcon={<OpenInNewIcon />}
          sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
        >
          Open link
        </Button>
      }
    >
      <Typography variant="subtitle2" fontWeight={800} gutterBottom>
        Official course link (AI matched)
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {course.official_url}
      </Typography>
    </Alert>
  );
}

const SECTIONS = [
  { key: "home", label: "Dashboard home" },
  { key: "cvfocus", label: "Career focus & résumé" },
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

const SECTION_KEYS = new Set(SECTIONS.map((s) => s.key));

function SectionPanel({ children }) {
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 3,
        borderColor: "divider",
        boxShadow: "0 8px 22px rgba(0,0,0,0.06)"
      }}
    >
      <CardContent sx={{ p: { xs: 1.5, sm: 2, md: 2.5 } }}>{children}</CardContent>
    </Card>
  );
}

function TrainingRecommendationCard({ rec, onEnroll, enrollingKey }) {
  const severityColor =
    rec.severity === "high" ? "error" : rec.severity === "medium" ? "warning" : "default";
  const enrollKey = `${rec.course_id || rec.course}-${rec.skill}`;
  const isEnrolling = enrollingKey === enrollKey;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 1.75, sm: 2 },
        borderRadius: 2.5,
        borderColor: "divider",
        height: "100%"
      }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", sm: "flex-start" }}
          justifyContent="space-between"
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            {rec.official_url ? (
              <Typography
                component="a"
                href={rec.official_url}
                target="_blank"
                rel="noopener noreferrer"
                variant="subtitle1"
                fontWeight={800}
                sx={{ color: "primary.main", textDecoration: "none", display: "block", wordBreak: "break-word" }}
              >
                {rec.course}
              </Typography>
            ) : (
              <Typography variant="subtitle1" fontWeight={800} sx={{ wordBreak: "break-word" }}>
                {rec.course}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {rec.provider || "Official provider"} · {rec.duration_weeks} wk · {rec.mode}
              {rec.certification ? " · certification" : ""}
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            disabled={isEnrolling}
            onClick={() => onEnroll(rec)}
            sx={{ flexShrink: 0 }}
          >
            {isEnrolling ? "Sending…" : "Request from HR"}
          </Button>
        </Stack>

        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`Skill: ${rec.skill}`} />
          {rec.severity ? <Chip size="small" color={severityColor} label={`${rec.severity} gap`} /> : null}
          {rec.cv_in_experience ? <Chip size="small" color="success" variant="outlined" label="CV · experience" /> : null}
        </Stack>

        <Grid container spacing={1}>
          {[
            { label: "Required", value: rec.required_level ?? "—" },
            { label: "Current", value: rec.current_level ?? "—" },
            { label: "Gap", value: rec.gap ?? "—" },
            { label: "Match", value: rec.match_pct != null ? `${rec.match_pct}%` : "—" },
            { label: "CV evidence", value: rec.cv_relevance_pct != null ? `${rec.cv_relevance_pct}%` : "—" },
            { label: "Semantic", value: rec.semantic_match_pct != null ? `${rec.semantic_match_pct}%` : "—" },
            { label: "Est. closure", value: rec.projected_gap_reduction_pct != null ? `${rec.projected_gap_reduction_pct}%` : "—" },
            { label: "Priority", value: rec.priority_score ?? "—" }
          ].map((m) => (
            <Grid item xs={6} sm={3} key={m.label}>
              <Typography variant="caption" color="text.secondary" display="block">
                {m.label}
              </Typography>
              <Typography variant="body2" fontWeight={700}>
                {m.value}
              </Typography>
            </Grid>
          ))}
        </Grid>

        <Box
          sx={{
            p: 1.5,
            borderRadius: 2,
            bgcolor: "action.hover",
            borderLeft: "3px solid",
            borderColor: "primary.main"
          }}
        >
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.4 }}>
            Why this course
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.65, wordBreak: "break-word" }}>
            {rec.rationale || "Recommended from your role skill gap profile."}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

export default function EmployeeDashboard() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = useMemo(() => {
    const s = searchParams.get("section");
    if (s && SECTION_KEYS.has(s)) return s;
    return "home";
  }, [searchParams]);
  const activeSectionLabel = useMemo(
    () => SECTIONS.find((s) => s.key === activeSection)?.label ?? "Dashboard home",
    [activeSection]
  );
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
  const [trainingMeta, setTrainingMeta] = useState(null);
  const [trainingProgress, setTrainingProgress] = useState({
    pending_requests: [],
    active_courses: [],
    completed_courses: []
  });
  const [careerPaths, setCareerPaths] = useState([]);
  const [goals, setGoals] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [complianceRequirements, setComplianceRequirements] = useState([]);
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
  const [courseViewer, setCourseViewer] = useState(null);
  const [intel, setIntel] = useState(null);
  const [jobTitles, setJobTitles] = useState([]);
  const [careerForm, setCareerForm] = useState({
    target_job_title: "",
    selected_project_ids: []
  });
  const [cvUploadFile, setCvUploadFile] = useState(null);
  const [cvBusy, setCvBusy] = useState(false);
  const [careerBusy, setCareerBusy] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });
  const [enrollingKey, setEnrollingKey] = useState("");
  const { mode } = useThemeMode();
  const { colors, tooltipStyle } = getChartTheme(mode);
  const gapChartRows = useMemo(() => (gaps?.chart || []).filter((r) => Number(r.gap) > 0).slice(0, 14), [gaps]);
  const gapTableRows = useMemo(() => {
    const rows = gaps?.gaps || [];
    return rows;
  }, [gaps]);
  const trainingCoursesWithAiLink = useMemo(() => {
    const all = [
      ...(trainingProgress.pending_requests || []),
      ...(trainingProgress.active_courses || []),
      ...(trainingProgress.completed_courses || [])
    ];
    return all.filter((c) => c.official_url);
  }, [trainingProgress]);

  const headerKpis = useMemo(() => {
    if (!overview) return [];
    const r = intel?.readiness?.vs_target_role;
    const hasMl = intel?.cv_signal?.semantic_similarity_cosine != null && intel?.engine?.sklearn_signals;
    const cvQ = intel?.cv_competency || gaps?.cv_competency;
    return [
      {
        label: "CV competency quality",
        value: cvQ?.quality_score != null ? `${cvQ.quality_score}%` : "—",
        hint: cvQ?.quality_tier
          ? `Tier: ${cvQ.quality_tier} — structure, sections, and NLP confidence on your résumé.`
          : "Upload a PDF résumé to unlock deep competency analysis."
      },
      {
        label: "Target role readiness",
        value: r?.label ? String(r.label) : "—",
        hint: "Weighted skill gaps vs your target role profile."
      },
      {
        label: "Alignment score (target)",
        value: intel?.alignment_score_target_role != null ? `${intel.alignment_score_target_role}%` : "—",
        hint: hasMl
          ? "Gap math + TF–IDF cosine vs role profile from full résumé text."
          : "Gap math only until résumé supports semantic analysis."
      },
      {
        label: "Weighted gap impact",
        value: overview.weighted_gap_impact_score != null ? overview.weighted_gap_impact_score : "—",
        hint: "Lower is better — drives training prioritization."
      }
    ];
  }, [overview, intel, gaps]);

  useEffect(() => {
    loadAll();
  }, [activeSection]);

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
    if (!s || !SECTION_KEYS.has(s)) {
      setSearchParams({ section: "home" }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function refreshTrainingProgress() {
    try {
      const prog = await api.get("/analytics/employee/training-progress");
      setTrainingProgress(
        prog.data || { pending_requests: [], active_courses: [], completed_courses: [] }
      );
    } catch {
      /* ignore — viewer still works */
    }
  }

  async function loadAll() {
      setLoading(true);
    setError("");
    try {
      const intelPromise = api.get("/analytics/employee/dashboard-intel").catch(() => ({ data: null }));
      const [ov, pr, sk, gp, proj, rec, prog, car, gl, noti, intelRes] = await Promise.all([
        api.get("/analytics/employee/overview"),
        api.get("/analytics/employee/profile"),
        api.get("/analytics/employee/skills"),
        api.get("/analytics/my-skill-gaps"),
        api.get("/analytics/employee/projects"),
        api.get("/analytics/employee/training-recommendations"),
        api.get("/analytics/employee/training-progress"),
        api.get("/analytics/employee/career-paths"),
        api.get("/analytics/employee/goals"),
        api.get("/analytics/employee/notifications"),
        intelPromise
      ]);
      const complianceRes = await api.get("/analytics/employee/compliance-requirements").catch(() => ({ data: { requirements: [] } }));
      setOverview(ov.data);
      setProfile(pr.data);
      setIntel(intelRes.data);
      const recPayload = rec.data;
      if (Array.isArray(recPayload)) {
        setRecommendations(recPayload);
        setTrainingMeta(null);
      } else {
        setRecommendations(recPayload?.recommendations || []);
        setTrainingMeta(recPayload?.cv_competency || null);
      }
      try {
        const opts = await api.get("/registration/options");
        setJobTitles(opts.data?.job_titles || []);
      } catch {
        setJobTitles([]);
      }
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
      setTrainingProgress(
        prog.data || { pending_requests: [], active_courses: [], completed_courses: [] }
      );
      setCareerPaths(car.data || []);
      setGoals(gl.data || []);
      setNotifications(noti.data || []);
      setComplianceRequirements(complianceRes.data?.requirements || []);
      setProfileEdit({
        phone_number: pr.data?.basic?.phone || "",
        country: pr.data?.basic?.country || "",
        primary_skill: pr.data?.basic?.primary_skill || "",
        headline: pr.data?.basic?.headline || ""
      });
      setCareerForm({
        target_job_title: pr.data?.career_preferences?.target_job_title ?? "",
        selected_project_ids: [...(pr.data?.career_preferences?.selected_project_ids || [])]
      });
      } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load employee analytics"));
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

  async function enrollInTraining(rec) {
    const key = `${rec.course_id || rec.course}-${rec.skill}`;
    setEnrollingKey(key);
    setError("");
    try {
      const res = await api.post("/analytics/employee/training-enroll", {
        course: rec.course,
        skill: rec.skill,
        provider: rec.provider,
        official_url: rec.official_url,
        course_id: rec.course_id
      });
      setSnackbar({
        open: true,
        message:
          res.data?.message ||
          "Enrollment request sent to HR. Track status under Training progress."
      });
      await loadAll();
    } catch (err) {
      const msg = getApiErrorMessage(err, "Failed to request training from HR");
      setSnackbar({ open: true, message: msg });
      setError(msg);
    } finally {
      setEnrollingKey("");
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

  async function saveCareerPreferences() {
    setError("");
    setCareerBusy(true);
    try {
      const trimmed = careerForm.target_job_title?.trim?.() || "";
      await api.put("/analytics/employee/career-preferences", {
        target_job_title: trimmed || null,
        selected_project_ids: careerForm.selected_project_ids
      });
      setSnackbar({ open: true, message: "Career focus saved. Intelligence views updated." });
      await loadAll();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not save career preferences"));
    } finally {
      setCareerBusy(false);
    }
  }

  function toggleTrackedOpportunity(projectId) {
    setCareerForm((f) => {
      const sid = String(projectId);
      const next = new Set(f.selected_project_ids.map(String));
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return { ...f, selected_project_ids: Array.from(next) };
    });
  }

  async function submitCvReupload() {
    if (!cvUploadFile || cvUploadFile.type !== "application/pdf") {
      setError("Please choose a PDF résumé to upload.");
      return;
    }
    setCvBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("cv", cvUploadFile);
      await api.post("/analytics/employee/cv", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setCvUploadFile(null);
      setSnackbar({ open: true, message: "Résumé processed — CV skills and narratives refreshed." });
      await loadAll();
    } catch (err) {
      setError(getApiErrorMessage(err, "Résumé upload failed"));
    } finally {
      setCvBusy(false);
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
              <Stack spacing={2}>
                <Card
                  variant="outlined"
                  sx={{
                    borderRadius: 3,
                    borderColor: "divider",
                    background: "linear-gradient(135deg, rgba(25,118,210,0.10) 0%, rgba(46,125,50,0.08) 100%)"
                  }}
                >
                  <CardContent>
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={2}
                      alignItems={{ xs: "flex-start", md: "center" }}
                      justifyContent="space-between"
                    >
                      <Box>
                        <Typography variant="overline" color="secondary.main">
                          CV-driven developmental intelligence
                        </Typography>
                        <Typography variant="h5" fontWeight={800}>
                          {intel?.narrative?.headline || "Your competency intelligence"}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 780 }}>
                          {intel?.narrative?.subtitle ||
                            "Upload your résumé and tune your career focus — the engine blends parsed competencies, verified inventory levels, HR role templates, and opportunities you prioritize."}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.25 }}>
                          Welcome, {overview?.welcome_name || "colleague"}. HR job title:{" "}
                          <strong>{intel?.positions?.hr_job_title || profile?.basic?.job_title || "—"}</strong>
                          {" · "}Target analyst lens:{" "}
                          <strong>
                            {intel?.positions?.target_job_title ||
                              intel?.positions?.hr_job_title ||
                              profile?.basic?.job_title ||
                              "—"}
                          </strong>
                        </Typography>
                      </Box>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} width={{ xs: "100%", md: "auto" }}>
                        <Button variant="outlined" fullWidth={isMobile} onClick={() => loadAll()}>
                          Refresh data
                        </Button>
                        <Button variant="contained" fullWidth={isMobile} onClick={() => setSearchParams({ section: "cvfocus" })}>
                          Résumé & career focus
                        </Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>

                <Grid container spacing={2}>
                  {headerKpis.map((k, idx) => (
                    <Grid item xs={12} sm={6} md={3} key={k.label}>
                      <Card
                        variant="outlined"
                        sx={{
                          borderRadius: 3,
                          borderColor: "divider",
                          height: "100%",
                          position: "relative",
                          overflow: "hidden",
                          background:
                            idx % 2 === 0
                              ? "linear-gradient(145deg, rgba(25,118,210,0.08) 0%, rgba(255,255,255,0.02) 100%)"
                              : "linear-gradient(145deg, rgba(46,125,50,0.08) 0%, rgba(255,255,255,0.02) 100%)"
                        }}
                      >
                        <Box
                          sx={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            height: 4,
                            width: "100%",
                            bgcolor: idx % 2 === 0 ? "secondary.main" : "primary.main"
                          }}
                        />
                        <CardContent sx={{ pt: 2 }}>
                          <Typography variant="body2" color="text.secondary">
                            {k.label}
                          </Typography>
                          <Typography variant="h5" fontWeight={900}>
                            {k.value}
                          </Typography>
                          {k.hint ? (
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75, lineHeight: 1.35 }}>
                              {k.hint}
                            </Typography>
                          ) : null}
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>

                <SectionPanel>
                  <Typography variant="h6" fontWeight={800} gutterBottom>
                    Structured AI / ML pipeline{" "}
                    <Typography component="span" variant="body2" color="text.secondary" fontWeight={500}>
                      (NLP taxonomy + classical ML where applicable)
                    </Typography>
                  </Typography>
                  <Typography variant="body2" color="text.secondary" paragraph>
                    Skills use boundary-aware NLP on your PDF plus canonical normalization. Alignment also blends deterministic gap math with scikit-learn TF–IDF cosine similarity against your target-role competency profile whenever enough résumé text is available — no pretrained LLMs, measurable and reproducible signals only.
                  </Typography>
                  <Stack component="ul" sx={{ m: 0, pl: 2.25 }}>
                    {(intel?.narrative?.bullets || []).map((line, i) => (
                      <Typography key={`b-${i}`} component="li" variant="body2" sx={{ mb: 1 }}>
                        {line}
                      </Typography>
                    ))}
                  </Stack>
                </SectionPanel>

                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <SectionPanel>
                      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                        Opportunities you prioritized
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                        Fit percentage compares your inventory to each project skill grid when managers publish explicit requirements.
                      </Typography>
                      {(intel?.selected_projects || []).length === 0 ? (
                        <Alert severity="info" icon={false}>
                          Short-list internal roles under Career focus — we surface granular fit summaries here so your dashboard mirrors the programs you genuinely want to staff.
                        </Alert>
                      ) : (
                        <Stack spacing={1.25}>
                          {(intel?.selected_projects || []).map((p) => (
                            <Paper key={p.project_id} variant="outlined" sx={{ p: 1.75, borderRadius: 2 }}>
                              <Typography fontWeight={700}>{p.name}</Typography>
                              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" sx={{ mt: 0.5 }}>
                                <Chip size="small" label={p.status || "unknown"} variant="outlined" />
                                <Typography variant="body2" color="text.secondary">
                                  Skill-grid fit{" "}
                                  <strong>{p.project_skill_fit_pct != null ? `${p.project_skill_fit_pct}%` : "N/A"}</strong>
                                  {p.project_has_skill_grid ? "" : " (no HR grid)"}
                                </Typography>
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                {p.open_slots > 0 ? `${p.open_slots} opening(s) advertised` : "Fully staffed"}
                              </Typography>
                            </Paper>
                          ))}
                        </Stack>
                      )}
                    </SectionPanel>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <SectionPanel>
                      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                        Open internal roles aligned to your profile
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                        Only projects marked active/draft with available head-count and overlapping job titles are listed.
                      </Typography>
                      {(intel?.open_opportunities || []).length === 0 ? (
                        <Alert severity="info" icon={false}>
                          Managers publish staffing demand with tagged job titles. When new opportunities match your HR or aspirational titles, they appear here instantly.
                        </Alert>
                      ) : (
                        <Stack spacing={1.25} sx={{ maxHeight: 280, overflow: "auto", pr: 0.5 }}>
                          {(intel?.open_opportunities || []).slice(0, 10).map((o) => (
                            <Paper key={o.project_id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                              <Typography fontWeight={700}>{o.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                Leader: {o.manager_name || "—"}
                              </Typography>
                              <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
                                <Chip size="small" label={`${o.open_slots} slot(s)`} />
                                {(o.required_job_titles || []).slice(0, 3).map((t) => (
                                  <Chip key={t} size="small" variant="outlined" label={t} />
                                ))}
                              </Stack>
                            </Paper>
                          ))}
                        </Stack>
                      )}
                    </SectionPanel>
                  </Grid>
                </Grid>

                <SectionPanel>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                    Readiness telemetry (dual lens)
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">
                        HR record vs. aspiration
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        Gap pressure (avg): <strong>{intel?.readiness?.vs_hr_record_role?.gap_avg ?? "—"}</strong> · Impact:{" "}
                        <strong>{intel?.readiness?.vs_hr_record_role?.weighted_impact_avg ?? "—"}</strong>
                      </Typography>
                      <Chip
                        sx={{ mt: 1 }}
                        color={
                          intel?.readiness?.vs_hr_record_role?.band === "strong"
                            ? "success"
                            : intel?.readiness?.vs_hr_record_role?.band === "developing"
                              ? "warning"
                              : intel?.readiness?.vs_hr_record_role?.band === "focus_required"
                                ? "error"
                                : "default"
                        }
                        label={intel?.readiness?.vs_hr_record_role?.label || "—"}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">
                        Target-role lens ({intel?.positions?.target_job_title || "mirrors HR if unset"})
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        Gap pressure (avg): <strong>{intel?.readiness?.vs_target_role?.gap_avg ?? "—"}</strong> · Impact:{" "}
                        <strong>{intel?.readiness?.vs_target_role?.weighted_impact_avg ?? "—"}</strong>
                      </Typography>
                      <Chip
                        sx={{ mt: 1 }}
                        color={
                          intel?.readiness?.vs_target_role?.band === "strong"
                            ? "success"
                            : intel?.readiness?.vs_target_role?.band === "developing"
                              ? "warning"
                              : "error"
                        }
                        label={intel?.readiness?.vs_target_role?.label || "—"}
                      />
                    </Grid>
                  </Grid>
                </SectionPanel>

                <SectionPanel>
                  <Typography variant="h6" fontWeight={800} gutterBottom>
                    Activity snapshot ({activeSectionLabel.toLowerCase()})
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" color="text.secondary">
                        Skill strength avg
                      </Typography>
                      <Typography variant="h6" fontWeight={800}>
                        {overview?.skill_strength_score ?? "—"}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" color="text.secondary">
                        Plain gap score
                      </Typography>
                      <Typography variant="h6" fontWeight={800}>
                        {overview?.skill_gap_score ?? "—"}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" color="text.secondary">
                        Profile completeness
                      </Typography>
                      <Typography variant="h6" fontWeight={800}>
                        {overview?.profile_completion_pct ?? 0}%
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" color="text.secondary">
                        Active trainings
                      </Typography>
                      <Typography variant="h6" fontWeight={800}>
                        {overview?.active_trainings ?? "—"}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" color="text.secondary">
                        Learning sessions live
                      </Typography>
                      <Typography variant="h6" fontWeight={800}>
                        {overview?.actively_learning_now ?? 0}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" color="text.secondary">
                        Assigned initiatives
                      </Typography>
                      <Typography variant="h6" fontWeight={800}>
                        {overview?.assigned_projects_count ?? 0} ({overview?.active_assigned_projects ?? 0} active/draft)
                      </Typography>
                    </Grid>
                  </Grid>
                </SectionPanel>
              </Stack>
            ) : null}

            {!loading && activeSection === "cvfocus" ? (
              <SectionPanel>
                <Typography variant="h6" fontWeight={800} gutterBottom>
                  Career lens & résumé signal
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Declare the position you aspire toward (must exist in HR master data) and shortlist staffing opportunities. Each save re-evaluates dashboards so metrics always trace back to CV parsing,
                  inventories, declared targets, and project skill grids.
                </Typography>
                {(intel?.cv_competency || gaps?.cv_competency) ? (
                  <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
                    <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                      Résumé competency profile
                    </Typography>
                    <Grid container spacing={2}>
                      {[
                        { label: "Quality score", value: `${(intel?.cv_competency || gaps?.cv_competency)?.quality_score}%` },
                        { label: "Tier", value: (intel?.cv_competency || gaps?.cv_competency)?.quality_tier },
                        { label: "Skills detected", value: (intel?.cv_competency || gaps?.cv_competency)?.skills_detected },
                        {
                          label: "Document confidence",
                          value: `${(intel?.cv_competency || gaps?.cv_competency)?.document_confidence_pct ?? (intel?.cv_competency || gaps?.cv_competency)?.avg_mention_confidence_pct ?? "—"}%`
                        }
                      ].map((item) => (
                        <Grid item xs={6} sm={3} key={item.label}>
                          <Typography variant="caption" color="text.secondary">
                            {item.label}
                          </Typography>
                          <Typography fontWeight={800}>{item.value ?? "—"}</Typography>
                        </Grid>
                      ))}
                    </Grid>
                  </Paper>
                ) : null}
                <Divider sx={{ my: 2 }} />
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      select
                      fullWidth
                      label="Target analyst / role lens"
                      value={careerForm.target_job_title}
                      helperText={
                        profile?.basic?.job_title ? `Blank defaults to HR title: ${profile.basic.job_title}` : "Must match HR catalog naming."
                      }
                      onChange={(e) =>
                        setCareerForm((f) => ({
                          ...f,
                          target_job_title: typeof e.target.value === "string" ? e.target.value : ""
                        }))
                      }
                    >
                      <MenuItem value="">
                        <em>Unspecified — inherit HR role</em>
                      </MenuItem>
                      {jobTitles.map((jt) => (
                        <MenuItem key={jt} value={jt}>
                          {jt}
                        </MenuItem>
                      ))}
                    </TextField>
                </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle2" gutterBottom>
                      Upload replacement résumé (PDF · max 8MB)
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
                      <Button variant="outlined" component="label" fullWidth>
                        {cvUploadFile?.name ? cvUploadFile.name : "Choose PDF"}
                        <input
                          hidden
                          type="file"
                          accept="application/pdf"
                          onChange={(e) => setCvUploadFile(e.target.files?.[0] || null)}
                        />
                      </Button>
                      <Button
                        variant="contained"
                        onClick={() => submitCvReupload()}
                        disabled={cvBusy || !cvUploadFile}
                        fullWidth
                      >
                        {cvBusy ? "Processing..." : "Re-analyze résumé"}
                      </Button>
                    </Stack>
                  </Grid>
                </Grid>
                <Divider sx={{ my: 3 }} />
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  Match internal postings to watch
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Checkbox opportunities to pin them onto your Intelligence Home. Only compatible titles with available head-count are shown below.
                </Typography>
                <Stack spacing={0.75}>
                  {(intel?.open_opportunities || []).length === 0 ? (
                    <Alert severity="info" icon={false}>
                      Nothing aligns yet — widen master job titles via HR Admin or collaborate with managers to publish demand.
                    </Alert>
                  ) : (
                    (intel?.open_opportunities || []).map((o) => (
                      <Paper key={o.project_id} variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={careerForm.selected_project_ids.includes(String(o.project_id))}
                              onChange={() => toggleTrackedOpportunity(o.project_id)}
                            />
                          }
                          label={
                            <Box>
                              <Typography fontWeight={700}>{o.name}</Typography>
                              <Typography variant="caption" display="block" color="text.secondary">
                                {o.open_slots} slot(s) · {o.manager_name}
                              </Typography>
                            </Box>
                          }
                        />
                      </Paper>
                    ))
                  )}
                </Stack>
                <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
                  <Button variant="contained" disabled={careerBusy} onClick={() => saveCareerPreferences()}>
                    {careerBusy ? "Saving..." : "Save career focus"}
                  </Button>
                </Stack>
              </SectionPanel>
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
                  <Typography variant="subtitle1" fontWeight={700}>
                    CV intelligence (from latest upload)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {profile?.cv_intel?.story_subtitle || "Upload a PDF résumé from Career focus to populate structured signals."}
                  </Typography>
                  <Stack spacing={0.75} sx={{ mb: 2 }}>
                    {(profile?.cv_intel?.analysis_bullets || []).map((b, i) => (
                      <Typography key={`pbl-${i}`} variant="body2">
                        • {b}
                      </Typography>
                    ))}
                  </Stack>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                    <Chip size="small" variant="outlined" label={`Pipeline: ${profile?.cv_intel?.pipeline || "—"}`} />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        typeof profile?.cv_intel?.parser_confidence === "number"
                          ? `Confidence ${(profile.cv_intel.parser_confidence * 100).toFixed(0)}%`
                          : "Confidence —"
                      }
                    />
                    <Chip
                      size="small"
                      color={profile?.cv_intel?.primary_skill_validated === false ? "warning" : "success"}
                      label={
                        profile?.cv_intel?.primary_skill_validated === undefined
                          ? "Primary × CV unchecked"
                          : profile?.cv_intel?.primary_skill_validated
                            ? "Primary skill mirrors CV text"
                            : "Primary wording not in résumé"
                      }
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        typeof profile?.cv_intel?.role_context_alignment?.weighted_role_alignment_pct === "number"
                          ? `Role-context alignment ${profile.cv_intel.role_context_alignment.weighted_role_alignment_pct}%`
                          : "Role-context alignment —"
                      }
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        typeof profile?.cv_intel?.role_context_alignment?.required_skill_overlap === "number" &&
                        typeof profile?.cv_intel?.role_context_alignment?.required_skill_count === "number"
                          ? `Overlap ${profile.cv_intel.role_context_alignment.required_skill_overlap}/${profile.cv_intel.role_context_alignment.required_skill_count}`
                          : "Overlap —"
                      }
                    />
                  </Stack>
                  {(profile?.cv_intel?.role_context_alignment?.selected_job_title ||
                    profile?.cv_intel?.role_context_alignment?.selected_department ||
                    profile?.cv_intel?.role_context_alignment?.selected_primary_skill) ? (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25 }}>
                      Context used: job title <strong>{profile?.cv_intel?.role_context_alignment?.selected_job_title || "—"}</strong>
                      {" · "}department <strong>{profile?.cv_intel?.role_context_alignment?.selected_department || "—"}</strong>
                      {" · "}primary skill <strong>{profile?.cv_intel?.role_context_alignment?.selected_primary_skill || "—"}</strong>
                    </Typography>
                  ) : null}
                  <Typography variant="subtitle2" sx={{ mt: 1 }}>
                    Priority missing skills for selected context
                  </Typography>
                  {(profile?.cv_intel?.role_context_alignment?.missing_priority_skills || []).length ? (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                      {(profile.cv_intel.role_context_alignment.missing_priority_skills || []).slice(0, 10).map((s) => (
                        <Chip key={`missing-${s}`} size="small" color="warning" variant="outlined" label={s} />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      No high-priority missing skills detected for the selected job/department context.
                    </Typography>
                  )}
                  <Typography variant="subtitle2">Catalog skills detected</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {(profile?.cv_preview?.skills || []).join(", ") || "No CV-derived skills detected yet."}
                  </Typography>
                  <Typography variant="subtitle2" sx={{ mt: 2 }}>
                    Suggested adjunct skills
                  </Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {(profile?.cv_intel?.suggested_skills || []).length ? (
                      (profile.cv_intel.suggested_skills || []).map((s) => <Chip key={s} size="small" label={s} />)
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Parsed CV overlaps will appear here automatically.
                      </Typography>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "skills" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Skill inventory
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Rows marked from CV ingestion stay traceable alongside self-service edits — reconcile here if recruiters adjust your competencies.
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
                    Competency comparison for <strong>{gaps?.role_context?.job_title || "your position"}</strong>
                    {gaps?.role_context?.department ? ` · ${gaps.role_context.department}` : ""} — primary skill{" "}
                    <strong>{gaps?.role_context?.primary_skill || "—"}</strong>. Blends HR role profile, validated inventory,
                    and deep résumé evidence (confidence, experience section, inferred levels).
                  </Typography>
                  {gaps?.cv_competency ? (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                      <Chip
                        size="small"
                        color={gaps.cv_competency.quality_tier === "strong" ? "success" : "default"}
                        label={`CV quality ${gaps.cv_competency.quality_score}% · ${gaps.cv_competency.quality_tier}`}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${gaps.cv_competency.skills_detected} skills detected in résumé`}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`Document confidence ${gaps.cv_competency.document_confidence_pct}%`}
                      />
                      {gaps.summary?.role_semantic_similarity_pct != null ? (
                        <Chip size="small" variant="outlined" label={`Role semantic fit ${gaps.summary.role_semantic_similarity_pct}%`} />
                      ) : null}
                    </Stack>
                  ) : null}
                  <Divider sx={{ my: 2 }} />
                  {gaps?.summary ? (
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                      <Grid item xs={6} sm={4} md={2}>
                        <Typography variant="caption" color="text.secondary">
                          Skills in scope
                        </Typography>
                        <Typography fontWeight={800}>{gaps.summary.skills_in_scope}</Typography>
                      </Grid>
                      <Grid item xs={6} sm={4} md={2}>
                        <Typography variant="caption" color="text.secondary">
                          With gap
                        </Typography>
                        <Typography fontWeight={800} color="error.main">
                          {gaps.summary.skills_with_gap}
                        </Typography>
                      </Grid>
                      <Grid item xs={6} sm={4} md={2}>
                        <Typography variant="caption" color="text.secondary">
                          Meets target
                        </Typography>
                        <Typography fontWeight={800} color="success.main">
                          {gaps.summary.skills_meeting_target}
                        </Typography>
                      </Grid>
                      <Grid item xs={6} sm={4} md={2}>
                        <Typography variant="caption" color="text.secondary">
                          High severity
                        </Typography>
                        <Typography fontWeight={800}>{gaps.summary.high_severity_gaps}</Typography>
                      </Grid>
                      <Grid item xs={6} sm={4} md={2}>
                        <Typography variant="caption" color="text.secondary">
                          Total weighted impact
                        </Typography>
                        <Typography fontWeight={800}>{gaps.summary.total_weighted_impact}</Typography>
                      </Grid>
                      <Grid item xs={6} sm={4} md={2}>
                        <Typography variant="caption" color="text.secondary">
                          Role alignment
                        </Typography>
                        <Typography fontWeight={800}>{gaps.summary.alignment_score_pct}%</Typography>
                      </Grid>
                      <Grid item xs={6} sm={4} md={2}>
                        <Typography variant="caption" color="text.secondary">
                          CV-evidenced gaps
                        </Typography>
                        <Typography fontWeight={800}>{gaps.summary.gaps_with_cv_evidence ?? 0}</Typography>
                      </Grid>
                      <Grid item xs={6} sm={4} md={2}>
                        <Typography variant="caption" color="text.secondary">
                          In experience section
                        </Typography>
                        <Typography fontWeight={800}>{gaps.summary.gaps_in_experience_section ?? 0}</Typography>
                      </Grid>
                    </Grid>
                  ) : null}
                  {gapChartRows.length === 0 ? (
                    <Alert severity="success" sx={{ mb: 2 }}>
                      All required skills meet or exceed targets for your HR role profile. Upload skills via résumé or
                      self-assessment if something is missing.
                    </Alert>
                  ) : (
                    <Box sx={{ width: "100%", height: 320, mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                        Required vs current competency (top gaps by weighted impact)
                      </Typography>
                      <ResponsiveContainer>
                        <BarChart data={gapChartRows} margin={{ top: 8, right: 12, left: 0, bottom: 48 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                          <XAxis dataKey="skill_label" tick={{ fontSize: 11 }} interval={0} angle={-28} textAnchor="end" height={70} />
                          <YAxis allowDecimals={false} domain={[0, 5]} tick={{ fontSize: 11 }} label={{ value: "Level", angle: -90, position: "insideLeft" }} />
                          <Tooltip contentStyle={tooltipStyle} />
                          <Legend />
                          <Bar dataKey="required" name="Required (HR profile)" fill={colors.danger} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="current" name="Your inventory" fill={colors.primary} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Box>
                  )}
                  {gapTableRows.length === 0 ? (
                    <Alert severity="info">Loading gap breakdown…</Alert>
                  ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Skill</TableCell>
                          <TableCell align="right">Required</TableCell>
                          <TableCell align="right">Current</TableCell>
                            <TableCell align="right">CV level</TableCell>
                          <TableCell align="right">Gap</TableCell>
                            <TableCell>CV evidence</TableCell>
                            <TableCell>Source</TableCell>
                            <TableCell align="right">Impact</TableCell>
                          <TableCell>Severity</TableCell>
                            <TableCell>Competency note</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                          {gapTableRows.map((g) => (
                            <TableRow key={g.skill} sx={{ bgcolor: g.gap > 0 ? "action.hover" : undefined }}>
                              <TableCell>
                                {g.skill}
                                {g.in_cv ? (
                                  <Chip size="small" label="on CV" variant="outlined" sx={{ ml: 0.75 }} />
                                ) : null}
                                {g.in_experience_section ? (
                                  <Chip size="small" label="experience" color="success" variant="outlined" sx={{ ml: 0.5 }} />
                                ) : null}
                              </TableCell>
                            <TableCell align="right">{g.required_level}</TableCell>
                            <TableCell align="right">{g.current_level}</TableCell>
                              <TableCell align="right">{g.cv_inferred_level ?? "—"}</TableCell>
                            <TableCell align="right">{g.gap}</TableCell>
                              <TableCell>
                                {g.cv_confidence_pct != null && g.cv_confidence_pct > 0
                                  ? `${g.cv_confidence_pct}%`
                                  : "—"}
                              </TableCell>
                              <TableCell>
                                <Chip size="small" variant="outlined" label={g.evidence_source || "—"} />
                              </TableCell>
                              <TableCell align="right">
                                {g.weighted_gap_impact != null ? Number(g.weighted_gap_impact).toFixed(2) : "—"}
                              </TableCell>
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
                              <TableCell sx={{ maxWidth: 320, whiteSpace: "normal" }}>
                                {g.competency_note || g.explanation || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  )}
                  {gaps?.explainability?.rule ? (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                      {gaps.explainability.rule} {gaps.explainability.weighted_gaps}
                    </Typography>
                  ) : null}
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
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Ranked from your role gaps using official vendor programs, full résumé TF–IDF match, per-skill CV
                    evidence (experience section weighted higher), and inventory source confidence.
                  </Typography>
                  {(trainingMeta || intel?.cv_competency) ? (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                      <Chip
                        size="small"
                        label={`CV quality ${(trainingMeta || intel?.cv_competency)?.quality_score}% · ${(trainingMeta || intel?.cv_competency)?.quality_tier}`}
                      />
                      {(trainingMeta || intel?.cv_competency)?.role_semantic_similarity_pct != null ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Role semantic ${(trainingMeta || intel?.cv_competency).role_semantic_similarity_pct}%`}
                        />
                      ) : null}
                    </Stack>
                  ) : null}
                  <Divider sx={{ my: 2 }} />
                  {recommendations.length === 0 ? (
                    <Alert severity="success">
                      No skill gaps detected against your HR role profile. Recommendations appear when required skills exceed your
                      validated inventory levels.
                    </Alert>
                  ) : null}
                  {recommendations.length > 0 ? (
                    <>
                      <Box sx={{ display: { xs: "block", lg: "none" } }}>
                        <Stack spacing={2}>
                    {recommendations.map((r, idx) => (
                            <TrainingRecommendationCard
                              key={`${r.course_id || r.course}-${idx}`}
                              rec={r}
                              onEnroll={enrollInTraining}
                              enrollingKey={enrollingKey}
                            />
                          ))}
                        </Stack>
                      </Box>

                      <TableContainer sx={{ display: { xs: "none", lg: "block" } }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Official course</TableCell>
                              <TableCell>Skill</TableCell>
                              <TableCell align="right">Req / Cur / Gap</TableCell>
                              <TableCell align="right">Match</TableCell>
                              <TableCell align="right">CV · Semantic</TableCell>
                              <TableCell align="right">Est. closure</TableCell>
                              <TableCell>Duration</TableCell>
                              <TableCell align="right">Action</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {recommendations.map((r, idx) => (
                              <React.Fragment key={`${r.course_id || r.course}-${idx}`}>
                                <TableRow hover>
                                  <TableCell sx={{ maxWidth: 260 }}>
                                    {r.official_url ? (
                                      <Typography
                                        component="a"
                                        href={r.official_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        variant="body2"
                                        fontWeight={700}
                                        sx={{ color: "primary.main", textDecoration: "none", wordBreak: "break-word" }}
                                      >
                                        {r.course}
                                      </Typography>
                                    ) : (
                                      r.course
                                    )}
                                    <Typography variant="caption" color="text.secondary" display="block">
                                      {r.provider || "—"}
                                    </Typography>
                      </TableCell>
                                  <TableCell>
                                    <Chip size="small" label={r.skill} />
                                  </TableCell>
                                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                                    {r.required_level ?? "—"} / {r.current_level ?? "—"} / {r.gap ?? "—"}
                                  </TableCell>
                                  <TableCell align="right">{r.match_pct}%</TableCell>
                                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                                    {r.cv_relevance_pct ?? 0}%{r.cv_in_experience ? " · exp" : ""} · {r.semantic_match_pct ?? "—"}%
                                  </TableCell>
                                  <TableCell align="right">{r.projected_gap_reduction_pct ?? "—"}%</TableCell>
                                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                                    {r.duration_weeks} wk · {r.mode}
                                  </TableCell>
                        <TableCell align="right">
                                    <Button
                                      size="small"
                                      variant="contained"
                                      disabled={enrollingKey === `${r.course_id || r.course}-${r.skill}`}
                                      onClick={() => enrollInTraining(r)}
                                    >
                                      {enrollingKey === `${r.course_id || r.course}-${r.skill}`
                                        ? "Sending…"
                                        : "Request from HR"}
                          </Button>
                        </TableCell>
                      </TableRow>
                                <TableRow>
                                  <TableCell colSpan={8} sx={{ py: 0, borderBottom: "1px solid", borderColor: "divider" }}>
                                    <Box
                                      sx={{
                                        py: 1.5,
                                        px: 0.5,
                                        mb: 1,
                                        borderLeft: "3px solid",
                                        borderColor: "primary.main",
                                        pl: 1.5
                                      }}
                                    >
                                      <Typography variant="caption" color="text.secondary" fontWeight={700}>
                                        Why this course
                                      </Typography>
                                      <Typography variant="body2" sx={{ mt: 0.35, lineHeight: 1.65, maxWidth: "100%" }}>
                                        {r.rationale || "—"}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                </TableRow>
                              </React.Fragment>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "progress" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Training progress tracking</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Start a <strong>learning session</strong> while you study. Open <strong>View course</strong> for HR-uploaded PDF or video — progress updates automatically from verified session time and content viewed. When progress reaches <strong>100%</strong>, click <strong>Mark complete</strong> to finish and receive your certificate.
                </Typography>
                {trainingCoursesWithAiLink.length > 0 ? (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    {trainingCoursesWithAiLink.length} course{trainingCoursesWithAiLink.length === 1 ? "" : "s"} include an{" "}
                    <strong>AI-recommended official link</strong> — look for the blue <strong>Open link</strong> button on each course card below.
                  </Alert>
                ) : null}
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle1" fontWeight={700}>Pending HR approval</Typography>
                <Stack spacing={1} sx={{ mb: 2 }}>
                  {(trainingProgress.pending_requests || []).length === 0 ? (
                    <Alert severity="info">No pending enrollment requests.</Alert>
                  ) : null}
                  {(trainingProgress.pending_requests || []).map((c) => (
                    <Card variant="outlined" key={c.id}><CardContent>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                        <Box>
                          <Typography fontWeight={700}>{c.course}</Typography>
                          <Typography variant="body2" color="text.secondary">{c.skill}</Typography>
                          <AICourseLinkPanel course={c} />
                          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                            <Chip size="small" color="warning" label="Awaiting HR approval" />
                            {c.source ? <Chip size="small" variant="outlined" label={c.source.replace(/_/g, " ")} /> : null}
                          </Stack>
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                            HR will approve your request and upload course material (PDF or video). Use the official link above to start studying while you wait.
                          </Typography>
                        </Box>
                      </Stack>
                    </CardContent></Card>
                  ))}
                </Stack>
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
                          <AICourseLinkPanel course={c} />
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
                              {c.official_url
                                ? "HR has not uploaded a course PDF or video yet. Use the official course link above while you wait, or ask HR to attach the file from their dashboard."
                                : "HR has not uploaded a course PDF or video yet. Ask HR to attach the official file from their HR dashboard."}
                            </Alert>
                          )}
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          {!c.session_active ? (
                            <Button size="small" variant="contained" color="primary" onClick={() => startLearningSession(c.id)}>Start learning session</Button>
                          ) : (
                            <Button size="small" variant="outlined" color="warning" onClick={() => endLearningSession(c.id)}>Pause / end session</Button>
                          )}
                          {(Number(c.progress_pct) || 0) >= 100 ? (
                            <Button
                            size="small"
                              variant="contained"
                              color="success"
                              onClick={() => markTrainingComplete(c.id)}
                            >
                              Mark complete
                            </Button>
                          ) : (
                            <Button size="small" variant="outlined" color="success" disabled title="Reach 100% progress first">
                              Mark complete (100% required)
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                      <Stack spacing={0.5} sx={{ mt: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          Course progress % (auto from sessions & content)
                        </Typography>
                        <LinearProgress variant="determinate" value={Number(c.progress_pct) || 0} sx={{ height: 8, borderRadius: 1 }} />
                        <Typography variant="caption" fontWeight={700}>
                          {Number(c.progress_pct) || 0}%
                          {(Number(c.progress_pct) || 0) >= 100 ? " — ready to mark complete" : ""}
                        </Typography>
                      </Stack>
                    </CardContent></Card>
                  ))}
                </Stack>
                <Typography variant="subtitle1" fontWeight={700}>Completed courses</Typography>
                <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Course</TableCell><TableCell>Skill</TableCell><TableCell>Official link</TableCell><TableCell>Certificate</TableCell><TableCell>Completed</TableCell></TableRow></TableHead><TableBody>
                  {trainingProgress.completed_courses.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.course}</TableCell>
                      <TableCell>{c.skill}</TableCell>
                      <TableCell>
                        {c.official_url ? (
                          <Typography
                            component="a"
                            href={c.official_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="body2"
                            fontWeight={600}
                            sx={{ color: "primary.main", textDecoration: "none", wordBreak: "break-all" }}
                          >
                            {c.provider || "Open course"}
                          </Typography>
                        ) : (
                          "—"
                        )}
                      </TableCell>
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
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Roles are loaded from your organization&apos;s master job-title catalog. Match % blends your skill inventory,
                  required profile per title, and scikit-learn TF–IDF similarity to your résumé.
                </Typography>
                <Divider sx={{ my: 2 }} />
                {careerPaths.length === 0 ? (
                  <Alert severity="info">No job titles in master data yet. Ask HR to add titles under Master data control.</Alert>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Role</TableCell>
                          <TableCell align="right">Match %</TableCell>
                          <TableCell align="right">ML similarity</TableCell>
                          <TableCell>Missing skills</TableCell>
                          <TableCell>Required skills</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {careerPaths.map((r) => (
                          <TableRow key={r.role} sx={{ bgcolor: r.is_current_hr_title ? "action.selected" : undefined }}>
                            <TableCell>
                              {r.role}
                              {r.is_current_hr_title ? <Chip size="small" label="Your HR title" sx={{ ml: 0.75 }} /> : null}
                            </TableCell>
                            <TableCell align="right">{r.career_match_pct}</TableCell>
                            <TableCell align="right">{r.semantic_similarity_pct != null ? `${r.semantic_similarity_pct}%` : "—"}</TableCell>
                            <TableCell>{(r.missing_skills || []).join(", ") || "—"}</TableCell>
                            <TableCell>
                              {Object.entries(r.required_skills || {})
                                .map(([k, v]) => `${k}(${v})`)
                                .join(", ")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
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
                {complianceRequirements.length > 0 ? (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                      HR certification requirements
                    </Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Required certification</TableCell>
                            <TableCell>Due date</TableCell>
                            <TableCell>HR note</TableCell>
                            <TableCell>Assigned</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {complianceRequirements.map((req) => (
                            <TableRow key={req.id}>
                              <TableCell sx={{ fontWeight: 700 }}>{req.required_certification}</TableCell>
                              <TableCell>{req.due_date || "—"}</TableCell>
                              <TableCell>{req.note || "—"}</TableCell>
                              <TableCell>{String(req.assigned_at || "").slice(0, 10)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                ) : null}
                <Stack spacing={1}>
                  {notifications.length === 0 && complianceRequirements.length === 0 ? (
                    <Alert severity="info">No notifications right now.</Alert>
                  ) : null}
                  {notifications.map((n, idx) => (
                    <Alert
                      key={`${n.type}-${idx}`}
                      severity={n.type === "compliance_requirement" ? "warning" : n.type?.includes("warning") ? "warning" : "info"}
                    >
                      {n.message}
                    </Alert>
                  ))}
                </Stack>
              </CardContent></Card>
            ) : null}
          </Grid>
        </Grid>
      </Stack>
      <Snackbar
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        open={snackbar.open}
        autoHideDuration={5200}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        message={snackbar.message}
      />
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

