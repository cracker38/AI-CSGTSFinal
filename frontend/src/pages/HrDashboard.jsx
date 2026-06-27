import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
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
import { Bar, BarChart, CartesianGrid, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../api/client";
import { exportHrDashboardReportLazy } from "../utils/dashboardReportPdfLazy";
import DashboardReportPanel from "../components/DashboardReportPanel";
import { HR_REPORTS } from "../constants/dashboardReports";
import { getChartTheme } from "../utils/chartTheme";
import { exportRowsToCsv } from "../utils/csvExport";
import { useThemeMode } from "../theme/ThemeModeContext";
import { getApiErrorMessage } from "../utils/apiError";
import { formatFrw } from "../utils/currency";

const SECTIONS = [
  { key: "home", label: "HR overview" },
  { key: "masterdata", label: "Master data control" },
  { key: "gaps", label: "Org skill gaps" },
  { key: "training", label: "Training planning & budget" },
  { key: "compliance", label: "Certification & compliance" },
  { key: "recruitment", label: "Recruitment insights" },
  { key: "pipeline", label: "Talent pipeline" },
  { key: "cv", label: "CV validation & skill verification" },
  { key: "performance", label: "Performance review support" },
  { key: "records", label: "Employee records" },
  { key: "reports", label: "Report" }
];

const HR_SECTION_KEYS = new Set(SECTIONS.map((s) => s.key));

function TrainingProgramCard({ program, onAssign }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="subtitle2" fontWeight={800} sx={{ wordBreak: "break-word" }}>
        {program.official_url ? (
          <Typography component="a" href={program.official_url} target="_blank" rel="noopener noreferrer" variant="subtitle2" fontWeight={800}>
            {program.program_name}
          </Typography>
        ) : (
          program.program_name
        )}
      </Typography>
      <Stack spacing={0.75} sx={{ mt: 1 }}>
        <Typography variant="body2" color="text.secondary">Provider: {program.provider || "—"}</Typography>
        <Typography variant="body2" color="text.secondary">Skill: {program.target_skill}</Typography>
        <Grid container spacing={1}>
          <Grid item xs={6}><Typography variant="caption" color="text.secondary">Employees needing</Typography><Typography variant="body2" fontWeight={700}>{program.employees_needing}</Typography></Grid>
          <Grid item xs={6}><Typography variant="caption" color="text.secondary">Org gap</Typography><Typography variant="body2" fontWeight={700}>{program.org_gap_units}</Typography></Grid>
          <Grid item xs={6}><Typography variant="caption" color="text.secondary">Suggested</Typography><Typography variant="body2" fontWeight={700}>{formatFrw(program.suggested_investment)}</Typography></Grid>
          <Grid item xs={6}><Typography variant="caption" color="text.secondary">Committed</Typography><Typography variant="body2" fontWeight={700}>{formatFrw(program.committed_spend)}</Typography></Grid>
        </Grid>
      </Stack>
      <Button size="small" variant="outlined" fullWidth sx={{ mt: 1.5 }} onClick={onAssign}>
        Assign employee
      </Button>
    </Paper>
  );
}

function EnrollmentRequestCard({ row, onApprove, onReject }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="subtitle2" fontWeight={800}>{row.employee_name}</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{row.employee_email}</Typography>
      <Typography variant="body2" fontWeight={600} sx={{ wordBreak: "break-word" }}>
        {row.official_url ? (
          <Typography component="a" href={row.official_url} target="_blank" rel="noopener noreferrer" variant="body2" fontWeight={600}>
            {row.program_name}
          </Typography>
        ) : (
          row.program_name
        )}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Skill: {row.target_skill} · {row.provider || "—"}</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        Requested: {row.requested_at ? new Date(row.requested_at).toLocaleString() : row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" variant="contained" fullWidth onClick={onApprove}>Approve & upload</Button>
        <Button size="small" color="error" variant="outlined" fullWidth onClick={onReject}>Reject</Button>
      </Stack>
    </Paper>
  );
}

function LiveTrainingAssignmentCard({ row, progressValue, onProgressChange, onUploadClick, onSaveProgress, onMarkComplete }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="subtitle2" fontWeight={800}>{row.employee_name}</Typography>
      <Typography variant="caption" color="text.secondary" display="block">{row.employee_email}</Typography>
      <Divider sx={{ my: 1.25 }} />
      <Stack spacing={0.75}>
        <Typography variant="body2"><strong>Course:</strong> {row.program_name}</Typography>
        <Typography variant="body2"><strong>Skill:</strong> {row.target_skill}</Typography>
        <Typography variant="body2"><strong>Status:</strong> {row.status}</Typography>
        <Typography variant="body2"><strong>Attendance:</strong> {(row.attendance_tier || "—").replace(/_/g, " ")}</Typography>
        <Typography variant="body2"><strong>Time on course:</strong> {row.total_learning_display || "0s"}</Typography>
        <Typography variant="body2"><strong>Live session:</strong> {row.session_active ? "Yes" : "No"}</Typography>
      </Stack>
      <TextField
        size="small"
        fullWidth
        label="Progress %"
        type="number"
        inputProps={{ min: 0, max: 100 }}
        value={progressValue}
        onChange={(e) => onProgressChange(Number(e.target.value))}
        sx={{ mt: 1.5 }}
      />
      <Button
        size="small"
        fullWidth
        variant={row.course_material_filename ? "outlined" : "contained"}
        color="primary"
        startIcon={<CloudUploadIcon fontSize="small" />}
        sx={{ mt: 1.5 }}
        onClick={onUploadClick}
      >
        {row.course_material_filename ? "Replace PDF/video" : "Upload PDF/video"}
      </Button>
      {row.course_material_filename ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
          File: {row.course_material_filename}
        </Typography>
      ) : null}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" variant="outlined" fullWidth onClick={onSaveProgress}>Save progress</Button>
        <Button size="small" variant="contained" color="success" fullWidth onClick={onMarkComplete}>Mark complete</Button>
      </Stack>
    </Paper>
  );
}

