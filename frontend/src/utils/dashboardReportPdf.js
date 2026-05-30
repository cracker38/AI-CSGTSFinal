import jsPDF from "jspdf";
import { drawBrandLogoPdf } from "./brandLogoPdf.js";

function isMainReport(reportType) {
  return (reportType || "main") === "main";
}

function isDivisionReport(reportType, key) {
  return reportType === key;
}

function topGapRows(gaps, limit = 6) {
  return (gaps || [])
    .filter((g) => Number(g.gap) > 0)
    .sort((a, b) => {
      const sev = { high: 3, medium: 2, low: 1 };
      return (sev[b.severity] || 0) - (sev[a.severity] || 0) || Number(b.gap) - Number(a.gap);
    })
    .slice(0, limit);
}

function buildEmployeeMainBrief(r, data) {
  const { kpis = [], profile, intel, gaps, recommendations = [], trainingProgress = {}, projects = [] } = data;
  r.section("Executive brief", "Professional summary — key metrics and priorities only");
  r.kpis(kpis.slice(0, 4), 4);
  r.keyValueRows([
    ["Employee", profile?.basic?.name],
    ["Department", profile?.basic?.department],
    ["Job title", profile?.basic?.job_title],
    ["Target role", intel?.positions?.target_job_title || profile?.career_preferences?.target_job_title],
    ["Primary skill", profile?.basic?.primary_skill],
    ["Role alignment", intel?.alignment_score_target_role != null ? fmtPct(intel.alignment_score_target_role) : "—"],
    ["CV quality", intel?.cv_competency?.quality_score != null ? `${intel.cv_competency.quality_score}%` : "—"]
  ]);
  const bullets = (intel?.narrative?.bullets || profile?.cv_intel?.analysis_bullets || []).slice(0, 5);
  if (bullets.length) {
    r.section("Key insights");
    r.bullets(bullets);
  }
  const priorityGaps = topGapRows(gaps?.gaps, 6);
  if (priorityGaps.length) {
    r.section("Priority skill gaps");
    r.table(
      [
        { header: "Skill", value: (row) => row.skill },
        { header: "Gap", value: (row) => row.gap },
        { header: "Severity", value: (row) => row.severity }
      ],
      priorityGaps,
      { maxRows: 6 }
    );
  }
  r.section("Development snapshot");
  r.kpis(
    [
      { label: "Active training", value: (trainingProgress.active_courses || []).length },
      { label: "Completed", value: (trainingProgress.completed_courses || []).length },
      { label: "Pending HR", value: (trainingProgress.pending_requests || []).length },
      { label: "Open projects", value: projects.length }
    ],
    4
  );
  if (recommendations.length) {
    r.table(
      [
        { header: "Recommended course", value: (row) => safeLines(row.course, 48) },
        { header: "Skill", value: (row) => row.skill },
        { header: "Match", value: (row) => fmtPct(row.match_pct) }
      ],
      recommendations.slice(0, 4),
      { maxRows: 4, emptyText: "No recommendations." }
    );
  }
  if (projects.length) {
    r.table(
      [
        { header: "Project", value: (row) => row.name },
        { header: "Status", value: (row) => row.status },
        { header: "Progress", value: (row) => fmtPct(row.progress_pct) }
      ],
      projects.slice(0, 4),
      { maxRows: 4 }
    );
  }
}

