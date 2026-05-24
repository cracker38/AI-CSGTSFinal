import React, { useEffect, useMemo, useState } from "react";
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
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../api/client";
import { getApiErrorMessage } from "../utils/apiError";

const PROJECT_SKILL_LEVELS = [1, 2, 3, 4, 5];
const PROJECT_SKILL_WEIGHTS = [0.5, 1, 1.5, 2, 2.5, 3];
const PROJECT_EMPLOYEE_COUNTS = Array.from({ length: 20 }, (_, i) => i + 1);

const SECTIONS = [
  { key: "home", label: "Home overview" },
  { key: "team", label: "Team members" },
  { key: "skills", label: "Team skill overview" },
  { key: "gaps", label: "Skill gap analysis" },
  { key: "projects", label: "Project management" },
  { key: "matching", label: "AI employee matching" },
  { key: "assignment", label: "Project assignment" },
  { key: "requests", label: "Master data requests" },
  { key: "workload", label: "Workload & availability" },
  { key: "performance", label: "Performance monitoring" },
  { key: "alerts", label: "Alerts & risks" }
];

function fitClassTextColor(fitClass) {
  if (fitClass === "Best Fit") return "success.main";
  if (fitClass === "Good Fit") return "primary.main";
  if (fitClass === "Risky") return "warning.main";
  return "text.primary";
}

function formatEligibilityBlockers(reason) {
  if (!reason) return [];
  return String(reason)
    .split(",")
    .map((part) => part.trim().replace(/_/g, " "))
    .filter(Boolean);
}

function MatchStatusStrip({ match, compact = false }) {
  const blockers = formatEligibilityBlockers(match.eligibility_reason);
  const qualityColor =
    match.cv_quality_tier === "strong"
      ? "success.main"
      : match.cv_quality_tier === "weak" || match.cv_quality_tier === "minimal"
        ? "warning.main"
        : "text.primary";

  const items = [
    {
      key: "fit",
      label: "Fit class",
      value: match.fit_class || "Unknown",
      color: fitClassTextColor(match.fit_class),
      hint: "Overall assignment fit tier from CV + skills."
    },
    {
      key: "quality",
      label: "CV quality",
      value: match.cv_quality_pct != null ? `${match.cv_quality_pct}%` : "—",
      color: qualityColor,
      hint: "Résumé structure, sections, and NLP confidence.",
      tier: match.cv_quality_tier
    },
    {
      key: "eligibility",
      label: "Eligibility",
      value: match.eligible ? "Eligible" : "Not eligible",
      color: match.eligible ? "success.main" : "warning.main",
      hint: match.eligible ? "Passes hard rules for assignment." : blockers.join(", ") || "Blocked by hard rules."
    }
  ];

  return (
    <Stack
      direction={compact ? "column" : { xs: "column", sm: "row" }}
      spacing={1}
      useFlexGap
      flexWrap="wrap"
      sx={{ width: "100%" }}
    >
      {items.map((item) => (
        <Tooltip key={item.key} title={item.hint} arrow placement="top">
          <Box
            sx={{
              flex: compact ? "1 1 auto" : { xs: "1 1 100%", sm: "1 1 160px" },
              minWidth: compact ? 0 : { sm: 160 },
              p: 1.25,
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper"
            }}
          >
            <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3 }}>
              {item.label}
            </Typography>
            <Typography variant="body2" fontWeight={800} sx={{ color: item.color, mt: 0.25, lineHeight: 1.35, wordBreak: "break-word" }}>
              {item.value}
            </Typography>
            {item.key === "quality" && item.tier ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.2, textTransform: "capitalize", lineHeight: 1.35 }}>
                Tier: {item.tier}
              </Typography>
            ) : null}
            {item.key === "eligibility" && !match.eligible && blockers.length > 0 ? (
              <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                {blockers.map((blocker) => (
                  <Typography key={blocker} variant="caption" display="block" sx={{ lineHeight: 1.35, wordBreak: "break-word" }}>
                    • {blocker}
                  </Typography>
                ))}
              </Stack>
            ) : null}
          </Box>
        </Tooltip>
      ))}
    </Stack>
  );
}

function CvRegistrationIntelStrip({ match }) {
  const intel = match.cv_intel || {};
  const regAlign = intel.role_context_alignment || {};

  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
      <Chip size="small" variant="outlined" label={`Pipeline: ${intel.pipeline || "—"}`} />
      <Chip
        size="small"
        variant="outlined"
        label={
          intel.parser_confidence_pct != null
            ? `Registration NLP ${intel.parser_confidence_pct}%`
            : "Registration NLP —"
        }
      />
      <Chip
        size="small"
        color={intel.primary_skill_validated === false ? "warning" : "success"}
        label={
          intel.primary_skill_validated === undefined
            ? "Primary skill unchecked"
            : intel.primary_skill_validated
              ? "Primary skill in CV"
              : "Primary not in CV"
        }
      />
      {regAlign.weighted_role_alignment_pct != null ? (
        <Chip
          size="small"
          variant="outlined"
          label={`HR role alignment ${regAlign.weighted_role_alignment_pct}%`}
        />
      ) : null}
      {match.project_alignment_pct != null ? (
        <Chip size="small" variant="outlined" color="primary" label={`Project skills ${match.project_alignment_pct}%`} />
      ) : null}
    </Stack>
  );
}