export default function HrDashboard() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const trainingMaterialFileRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // URL is the source of truth for the active tab (avoids useEffect loops between searchParams and state).
  const activeSection = useMemo(() => {
    const s = searchParams.get("section");
    if (s && HR_SECTION_KEYS.has(s)) return s;
    return "home";
  }, [searchParams]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [pending, setPending] = useState([]);
  const [records, setRecords] = useState([]);
  const [managers, setManagers] = useState([]);
  const [managerAssignments, setManagerAssignments] = useState({});
  const [kpis, setKpis] = useState(null);
  const [skills, setSkills] = useState([]);
  const [topGaps, setTopGaps] = useState([]);
  const [gapTable, setGapTable] = useState([]);
  const [gapSeverity, setGapSeverity] = useState({ HIGH: 0, MEDIUM: 0, LOW: 0 });
  const [deptGaps, setDeptGaps] = useState([]);
  const [cvValidation, setCvValidation] = useState([]);
  const [cvPendingCount, setCvPendingCount] = useState(0);
  const [trainingPlan, setTrainingPlan] = useState({
    budget: { committed_spend: 0, recommended_investment: 0, uncommitted_recommendation: 0 },
    programs: [],
    training_completion_rate_pct: 0,
    assignment_stats: { total: 0, active: 0, completed: 0 }
  });
  const [complianceData, setComplianceData] = useState({ rows: [], alerts: { expiring_soon: 0, missing: 0 } });
  const [recruitmentData, setRecruitmentData] = useState({ missing_skills: [], hiring_suggestions: [] });
  const [pipelineData, setPipelineData] = useState({ rows: [] });
  const [performanceData, setPerformanceData] = useState({ rows: [] });
  const [hrOverview, setHrOverview] = useState(null);
  const [recentHrActions, setRecentHrActions] = useState([]);
  const [masterCatalog, setMasterCatalog] = useState({ departments: [], job_titles: [], primary_skills: [] });
  const [masterCatalogAdmin, setMasterCatalogAdmin] = useState({ departments: [], job_titles: [], primary_skills: [] });
  const [catalogRequests, setCatalogRequests] = useState([]);
  const [newDepartment, setNewDepartment] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newPrimarySkill, setNewPrimarySkill] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });
  const [cvDialog, setCvDialog] = useState(null);
  const [cvNote, setCvNote] = useState("");
  const [cvViewer, setCvViewer] = useState(null);
  const [trainingDialog, setTrainingDialog] = useState(null);
  const [trainingUserId, setTrainingUserId] = useState("");
  const [trainingNote, setTrainingNote] = useState("");
  const [trainingMaterialsEdit, setTrainingMaterialsEdit] = useState(null);
  const [complianceDialog, setComplianceDialog] = useState(null);
  const [complianceUntil, setComplianceUntil] = useState("");
  const [complianceDueDate, setComplianceDueDate] = useState("");
  const [complianceNote, setComplianceNote] = useState("");
  const [complianceRequiredCert, setComplianceRequiredCert] = useState("");
  const [promotionDialog, setPromotionDialog] = useState(null);
  const [promotionNote, setPromotionNote] = useState("");
  const [hrOpenTrainings, setHrOpenTrainings] = useState([]);
  const [hrPendingEnrollments, setHrPendingEnrollments] = useState([]);
  const [hrTrainPct, setHrTrainPct] = useState({});
  const [reportDownloadingId, setReportDownloadingId] = useState("");
  const { mode } = useThemeMode();
  const { colors, tooltipStyle } = getChartTheme(mode);
  const activeSectionLabel = useMemo(
    () => SECTIONS.find((s) => s.key === activeSection)?.label ?? "HR overview",
    [activeSection]
  );

  async function load({ silent = false } = {}) {
    if (initialLoading) {
      setInitialLoading(true);
    } else if (!silent) {
      setRefreshing(true);
    }
    setError("");
    try {
      const pRes = await api.get("/admin/users/pending");
      setPending(pRes.data);
      const rRes = await api.get("/admin/users/records");
      setRecords(rRes.data || []);
      const mRes = await api.get("/admin/users/managers");
      setManagers(mRes.data || []);
      const initialAssignments = {};
      (rRes.data || []).forEach((u) => {
        initialAssignments[u.id] = u.manager_id ? String(u.manager_id) : "";
      });
      setManagerAssignments(initialAssignments);
      const sRes = await api.get("/analytics/org/skills/distribution");
      setSkills(sRes.data?.top_skills || []);
      const gRes = await api.get("/analytics/hr/skill-gaps");
      setGapTable(gRes.data?.rows || []);
      setGapSeverity(gRes.data?.severity_breakdown || { HIGH: 0, MEDIUM: 0, LOW: 0 });
      setTopGaps(
        (gRes.data?.rows || []).slice(0, 20).map((r) => ({
          skill: r.skill,
          total_gap: r.gap
        }))
      );
      const dRes = await api.get("/analytics/hr/skill-gaps/by-department");
      setDeptGaps(dRes.data?.rows || []);
      const oRes = await api.get("/analytics/org/kpis");
      setKpis(oRes.data);
      const cvRes = await api.get("/analytics/hr/cv-validation");
      setCvValidation(cvRes.data?.rows || []);
      setCvPendingCount(Number(cvRes.data?.pending_count) || 0);
      const trRes = await api.get("/analytics/hr/training-planning");
      const trData = trRes.data || {};
      if (trData.budget?.total != null && trData.budget?.committed_spend == null) {
        setError(
          "Training API returned an old response shape. Restart the backend (uvicorn) and hard-refresh the browser (Ctrl+Shift+R)."
        );
      }
      setTrainingPlan({
        budget: trData.budget || {
          committed_spend: 0,
          recommended_investment: 0,
          uncommitted_recommendation: 0
        },
        programs: trData.programs || [],
        training_completion_rate_pct: trData.training_completion_rate_pct ?? 0,
        assignment_stats: trData.assignment_stats || { total: 0, active: 0, completed: 0 },
        engine: trData.engine || null
      });
      const trainOpenRes = await api.get("/analytics/hr/training-assignments");
      setHrOpenTrainings(trainOpenRes.data || []);
      const pendingEnrollRes = await api.get("/analytics/hr/training-enrollment-requests");
      setHrPendingEnrollments(pendingEnrollRes.data || []);
      const cRes = await api.get("/analytics/hr/compliance");
      setComplianceData(cRes.data || { rows: [], alerts: { expiring_soon: 0, missing: 0 } });
      const recRes = await api.get("/analytics/hr/recruitment-insights");
      setRecruitmentData(recRes.data || { missing_skills: [], hiring_suggestions: [] });
      const pRes2 = await api.get("/analytics/hr/talent-pipeline");
      setPipelineData(pRes2.data || { rows: [] });
      const perfRes = await api.get("/analytics/hr/performance-support");
      setPerformanceData(perfRes.data || { rows: [] });
      const ovRes = await api.get("/analytics/hr/overview");
      setHrOverview(ovRes.data || null);
      const actRes = await api.get("/analytics/hr/actions/recent");
      setRecentHrActions(actRes.data || []);
      const catalogRes = await api.get("/master-data/catalog");
      setMasterCatalog(catalogRes.data || { departments: [], job_titles: [], primary_skills: [] });
      const catalogAdminRes = await api.get("/master-data/catalog-admin");
      setMasterCatalogAdmin(catalogAdminRes.data || { departments: [], job_titles: [], primary_skills: [] });
      const requestsRes = await api.get("/master-data/requests");
      setCatalogRequests(requestsRes.data || []);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load HR view"));
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, [activeSection]);

  // Normalize missing or invalid ?section= so the URL always matches a known tab (replace only).
  useEffect(() => {
    const s = searchParams.get("section");
    if (!s || !HR_SECTION_KEYS.has(s)) {
      setSearchParams({ section: "home" }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function approve(userId) {
    setError("");
    try {
      await api.post(`/admin/users/${userId}/approve`);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Approval failed"));
    }
  }

  async function assignManager(userId) {
    setError("");
    try {
      const managerId = managerAssignments[userId] || null;
      await api.post(`/admin/users/${userId}/assign-manager`, { manager_id: managerId || null });
      toastOk("Manager assignment updated.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to assign manager"));
    }
  }

  const activeEmployees = useMemo(
    () => records.filter((r) => r.role === "employee" && r.status === "active"),
    [records]
  );

  function toastOk(message) {
    setSnackbar({ open: true, message });
  }

  async function submitCvDecision() {
    if (!cvDialog) return;
    setError("");
    try {
      await api.post("/analytics/hr/actions/cv-validation", {
        user_id: cvDialog.userId,
        decision: cvDialog.decision,
        note: cvNote.trim() || null
      });
      setCvDialog(null);
      setCvNote("");
      toastOk(cvDialog.decision === "approve" ? "Primary skill approved." : "Mismatch recorded (rejected).");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "CV decision failed"));
    }
  }

  async function hrUpdateTrainingAssignment(actionId, body) {
    setError("");
    try {
      await api.patch(`/analytics/hr/training-assignments/${actionId}`, body);
      toastOk("Training assignment updated.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Training update failed"));
    }
  }

  async function approveEnrollmentRequest(row) {
    setError("");
    try {
      await api.post(`/analytics/hr/training-enrollment-requests/${row.id}/approve`, { note: "" });
      toastOk("Enrollment approved. Upload PDF/video so the employee can open the course.");
      setTrainingMaterialsEdit({
        id: row.id,
        label: `${row.employee_name} — ${row.program_name}`,
        filename: "",
        kind: ""
      });
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to approve enrollment"));
    }
  }

  async function rejectEnrollmentRequest(row) {
    setError("");
    try {
      await api.post(`/analytics/hr/training-enrollment-requests/${row.id}/reject`, {
        note: "Not approved at this time."
      });
      toastOk("Enrollment request rejected.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to reject enrollment"));
    }
  }

  async function uploadTrainingCourseMaterial() {
    if (!trainingMaterialsEdit) return;
    const file = trainingMaterialFileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF or video file to upload.");
      return;
    }
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/analytics/hr/training-assignments/${trainingMaterialsEdit.id}/course-material`, fd);
      if (trainingMaterialFileRef.current) trainingMaterialFileRef.current.value = "";
      setTrainingMaterialsEdit(null);
      toastOk("Course material uploaded (PDF or video).");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Upload failed (only PDF, MP4, WebM, MOV; max 80 MB)."));
    }
  }

  async function hrDownloadCourseMaterial(actionId, filename) {
    setError("");
    try {
      const res = await api.get(`/analytics/hr/training-assignments/${actionId}/course-material`, {
        responseType: "blob"
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "course-material";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(getApiErrorMessage(err, "Download failed"));
    }
  }

  function closeCvViewer() {
    if (cvViewer?.blobUrl) URL.revokeObjectURL(cvViewer.blobUrl);
    setCvViewer(null);
  }

  async function hrViewEmployeeCv(userId, displayName, filename) {
    setError("");
    if (cvViewer?.blobUrl) URL.revokeObjectURL(cvViewer.blobUrl);
    setCvViewer({ loading: true, title: displayName || "Employee CV", blobUrl: null });
    try {
      const res = await api.get(`/analytics/hr/employees/${userId}/cv`, { responseType: "blob" });
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setCvViewer({
        loading: false,
        title: filename ? `${displayName} — ${filename}` : `${displayName} — official CV`,
        blobUrl: url
      });
    } catch (err) {
      closeCvViewer();
      setError(getApiErrorMessage(err, "Could not load official CV"));
    }
  }

  async function submitTrainingAssign() {
    if (!trainingDialog || !trainingUserId) return;
    setError("");
    const programName = trainingDialog.program_name;
    const targetSkill = trainingDialog.target_skill;
    const userId = trainingUserId;
    const emp = activeEmployees.find((u) => String(u.id) === String(userId));
    try {
      const res = await api.post("/analytics/hr/actions/training-assign", {
        user_id: userId,
        program_name: programName,
        target_skill: targetSkill,
        estimated_cost: trainingDialog.cost != null ? Number(trainingDialog.cost) : null,
        note: trainingNote.trim() || null,
        official_url: trainingDialog.official_url || null,
        provider: trainingDialog.provider || null
      });
      const newId = res.data?.id;
      setTrainingDialog(null);
      setTrainingUserId("");
      setTrainingNote("");
      toastOk("Assignment saved. Upload the course PDF or video next.");
      await load();
      if (newId) {
        setTrainingMaterialsEdit({
          id: String(newId),
          label: `${emp?.full_name || "Employee"} — ${programName}`,
          filename: "",
          kind: ""
        });
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Training assignment failed"));
    }
  }

  async function submitComplianceRenewal() {
    if (!complianceDialog) return;
    setError("");
    const isMissing = complianceDialog.isMissing || complianceDialog.certification === "None";
    if (isMissing && !complianceRequiredCert.trim()) {
      setError("Enter the required certification name for this employee.");
      return;
    }
    if (isMissing && !complianceDueDate.trim()) {
      setError("Enter a due date for the required certification.");
      return;
    }
    try {
      const payload = {
        user_id: complianceDialog.userId,
        certification: complianceDialog.certification,
        note: complianceNote.trim() || null
      };
      if (isMissing) {
        payload.required_certification = complianceRequiredCert.trim();
        payload.due_date = complianceDueDate.trim();
      } else {
        payload.renewed_until = complianceUntil.trim() ? complianceUntil.trim() : null;
      }
      await api.post("/analytics/hr/actions/compliance-renewal", payload);
      setComplianceDialog(null);
      setComplianceUntil("");
      setComplianceDueDate("");
      setComplianceNote("");
      setComplianceRequiredCert("");
      toastOk(isMissing ? "Required certification assigned to employee." : "Compliance renewal recorded.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Compliance update failed"));
    }
  }

  async function submitPromotionRecommend() {
    if (!promotionDialog) return;
    setError("");
    try {
      await api.post("/analytics/hr/actions/promotion-recommend", {
        user_id: promotionDialog.userId,
        readiness_score: promotionDialog.readiness_score ?? null,
        note: promotionNote.trim() || null
      });
      setPromotionDialog(null);
      setPromotionNote("");
      toastOk("Promotion recommendation recorded.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not save recommendation"));
    }
  }

  async function addDepartment() {
    if (!newDepartment.trim()) return;
    setError("");
    try {
      await api.post("/master-data/departments", { name: newDepartment.trim(), active: true });
      setNewDepartment("");
      toastOk("Department added.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not add department"));
    }
  }

  async function addJobTitle() {
    if (!newJobTitle.trim()) return;
    setError("");
    try {
      await api.post("/master-data/job-titles", { name: newJobTitle.trim(), active: true });
      setNewJobTitle("");
      toastOk("Job title added.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not add job title"));
    }
  }

  async function reviewRequest(requestId, statusValue) {
    setError("");
    try {
      await api.post(`/master-data/requests/${requestId}/review`, { status: statusValue });
      toastOk(`Request ${statusValue}.`);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not update request"));
    }
  }

  async function addPrimarySkill() {
    if (!newPrimarySkill.trim()) return;
    setError("");
    try {
      await api.post("/master-data/skills", { name: newPrimarySkill.trim(), active: true });
      setNewPrimarySkill("");
      toastOk("Primary skill added.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not add primary skill"));
    }
  }

  async function renameCatalogItem(type, id, currentName, active = true) {
    const nextName = window.prompt(`Update ${type} name`, currentName);
    if (!nextName || !nextName.trim() || nextName.trim() === currentName) return;
    setError("");
    try {
      await api.patch(`/master-data/${type}/${id}`, { name: nextName.trim(), active });
      toastOk(`${type} updated.`);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, `Could not update ${type}`));
    }
  }

  async function toggleCatalogActive(type, row) {
    setError("");
    try {
      await api.patch(`/master-data/${type}/${row.id}`, { name: row.name, active: !row.active });
      toastOk(`${type} ${row.active ? "deactivated" : "activated"}.`);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, `Could not update ${type} status`));
    }
  }

  async function deleteCatalogItem(type, id) {
    if (!window.confirm(`Delete this ${type}?`)) return;
    setError("");
    try {
      await api.delete(`/master-data/${type}/${id}`);
      toastOk(`${type} deleted.`);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, `Could not delete ${type}`));
    }
  }

  const headerKpis = useMemo(
    () => [
      { label: "Total employees", value: records.filter((r) => r.role === "employee").length },
      { label: "Departments", value: new Set(records.filter((r) => r.role === "employee").map((r) => r.department)).size },
      { label: "Pending approvals", value: pending.length },
      { label: "Open org gaps", value: topGaps.length }
    ],
    [records, pending.length, topGaps.length]
  );

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.job_title.toLowerCase().includes(q)
    );
  }, [records, search]);

  const filteredGapTable = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return gapTable;
    return gapTable.filter((r) => String(r.skill).toLowerCase().includes(q));
  }, [gapTable, search]);

  const severityChartData = useMemo(
    () => [
      { name: "High", value: gapSeverity.HIGH || 0 },
      { name: "Medium", value: gapSeverity.MEDIUM || 0 },
      { name: "Low", value: gapSeverity.LOW || 0 }
    ],
    [gapSeverity]
  );

  const trainingBudget = trainingPlan?.budget || {
    committed_spend: 0,
    recommended_investment: 0,
    uncommitted_recommendation: 0
  };

  const overviewMetrics = useMemo(() => {
    const employees = records.filter((r) => r.role === "employee");
    const departments = new Set(employees.map((r) => r.department)).size;
    const activeProjects = hrOverview?.active_projects != null ? Number(hrOverview.active_projects) : 0;
    const gapsCount = topGaps.length;
    const trainingInProgress =
      hrOverview?.training_in_progress != null
        ? Number(hrOverview.training_in_progress)
        : Number(trainingPlan?.assignment_stats?.active || hrOpenTrainings.length || 0);
    const certificationsExpiringSoon = complianceData?.alerts?.expiring_soon || 0;
    return {
      totalEmployees: employees.length,
      departments,
      activeProjects,
      gapsCount,
      trainingInProgress,
      certificationsExpiringSoon
    };
  }, [records, topGaps, trainingPlan, complianceData, hrOverview, hrOpenTrainings.length]);

  const recruitmentInsights = useMemo(() => {
    const employeeCount = (kpis?.users_by_role?.employee ?? 0) || records.filter((r) => r.role === "employee").length;
    const openDemand = recruitmentData?.missing_skills || [];
    return {
      employeeCount,
      openDemand,
      hiringPriority: openDemand.map((g) => g.skill)
    };
  }, [kpis, records, recruitmentData]);

  async function downloadReport(report) {
    setReportDownloadingId(report.id);
    setError("");
    try {
      await exportHrDashboardReportLazy(
        {
          section: "reports",
          sectionLabel: report.title,
          reportType: report.id,
          reportTitle: report.title,
          reportSubtitle: report.description,
          headerKpis,
          overviewMetrics,
          kpis,
          records,
          pending,
          managers,
          gapTable,
          deptGaps,
          gapSeverity,
          complianceData,
          trainingPlan,
          hrOpenTrainings,
          hrPendingEnrollments,
          cvValidation,
          cvPendingCount,
          recruitmentData,
          pipelineData,
          performanceData,
          recentHrActions,
          topGaps
        },
        report.filename
      );
      toastOk(`${report.title} downloaded.`);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not generate report PDF"));
    } finally {
      setReportDownloadingId("");
    }
  }

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

  return (
    <AppShell title="HR Dashboard">
      <Stack spacing={2}>
        {refreshing ? <LinearProgress /> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {lastFetchedAt ? (
          <Alert severity="info" sx={{ py: 0.5 }}>
            Live data from server — last refreshed {lastFetchedAt.toLocaleTimeString()}
            {trainingPlan?.engine ? ` · engine ${trainingPlan.engine}` : ""}.
            {activeSection === "training" && trainingPlan?.budget?.total != null
              ? " You may be viewing a cached old page — use Ctrl+Shift+R."
              : ""}
          </Alert>
        ) : null}

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
              spacing={1.2}
              alignItems={{ xs: "flex-start", md: "center" }}
              justifyContent="space-between"
            >
              <Box>
                <Typography variant="h5" fontWeight={800}>
                  HR Intelligence Command Center
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Workforce operations and analytics for <strong>{activeSectionLabel}</strong>.
                </Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} width={{ xs: "100%", md: "auto" }}>
                <Button variant="outlined" onClick={() => load()} disabled={refreshing} fullWidth={isMobile}>
                  {refreshing ? "Refreshing…" : "Refresh data"}
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
                  <Typography variant="h4" fontWeight={900}>
                    {k.value}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={2}>
          <Grid item xs={12}>
            {initialLoading ? (
              <SectionPanel>
                <Stack direction="row" spacing={2} alignItems="center">
                  <CircularProgress size={22} />
                  <Typography>Loading HR analytics...</Typography>
                </Stack>
              </SectionPanel>
            ) : null}

            {!initialLoading && activeSection === "home" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Home (HR overview)
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Quick snapshot of current workforce status across the organization.
                  </Typography>
                  <Divider sx={{ my: 2 }} />

                  <Grid container spacing={2} sx={{ mb: 1 }}>
                    <Grid item xs={12} sm={6} md={4}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Total employees
                          </Typography>
                          <Typography variant="h4" fontWeight={900}>
                            {overviewMetrics.totalEmployees}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Departments
                          </Typography>
                          <Typography variant="h4" fontWeight={900}>
                            {overviewMetrics.departments}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Active projects
                          </Typography>
                          <Typography variant="h4" fontWeight={900}>
                            {overviewMetrics.activeProjects}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Pending project module integration
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>

                  <Grid container spacing={2}>
                    <Grid item xs={12} md={4}>
                      <Alert severity="warning">Number of skill gaps: {overviewMetrics.gapsCount}</Alert>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Alert severity="info">Training in progress: {overviewMetrics.trainingInProgress}</Alert>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Alert severity="error">Certifications expiring soon: {overviewMetrics.certificationsExpiringSoon}</Alert>
                    </Grid>
                  </Grid>

                  <Divider sx={{ my: 2 }} />
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
                        Skill distribution
                      </Typography>
                      <Box sx={{ width: "100%", height: 260 }}>
                        <ResponsiveContainer>
                          <BarChart data={skills.slice(0, 12)}>
                            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
                            <XAxis dataKey="skill" hide />
                            <YAxis />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Legend />
                            <Bar dataKey="count" fill={colors.primary} name="Employees" />
                          </BarChart>
                        </ResponsiveContainer>
                      </Box>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
                        Gap severity
                      </Typography>
                      <Box sx={{ width: "100%", height: 260 }}>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie data={severityChartData} dataKey="value" nameKey="name" outerRadius={90} label />
                            <Tooltip contentStyle={tooltipStyle} />
                          </PieChart>
                        </ResponsiveContainer>
                      </Box>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
                        Department comparison
                      </Typography>
                      <Box sx={{ width: "100%", height: 260 }}>
                        <ResponsiveContainer>
                          <BarChart data={deptGaps.slice(0, 10)} layout="vertical">
                            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
                            <XAxis type="number" />
                            <YAxis type="category" dataKey="department" width={90} />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Bar dataKey="gap_score" fill={colors.warning} name="Gap score" />
                          </BarChart>
                        </ResponsiveContainer>
                      </Box>
                    </Grid>
                  </Grid>

                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
                    Recent HR decisions
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Logged in the database and mirrored to the system audit trail.
                  </Typography>
                  {recentHrActions.length === 0 ? (
                    <Alert severity="info">No HR actions recorded yet.</Alert>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>When</TableCell>
                            <TableCell>Action</TableCell>
                            <TableCell>Target user</TableCell>
                            <TableCell>Note</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {recentHrActions.slice(0, 12).map((a) => (
                            <TableRow key={a.id}>
                              <TableCell>{a.created_at ? String(a.created_at).slice(0, 19) : "—"}</TableCell>
                              <TableCell>{a.action_type?.replace(/_/g, " ")}</TableCell>
                              <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{a.target_user_id}</TableCell>
                              <TableCell sx={{ maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {a.note || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {!initialLoading && activeSection === "records" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Organization-wide employee records
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Only accounts with the Employee role (self-registration + CV onboarding). HR, Manager, and Executive accounts are not listed here.
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <TextField size="small" label="Search records" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2 }} />
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Email</TableCell>
                          <TableCell>Department</TableCell>
                          <TableCell>Job title</TableCell>
                          <TableCell>Manager</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredRecords.map((u) => (
                          <TableRow key={u.id}>
                            <TableCell>{u.full_name}</TableCell>
                            <TableCell>{u.email}</TableCell>
                            <TableCell>{u.department}</TableCell>
                            <TableCell>{u.job_title}</TableCell>
                            <TableCell sx={{ minWidth: 220 }}>
                              <FormControl size="small" fullWidth>
                                <InputLabel>Manager</InputLabel>
                                <Select
                                  label="Manager"
                                  value={managerAssignments[u.id] ?? ""}
                                  onChange={(e) =>
                                    setManagerAssignments((prev) => ({ ...prev, [u.id]: e.target.value }))
                                  }
                                >
                                  <MenuItem value="">Unassigned</MenuItem>
                                  {managers.map((m) => (
                                    <MenuItem key={m.id} value={m.id}>
                                      {m.name}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </TableCell>
                            <TableCell>{u.status}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => hrViewEmployeeCv(u.id, u.full_name, null)}
                                >
                                  View CV
                                </Button>
                                <Button size="small" variant="outlined" onClick={() => assignManager(u.id)}>
                                  Save
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle1" fontWeight={700}>
                    Pending approval queue
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Self-registered employees only (same as the public registration form).
                  </Typography>
                  {pending.length === 0 ? <Alert severity="info">No pending records.</Alert> : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Email</TableCell>
                            <TableCell>Department</TableCell>
                            <TableCell>Role</TableCell>
                            <TableCell align="right">Action</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {pending.map((u) => (
                            <TableRow key={u.id}>
                              <TableCell>{u.full_name}</TableCell>
                              <TableCell>{u.email}</TableCell>
                              <TableCell>{u.department}</TableCell>
                              <TableCell>{u.role}</TableCell>
                              <TableCell align="right">
                                <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => hrViewEmployeeCv(u.id, u.full_name, null)}
                                  >
                                    View CV
                                  </Button>
                                  <Button size="small" variant="contained" onClick={() => approve(u.id)}>
                                    Approve
                                  </Button>
                                </Stack>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {!initialLoading && activeSection === "masterdata" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Master data control (HR)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    HR can manage departments and job titles, and review manager requests.
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12} md={6}>
                      <Stack direction="row" spacing={1}>
                        <TextField size="small" label="New department" value={newDepartment} onChange={(e) => setNewDepartment(e.target.value)} fullWidth />
                        <Button variant="contained" onClick={addDepartment}>Add</Button>
                      </Stack>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Stack direction="row" spacing={1}>
                        <TextField size="small" label="New job title" value={newJobTitle} onChange={(e) => setNewJobTitle(e.target.value)} fullWidth />
                        <Button variant="contained" onClick={addJobTitle}>Add</Button>
                      </Stack>
                    </Grid>
                    <Grid item xs={12}>
                      <Stack direction="row" spacing={1}>
                        <TextField size="small" label="New primary skill" value={newPrimarySkill} onChange={(e) => setNewPrimarySkill(e.target.value)} fullWidth />
                        <Button variant="contained" onClick={addPrimarySkill}>Add</Button>
                      </Stack>
                    </Grid>
                  </Grid>
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12} md={4}>
                      <Alert severity="info">Departments: {masterCatalog.departments.length}</Alert>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Alert severity="info">Job titles: {masterCatalog.job_titles.length}</Alert>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Alert severity="info">Primary skills: {masterCatalog.primary_skills.length}</Alert>
                    </Grid>
                  </Grid>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    Manager requests
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Type</TableCell>
                          <TableCell>Value</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {catalogRequests.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>{r.request_type}</TableCell>
                            <TableCell>{r.value}</TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell align="right">
                              {r.status === "pending" ? (
                                <Stack direction="row" spacing={1} justifyContent="flex-end">
                                  <Button size="small" variant="outlined" color="success" onClick={() => reviewRequest(r.id, "approved")}>Approve</Button>
                                  <Button size="small" variant="outlined" color="error" onClick={() => reviewRequest(r.id, "rejected")}>Reject</Button>
                                </Stack>
                              ) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    Departments (view / update / delete)
                  </Typography>
                  <TableContainer sx={{ mb: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {masterCatalogAdmin.departments.map((d) => (
                          <TableRow key={d.id}>
                            <TableCell>{d.name}</TableCell>
                            <TableCell>{d.active ? "active" : "inactive"}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button size="small" variant="outlined" onClick={() => renameCatalogItem("departments", d.id, d.name, d.active)}>Rename</Button>
                                <Button size="small" variant="outlined" onClick={() => toggleCatalogActive("departments", d)}>{d.active ? "Deactivate" : "Activate"}</Button>
                                <Button size="small" color="error" variant="outlined" onClick={() => deleteCatalogItem("departments", d.id)}>Delete</Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    Job Titles (view / update / delete)
                  </Typography>
                  <TableContainer sx={{ mb: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {masterCatalogAdmin.job_titles.map((j) => (
                          <TableRow key={j.id}>
                            <TableCell>{j.name}</TableCell>
                            <TableCell>{j.active ? "active" : "inactive"}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button size="small" variant="outlined" onClick={() => renameCatalogItem("job-titles", j.id, j.name, j.active)}>Rename</Button>
                                <Button size="small" variant="outlined" onClick={() => toggleCatalogActive("job-titles", j)}>{j.active ? "Deactivate" : "Activate"}</Button>
                                <Button size="small" color="error" variant="outlined" onClick={() => deleteCatalogItem("job-titles", j.id)}>Delete</Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    Primary Skills (view / update / delete)
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {masterCatalogAdmin.primary_skills.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>{s.name}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button size="small" variant="outlined" onClick={() => renameCatalogItem("skills", s.id, s.name, true)}>Rename</Button>
                                <Button size="small" color="error" variant="outlined" onClick={() => deleteCatalogItem("skills", s.id)}>Delete</Button>
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

            {!initialLoading && activeSection === "training" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Training planning & budget tracking
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Committed spend is summed from real HR training assignments in the database (amounts in FRW). Recommended investment is
                    calculated from organization skill gaps and official vendor course durations — not fixed demo budgets.
                  </Typography>
                  {refreshing ? <LinearProgress sx={{ mt: 1.5 }} /> : null}
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                    {lastFetchedAt ? (
                      <Chip size="small" variant="outlined" label={`Updated ${lastFetchedAt.toLocaleTimeString()}`} />
                    ) : null}
                    {trainingPlan?.engine ? (
                      <Chip size="small" color="success" variant="outlined" label={trainingPlan.engine} />
                    ) : null}
                  </Stack>
                  <Divider sx={{ my: 2 }} />
                  <Grid container spacing={2} sx={{ mb: 1 }}>
                    <Grid item xs={12} md={4}>
                      <Alert severity="success">
                        Committed spend (DB): {formatFrw(trainingBudget.committed_spend)}
                      </Alert>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Alert severity="info">
                        Recommended plan: {formatFrw(trainingBudget.recommended_investment)}
                      </Alert>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Alert severity="warning">
                        Not yet committed: {formatFrw(trainingBudget.uncommitted_recommendation)}
                      </Alert>
                    </Grid>
                  </Grid>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                    <Chip
                      size="small"
                      label={`Training completion rate: ${Number(trainingPlan.training_completion_rate_pct || 0).toFixed(1)}%`}
                    />
                    <Chip size="small" label={`Active assignments: ${trainingPlan.assignment_stats?.active ?? 0}`} />
                    <Chip size="small" label={`Completed: ${trainingPlan.assignment_stats?.completed ?? 0}`} />
                  </Stack>
                  <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
                    Recommended programs (from org skill gaps)
                  </Typography>
                  {(trainingPlan.programs || []).length === 0 ? (
                    <Alert severity="success" sx={{ mb: 2 }}>
                      No organization skill gaps — workforce meets required profiles.
                    </Alert>
                  ) : (
                    <>
                      <Box sx={{ display: { xs: "block", md: "none" }, mb: 2 }}>
                        <Stack spacing={2}>
                          {(trainingPlan.programs || []).map((p) => (
                            <TrainingProgramCard
                              key={`${p.target_skill}-${p.program_name}`}
                              program={p}
                              onAssign={() => {
                                setTrainingUserId(activeEmployees[0]?.id || "");
                                setTrainingNote("");
                                setTrainingDialog({
                                  program_name: p.program_name,
                                  target_skill: p.target_skill,
                                  cost: p.suggested_investment,
                                  official_url: p.official_url,
                                  provider: p.provider
                                });
                              }}
                            />
                          ))}
                        </Stack>
                      </Box>
                      <TableContainer sx={{ display: { xs: "none", md: "block" }, mb: 2, overflowX: "auto", width: "100%", WebkitOverflowScrolling: "touch" }}>
                        <Table size="small" sx={{ minWidth: 980 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ minWidth: 160 }}>Official course</TableCell>
                            <TableCell sx={{ minWidth: 100 }}>Provider</TableCell>
                            <TableCell sx={{ minWidth: 100 }}>Skill</TableCell>
                            <TableCell align="right">Employees needing</TableCell>
                            <TableCell align="right">Org gap</TableCell>
                            <TableCell align="right">Suggested investment (FRW)</TableCell>
                            <TableCell align="right">Committed (FRW)</TableCell>
                            <TableCell align="right" sx={{ minWidth: 120 }}>Assign</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(trainingPlan.programs || []).map((p) => (
                            <TableRow key={`${p.target_skill}-${p.program_name}`}>
                              <TableCell sx={{ maxWidth: 220, wordBreak: "break-word" }}>
                                {p.official_url ? (
                                  <Typography
                                    component="a"
                                    href={p.official_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    variant="body2"
                                    fontWeight={600}
                                  >
                                    {p.program_name}
                                  </Typography>
                                ) : (
                                  p.program_name
                                )}
                              </TableCell>
                              <TableCell>{p.provider || "—"}</TableCell>
                              <TableCell>{p.target_skill}</TableCell>
                              <TableCell align="right">{p.employees_needing}</TableCell>
                              <TableCell align="right">{p.org_gap_units}</TableCell>
                              <TableCell align="right">{formatFrw(p.suggested_investment)}</TableCell>
                              <TableCell align="right">
                                {formatFrw(p.committed_spend)}
                                {p.active_assignments > 0 ? ` (${p.active_assignments})` : ""}
                              </TableCell>
                              <TableCell align="right">
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => {
                                    setTrainingUserId(activeEmployees[0]?.id || "");
                                    setTrainingNote("");
                                    setTrainingDialog({
                                      program_name: p.program_name,
                                      target_skill: p.target_skill,
                                      cost: p.suggested_investment,
                                      official_url: p.official_url,
                                      provider: p.provider
                                    });
                                  }}
                                >
                                  Assign employee
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    </>
                  )}
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
                    Employee enrollment requests (awaiting HR)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Employees request courses from their recommendations. Approve each request, then upload the official PDF or video so they can open it from Training progress.
                  </Typography>
                  {hrPendingEnrollments.length === 0 ? (
                    <Alert severity="info" sx={{ mb: 2 }}>No pending enrollment requests.</Alert>
                  ) : (
                    <>
                      <Box sx={{ display: { xs: "block", md: "none" }, mb: 2 }}>
                        <Stack spacing={2}>
                          {hrPendingEnrollments.map((row) => (
                            <EnrollmentRequestCard
                              key={row.id}
                              row={row}
                              onApprove={() => approveEnrollmentRequest(row)}
                              onReject={() => rejectEnrollmentRequest(row)}
                            />
                          ))}
                        </Stack>
                      </Box>
                      <TableContainer sx={{ display: { xs: "none", md: "block" }, mb: 2, overflowX: "auto", width: "100%", WebkitOverflowScrolling: "touch" }}>
                        <Table size="small" sx={{ minWidth: 880 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ minWidth: 140 }}>Employee</TableCell>
                            <TableCell sx={{ minWidth: 160 }}>Course</TableCell>
                            <TableCell>Skill</TableCell>
                            <TableCell>Provider</TableCell>
                            <TableCell sx={{ minWidth: 140 }}>Requested</TableCell>
                            <TableCell align="right" sx={{ minWidth: 200 }}>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {hrPendingEnrollments.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell>
                                <Typography fontWeight={600}>{row.employee_name}</Typography>
                                <Typography variant="caption" color="text.secondary">{row.employee_email}</Typography>
                              </TableCell>
                              <TableCell sx={{ maxWidth: 220, wordBreak: "break-word" }}>
                                {row.official_url ? (
                                  <Typography
                                    component="a"
                                    href={row.official_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    variant="body2"
                                    fontWeight={600}
                                  >
                                    {row.program_name}
                                  </Typography>
                                ) : (
                                  row.program_name
                                )}
                              </TableCell>
                              <TableCell>{row.target_skill}</TableCell>
                              <TableCell>{row.provider || "—"}</TableCell>
                              <TableCell sx={{ whiteSpace: "nowrap" }}>
                                {row.requested_at
                                  ? new Date(row.requested_at).toLocaleString()
                                  : row.created_at
                                    ? new Date(row.created_at).toLocaleString()
                                    : "—"}
                              </TableCell>
                              <TableCell align="right">
                                <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                                  <Button size="small" variant="contained" onClick={() => approveEnrollmentRequest(row)}>
                                    Approve & upload
                                  </Button>
                                  <Button size="small" color="error" variant="outlined" onClick={() => rejectEnrollmentRequest(row)}>
                                    Reject
                                  </Button>
                                </Stack>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    </>
                  )}
                  <Divider sx={{ my: 2 }} />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between" sx={{ mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight={800}>
                      Live training assignments (in progress)
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={async () => {
                        setError("");
                        try {
                          const res = await api.get("/analytics/hr/training-attendance-sessions/export", {
                            responseType: "blob"
                          });
                          const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: "text/csv" });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement("a");
                          link.href = url;
                          link.download = `training-attendance-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          URL.revokeObjectURL(url);
                          setSnackbar({ open: true, message: "Attendance export downloaded." });
                        } catch (err) {
                          setError(getApiErrorMessage(err, "Failed to export attendance"));
                        }
                      }}
                    >
                      Export verified sessions (CSV)
                    </Button>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Real progress and completion are stored on each assignment. Use the <strong>Course PDF / video</strong> column (cloud icon) to attach the official file employees open while training — only PDF or MP4/WebM/MOV, not text links. Completing a course records certification and bumps the target skill. Use the export for session audit.
                  </Typography>
                  {hrOpenTrainings.length === 0 ? (
                    <Alert severity="info">No open training assignments.</Alert>
                  ) : (
                    <>
                      <Box sx={{ display: { xs: "block", md: "none" } }}>
                        <Stack spacing={2}>
                          {hrOpenTrainings.map((row) => (
                            <LiveTrainingAssignmentCard
                              key={row.id}
                              row={row}
                              progressValue={hrTrainPct[row.id] ?? row.progress_pct}
                              onProgressChange={(value) => setHrTrainPct((prev) => ({ ...prev, [row.id]: value }))}
                              onUploadClick={() =>
                                setTrainingMaterialsEdit({
                                  id: row.id,
                                  label: `${row.employee_name} — ${row.program_name}`,
                                  filename: row.course_material_filename || "",
                                  kind: row.course_material_kind || ""
                                })
                              }
                              onSaveProgress={() =>
                                hrUpdateTrainingAssignment(row.id, {
                                  progress_pct: Number(hrTrainPct[row.id] ?? row.progress_pct)
                                })
                              }
                              onMarkComplete={() =>
                                hrUpdateTrainingAssignment(row.id, {
                                  progress_pct: 100,
                                  mark_completed: true,
                                  certificate_status: "Issued"
                                })
                              }
                            />
                          ))}
                        </Stack>
                      </Box>
                      <TableContainer sx={{ display: { xs: "none", md: "block" }, overflowX: "auto", width: "100%", WebkitOverflowScrolling: "touch" }}>
                        <Table size="small" sx={{ minWidth: 1280 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ minWidth: 140 }}>Employee</TableCell>
                            <TableCell sx={{ minWidth: 140 }}>Course</TableCell>
                            <TableCell>Skill</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Attendance</TableCell>
                            <TableCell>Time on course</TableCell>
                            <TableCell>Live session</TableCell>
                            <TableCell align="right" sx={{ minWidth: 100 }}>Progress %</TableCell>
                            <TableCell sx={{ minWidth: 180 }}>Course PDF / video</TableCell>
                            <TableCell align="right" sx={{ minWidth: 220 }}>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {hrOpenTrainings.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell sx={{ verticalAlign: "top" }}>
                                <Typography fontWeight={600}>{row.employee_name}</Typography>
                                <Typography variant="caption" color="text.secondary">{row.employee_email}</Typography>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: "top", wordBreak: "break-word" }}>{row.program_name}</TableCell>
                              <TableCell sx={{ verticalAlign: "top" }}>{row.target_skill}</TableCell>
                              <TableCell sx={{ verticalAlign: "top" }}>{row.status}</TableCell>
                              <TableCell sx={{ verticalAlign: "top" }}>{(row.attendance_tier || "—").replace(/_/g, " ")}</TableCell>
                              <TableCell sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>{row.total_learning_display || "0s"}</TableCell>
                              <TableCell sx={{ verticalAlign: "top" }}>{row.session_active ? "Yes" : "No"}</TableCell>
                              <TableCell align="right" sx={{ minWidth: 120, verticalAlign: "top" }}>
                                <TextField
                                  size="small"
                                  type="number"
                                  inputProps={{ min: 0, max: 100 }}
                                  value={hrTrainPct[row.id] ?? row.progress_pct}
                                  onChange={(e) => setHrTrainPct((prev) => ({ ...prev, [row.id]: Number(e.target.value) }))}
                                />
                              </TableCell>
                              <TableCell sx={{ minWidth: 168, verticalAlign: "top" }}>
                                <Button
                                  size="small"
                                  variant={row.course_material_filename ? "outlined" : "contained"}
                                  color="primary"
                                  startIcon={<CloudUploadIcon fontSize="small" />}
                                  onClick={() =>
                                    setTrainingMaterialsEdit({
                                      id: row.id,
                                      label: `${row.employee_name} — ${row.program_name}`,
                                      filename: row.course_material_filename || "",
                                      kind: row.course_material_kind || ""
                                    })
                                  }
                                  sx={{ whiteSpace: "nowrap" }}
                                >
                                  {row.course_material_filename ? "Replace PDF/video" : "Upload PDF/video"}
                                </Button>
                              </TableCell>
                              <TableCell align="right" sx={{ verticalAlign: "top" }}>
                                <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() =>
                                      hrUpdateTrainingAssignment(row.id, {
                                        progress_pct: Number(hrTrainPct[row.id] ?? row.progress_pct)
                                      })
                                    }
                                  >
                                    Save progress
                                  </Button>
                                  <Button
                                    size="small"
                                    variant="contained"
                                    color="success"
                                    onClick={() =>
                                      hrUpdateTrainingAssignment(row.id, {
                                        progress_pct: 100,
                                        mark_completed: true,
                                        certificate_status: "Issued"
                                      })
                                    }
                                  >
                                    Mark complete
                                  </Button>
                                </Stack>
                              </TableCell>
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

            {!initialLoading && activeSection === "gaps" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Organization-level skill gap analysis
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Organization shortage per skill (sum of max(0, required − current) across active employees).
                  </Typography>
                  <TextField size="small" label="Search gap skill" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2 }} />
                  <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        exportRowsToCsv("hr-org-skill-gaps.csv", filteredGapTable, [
                          { header: "Skill", value: (r) => r.skill },
                          { header: "Org gap", value: (r) => r.gap },
                          { header: "Severity", value: (r) => r.severity }
                        ])
                      }
                    >
                      Export CSV
                    </Button>
                  </Stack>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Skill</TableCell>
                          <TableCell align="right">Org gap</TableCell>
                          <TableCell>Severity</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredGapTable.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3}>No organization skill gaps — workforce meets required profiles.</TableCell>
                          </TableRow>
                        ) : (
                          filteredGapTable.slice(0, 50).map((r) => (
                            <TableRow key={r.skill}>
                              <TableCell>{r.skill}</TableCell>
                              <TableCell align="right">{r.gap}</TableCell>
                              <TableCell>
                                <Alert
                                  severity={r.severity === "HIGH" ? "error" : r.severity === "MEDIUM" ? "warning" : "success"}
                                  icon={false}
                                  sx={{ py: 0.5 }}
                                >
                                  {r.severity}
                                </Alert>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!initialLoading && activeSection === "compliance" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Certification & compliance tracking
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Grid container spacing={2} sx={{ mb: 1 }}>
                    <Grid item xs={12} md={6}>
                      <Alert severity="warning">Expiring soon: {complianceData?.alerts?.expiring_soon || 0}</Alert>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Alert severity="error">Missing certifications: {complianceData?.alerts?.missing || 0}</Alert>
                    </Grid>
                  </Grid>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Suggested certifications are inferred from each employee&apos;s CV, job title, department, and skill gaps.
                    Assign a required certification when none is on file — the employee will see it in their dashboard.
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Employee</TableCell>
                          <TableCell>CV certification</TableCell>
                          <TableCell>Suggested (from CV &amp; profile)</TableCell>
                          <TableCell>HR assigned</TableCell>
                          <TableCell>Expiry</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">HR action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(complianceData.rows || []).map((r, idx) => (
                          <TableRow key={`${r.user_id || r.employee}-${idx}`}>
                            <TableCell>{r.employee}</TableCell>
                            <TableCell>{r.certification}</TableCell>
                            <TableCell>
                              {(r.suggested_certifications || []).length ? (
                                <Stack spacing={0.5}>
                                  {(r.suggested_certifications || []).slice(0, 2).map((s) => (
                                    <Typography key={s.name} variant="caption" display="block">
                                      {s.name}
                                    </Typography>
                                  ))}
                                </Stack>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell>
                              {(r.hr_required_certifications || []).length ? (
                                <Stack spacing={0.5}>
                                  {(r.hr_required_certifications || []).map((req) => (
                                    <Typography key={req.id} variant="caption" display="block" fontWeight={600}>
                                      {req.required_certification}
                                      {req.due_date ? ` (due ${req.due_date})` : ""}
                                    </Typography>
                                  ))}
                                </Stack>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell>{r.expiry_date}</TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell align="right">
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  const isMissing = r.status === "Missing Certification" || r.certification === "None";
                                  setComplianceUntil("");
                                  setComplianceDueDate("");
                                  setComplianceNote("");
                                  setComplianceRequiredCert(
                                    (r.suggested_certifications || [])[0]?.name || ""
                                  );
                                  setComplianceDialog({
                                    userId: r.user_id,
                                    employee: r.employee,
                                    certification: r.certification,
                                    isMissing,
                                    suggestedCertifications: r.suggested_certifications || []
                                  });
                                }}
                                disabled={!r.user_id}
                              >
                                {r.status === "Missing Certification" || (r.certification === "None" && r.status !== "Compliant")
                                  ? "Assign required cert"
                                  : "Record renewal"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!initialLoading && activeSection === "recruitment" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Recruitment insights
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Active workforce: {recruitmentInsights.employeeCount} employees
                  </Alert>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Priority hiring skill</TableCell>
                          <TableCell align="right">Gap level</TableCell>
                          <TableCell>Urgency</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {recruitmentInsights.openDemand.map((g) => (
                          <TableRow key={g.skill}>
                            <TableCell>{g.skill}</TableCell>
                            <TableCell align="right">{g.gap_level}</TableCell>
                            <TableCell>{g.urgency}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    Hiring suggestions
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Role</TableCell>
                          <TableCell align="right">Number needed</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(recruitmentData.hiring_suggestions || []).map((h) => (
                          <TableRow key={h.role}>
                            <TableCell>{h.role}</TableCell>
                            <TableCell align="right">{h.number_needed}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!initialLoading && activeSection === "pipeline" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Talent pipeline visualization
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Box sx={{ width: "100%", height: 280 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={(pipelineData.rows || []).slice(0, 8)}
                      >
                        <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
                        <XAxis dataKey="employee" hide />
                        <YAxis />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="promotion_readiness_score" fill={colors.primary} name="Promotion readiness" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Employee</TableCell>
                          <TableCell>Department</TableCell>
                          <TableCell align="right">Skill growth</TableCell>
                          <TableCell align="right">Promotion readiness</TableCell>
                          <TableCell align="right">HR action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(pipelineData.rows || []).slice(0, 20).map((r) => (
                          <TableRow key={`${r.user_id || r.employee}-${r.department}`}>
                            <TableCell>{r.employee}</TableCell>
                            <TableCell>{r.department}</TableCell>
                            <TableCell align="right">{r.skill_growth}</TableCell>
                            <TableCell align="right">{r.promotion_readiness_score}</TableCell>
                            <TableCell align="right">
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  setPromotionNote("");
                                  setPromotionDialog({
                                    userId: r.user_id,
                                    employee: r.employee,
                                    readiness_score: r.promotion_readiness_score
                                  });
                                }}
                                disabled={!r.user_id}
                              >
                                Recommend promotion
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!initialLoading && activeSection === "cv" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    CV validation & skill verification
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Review the official PDF résumé each employee uploaded at registration (or re-uploaded from their dashboard), then approve or reject the declared primary skill.
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  {cvValidation.length === 0 ? (
                    <Alert severity="info">No active employees in the workforce yet.</Alert>
                  ) : cvPendingCount === 0 ? (
                    <Alert severity="success" sx={{ mb: 2 }}>
                      No primary-skill mismatches pending — all listed employees are validated. You can still open each official PDF below.
                    </Alert>
                  ) : (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      {cvPendingCount} employee{cvPendingCount === 1 ? "" : "s"} need primary-skill validation. Review the PDF, then approve or reject.
                    </Alert>
                  )}
                  {cvValidation.length > 0 ? (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Employee</TableCell>
                            <TableCell>Email</TableCell>
                            <TableCell>Declared primary skill</TableCell>
                            <TableCell>CV skills (from résumé)</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Uploaded</TableCell>
                            <TableCell align="right">Official CV</TableCell>
                            <TableCell align="right">HR action</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {cvValidation.slice(0, 50).map((r) => (
                            <TableRow key={r.user_id}>
                              <TableCell>{r.employee}</TableCell>
                              <TableCell>{r.email}</TableCell>
                              <TableCell>{r.declared_primary_skill}</TableCell>
                              <TableCell sx={{ maxWidth: 380, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {(r.cv_skills || []).join(", ") || "—"}
                              </TableCell>
                              <TableCell>{r.status}</TableCell>
                              <TableCell>
                                {r.cv_uploaded_at ? String(r.cv_uploaded_at).slice(0, 10) : "—"}
                              </TableCell>
                              <TableCell align="right">
                                {r.has_cv_file ? (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => hrViewEmployeeCv(r.user_id, r.employee, r.original_filename)}
                                  >
                                    View PDF
                                  </Button>
                                ) : (
                                  <Typography variant="caption" color="text.secondary">
                                    No file
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell align="right">
                                {r.status === "Needs Validation" ? (
                                  <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                                    <Button
                                      size="small"
                                      color="success"
                                      variant="outlined"
                                      onClick={() => {
                                        setCvNote("");
                                        setCvDialog({ userId: r.user_id, name: r.employee, decision: "approve" });
                                      }}
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="small"
                                      color="error"
                                      variant="outlined"
                                      onClick={() => {
                                        setCvNote("");
                                        setCvDialog({ userId: r.user_id, name: r.employee, decision: "reject" });
                                      }}
                                    >
                                      Reject
                                    </Button>
                                  </Stack>
                                ) : (
                                  <Typography variant="caption" color="text.secondary">
                                    —
                                  </Typography>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {!initialLoading && activeSection === "performance" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Performance review support
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Employee</TableCell>
                          <TableCell>Department</TableCell>
                          <TableCell align="right">Project success</TableCell>
                          <TableCell align="right">Skill improvement</TableCell>
                          <TableCell align="right">Training completion</TableCell>
                          <TableCell align="right">Performance score</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(performanceData.rows || []).slice(0, 30).map((r) => (
                          <TableRow key={`${r.employee}-${r.department}`}>
                            <TableCell>{r.employee}</TableCell>
                            <TableCell>{r.department}</TableCell>
                            <TableCell align="right">{r.project_success}</TableCell>
                            <TableCell align="right">{r.skill_improvement}</TableCell>
                            <TableCell align="right">{r.training_completion}</TableCell>
                            <TableCell align="right">{r.performance_score}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!initialLoading && activeSection === "reports" ? (
              <DashboardReportPanel
                roleLabel="HR"
                reports={HR_REPORTS}
                onDownload={downloadReport}
                downloadingId={reportDownloadingId}
                layout="three"
                showMainBadge={false}
                headerSubtitle="Three professional PDF divisions for HR operations — complete employee directory, organization-wide performance scores, and everyone currently in training with live progress and attendance."
              />
            ) : null}
          </Grid>
        </Grid>
      </Stack>

      <Dialog open={Boolean(cvViewer)} onClose={closeCvViewer} fullWidth maxWidth="lg">
        <DialogTitle>{cvViewer?.title || "Official CV"}</DialogTitle>
        <DialogContent sx={{ height: { xs: "60vh", md: "75vh" }, p: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {cvViewer?.loading ? (
            <CircularProgress />
          ) : cvViewer?.blobUrl ? (
            <Box component="iframe" src={cvViewer.blobUrl} title="Employee CV" sx={{ width: "100%", height: "100%", border: 0 }} />
          ) : (
            <Typography color="text.secondary">No preview available.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCvViewer}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(cvDialog)} onClose={() => setCvDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {cvDialog?.decision === "approve" ? "Approve" : "Reject"} primary skill — {cvDialog?.name}
        </DialogTitle>
        <DialogContent>
          <TextField
            margin="dense"
            label="Note (optional)"
            fullWidth
            multiline
            minRows={2}
            value={cvNote}
            onChange={(e) => setCvNote(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCvDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitCvDecision}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(trainingDialog)} onClose={() => setTrainingDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>Assign training</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {trainingDialog?.program_name} — {trainingDialog?.target_skill}
          </Typography>
          <FormControl fullWidth margin="dense" size="small">
            <InputLabel id="train-user-label">Employee</InputLabel>
            <Select
              labelId="train-user-label"
              label="Employee"
              value={trainingUserId}
              onChange={(e) => setTrainingUserId(e.target.value)}
            >
              {activeEmployees.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.full_name} ({u.email})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            label="Note (optional)"
            fullWidth
            multiline
            minRows={2}
            value={trainingNote}
            onChange={(e) => setTrainingNote(e.target.value)}
          />
          <Alert severity="info" sx={{ mt: 2 }}>
            After you click <strong>Save assignment</strong>, the <strong>Upload PDF/video</strong> window opens automatically. You can also use the <strong>Course PDF / video</strong> column in the table below (same cloud upload button on each row).
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrainingDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitTrainingAssign} disabled={!trainingUserId}>
            Save assignment
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(trainingMaterialsEdit)}
        onClose={() => {
          if (trainingMaterialFileRef.current) trainingMaterialFileRef.current.value = "";
          setTrainingMaterialsEdit(null);
        }}
        fullWidth
        maxWidth="sm"
        fullScreen={isMobile}
      >
        <DialogTitle>Upload course PDF or video</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Assignment: {trainingMaterialsEdit?.label}
          </Typography>
          {trainingMaterialsEdit?.filename ? (
            <Typography variant="body2" sx={{ mb: 1 }}>
              Current file: <strong>{trainingMaterialsEdit.filename}</strong> ({trainingMaterialsEdit.kind || "file"})
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ mb: 1 }}>
              No file uploaded yet.
            </Typography>
          )}
          {trainingMaterialsEdit?.filename ? (
            <Button size="small" sx={{ mb: 2 }} onClick={() => hrDownloadCourseMaterial(trainingMaterialsEdit.id, trainingMaterialsEdit.filename)}>
              Download current file
            </Button>
          ) : null}
          <input
            ref={trainingMaterialFileRef}
            type="file"
            accept=".pdf,.mp4,.webm,.mov,application/pdf,video/mp4,video/webm,video/quicktime"
            style={{ display: "none" }}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <Button variant="outlined" fullWidth={isMobile} onClick={() => trainingMaterialFileRef.current?.click()}>
              Choose PDF or video
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block">
            Allowed: PDF, MP4, WebM, MOV. Max 80 MB. Uploading replaces any previous file.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ flexDirection: { xs: "column", sm: "row" }, gap: 1, px: 2, pb: 2 }}>
          <Button
            fullWidth={isMobile}
            onClick={() => {
              if (trainingMaterialFileRef.current) trainingMaterialFileRef.current.value = "";
              setTrainingMaterialsEdit(null);
            }}
          >
            Cancel
          </Button>
          <Button fullWidth={isMobile} variant="contained" onClick={uploadTrainingCourseMaterial}>
            Upload
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(complianceDialog)} onClose={() => setComplianceDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {complianceDialog?.isMissing ? "Assign required certification" : "Record certification renewal"}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {complianceDialog?.employee} — CV on file: {complianceDialog?.certification || "None"}
          </Typography>
          {complianceDialog?.isMissing ? (
            <>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                This employee has no certificate in their CV. Select or enter the certification HR requires, a due date, and a note.
              </Typography>
              {(complianceDialog?.suggestedCertifications || []).length > 0 ? (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
                    Suggested from CV &amp; profile
                  </Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {(complianceDialog.suggestedCertifications || []).map((s) => (
                      <Chip
                        key={s.name}
                        size="small"
                        label={s.name}
                        onClick={() => setComplianceRequiredCert(s.name)}
                        color={complianceRequiredCert === s.name ? "primary" : "default"}
                        variant={complianceRequiredCert === s.name ? "filled" : "outlined"}
                      />
                    ))}
                  </Stack>
                </Box>
              ) : null}
              <TextField
                margin="dense"
                label="Required certification"
                fullWidth
                required
                value={complianceRequiredCert}
                onChange={(e) => setComplianceRequiredCert(e.target.value)}
                sx={{ mb: 1 }}
              />
              <TextField
                margin="dense"
                label="Due date (YYYY-MM-DD)"
                fullWidth
                required
                type="date"
                InputLabelProps={{ shrink: true }}
                value={complianceDueDate}
                onChange={(e) => setComplianceDueDate(e.target.value)}
                sx={{ mb: 1 }}
              />
              <TextField
                margin="dense"
                label="Note to employee"
                fullWidth
                multiline
                minRows={3}
                value={complianceNote}
                onChange={(e) => setComplianceNote(e.target.value)}
                placeholder="Explain why this certification is required and any steps to complete it."
              />
            </>
          ) : (
            <>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                Record renewal for the certification parsed from the employee CV.
              </Typography>
              <TextField
                margin="dense"
                label="Valid until (YYYY-MM-DD), optional"
                fullWidth
                placeholder="Leave empty for default +365 days"
                value={complianceUntil}
                onChange={(e) => setComplianceUntil(e.target.value)}
              />
              <TextField
                margin="dense"
                label="Note (optional)"
                fullWidth
                multiline
                minRows={2}
                value={complianceNote}
                onChange={(e) => setComplianceNote(e.target.value)}
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComplianceDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitComplianceRenewal}>
            {complianceDialog?.isMissing ? "Assign to employee" : "Save renewal"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(promotionDialog)} onClose={() => setPromotionDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>Promotion recommendation</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {promotionDialog?.employee}
            {promotionDialog?.readiness_score != null ? ` — readiness ${promotionDialog.readiness_score}` : ""}
          </Typography>
          <TextField
            margin="dense"
            label="Note (optional)"
            fullWidth
            multiline
            minRows={3}
            value={promotionNote}
            onChange={(e) => setPromotionNote(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPromotionDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitPromotionRecommend}>
            Record recommendation
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        message={snackbar.message}
      />
    </AppShell>
  );
}