function buildManagerTeamDirectoryReport(r, data) {
  const { team = [], overview, kpis = [] } = data;
  const deptRows = Object.entries(
    team.reduce((acc, m) => {
      const d = (m.department || "Unassigned").trim() || "Unassigned";
      acc[d] = (acc[d] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);
  const available = team.filter((m) => m.availability === "available").length;
  const overloaded = team.filter((m) => m.availability === "overloaded").length;

  r.section("Team overview", "Official register of employees assigned to your management unit");
  r.kpis(
    [
      { label: "Team members", value: team.length },
      { label: "Available", value: available },
      { label: "Overloaded", value: overloaded },
      { label: "Active projects", value: overview?.kpis?.active_projects ?? kpis.find((k) => k.label?.includes("project"))?.value ?? "—" }
    ],
    4
  );

  r.section("Headcount by department");
  r.table(
    [
      { header: "Department", value: (row) => row.department },
      { header: "Members", value: (row) => row.count },
      { header: "Share", value: (row) => (team.length ? fmtPct(Math.round((100 * row.count) / team.length)) : "—") }
    ],
    deptRows,
    { maxRows: 30, emptyText: "No team members assigned." }
  );

  r.section("Complete team roster", `${team.length} member(s) — sorted alphabetically`);
  r.table(
    [
      { header: "Name", value: (row) => row.name },
      { header: "Job title", value: (row) => row.role },
      { header: "Department", value: (row) => row.department },
      { header: "Skills", value: (row) => (row.skills || []).slice(0, 5).map((s) => `${s.name} (${s.level})`).join(", ") },
      { header: "Workload", value: (row) => fmtPct(row.workload_pct) },
      { header: "Availability", value: (row) => row.availability },
      { header: "Performance", value: (row) => (row.performance != null ? `${row.performance}%` : "—") },
      { header: "Training", value: (row) => (row.training_completion_pct != null ? `${row.training_completion_pct}%` : "—") }
    ],
    [...team].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    { maxRows: 200, emptyText: "No team members on record." }
  );
}

function buildManagerTeamPerformanceReport(r, data) {
  const rows = [...(data.performance || [])].sort(
    (a, b) => Number(b.performance_score || 0) - Number(a.performance_score || 0)
  );
  const avg = (key) =>
    rows.length ? round(rows.reduce((s, row) => s + Number(row[key] || 0), 0) / rows.length, 1) : 0;
  const high = rows.filter((row) => Number(row.performance_score || 0) >= 70).length;
  const developing = rows.filter((row) => {
    const s = Number(row.performance_score || 0);
    return s >= 45 && s < 70;
  }).length;
  const focus = rows.filter((row) => Number(row.performance_score || 0) < 45).length;

  r.section("Team performance summary", "Composite scores from project delivery, skill targets, and training progress");
  r.kpis(
    [
      { label: "Team members scored", value: rows.length },
      { label: "Avg performance", value: avg("performance_score") },
      { label: "Avg task completion", value: `${avg("task_completion_rate")}%` },
      { label: "Avg skill improvement", value: `${avg("skill_improvement")}%` }
    ],
    4
  );
  r.kpis(
    [
      { label: "Strong (≥70)", value: high },
      { label: "Developing (45–69)", value: developing },
      { label: "Focus required (<45)", value: focus },
      { label: "Avg training completion", value: `${avg("training_completion_pct")}%` }
    ],
    4
  );

  r.section("Team performance register", "Sorted by composite performance score (highest first)");
  r.table(
    [
      { header: "Employee", value: (row) => row.employee },
      { header: "Performance", value: (row) => row.performance_score },
      { header: "Task completion", value: (row) => `${row.task_completion_rate}%` },
      { header: "Skill improvement", value: (row) => `${row.skill_improvement}%` },
      { header: "Training", value: (row) => `${row.training_completion_pct}%` },
      { header: "Projects tracked", value: (row) => row.projects_tracked ?? "—" }
    ],
    rows,
    { maxRows: 200, emptyText: "No performance data for your team." }
  );

  const top = rows.slice(0, 10);
  if (top.length) {
    r.section("Top performers on your team");
    r.table(
      [
        { header: "Rank", value: (row) => row.rank },
        { header: "Employee", value: (row) => row.employee },
        { header: "Score", value: (row) => row.performance_score },
        { header: "Training", value: (row) => `${row.training_completion_pct}%` }
      ],
      top.map((row, i) => ({ ...row, rank: i + 1 })),
      { maxRows: 10 }
    );
  }
}

function buildManagerTeamTrainingReport(r, data) {
  const teamTraining = data.teamTraining || [];
  const inSession = teamTraining.filter((t) => t.session_active || t.learning_state === "in_session").length;
  const pending = teamTraining.filter((t) => t.status === "pending").length;
  const employeeIds = new Set(teamTraining.map((t) => t.employee_id || t.employee_name));

  const byEmployee = Object.values(
    teamTraining.reduce((acc, row) => {
      const key = row.employee_id || row.employee_name || "unknown";
      if (!acc[key]) {
        acc[key] = {
          employee_name: row.employee_name,
          employee_email: row.employee_email,
          department: row.department,
          courses: 0,
          max_progress: 0,
          in_session: false,
          has_pending: false
        };
      }
      acc[key].courses += 1;
      acc[key].max_progress = Math.max(acc[key].max_progress, Number(row.progress_pct) || 0);
      if (row.session_active || row.learning_state === "in_session") acc[key].in_session = true;
      if (row.status === "pending") acc[key].has_pending = true;
      return acc;
    }, {})
  ).sort((a, b) => String(a.employee_name || "").localeCompare(String(b.employee_name || "")));

  r.section("Team training operations", "Direct reports currently enrolled in HR learning programs");
  r.kpis(
    [
      { label: "Active assignments", value: teamTraining.length },
      { label: "Team members in training", value: employeeIds.size },
      { label: "Learning now (in session)", value: inSession },
      { label: "Pending HR approval", value: pending }
    ],
    4
  );

  r.section("Team members in training", `${employeeIds.size} employee(s) with open programs`);
  r.table(
    [
      { header: "Employee", value: (row) => row.employee_name },
      { header: "Email", value: (row) => row.employee_email },
      { header: "Department", value: (row) => row.department },
      { header: "Open courses", value: (row) => row.courses },
      { header: "Best progress", value: (row) => fmtPct(row.max_progress) },
      { header: "In session", value: (row) => (row.in_session ? "Yes" : "No") },
      { header: "Pending HR", value: (row) => (row.has_pending ? "Yes" : "No") }
    ],
    byEmployee,
    { maxRows: 200, emptyText: "No team members currently in training." }
  );

  r.section("Active course assignments", "Full detail — program, skill target, progress, and attendance");
  r.table(
    [
      { header: "Employee", value: (row) => row.employee_name },
      { header: "Program", value: (row) => safeLines(row.program_name, 36) },
      { header: "Target skill", value: (row) => row.target_skill },
      { header: "Progress", value: (row) => fmtPct(row.progress_pct) },
      { header: "Status", value: (row) => row.status },
      { header: "Learning state", value: (row) => String(row.learning_state || "—").replace(/_/g, " ") },
      { header: "Verified time", value: (row) => row.total_learning_display || row.total_learning_seconds || "—" },
      { header: "Sessions", value: (row) => row.sessions_completed ?? "—" }
    ],
    teamTraining,
    { maxRows: 200, emptyText: "No active training on your team." }
  );
}

function buildHrEmployeeDirectoryReport(r, data) {
  const { records = [], pending = [], managers = [] } = data;
  const employees = records.filter((x) => x.role === "employee");
  const managerMap = Object.fromEntries(
    (managers || []).map((m) => [String(m.id), m.name || m.full_name || "—"])
  );
  const deptRows = Object.entries(
    employees.reduce((acc, e) => {
      const d = (e.department || "Unassigned").trim() || "Unassigned";
      acc[d] = (acc[d] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);

  r.section("Workforce overview", "Official register of all employee accounts in the organization");
  r.kpis(
    [
      { label: "Total employees", value: employees.length },
      { label: "Active accounts", value: employees.filter((e) => e.status === "active").length },
      { label: "Pending approval", value: pending.length },
      { label: "Departments", value: deptRows.length }
    ],
    4
  );

  r.section("Headcount by department");
  r.table(
    [
      { header: "Department", value: (row) => row.department },
      { header: "Employees", value: (row) => row.count },
      { header: "Share", value: (row) => (employees.length ? fmtPct(Math.round((100 * row.count) / employees.length)) : "—") }
    ],
    deptRows,
    { maxRows: 40, emptyText: "No employees on record." }
  );

  r.section("Complete employee list", `${employees.length} record(s) — sorted alphabetically`);
  r.table(
    [
      { header: "Name", value: (row) => row.full_name },
      { header: "Email", value: (row) => row.email },
      { header: "Department", value: (row) => row.department },
      { header: "Job title", value: (row) => row.job_title },
      { header: "Primary skill", value: (row) => row.primary_skill },
      { header: "Experience", value: (row) => row.experience_level },
      { header: "Manager", value: (row) => (row.manager_id ? managerMap[String(row.manager_id)] || "Assigned" : "—") },
      { header: "Status", value: (row) => row.status }
    ],
    [...employees].sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""))),
    { maxRows: 500, emptyText: "No employee records." }
  );

  if (pending.length) {
    r.section("Pending registrations", "New accounts awaiting HR approval");
    r.table(
      [
        { header: "Name", value: (row) => row.full_name },
        { header: "Email", value: (row) => row.email },
        { header: "Department", value: (row) => row.department },
        { header: "Job title", value: (row) => row.job_title },
        { header: "Role", value: (row) => row.role }
      ],
      pending,
      { maxRows: 40 }
    );
  }
}

function buildHrEmployeePerformanceReport(r, data) {
  const rows = [...(data.performanceData?.rows || [])].sort(
    (a, b) => Number(b.performance_score || 0) - Number(a.performance_score || 0)
  );
  const avg = (key) =>
    rows.length ? round(rows.reduce((s, row) => s + Number(row[key] || 0), 0) / rows.length, 1) : 0;
  const high = rows.filter((row) => Number(row.performance_score || 0) >= 70).length;
  const developing = rows.filter((row) => {
    const s = Number(row.performance_score || 0);
    return s >= 45 && s < 70;
  }).length;
  const focus = rows.filter((row) => Number(row.performance_score || 0) < 45).length;

  r.section("Performance summary", "Composite scores from project delivery, skill targets, and training progress");
  r.kpis(
    [
      { label: "Employees scored", value: rows.length },
      { label: "Avg performance", value: avg("performance_score") },
      { label: "Avg skill improvement", value: `${avg("skill_improvement")}%` },
      { label: "Avg training completion", value: `${avg("training_completion")}%` }
    ],
    4
  );
  r.kpis(
    [
      { label: "Strong (≥70)", value: high },
      { label: "Developing (45–69)", value: developing },
      { label: "Focus required (<45)", value: focus },
      { label: "Avg project success", value: `${avg("project_success")}%` }
    ],
    4
  );

  r.section("Employee performance register", "Sorted by composite performance score (highest first)");
  r.table(
    [
      { header: "Employee", value: (row) => row.employee },
      { header: "Department", value: (row) => row.department },
      { header: "Performance", value: (row) => row.performance_score },
      { header: "Project success", value: (row) => `${row.project_success}%` },
      { header: "Skill improvement", value: (row) => `${row.skill_improvement}%` },
      { header: "Training", value: (row) => `${row.training_completion}%` },
      { header: "Skills on target", value: (row) => row.skills_meeting_target },
      { header: "Trainings done", value: (row) => row.trainings_completed }
    ],
    rows,
    { maxRows: 300, emptyText: "No performance data available." }
  );

  const top = rows.slice(0, 10);
  if (top.length) {
    r.section("Top performers", "Highest composite scores — recognition and succession planning");
    r.table(
      [
        { header: "Rank", value: (row) => row.rank },
        { header: "Employee", value: (row) => row.employee },
        { header: "Department", value: (row) => row.department },
        { header: "Score", value: (row) => row.performance_score }
      ],
      top.map((row, i) => ({ ...row, rank: i + 1 })),
      { maxRows: 10 }
    );
  }
}

function buildHrTrainingActiveReport(r, data) {
  const { hrOpenTrainings = [], hrPendingEnrollments = [], trainingPlan = {} } = data;
  const inSession = hrOpenTrainings.filter((t) => t.session_active || t.learning_state === "in_session").length;
  const employeeIds = new Set(hrOpenTrainings.map((t) => t.employee_id || t.employee_name));

  const byEmployee = Object.values(
    hrOpenTrainings.reduce((acc, row) => {
      const key = row.employee_id || row.employee_name || "unknown";
      if (!acc[key]) {
        acc[key] = {
          employee_name: row.employee_name,
          employee_email: row.employee_email,
          courses: 0,
          max_progress: 0,
          in_session: false,
          total_verified: row.total_learning_display || "—"
        };
      }
      acc[key].courses += 1;
      acc[key].max_progress = Math.max(acc[key].max_progress, Number(row.progress_pct) || 0);
      if (row.session_active || row.learning_state === "in_session") acc[key].in_session = true;
      return acc;
    }, {})
  ).sort((a, b) => String(a.employee_name || "").localeCompare(String(b.employee_name || "")));

  r.section("Training operations", "Employees currently enrolled in HR-assigned learning programs");
  r.kpis(
    [
      { label: "Active assignments", value: hrOpenTrainings.length },
      { label: "Employees in training", value: employeeIds.size },
      { label: "Learning now (in session)", value: inSession },
      { label: "Pending enrollments", value: hrPendingEnrollments.length }
    ],
    4
  );
  r.kpis(
    [
      { label: "Org completion rate", value: fmtPct(trainingPlan.training_completion_rate_pct) },
      { label: "Completed (org)", value: trainingPlan.assignment_stats?.completed ?? "—" },
      { label: "Active (org)", value: trainingPlan.assignment_stats?.active ?? hrOpenTrainings.length },
      { label: "Budget committed", value: trainingPlan.budget?.committed_spend != null ? `$${trainingPlan.budget.committed_spend}` : "—" }
    ],
    4
  );

  r.section("Employees in training", `${employeeIds.size} employee(s) with open assignments`);
  r.table(
    [
      { header: "Employee", value: (row) => row.employee_name },
      { header: "Email", value: (row) => row.employee_email },
      { header: "Open courses", value: (row) => row.courses },
      { header: "Best progress", value: (row) => fmtPct(row.max_progress) },
      { header: "In session", value: (row) => (row.in_session ? "Yes" : "No") },
      { header: "Verified time", value: (row) => row.total_verified }
    ],
    byEmployee,
    { maxRows: 200, emptyText: "No employees currently in training." }
  );

  r.section("Active course assignments", "Full detail — program, skill target, progress, and attendance");
  r.table(
    [
      { header: "Employee", value: (row) => row.employee_name },
      { header: "Program", value: (row) => safeLines(row.program_name, 36) },
      { header: "Target skill", value: (row) => row.target_skill },
      { header: "Progress", value: (row) => fmtPct(row.progress_pct) },
      { header: "Status", value: (row) => row.status },
      { header: "Learning state", value: (row) => String(row.learning_state || "—").replace(/_/g, " ") },
      { header: "Verified time", value: (row) => row.total_learning_display || row.total_learning_seconds || "—" },
      { header: "Sessions", value: (row) => row.sessions_completed ?? "—" }
    ],
    hrOpenTrainings,
    { maxRows: 200, emptyText: "No active training assignments." }
  );

  if (hrPendingEnrollments.length) {
    r.section("Enrollment requests pending HR approval");
    r.table(
      [
        { header: "Employee", value: (row) => row.employee_name },
        { header: "Course", value: (row) => safeLines(row.course || row.program_name, 40) },
        { header: "Skill", value: (row) => row.skill || row.target_skill },
        { header: "Requested", value: (row) => (row.created_at || row.requested_at || "").slice(0, 10) }
      ],
      hrPendingEnrollments,
      { maxRows: 40 }
    );
  }
}

function round(n, d = 1) {
  const f = 10 ** d;
  return Math.round(Number(n) * f) / f;
}

function mainReportFooter(r) {
  r.spacer(2);
  r.paragraph(
    "This is an executive brief with selected highlights only. Download the division reports (Executive, Training, Talent, etc.) from the Report section for complete tables and audit detail."
  );
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 12;
const HEADER_H = 22;

const C = {
  primary: [25, 118, 210],
  secondary: [46, 125, 50],
  dark: [25, 35, 55],
  muted: [100, 116, 139],
  light: [248, 250, 252],
  border: [226, 232, 240],
  white: [255, 255, 255],
  warn: [237, 108, 2],
  danger: [211, 47, 47]
};

function fmt(v) {
  if (v == null || v === "") return "—";
  return String(v);
}

function fmtPct(v) {
  if (v == null || v === "") return "—";
  return typeof v === "number" ? `${v}%` : String(v);
}

function safeLines(text, maxLen = 420) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

class ReportBuilder {
  constructor(options = {}) {
    this.pdf = new jsPDF("p", "mm", "a4");
    this.options = {
      logoText: "AI-CSGTS",
      title: "Workforce Intelligence Report",
      subtitle: "",
      role: "user",
      roleLabel: "Dashboard",
      section: "overview",
      sectionLabel: "Overview",
      generatedAt: new Date(),
      confidential: true,
      ...options
    };
    this.y = MARGIN + HEADER_H;
    this.page = 1;
    this._drawPageChrome();
  }

  _setColor(rgb, type = "text") {
    this.pdf[`set${type === "fill" ? "Fill" : "Text"}Color`](...rgb);
  }

  _drawPageChrome() {
    const { logoText, title, roleLabel, sectionLabel, generatedAt } = this.options;
    const p = this.pdf;

    p.setFillColor(...C.light);
    p.rect(0, 0, PAGE_W, HEADER_H, "F");
    p.setFillColor(...C.primary);
    p.rect(0, 0, 3, HEADER_H, "F");
    drawBrandLogoPdf(p, MARGIN, 3.5, 9);

    this._setColor(C.dark);
    p.setFont("helvetica", "bold");
    p.setFontSize(8);
    p.text(logoText, MARGIN + 11, 7);
    p.setFontSize(11);
    p.text(title, MARGIN + 11, 14);

    this._setColor(C.muted);
    p.setFont("helvetica", "normal");
    p.setFontSize(8);
    p.text(`${roleLabel} · ${sectionLabel}`, PAGE_W - MARGIN, 8, { align: "right" });
    p.text(new Date(generatedAt).toLocaleString(), PAGE_W - MARGIN, 14, { align: "right" });

    p.setDrawColor(...C.border);
    p.line(MARGIN, HEADER_H + 1, PAGE_W - MARGIN, HEADER_H + 1);

    p.setFillColor(...C.light);
    p.rect(0, PAGE_H - FOOTER_H, PAGE_W, FOOTER_H, "F");
    this._setColor(C.muted);
    p.setFontSize(7.5);
    p.text("Confidential — AI-CSGTS Workforce Intelligence", MARGIN, PAGE_H - 5);
    p.text(`Page ${this.page}`, PAGE_W - MARGIN, PAGE_H - 5, { align: "right" });
  }

  _newPage() {
    this.pdf.addPage();
    this.page += 1;
    this.y = MARGIN + HEADER_H;
    this._drawPageChrome();
  }

  ensureSpace(needed) {
    if (this.y + needed > PAGE_H - FOOTER_H - 4) {
      this._newPage();
    }
  }

  coverBlock() {
    const { title, subtitle, roleLabel, sectionLabel, generatedAt } = this.options;
    this.y = MARGIN + HEADER_H + 6;

    this.pdf.setFillColor(...C.primary);
    this.pdf.roundedRect(MARGIN, this.y, CONTENT_W, 36, 3, 3, "F");
    drawBrandLogoPdf(this.pdf, MARGIN + 6, this.y + 6, 14);
    this._setColor(C.white);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(18);
    this.pdf.text(title, MARGIN + 24, this.y + 14);
    this.pdf.setFont("helvetica", "normal");
    this.pdf.setFontSize(10);
    const sub = safeLines(subtitle || `${roleLabel} comprehensive analytics export`, 90);
    this.pdf.text(sub, MARGIN + 24, this.y + 22, { maxWidth: CONTENT_W - 30 });

    this.pdf.setFontSize(9);
    this.pdf.text(`Section: ${sectionLabel}`, MARGIN + 24, this.y + 30);
    this.pdf.text(`Generated ${new Date(generatedAt).toLocaleString()}`, PAGE_W - MARGIN - 8, this.y + 30, {
      align: "right"
    });

    this.y += 44;
    return this;
  }

  section(title, subtitle = "") {
    this.ensureSpace(16);
    this.pdf.setFillColor(...C.primary);
    this.pdf.rect(MARGIN, this.y, 2.5, 10, "F");
    this._setColor(C.dark);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(12);
    this.pdf.text(String(title), MARGIN + 6, this.y + 7);
    this.y += 12;
    if (subtitle) {
      this._setColor(C.muted);
      this.pdf.setFont("helvetica", "normal");
      this.pdf.setFontSize(8.5);
      const lines = this.pdf.splitTextToSize(safeLines(subtitle, 300), CONTENT_W);
      lines.forEach((ln) => {
        this.ensureSpace(5);
        this.pdf.text(ln, MARGIN, this.y);
        this.y += 4.2;
      });
      this.y += 2;
    }
    return this;
  }

  kpis(items = [], cols = 4) {
    if (!items.length) return this;
    const colW = CONTENT_W / cols;
    const boxH = 22;
    const rows = Math.ceil(items.length / cols);
    this.ensureSpace(rows * (boxH + 4) + 4);

    items.forEach((kpi, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = MARGIN + col * colW + (col > 0 ? 2 : 0);
      const y = this.y + row * (boxH + 4);
      const w = colW - 3;

      this.pdf.setDrawColor(...C.border);
      this.pdf.setFillColor(...C.white);
      this.pdf.roundedRect(x, y, w, boxH, 2, 2, "FD");
      this.pdf.setFillColor(...(idx % 2 === 0 ? C.primary : C.secondary));
      this.pdf.rect(x, y, w, 1.2, "F");

      this._setColor(C.muted);
      this.pdf.setFont("helvetica", "normal");
      this.pdf.setFontSize(7.5);
      this.pdf.text(String(kpi.label || ""), x + 4, y + 7, { maxWidth: w - 8 });

      this._setColor(C.dark);
      this.pdf.setFont("helvetica", "bold");
      this.pdf.setFontSize(13);
      this.pdf.text(fmt(kpi.value), x + 4, y + 16, { maxWidth: w - 8 });
    });

    this.y += rows * (boxH + 4) + 4;
    return this;
  }

  paragraph(text) {
    const lines = this.pdf.splitTextToSize(safeLines(text, 800), CONTENT_W);
    lines.forEach((ln) => {
      this.ensureSpace(5);
      this._setColor(C.dark);
      this.pdf.setFont("helvetica", "normal");
      this.pdf.setFontSize(9);
      this.pdf.text(ln, MARGIN, this.y);
      this.y += 4.5;
    });
    this.y += 2;
    return this;
  }

  bullets(items = []) {
    items.filter(Boolean).forEach((item) => {
      const lines = this.pdf.splitTextToSize(`• ${safeLines(item, 350)}`, CONTENT_W - 4);
      lines.forEach((ln, i) => {
        this.ensureSpace(5);
        this._setColor(C.dark);
        this.pdf.setFont("helvetica", "normal");
        this.pdf.setFontSize(8.5);
        this.pdf.text(ln, MARGIN + (i === 0 ? 0 : 4), this.y);
        this.y += 4.3;
      });
    });
    this.y += 2;
    return this;
  }

  keyValueRows(rows = []) {
    if (!rows.length) return this;
    rows.forEach(([label, value]) => {
      this.ensureSpace(7);
      this._setColor(C.muted);
      this.pdf.setFont("helvetica", "normal");
      this.pdf.setFontSize(8);
      this.pdf.text(String(label), MARGIN, this.y);
      this._setColor(C.dark);
      this.pdf.setFont("helvetica", "bold");
      this.pdf.setFontSize(9);
      const valLines = this.pdf.splitTextToSize(fmt(value), CONTENT_W * 0.55);
      valLines.forEach((ln, i) => {
        if (i > 0) this.ensureSpace(5);
        this.pdf.text(ln, PAGE_W - MARGIN, this.y + i * 4.2, { align: "right" });
      });
      this.y += Math.max(5, valLines.length * 4.2) + 1.5;
    });
    this.y += 2;
    return this;
  }

  table(columns, rows, options = {}) {
    if (!columns?.length) return this;
    const { maxRows = 40, emptyText = "No records." } = options;
    const dataRows = (rows || []).slice(0, maxRows);
    const colCount = columns.length;
    const colW = CONTENT_W / colCount;
    const headerH = 8;
    const rowH = 7;
    const drawHeader = () => {
      this.ensureSpace(headerH + 4);
      this.pdf.setFillColor(...C.primary);
      this.pdf.rect(MARGIN, this.y, CONTENT_W, headerH, "F");
      this._setColor(C.white);
      this.pdf.setFont("helvetica", "bold");
      this.pdf.setFontSize(7.5);
      columns.forEach((col, i) => {
        const x = MARGIN + i * colW + 2;
        this.pdf.text(String(col.header || ""), x, this.y + 5.5, { maxWidth: colW - 4 });
      });
      this.y += headerH;
    };

    drawHeader();

    if (!dataRows.length) {
      this.ensureSpace(8);
      this._setColor(C.muted);
      this.pdf.setFont("helvetica", "italic");
      this.pdf.setFontSize(8.5);
      this.pdf.text(emptyText, MARGIN + 2, this.y + 5);
      this.y += 10;
      return this;
    }

    dataRows.forEach((row, rIdx) => {
      if (this.y + rowH > PAGE_H - FOOTER_H - 4) {
        this._newPage();
        drawHeader();
      }
      if (rIdx % 2 === 0) {
        this.pdf.setFillColor(...C.light);
        this.pdf.rect(MARGIN, this.y, CONTENT_W, rowH, "F");
      }
      this._setColor(C.dark);
      this.pdf.setFont("helvetica", "normal");
      this.pdf.setFontSize(7.2);
      columns.forEach((col, i) => {
        const raw = col.value ? col.value(row) : row[col.key];
        const cell = fmt(raw);
        const x = MARGIN + i * colW + 2;
        this.pdf.text(cell, x, this.y + 5, { maxWidth: colW - 4 });
      });
      this.y += rowH;
    });

    if ((rows || []).length > maxRows) {
      this.paragraph(`… and ${rows.length - maxRows} more row(s) not shown.`);
    }
    this.y += 4;
    return this;
  }

  spacer(h = 4) {
    this.y += h;
    return this;
  }

  save(filename) {
    this.pdf.save(filename);
  }
}

export function exportEmployeeDashboardReport(data, filename = "employee-workforce-report.pdf") {
  const {
    userName,
    sectionLabel,
    kpis = [],
    profile,
    intel,
    skills = [],
    gaps,
    projects = [],
    recommendations = [],
    trainingProgress = {},
    goals = [],
    complianceRequirements = [],
    notifications = [],
    careerPaths = [],
    projectReports = [],
    experienceTimeline = []
  } = data;

  const reportType = data.reportType || "main";

  const r = new ReportBuilder({
    title: data.reportTitle || "Employee Workforce Report",
    subtitle: data.reportSubtitle || intel?.narrative?.headline || "Personal competency, gaps, training, and project intelligence",
    role: "employee",
    roleLabel: userName ? `Employee · ${userName}` : "Employee",
    section: data.section || "full",
    sectionLabel: sectionLabel || "Full dashboard"
  });

  r.coverBlock();
  if (isMainReport(reportType)) {
    buildEmployeeMainBrief(r, data);
    mainReportFooter(r);
    r.save(filename);
    return;
  }

  if (isDivisionReport(reportType, "competency")) {
    r.section("Executive summary", intel?.narrative?.subtitle || "CV-driven developmental intelligence");
    r.kpis(kpis, 4);
    r.bullets(intel?.narrative?.bullets || profile?.cv_intel?.analysis_bullets || []);
  }

  if (isDivisionReport(reportType, "competency")) {
    r.section("Profile & CV intelligence");
  r.keyValueRows([
    ["Name", profile?.basic?.name],
    ["Email", profile?.basic?.email],
    ["Department", profile?.basic?.department],
    ["Job title (HR)", profile?.basic?.job_title],
    ["Target role", intel?.positions?.target_job_title || profile?.career_preferences?.target_job_title],
    ["Primary skill", profile?.basic?.primary_skill],
    ["CV pipeline", profile?.cv_intel?.pipeline],
    ["Parser confidence", profile?.cv_intel?.parser_confidence != null ? fmtPct(Math.round(profile.cv_intel.parser_confidence * 100)) : "—"],
    ["Role alignment", intel?.alignment_score_target_role != null ? fmtPct(intel.alignment_score_target_role) : "—"],
    ["Experience (years)", data.experienceYears]
  ]);

  if (experienceTimeline?.length) {
    r.section("Work history (parsed from CV)");
    r.table(
      [
        { header: "Role", value: (row) => row.title },
        { header: "Company", value: (row) => row.company },
        { header: "Dates", value: (row) => row.dates },
        { header: "Skills", value: (row) => (row.skills || []).slice(0, 5).join(", ") }
      ],
      experienceTimeline,
      { maxRows: 12 }
    );
  }

  r.section("Skill inventory", `${skills.length} skill(s) on record`);
  r.table(
    [
      { header: "Skill", value: (row) => row.skill },
      { header: "Level", value: (row) => row.level },
      { header: "Updated", value: (row) => (row.last_updated || "").slice(0, 10) }
    ],
    skills,
    { maxRows: 35 }
  );

  r.section("Skill gap analysis", gaps?.explainability?.rule || "Required vs current competency levels");
  r.table(
    [
      { header: "Skill", value: (row) => row.skill },
      { header: "Required", value: (row) => row.required_level },
      { header: "Current", value: (row) => row.current_level },
      { header: "Gap", value: (row) => row.gap },
      { header: "Severity", value: (row) => row.severity },
      { header: "CV", value: (row) => (row.in_cv ? "Yes" : "No") }
    ],
    gaps?.gaps || [],
    { maxRows: 30 }
  );
  }

  if (isDivisionReport(reportType, "training")) {
  r.section("Training recommendations", `${recommendations.length} AI-ranked program(s)`);
  r.table(
    [
      { header: "Course", value: (row) => row.course },
      { header: "Skill", value: (row) => row.skill },
      { header: "Gap", value: (row) => row.gap },
      { header: "Match", value: (row) => fmtPct(row.match_pct) },
      { header: "Priority", value: (row) => row.priority_score }
    ],
    recommendations,
    { maxRows: 15 }
  );

  const active = trainingProgress.active_courses || [];
  const completed = trainingProgress.completed_courses || [];
  const pending = trainingProgress.pending_requests || [];
  r.section("Training progress");
  r.kpis(
    [
      { label: "Pending HR approval", value: pending.length },
      { label: "Active courses", value: active.length },
      { label: "Completed", value: completed.length }
    ],
    3
  );
  r.table(
    [
      { header: "Course", value: (row) => row.course_title || row.course },
      { header: "Skill", value: (row) => row.target_skill || row.skill },
      { header: "Progress", value: (row) => fmtPct(row.progress_pct) },
      { header: "Status", value: (row) => row.status }
    ],
    [...active, ...completed, ...pending],
    { maxRows: 20 }
  );

  r.section("Career goals");
  r.table(
    [
      { header: "Goal", value: (row) => row.title },
      { header: "Status", value: (row) => row.status }
    ],
    goals,
    { maxRows: 12 }
  );

  if (careerPaths?.length) {
    r.section("Career path suggestions");
    r.table(
      [
        { header: "Path", value: (row) => row.title || row.path },
        { header: "Fit", value: (row) => fmtPct(row.fit_pct) },
        { header: "Notes", value: (row) => safeLines(row.summary || row.description, 70) }
      ],
      careerPaths,
      { maxRows: 10 }
    );
  }
  }

  if (isDivisionReport(reportType, "projects")) {
  r.section("Projects & daily reports");
  r.table(
    [
      { header: "Project", value: (row) => row.name },
      { header: "Status", value: (row) => row.status },
      { header: "Progress", value: (row) => fmtPct(row.progress_pct) },
      { header: "Reports", value: (row) => row.days_reported }
    ],
    projects,
    { maxRows: 15 }
  );
  if (projectReports?.length) {
    r.paragraph("Recent daily reports for selected project:");
    r.table(
      [
        { header: "Date", value: (row) => row.work_date },
        { header: "Hours", value: (row) => row.hours_spent },
        { header: "Progress", value: (row) => fmtPct(row.progress_pct) },
        { header: "Summary", value: (row) => safeLines(row.summary, 80) }
      ],
      projectReports,
      { maxRows: 20 }
    );
  }

  r.section("Compliance requirements");
  r.table(
    [
      { header: "Certification", value: (row) => row.certification || row.name },
      { header: "Due", value: (row) => row.due_date },
      { header: "Note", value: (row) => safeLines(row.note, 60) }
    ],
    complianceRequirements,
    { maxRows: 12, emptyText: "No active HR compliance requirements." }
  );

  if (notifications?.length) {
    r.section("Notifications");
    r.bullets(notifications.slice(0, 12).map((n) => n.message || n.text || JSON.stringify(n)));
  }
  }

  r.save(filename);
}

export function exportManagerDashboardReport(data, filename = "manager-workforce-report.pdf") {
  const reportType = data.reportType || "team_directory";

  const r = new ReportBuilder({
    title: data.reportTitle || "Manager Team Report",
    subtitle: data.reportSubtitle || "Team workforce intelligence export",
    role: "manager",
    roleLabel: data.managerName ? `Manager · ${data.managerName}` : "Manager",
    section: data.section || "reports",
    sectionLabel: data.sectionLabel || "Manager Report"
  });

  r.coverBlock();

  if (isDivisionReport(reportType, "team_directory")) {
    buildManagerTeamDirectoryReport(r, data);
  } else if (isDivisionReport(reportType, "team_performance")) {
    buildManagerTeamPerformanceReport(r, data);
  } else if (isDivisionReport(reportType, "team_training")) {
    buildManagerTeamTrainingReport(r, data);
  } else {
    buildManagerTeamDirectoryReport(r, data);
  }

  r.save(filename);
}

export function exportHrDashboardReport(data, filename = "hr-workforce-report.pdf") {
  const reportType = data.reportType || "employee_directory";

  const r = new ReportBuilder({
    title: data.reportTitle || "HR Workforce Report",
    subtitle: data.reportSubtitle || "Organization workforce intelligence export",
    role: "hr_admin",
    roleLabel: "HR Administration",
    section: data.section || "reports",
    sectionLabel: data.sectionLabel || "HR Report"
  });

  r.coverBlock();

  if (isDivisionReport(reportType, "employee_directory")) {
    buildHrEmployeeDirectoryReport(r, data);
  } else if (isDivisionReport(reportType, "employee_performance")) {
    buildHrEmployeePerformanceReport(r, data);
  } else if (isDivisionReport(reportType, "training_active")) {
    buildHrTrainingActiveReport(r, data);
  } else {
    buildHrEmployeeDirectoryReport(r, data);
  }

  r.save(filename);
}