function ProjectSkillBreakdownTable({ rows }) {
  if (!rows?.length) return null;
  return (
    <TableContainer sx={{ mt: 1.25, maxWidth: "100%" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Skill</TableCell>
            <TableCell align="right">Required</TableCell>
            <TableCell align="right">Inventory</TableCell>
            <TableCell align="right">CV</TableCell>
            <TableCell align="right">Gap</TableCell>
            <TableCell>Evidence</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.skill}>
              <TableCell sx={{ fontWeight: 600 }}>{row.skill}</TableCell>
              <TableCell align="right">{row.required_level}</TableCell>
              <TableCell align="right">{row.inventory_level}</TableCell>
              <TableCell align="right">{row.cv_level}</TableCell>
              <TableCell align="right">
                <Typography
                  variant="body2"
                  color={row.gap > 0 ? "warning.main" : "success.main"}
                  fontWeight={row.gap > 0 ? 700 : 400}
                >
                  {row.gap}
                </Typography>
              </TableCell>
              <TableCell>
                {row.cv_evidence ? (
                  <Chip
                    size="small"
                    color={row.in_experience ? "success" : "default"}
                    label={row.in_experience ? "CV · experience" : "CV"}
                  />
                ) : (
                  <Chip size="small" variant="outlined" label="No CV hit" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ProjectMatchingBriefing({ report }) {
  if (!report?.project) return null;
  const { project, analysis_profile, summary } = report;
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: "background.default" }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Project matching profile
          </Typography>
          <Typography variant="h6" fontWeight={800}>
            {project.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Same CV intelligence pipeline as employee registration — scored against this project&apos;s department,
            job titles, and weighted skill requirements.
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`Department: ${project.department || "—"}`} />
          <Chip size="small" label={`Job title: ${(project.required_job_titles || []).join(", ") || "—"}`} />
          <Chip size="small" label={`Headcount: ${project.required_employees}`} />
          <Chip size="small" variant="outlined" label={`Engine: ${analysis_profile?.engine || "—"}`} />
        </Stack>
        {(project.skill_requirements || []).length > 0 ? (
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
              Weighted skill requirements
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {project.skill_requirements.map((s) => (
                <Chip
                  key={s.skill}
                  size="small"
                  variant="outlined"
                  label={`${s.skill} · L${s.required_level} · W${s.weight}`}
                />
              ))}
            </Stack>
          </Box>
        ) : null}
        {summary ? (
          <Typography variant="caption" color="text.secondary">
            Ranked {summary.candidates_ranked} team member(s) · {summary.eligible_count} eligible · best match{" "}
            {summary.best_match_pct}%
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

function EmployeeMatchRationale({ match }) {
  const bullets = match.analysis_bullets?.length ? match.analysis_bullets : match.highlights || [];
  const missing = match.project_context?.missing_priority_skills || [];

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: "action.hover",
        borderLeft: "3px solid",
        borderColor: match.eligible ? "success.main" : "warning.main"
      }}
    >
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.4 }}>
        Professional match analysis
      </Typography>
      <Typography variant="body2" fontWeight={700} sx={{ mt: 0.35, lineHeight: 1.55 }}>
        {match.recommendation || "No recommendation generated."}
      </Typography>
      {bullets.length > 0 ? (
        <Stack component="ul" spacing={0.4} sx={{ m: 0, mt: 0.85, pl: 2.25 }}>
          {bullets.map((item, idx) => (
            <Typography component="li" variant="body2" key={`${item}-${idx}`} sx={{ lineHeight: 1.65, wordBreak: "break-word" }}>
              {item}
            </Typography>
          ))}
        </Stack>
      ) : null}
      {missing.length > 0 ? (
        <Box sx={{ mt: 1.25 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            Priority project skill gaps (CV / inventory)
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {missing.slice(0, 8).map((s) => (
              <Chip key={s} size="small" color="warning" variant="outlined" label={s} />
            ))}
          </Stack>
        </Box>
      ) : null}
      <ProjectSkillBreakdownTable rows={match.skill_breakdown} />
      {!match.eligible && match.eligibility_reason ? (
        <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.85 }}>
          Blockers: {String(match.eligibility_reason).replace(/_/g, " ")}
        </Typography>
      ) : null}
    </Box>
  );
}

function EmployeeMatchCard({ match }) {
  const metrics = [
    { label: "Overall", value: `${match.match_pct}%` },
    { label: "Project skills", value: match.project_alignment_pct != null ? `${match.project_alignment_pct}%` : "—" },
    { label: "Skill inventory", value: `${match.skill_match_pct}%` },
    { label: "CV evidence", value: `${match.cv_score}%` },
    { label: "CV semantic", value: match.cv_semantic_pct != null ? `${match.cv_semantic_pct}%` : "—" },
    { label: "Title fit", value: `${match.title_match_pct}%` },
    { label: "Gap", value: match.gap ?? "—" },
    { label: "Workload", value: `${match.workload_pct ?? (match.availability ? "<100" : "100")}%` }
  ];

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.75, sm: 2 }, borderRadius: 2.5, borderColor: "divider" }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "flex-start" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={800}>
              {match.employee}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {match.job_title || "—"} · {match.department || "—"}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              Primary: {match.primary_skill || "—"} · {match.experience_level || "—"}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}>
            <Chip size="small" color={match.department_match ? "success" : "warning"} variant="outlined" label={match.department_match ? "Dept OK" : "Dept mismatch"} />
            <Chip size="small" variant="outlined" label={match.availability ? "Available" : "Busy"} />
          </Stack>
        </Stack>

        <MatchStatusStrip match={match} compact />
        <CvRegistrationIntelStrip match={match} />

        <Grid container spacing={1}>
          {metrics.map((m) => (
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

        <EmployeeMatchRationale match={match} />
      </Stack>
    </Paper>
  );
}

function normalizeTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export default function ManagerDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = useMemo(() => {
    const section = searchParams.get("section");
    if (SECTIONS.some((s) => s.key === section)) return section;
    return "home";
  }, [searchParams]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(null);
  const [team, setTeam] = useState([]);
  const [skillsOverview, setSkillsOverview] = useState({ heatmap: [], coverage: [] });
  const [gaps, setGaps] = useState([]);
  const [projects, setProjects] = useState([]);
  const [allSkills, setAllSkills] = useState([]);
  const [allDepartments, setAllDepartments] = useState([]);
  const [allJobTitles, setAllJobTitles] = useState([]);
  const [matches, setMatches] = useState([]);
  const [matchReport, setMatchReport] = useState(null);
  const [matchingLoading, setMatchingLoading] = useState(false);
  const [hasRunMatching, setHasRunMatching] = useState(false);
  const [workload, setWorkload] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [catalogRequests, setCatalogRequests] = useState([]);
  const [requestForm, setRequestForm] = useState({ request_type: "department", value: "" });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [assignAllocationPct, setAssignAllocationPct] = useState(100);
  const [assignSuccess, setAssignSuccess] = useState("");
  const [projectAssignmentsMap, setProjectAssignmentsMap] = useState({});
  const [projectDailyReports, setProjectDailyReports] = useState([]);
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [projectForm, setProjectForm] = useState({
    name: "",
    department: "",
    job_title: "",
    description: "",
    deadline: "",
    required_employees: 1,
    status: "draft",
    requirements: [{ skill_id: "", required_level: 3, weight: 1 }]
  });
  const [projectFormError, setProjectFormError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [
        overviewRes,
        teamRes,
        skillRes,
        gapRes,
        projectRes,
        skillListRes,
        departmentsRes,
        workloadRes,
        performanceRes,
        alertsRes,
        requestsRes
      ] = await Promise.all([
        api.get("/manager/overview"),
        api.get("/manager/team-members"),
        api.get("/manager/skills/overview"),
        api.get("/manager/skills/gaps"),
        api.get("/manager/projects"),
        api.get("/manager/skills"),
        api.get("/manager/departments"),
        api.get("/manager/workload"),
        api.get("/manager/performance"),
        api.get("/manager/alerts"),
        api.get("/master-data/requests")
      ]);
      setOverview(overviewRes.data);
      setTeam(teamRes.data);
      setSkillsOverview(skillRes.data);
      setGaps(gapRes.data);
      setProjects(projectRes.data);
      setAllSkills(skillListRes.data);
      setAllDepartments(departmentsRes.data || []);
      setWorkload(workloadRes.data);
      setPerformance(performanceRes.data);
      setAlerts(alertsRes.data);
      setCatalogRequests(requestsRes.data || []);
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to load manager dashboard data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [activeSection]);

  useEffect(() => {
    if (!projectForm.department) {
      setAllJobTitles([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/manager/job-titles", { params: { department: projectForm.department } });
        if (!cancelled) setAllJobTitles(res.data || []);
      } catch {
        if (!cancelled) setAllJobTitles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectForm.department]);

  useEffect(() => {
    const section = searchParams.get("section");
    if (!section || !SECTIONS.some((s) => s.key === section)) {
      setSearchParams({ section: "home" }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function createProject() {
    const validationError = validateProjectForm();
    if (validationError) {
      setProjectFormError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    setProjectFormError("");
    try {
      await api.post("/manager/projects", {
        ...projectForm,
        required_employees: Number(projectForm.required_employees),
        requirements: projectForm.requirements
          .filter((r) => r.skill_id)
          .map((r) => ({
            skill_id: r.skill_id,
            required_level: Number(r.required_level),
            weight: Number(r.weight)
          })),
        required_job_titles: projectForm.job_title ? [projectForm.job_title] : []
      });
      await load();
      setProjectForm({
        name: "",
        department: "",
        job_title: "",
        description: "",
        deadline: "",
        required_employees: 1,
        status: "draft",
        requirements: [{ skill_id: "", required_level: 3, weight: 1 }]
      });
    } catch (err) {
      setError(err?.response?.data?.detail || "Project creation failed");
    } finally {
      setSaving(false);
    }
  }

  function validateProjectForm() {
    if (!projectForm.name.trim()) return "Project name is required.";
    if (!projectForm.department) return "Select a department for this project.";
    if (!projectForm.job_title) return "Select a job title for this project.";
    const hasSkillRequirement = projectForm.requirements.some((r) => r.skill_id);
    if (!hasSkillRequirement) return "Select at least one required skill.";
    const requiredEmployees = Number(projectForm.required_employees);
    if (!PROJECT_EMPLOYEE_COUNTS.includes(requiredEmployees)) {
      return "Select how many employees are needed.";
    }
    for (const req of projectForm.requirements) {
      if (!req.skill_id) continue;
      const level = Number(req.required_level);
      const weight = Number(req.weight);
      if (!PROJECT_SKILL_LEVELS.includes(level)) return "Select a skill level (1–5).";
      if (!PROJECT_SKILL_WEIGHTS.includes(weight)) return "Select a skill weight.";
    }
    return "";
  }

  async function runMatching() {
    if (!selectedProjectId) {
      setError("Please select a project before running matching.");
      return;
    }
    setError("");
    setMatchingLoading(true);
    try {
      const res = await api.get(`/manager/projects/${selectedProjectId}/match`);
      const payload = res.data;
      if (Array.isArray(payload)) {
        setMatchReport(null);
        setMatches(payload);
      } else {
        setMatchReport(payload);
        setMatches(payload.candidates || []);
      }
      setHasRunMatching(true);
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to run matching");
    } finally {
      setMatchingLoading(false);
    }
  }

  async function loadProjectAssignments(projectId) {
    if (!projectId) {
      setProjectAssignmentsMap({});
      return;
    }
    try {
      const res = await api.get(`/manager/projects/${projectId}/assignments`);
      const map = {};
      (res.data || []).forEach((row) => {
        map[row.employee_id] = Number(row.allocation_pct || 0);
      });
      setProjectAssignmentsMap(map);
    } catch (err) {
      setProjectAssignmentsMap({});
      setError(err?.response?.data?.detail || "Failed to load current project allocations");
    }
  }

  async function loadProjectDailyReports(projectId) {
    if (!projectId) {
      setProjectDailyReports([]);
      return;
    }
    try {
      const res = await api.get(`/manager/projects/${projectId}/daily-reports`);
      setProjectDailyReports(res.data || []);
    } catch (err) {
      setProjectDailyReports([]);
      setError(err?.response?.data?.detail || "Failed to load project daily reports");
    }
  }

  async function assignEmployee() {
    if (!selectedProjectId || !assignEmployeeId) return;
    setError("");
    setAssignSuccess("");
    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    const selectedMember = team.find((m) => m.id === assignEmployeeId);
    if (!selectedProject || !selectedMember) return;
    const blockedReason = getAssignmentBlockReason(selectedMember, selectedProject, assignAllocationPct);
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    try {
      await api.post(`/manager/projects/${selectedProjectId}/assign`, {
        employee_id: assignEmployeeId,
        allocation_pct: Number(assignAllocationPct)
      });
      await loadProjectAssignments(selectedProjectId);
      await load();
      await runMatching();
      setAssignSuccess(`Assigned ${selectedMember.name} to ${selectedProject.name} (${assignAllocationPct}%).`);
    } catch (err) {
      setError(getApiErrorMessage(err, "Assignment failed"));
    }
  }

  async function unassignFromProject(employeeId) {
    if (!selectedProjectId || !employeeId) return;
    setError("");
    setAssignSuccess("");
    try {
      await api.delete(`/manager/projects/${selectedProjectId}/assignments/${employeeId}`);
      await loadProjectAssignments(selectedProjectId);
      await load();
      setAssignSuccess("Assignment removed successfully.");
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to remove assignment");
    }
  }

  async function deleteProject(projectId, projectName) {
    if (!projectId) return;
    const ok = window.confirm(`Delete project "${projectName}"? This will remove related assignments and reports.`);
    if (!ok) return;
    setError("");
    setAssignSuccess("");
    try {
      await api.delete(`/manager/projects/${projectId}`);
      if (selectedProjectId === projectId) {
        setSelectedProjectId("");
        setProjectAssignmentsMap({});
        setProjectDailyReports([]);
      }
      await load();
      setAssignSuccess("Project deleted.");
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to delete project");
    }
  }

  async function archiveProject(projectId, projectName) {
    if (!projectId) return;
    const ok = window.confirm(`Archive project "${projectName}"? It will stay in history and stop new assignments.`);
    if (!ok) return;
    setError("");
    setAssignSuccess("");
    try {
      await api.post(`/manager/projects/${projectId}/archive`);
      await load();
      setAssignSuccess("Project archived.");
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to archive project");
    }
  }

  async function unassignTeamMember(employeeId, name) {
    if (!employeeId) return;
    const ok = window.confirm(`Unassign ${name} from your team?`);
    if (!ok) return;
    setError("");
    setAssignSuccess("");
    try {
      await api.post(`/manager/team-members/${employeeId}/unassign`);
      await load();
      if (selectedProjectId) {
        await loadProjectAssignments(selectedProjectId);
      }
      setAssignSuccess(`${name} was unassigned from your team.`);
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to unassign team member");
    }
  }

  async function submitCatalogRequest() {
    if (!requestForm.value.trim()) return;
    setError("");
    try {
      await api.post("/master-data/requests", {
        request_type: requestForm.request_type,
        value: requestForm.value.trim()
      });
      setRequestForm((prev) => ({ ...prev, value: "" }));
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to submit request");
    }
  }

  const kpis = useMemo(() => {
    if (!overview?.kpis) return [];
    return [
      { label: "Total Team Members", value: overview.kpis.total_team_members },
      { label: "Active Projects", value: overview.kpis.active_projects },
      { label: "Team Skill Gap Score", value: overview.kpis.team_skill_gap_score },
      { label: "Available Employees", value: overview.kpis.available_employees },
      { label: "Overloaded Employees", value: overview.kpis.overloaded_employees }
    ];
  }, [overview]);

  const filteredTeam = useMemo(() => {
    return team.filter((row) => {
      if (availabilityFilter && row.availability !== availabilityFilter) return false;
      if (skillFilter && !row.skills.some((s) => s.name.toLowerCase().includes(skillFilter.toLowerCase()))) return false;
      if (query) {
        const packed = `${row.name} ${row.role}`.toLowerCase();
        if (!packed.includes(query.toLowerCase())) return false;
      }
      return true;
    });
  }, [team, availabilityFilter, skillFilter, query]);

  const eligibleTeamForSelectedProject = useMemo(() => {
    if (!selectedProjectId) return team;
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) return team;
    return team.filter((member) => {
      if (project.department && normalizeTitle(member.department) !== normalizeTitle(project.department)) {
        return false;
      }
      const requiredTitles = (project.required_job_titles || []).map(normalizeTitle);
      if (!requiredTitles.length) return true;
      return requiredTitles.includes(normalizeTitle(member.role));
    });
  }, [team, projects, selectedProjectId]);

  const selectedProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId) || null;
  }, [projects, selectedProjectId]);

  const selectableProjects = useMemo(
    () => (showArchivedProjects ? projects : projects.filter((p) => p.status !== "cancelled")),
    [projects, showArchivedProjects]
  );

  useEffect(() => {
    loadProjectAssignments(selectedProjectId);
    loadProjectDailyReports(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (!selectableProjects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId("");
    }
  }, [selectedProjectId, selectableProjects]);

  function getAssignmentBlockReason(member, project, allocationPct = 100) {
    if (!project) return "Select a project first.";
    if (project.department && normalizeTitle(member.department) !== normalizeTitle(project.department)) {
      return `Employee department (${member.department || "—"}) does not match project department (${project.department}).`;
    }
    const requiredTitles = (project.required_job_titles || []).map(normalizeTitle);
    if (requiredTitles.length && !requiredTitles.includes(normalizeTitle(member.role))) {
      return "Employee job title does not match project required job titles.";
    }
    const currentOnProject = Number(projectAssignmentsMap[member.id] || 0);
    const projected = Number(member.workload_pct || 0) - currentOnProject + Number(allocationPct || 0);
    if (projected > 100) {
      return `Allocation would exceed 100% workload (current ${Number(member.workload_pct || 0)}%).`;
    }
    return "";
  }

  return (
    <AppShell title="Manager Dashboard">
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Grid container spacing={2}>
          <Grid item xs={12}>
            {loading ? (
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <CircularProgress size={22} />
                    <Typography>Loading manager control center...</Typography>
                  </Stack>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "home" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>Team overview</Typography>
                  <Divider sx={{ my: 2 }} />
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    {kpis.map((k) => (
                      <Grid item xs={12} md={4} key={k.label}>
                        <Card variant="outlined">
                          <CardContent>
                            <Typography variant="body2" color="text.secondary">{k.label}</Typography>
                            <Typography variant="h5" fontWeight={900}>{k.value}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>Skill distribution</Typography>
                      <Box sx={{ width: "100%", height: 260 }}>
                        <ResponsiveContainer>
                          <BarChart data={overview?.skill_distribution || []}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="skill" />
                            <YAxis />
                            <ChartTooltip />
                            <Bar dataKey="count" fill="#1976d2" />
                          </BarChart>
                        </ResponsiveContainer>
                      </Box>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>Workload distribution</Typography>
                      <Box sx={{ width: "100%", height: 260 }}>
                        <ResponsiveContainer>
                          <BarChart data={overview?.workload_distribution || []}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis />
                            <ChartTooltip />
                            <Bar dataKey="workload_pct" fill="#9c27b0" />
                          </BarChart>
                        </ResponsiveContainer>
                      </Box>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "team" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>Team members management</Typography>
                  <Divider sx={{ my: 2 }} />
                  <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                    <TextField size="small" label="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <TextField size="small" label="Skill filter" value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)} />
                    <TextField select size="small" label="Availability" value={availabilityFilter} onChange={(e) => setAvailabilityFilter(e.target.value)} sx={{ minWidth: 180 }}>
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="available">Available</MenuItem>
                      <MenuItem value="overloaded">Overloaded</MenuItem>
                    </TextField>
                  </Stack>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Role</TableCell>
                          <TableCell>Skills</TableCell>
                          <TableCell>Availability</TableCell>
                          <TableCell>Performance</TableCell>
                          <TableCell align="right">Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredTeam.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.name}</TableCell>
                            <TableCell>{row.role}</TableCell>
                            <TableCell>{row.skills.slice(0, 3).map((s) => `${s.name} (${s.level})`).join(", ")}</TableCell>
                            <TableCell><Chip size="small" color={row.availability === "overloaded" ? "error" : "success"} label={`${row.availability} (${row.workload_pct}%)`} /></TableCell>
                            <TableCell>{row.performance}%</TableCell>
                            <TableCell align="right">
                              <Button
                                size="small"
                                color="warning"
                                variant="outlined"
                                onClick={() => unassignTeamMember(row.id, row.name)}
                              >
                                Unassign
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

            {!loading && activeSection === "skills" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>Team skill overview</Typography>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Skill coverage %</Typography>
                  <Box sx={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={skillsOverview.coverage}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="skill" />
                        <YAxis />
                        <ChartTooltip />
                        <Bar dataKey="coverage_pct" fill="#2e7d32" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "gaps" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Team skill gap analysis</Typography>
                <Divider sx={{ my: 2 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Total gap rows: {gaps.length}
                </Typography>
                {gaps.length === 0 ? (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    No gap entries yet. Add project required skills and assign team members to generate gap analysis.
                  </Alert>
                ) : null}
                <TableContainer><Table size="small"><TableHead><TableRow>
                  <TableCell>Skill</TableCell><TableCell>Required</TableCell><TableCell>Current</TableCell><TableCell>Gap</TableCell><TableCell>Severity</TableCell>
                </TableRow></TableHead><TableBody>
                  {gaps.map((g) => (
                    <TableRow key={g.skill}>
                      <TableCell>{g.skill}</TableCell><TableCell>{g.required}</TableCell><TableCell>{g.current}</TableCell><TableCell>{g.gap}</TableCell>
                      <TableCell><Chip size="small" color={g.severity === "critical" ? "error" : g.severity === "moderate" ? "warning" : "success"} label={g.severity} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody></Table></TableContainer>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "projects" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Project management</Typography>
                <Divider sx={{ my: 2 }} />
                {projectFormError ? (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    {projectFormError}
                  </Alert>
                ) : null}
                <Grid container spacing={1}>
                  <Grid item xs={12} md={4}><TextField size="small" fullWidth label="Project name" value={projectForm.name} onChange={(e) => setProjectForm((p) => ({ ...p, name: e.target.value }))} /></Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      select
                      size="small"
                      fullWidth
                      label="Department"
                      value={projectForm.department}
                      onChange={(e) => {
                        const department = e.target.value;
                        setProjectForm((p) => ({
                          ...p,
                          department,
                          job_title: ""
                        }));
                      }}
                    >
                      <MenuItem value="">Select department</MenuItem>
                      {allDepartments.map((dep) => <MenuItem key={dep} value={dep}>{dep}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      select
                      size="small"
                      fullWidth
                      label="Job title"
                      value={projectForm.job_title}
                      disabled={!projectForm.department}
                      helperText={!projectForm.department ? "Select a department first" : ""}
                      onChange={(e) => setProjectForm((p) => ({ ...p, job_title: e.target.value }))}
                    >
                      <MenuItem value="">Select job title</MenuItem>
                      {allJobTitles.map((jt) => <MenuItem key={jt} value={jt}>{jt}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} md={4}><TextField size="small" fullWidth label="Deadline" type="date" InputLabelProps={{ shrink: true }} value={projectForm.deadline} onChange={(e) => setProjectForm((p) => ({ ...p, deadline: e.target.value }))} /></Grid>
                  <Grid item xs={12}><TextField size="small" fullWidth label="Description" value={projectForm.description} onChange={(e) => setProjectForm((p) => ({ ...p, description: e.target.value }))} /></Grid>
                  <Grid item xs={12} md={4}>
                    <TextField select size="small" fullWidth label="Required skill" value={projectForm.requirements[0].skill_id} onChange={(e) => setProjectForm((p) => ({ ...p, requirements: [{ ...p.requirements[0], skill_id: e.target.value }] }))}>
                      <MenuItem value="">Select skill</MenuItem>
                      {allSkills.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField
                      select
                      size="small"
                      fullWidth
                      label="Level"
                      value={projectForm.requirements[0].required_level}
                      onChange={(e) =>
                        setProjectForm((p) => ({
                          ...p,
                          requirements: [{ ...p.requirements[0], required_level: Number(e.target.value) }]
                        }))
                      }
                    >
                      {PROJECT_SKILL_LEVELS.map((level) => (
                        <MenuItem key={level} value={level}>{level}</MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField
                      select
                      size="small"
                      fullWidth
                      label="Weight"
                      value={projectForm.requirements[0].weight}
                      onChange={(e) =>
                        setProjectForm((p) => ({
                          ...p,
                          requirements: [{ ...p.requirements[0], weight: Number(e.target.value) }]
                        }))
                      }
                    >
                      {PROJECT_SKILL_WEIGHTS.map((w) => (
                        <MenuItem key={w} value={w}>{w}</MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField
                      select
                      size="small"
                      fullWidth
                      label="Employees needed"
                      value={projectForm.required_employees}
                      onChange={(e) => setProjectForm((p) => ({ ...p, required_employees: Number(e.target.value) }))}
                    >
                      {PROJECT_EMPLOYEE_COUNTS.map((n) => (
                        <MenuItem key={n} value={n}>{n}</MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <Button fullWidth variant="contained" disabled={saving} onClick={createProject}>
                      Create
                    </Button>
                  </Grid>
                </Grid>
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                  <FormControlLabel
                    control={<Checkbox checked={showArchivedProjects} onChange={(e) => setShowArchivedProjects(e.target.checked)} />}
                    label="Show archived projects"
                    sx={{ mr: 2 }}
                  />
                  <TextField
                    select
                    size="small"
                    label="View project execution reports"
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    sx={{ minWidth: 320 }}
                  >
                    {selectableProjects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                  </TextField>
                </Stack>
                <TableContainer sx={{ mb: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Employee</TableCell>
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
                      {projectDailyReports.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8}>No daily reports found for this project yet.</TableCell>
                        </TableRow>
                      ) : (
                        projectDailyReports.map((r) => (
                          <TableRow key={r.report_id}>
                            <TableCell>{r.employee}</TableCell>
                            <TableCell>{r.work_date}</TableCell>
                            <TableCell align="right">{r.hours_spent}</TableCell>
                            <TableCell align="right">{r.progress_pct}</TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell>{r.summary}</TableCell>
                            <TableCell>{r.blockers || "-"}</TableCell>
                            <TableCell>{r.next_plan || "-"}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Divider sx={{ my: 2 }} />
                <TableContainer><Table size="small"><TableHead><TableRow>
                  <TableCell>Project</TableCell><TableCell>Department</TableCell><TableCell>Status</TableCell><TableCell>Job title</TableCell><TableCell>Deadline</TableCell><TableCell>Assigned</TableCell><TableCell align="right">Action</TableCell>
                </TableRow></TableHead><TableBody>
                  {projects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.department || "-"}</TableCell>
                      <TableCell>{p.status}</TableCell>
                      <TableCell>{(p.required_job_titles || []).join(", ") || "-"}</TableCell>
                      <TableCell>{p.deadline || "-"}</TableCell>
                      <TableCell>{p.assigned_employees}/{p.required_employees}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button
                            size="small"
                            color="warning"
                            variant="outlined"
                            onClick={() => archiveProject(p.id, p.name)}
                            disabled={p.status === "cancelled"}
                          >
                            Archive
                          </Button>
                          <Button size="small" color="error" variant="outlined" onClick={() => deleteProject(p.id, p.name)}>
                            Delete
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody></Table></TableContainer>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "matching" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>AI employee matching</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Professional workforce fit analysis: reuses registration CV NLP (taxonomy parser, role-context
                  alignment, primary-skill validation) and scores each team member against the selected project&apos;s
                  department, job title, and weighted skill requirements.
                </Typography>
                <Divider sx={{ my: 2 }} />
                {matchReport ? <ProjectMatchingBriefing report={matchReport} /> : null}
                {team.length === 0 ? (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    No employees are assigned to your team yet. Matching runs only against your approved team members.
                    Ask HR/Admin to approve employees under your account (or reassign employees to you).
                  </Alert>
                ) : null}
                <FormControlLabel
                  control={<Checkbox checked={showArchivedProjects} onChange={(e) => setShowArchivedProjects(e.target.checked)} />}
                  label="Show archived projects"
                  sx={{ mb: 1 }}
                />
                <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                  <TextField
                    select
                    size="small"
                    label="Project"
                    value={selectedProjectId}
                    onChange={(e) => {
                      setSelectedProjectId(e.target.value);
                      setHasRunMatching(false);
                      setMatches([]);
                      setMatchReport(null);
                    }}
                    sx={{ minWidth: 260 }}
                  >
                    {selectableProjects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                  </TextField>
                  <Button
                    variant="contained"
                    onClick={runMatching}
                    disabled={!selectedProjectId || matchingLoading || team.length === 0}
                  >
                    {matchingLoading ? "Running..." : "Run matching"}
                  </Button>
                </Stack>
                {hasRunMatching && matches.length === 0 ? (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    No matching employees found for this project right now.
                  </Alert>
                ) : null}
                {hasRunMatching && matches.length > 0 && matches.every((m) => !m.eligible) ? (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    Candidates were found, but none are currently eligible for assignment. Review department, job titles, or workload.
                  </Alert>
                ) : null}
                {hasRunMatching && matches.length > 0 ? (
                  <>
                    <Box sx={{ display: { xs: "block", lg: "none" } }}>
                      <Stack spacing={2}>
                        {matches.map((m) => (
                          <EmployeeMatchCard key={m.employee_id} match={m} />
                        ))}
                      </Stack>
                    </Box>

                    <TableContainer sx={{ display: { xs: "none", lg: "block" }, overflowX: "auto" }}>
                      <Table size="small" sx={{ minWidth: 980 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ minWidth: 140 }}>Employee</TableCell>
                            <TableCell sx={{ minWidth: 120 }}>Job Title</TableCell>
                            <TableCell align="right">Overall</TableCell>
                            <TableCell align="right">Project</TableCell>
                            <TableCell align="right">Inventory</TableCell>
                            <TableCell align="right">CV Evidence</TableCell>
                            <TableCell align="right">Semantic</TableCell>
                            <TableCell align="right">Title</TableCell>
                            <TableCell align="right">Experience</TableCell>
                            <TableCell align="right">Gap</TableCell>
                            <TableCell>Availability</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {matches.map((m) => (
                            <React.Fragment key={m.employee_id}>
                              <TableRow hover>
                                <TableCell sx={{ fontWeight: 700, verticalAlign: "top" }}>{m.employee}</TableCell>
                                <TableCell sx={{ verticalAlign: "top", wordBreak: "break-word" }}>{m.job_title}</TableCell>
                                <TableCell align="right" sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>{m.match_pct}%</TableCell>
                                <TableCell align="right" sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                                  {m.project_alignment_pct != null ? `${m.project_alignment_pct}%` : "—"}
                                </TableCell>
                                <TableCell align="right" sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>{m.skill_match_pct}%</TableCell>
                                <TableCell align="right" sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>{m.cv_score}%</TableCell>
                                <TableCell align="right" sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                                  {m.cv_semantic_pct != null ? `${m.cv_semantic_pct}%` : "—"}
                                </TableCell>
                                <TableCell align="right" sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>{m.title_match_pct}%</TableCell>
                                <TableCell align="right" sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>{m.experience_score}%</TableCell>
                                <TableCell align="right" sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>{m.gap}</TableCell>
                                <TableCell sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>{m.availability ? "Available" : "Busy"}</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell colSpan={11} sx={{ py: 0, borderBottom: "1px solid", borderColor: "divider" }}>
                                  <Box sx={{ py: 1.5, mb: 1 }}>
                                    <MatchStatusStrip match={m} />
                                    <CvRegistrationIntelStrip match={m} />
                                    <Box sx={{ mt: 1.25 }}>
                                      <EmployeeMatchRationale match={m} />
                                    </Box>
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
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "assignment" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Project assignment</Typography>
                <Divider sx={{ my: 2 }} />
                {assignSuccess ? <Alert severity="success" sx={{ mb: 2 }}>{assignSuccess}</Alert> : null}
                <FormControlLabel
                  control={<Checkbox checked={showArchivedProjects} onChange={(e) => setShowArchivedProjects(e.target.checked)} />}
                  label="Show archived projects"
                  sx={{ mb: 1 }}
                />
                <Stack direction="row" spacing={1}>
                  <TextField
                    select
                    size="small"
                    label="Project"
                    value={selectedProjectId}
                    onChange={(e) => {
                      setSelectedProjectId(e.target.value);
                      setAssignEmployeeId("");
                      setAssignSuccess("");
                    }}
                    sx={{ minWidth: 240 }}
                  >
                    {selectableProjects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                  </TextField>
                  <TextField select size="small" label="Employee" value={assignEmployeeId} onChange={(e) => setAssignEmployeeId(e.target.value)} sx={{ minWidth: 300 }}>
                    {team.map((t) => {
                      const reason = getAssignmentBlockReason(t, selectedProject, assignAllocationPct);
                      const currentAllocation = projectAssignmentsMap[t.id] || 0;
                      return (
                        <MenuItem key={t.id} value={t.id} disabled={Boolean(reason)}>
                          {t.name} ({t.role}) — current project allocation: {currentAllocation}%{reason ? ` — ${reason}` : ""}
                        </MenuItem>
                      );
                    })}
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label="Allocation %"
                    value={assignAllocationPct}
                    onChange={(e) => setAssignAllocationPct(Number(e.target.value))}
                    sx={{ minWidth: 140 }}
                  >
                    {[25, 50, 75, 100].map((v) => (
                      <MenuItem key={v} value={v}>{v}%</MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="contained"
                    onClick={assignEmployee}
                    disabled={!selectedProjectId || !assignEmployeeId}
                  >
                    Assign
                  </Button>
                </Stack>
                {selectedProjectId && eligibleTeamForSelectedProject.length === 0 ? (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    No team members match this project's department and required job titles.
                  </Alert>
                ) : null}
                {selectedProjectId ? (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Current project assignments</Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Employee</TableCell>
                            <TableCell align="right">Allocation</TableCell>
                            <TableCell align="right">Action</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {Object.keys(projectAssignmentsMap).length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={3}>No employees assigned to this project yet.</TableCell>
                            </TableRow>
                          ) : (
                            Object.entries(projectAssignmentsMap).map(([employeeId, allocation]) => {
                              const employee = team.find((t) => t.id === employeeId);
                              return (
                                <TableRow key={employeeId}>
                                  <TableCell>{employee?.name || employeeId}</TableCell>
                                  <TableCell align="right">{allocation}%</TableCell>
                                  <TableCell align="right">
                                    <Button
                                      size="small"
                                      color="warning"
                                      variant="outlined"
                                      onClick={() => unassignFromProject(employeeId)}
                                    >
                                      Remove
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </>
                ) : null}
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "requests" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Master data requests</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Managers can request new departments, job titles, or skills. HR/System Admin review these requests.
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mb: 2 }}>
                  <TextField
                    select
                    size="small"
                    label="Request type"
                    value={requestForm.request_type}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, request_type: e.target.value }))}
                    sx={{ minWidth: 180 }}
                  >
                    <MenuItem value="department">Department</MenuItem>
                    <MenuItem value="job_title">Job title</MenuItem>
                    <MenuItem value="skill">Primary skill</MenuItem>
                  </TextField>
                  <TextField
                    size="small"
                    label="Requested value"
                    value={requestForm.value}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, value: e.target.value }))}
                    fullWidth
                  />
                  <Button variant="contained" onClick={submitCatalogRequest}>Submit</Button>
                </Stack>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Type</TableCell>
                        <TableCell>Value</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {catalogRequests.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3}>No requests submitted yet.</TableCell>
                        </TableRow>
                      ) : (
                        catalogRequests.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>{r.request_type}</TableCell>
                            <TableCell>{r.value}</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={r.status}
                                color={r.status === "approved" ? "success" : r.status === "rejected" ? "error" : "warning"}
                              />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "workload" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Workload & availability</Typography>
                <Divider sx={{ my: 2 }} />
                <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Employee</TableCell><TableCell>Workload %</TableCell><TableCell>Status</TableCell></TableRow></TableHead><TableBody>
                  {workload.map((w) => <TableRow key={w.employee_id}><TableCell>{w.employee}</TableCell><TableCell>{w.workload_pct}</TableCell><TableCell>{w.availability}</TableCell></TableRow>)}
                </TableBody></Table></TableContainer>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "performance" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Team performance monitoring</Typography>
                <Divider sx={{ my: 2 }} />
                <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Employee</TableCell><TableCell>Performance</TableCell><TableCell>Completion rate</TableCell><TableCell>Skill improvement</TableCell></TableRow></TableHead><TableBody>
                  {performance.map((p) => <TableRow key={p.employee_id}><TableCell>{p.employee}</TableCell><TableCell>{p.performance_score}</TableCell><TableCell>{p.task_completion_rate}%</TableCell><TableCell>{p.skill_improvement}%</TableCell></TableRow>)}
                </TableBody></Table></TableContainer>
              </CardContent></Card>
            ) : null}

            {!loading && activeSection === "alerts" ? (
              <Card variant="outlined"><CardContent>
                <Typography variant="h6" fontWeight={800}>Alerts & risks</Typography>
                <Divider sx={{ my: 2 }} />
                <Stack spacing={1}>
                  {alerts.length === 0 ? <Alert severity="success">No current risks.</Alert> : alerts.map((a, idx) => <Alert key={`${a.type}-${idx}`} severity={a.severity === "critical" ? "error" : a.severity === "moderate" ? "warning" : "info"}>{a.message}</Alert>)}
                </Stack>
              </CardContent></Card>
            ) : null}
          </Grid>
        </Grid>
      </Stack>
    </AppShell>
  );
}

