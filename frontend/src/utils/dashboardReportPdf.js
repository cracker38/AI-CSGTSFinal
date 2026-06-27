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
  r.section("Report status summary", "Completed work and key highlights for this reporting period");
  r.numberedList([
    `Profile reviewed for ${profile?.basic?.name || "employee"}`,
    intel?.alignment_score_target_role != null
      ? `Role alignment score: ${fmtPct(intel.alignment_score_target_role)}`
      : "Role alignment assessed from CV and competency data",
    `${(trainingProgress.active_courses || []).length} active training course(s) in progress`,
    `${projects.length} open project assignment(s) tracked`
  ]);
  r.section("Report health");
  r.healthPanel(
    kpis.slice(0, 4).map((k) => ({ title: k.label, body: fmt(k.value) }))
  );
  r.reportInfo([
    { label: "Employee", value: profile?.basic?.name },
    { label: "Department", value: profile?.basic?.department },
    { label: "Job title", value: profile?.basic?.job_title },
    { label: "Target role", value: intel?.positions?.target_job_title || profile?.career_preferences?.target_job_title }
  ]);
  const bullets = (intel?.narrative?.bullets || profile?.cv_intel?.analysis_bullets || []).slice(0, 5);
  if (bullets.length) {
    r.section("Key insights");
    r.numberedList(bullets);
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

  r.section("Report status summary", "Team directory snapshot for this reporting period");
  r.numberedList([
    `${team.length} direct report(s) on record`,
    `${available} available · ${overloaded} overloaded`,
    `${deptRows.length} department(s) represented on the team`,
    "Complete roster and department breakdown included below"
  ]);

  r.section("Report health");
  r.healthPanel([
    { title: "Team members", body: fmt(team.length) },
    { title: "Available", body: fmt(available) },
    { title: "Overloaded", body: fmt(overloaded) },
    {
      title: "Active projects",
      body: fmt(overview?.kpis?.active_projects ?? kpis.find((k) => k.label?.includes("project"))?.value ?? "—")
    }
  ]);

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

  r.section("Report status summary", "Team performance highlights for this reporting period");
  r.numberedList([
    `${rows.length} team member(s) scored`,
    `Average performance: ${avg("performance_score")}`,
    `${high} strong (≥70) · ${developing} developing (45–69) · ${focus} need focus (<45)`,
    "Full performance register sorted by score included below"
  ]);

  r.section("Report health");
  r.healthPanel([
    { title: "Avg performance", body: fmt(avg("performance_score")) },
    { title: "Avg task completion", body: `${avg("task_completion_rate")}%` },
    { title: "Strong (≥70)", body: fmt(high) },
    { title: "Focus required (<45)", body: fmt(focus) }
  ]);

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

  r.section("Report status summary", "Team training operations for this reporting period");
  r.numberedList([
    `${teamTraining.length} active course assignment(s)`,
    `${employeeIds.size} team member(s) enrolled in training`,
    `${inSession} learning session(s) in progress now`,
    `${pending} assignment(s) pending HR approval`
  ]);

  r.section("Report health");
  r.healthPanel([
    { title: "Active assignments", body: fmt(teamTraining.length) },
    { title: "Members in training", body: fmt(employeeIds.size) },
    { title: "In session now", body: fmt(inSession) },
    { title: "Pending HR approval", body: fmt(pending) }
  ]);

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

  r.section("Report status summary", "Organization workforce snapshot for this reporting period");
  r.numberedList([
    `${employees.length} employee account(s) on record`,
    `${employees.filter((e) => e.status === "active").length} active · ${pending.length} pending approval`,
    `${deptRows.length} department(s) with assigned staff`,
    "Complete directory and department breakdown included below"
  ]);

  r.section("Report health");
  r.healthPanel([
    { title: "Total employees", body: fmt(employees.length) },
    { title: "Active accounts", body: fmt(employees.filter((e) => e.status === "active").length) },
    { title: "Pending approval", body: fmt(pending.length) },
    { title: "Departments", body: fmt(deptRows.length) }
  ]);

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

  r.section("Report status summary", "Organization performance highlights for this reporting period");
  r.numberedList([
    `${rows.length} employee(s) with performance scores`,
    `Average performance: ${avg("performance_score")}`,
    `${high} strong (≥70) · ${developing} developing (45–69) · ${focus} need focus (<45)`,
    "Full performance register sorted by score included below"
  ]);

  r.section("Report health");
  r.healthPanel([
    { title: "Avg performance", body: fmt(avg("performance_score")) },
    { title: "Avg skill improvement", body: `${avg("skill_improvement")}%` },
    { title: "Strong (≥70)", body: fmt(high) },
    { title: "Focus required (<45)", body: fmt(focus) }
  ]);

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

  r.section("Report status summary", "Organization training operations for this reporting period");
  r.numberedList([
    `${hrOpenTrainings.length} active course assignment(s)`,
    `${employeeIds.size} employee(s) currently in training`,
    `${inSession} learning session(s) in progress`,
    `${hrPendingEnrollments.length} enrollment request(s) awaiting HR approval`
  ]);

  r.section("Report health");
  r.healthPanel([
    { title: "Active assignments", body: fmt(hrOpenTrainings.length) },
    { title: "Employees in training", body: fmt(employeeIds.size) },
    { title: "Org completion rate", body: fmtPct(trainingPlan.training_completion_rate_pct) },
    {
      title: "Budget committed",
      body: trainingPlan.budget?.committed_spend != null ? `$${trainingPlan.budget.committed_spend}` : "—"
    }
  ]);

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

function formatReportDate(d = new Date()) {
  return new Date(d).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function reportMeta(r, data) {
  return {
    ...data,
    roleLabel: data.roleLabel || r.options.roleLabel,
    sectionLabel: data.sectionLabel || r.options.sectionLabel,
    reportTitle: data.reportTitle || r.options.title,
    generatedAt: data.generatedAt || r.options.generatedAt,
    managerName: data.managerName || data.userName,
    signOffTitle: data.signOffTitle
  };
}

function beginWorkforceReport(r, data) {
  r.coverBlock();
  r.reportInfo([
    { label: "Organization", value: "AI-CSGTS Workforce Intelligence" },
    { label: "Report owner", value: data.managerName || data.roleLabel || "Authorized user" },
    { label: "Report type", value: data.sectionLabel || data.reportTitle || "Workforce report" },
    { label: "Reporting date", value: formatReportDate(data.generatedAt || new Date()) }
  ]);
}

function finishWorkforceReport(r, data) {
  r.signOff({
    reportingPerson: data.managerName || data.roleLabel || "Authorized user",
    jobTitle: data.signOffTitle || data.roleLabel || "Workforce intelligence export",
    date: formatReportDate()
  });
}

function mainReportFooter(r) {
  r.spacer(2);
  r.paragraph(
    "This is an executive brief with selected highlights only. Download division reports from the Report section for complete tables and audit detail."
  );
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 10;
const HEADER_H = 0;

/** Project Status Report template palette */
const C = {
  purple: [123, 104, 174],
  purpleDark: [98, 82, 145],
  dark: [33, 37, 41],
  muted: [108, 117, 125],
  fieldBg: [245, 245, 247],
  fieldBorder: [222, 226, 230],
  light: [250, 250, 252],
  border: [230, 232, 236],
  white: [255, 255, 255],
  rowAlt: [248, 249, 251]
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
      title: "Workforce Status Report",
      subtitle: "",
      role: "user",
      roleLabel: "Dashboard",
      section: "overview",
      sectionLabel: "Overview",
      generatedAt: new Date(),
      confidential: true,
      ...options
    };
    this.y = MARGIN;
    this.page = 1;
    this._drawPageFooter();
  }

  _setColor(rgb, type = "text") {
    this.pdf[`set${type === "fill" ? "Fill" : "Text"}Color`](...rgb);
  }

  _drawPageFooter() {
    const p = this.pdf;
    const { logoText } = this.options;
    const logoSize = 5.5;
    drawBrandLogoPdf(p, MARGIN, PAGE_H - FOOTER_H + 0.5, logoSize);
    p.setDrawColor(...C.fieldBorder);
    p.line(MARGIN, PAGE_H - FOOTER_H, PAGE_W - MARGIN, PAGE_H - FOOTER_H);
    this._setColor(C.muted);
    p.setFont("helvetica", "normal");
    p.setFontSize(7.5);
    p.text(
      `${logoText || "AI-CSGTS"} · Confidential workforce intelligence`,
      MARGIN + logoSize + 3,
      PAGE_H - 4
    );
    p.text(`Page ${this.page}`, PAGE_W - MARGIN, PAGE_H - 4, { align: "right" });
  }

  _newPage() {
    this.pdf.addPage();
    this.page += 1;
    this.y = MARGIN;
    this._drawPageFooter();
  }

  ensureSpace(needed) {
    if (this.y + needed > PAGE_H - FOOTER_H - 4) {
      this._newPage();
    }
  }

  /** Full-width purple title bar — matches Project Status Report template */
  coverBlock() {
    const { title, logoText } = this.options;
    const barH = 18;
    const logoSize = 12;
    this.ensureSpace(barH + 8);
    this.pdf.setFillColor(...C.purple);
    this.pdf.rect(MARGIN, this.y, CONTENT_W, barH, "F");
    drawBrandLogoPdf(this.pdf, MARGIN + 4, this.y + (barH - logoSize) / 2, logoSize);
    this._setColor(C.white);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(9);
    this.pdf.text(logoText || "AI-CSGTS", MARGIN + 4 + logoSize + 3, this.y + barH / 2 + 1);
    this.pdf.setFontSize(14);
    this.pdf.text(String(title), MARGIN + CONTENT_W / 2, this.y + barH / 2 + 1.5, { align: "center" });
    this.y += barH + 8;
    return this;
  }

  /** Grey label + value fields in two columns */
  reportInfo(fields = []) {
    return this._reportFields(fields, "Report information");
  }

  _reportFields(fields = [], title = null) {
    if (title) this.sectionTitle(title);
    const cols = 2;
    const gap = 4;
    const colW = (CONTENT_W - gap) / cols;
    const boxH = 12;
    const rowGap = 10;

    for (let i = 0; i < fields.length; i += cols) {
      this.ensureSpace(boxH + rowGap + 6);
      const rowY = this.y;
      for (let c = 0; c < cols; c++) {
        const field = fields[i + c];
        if (!field) continue;
        const x = MARGIN + c * (colW + gap);
        this._setColor(C.muted);
        this.pdf.setFont("helvetica", "normal");
        this.pdf.setFontSize(8);
        this.pdf.text(String(field.label || ""), x, rowY);
        const by = rowY + 4;
        this.pdf.setDrawColor(...C.fieldBorder);
        this.pdf.setFillColor(...C.fieldBg);
        this.pdf.roundedRect(x, by, colW, boxH, 1.5, 1.5, "FD");
        this._setColor(C.dark);
        this.pdf.setFont("helvetica", "normal");
        this.pdf.setFontSize(9);
        const valLines = this.pdf.splitTextToSize(fmt(field.value), colW - 6);
        this.pdf.text(valLines[0] || "—", x + 3, by + 7.5, { maxWidth: colW - 6 });
      }
      this.y = rowY + 4 + boxH + rowGap;
    }
    this.y += 2;
    return this;
  }

  sectionTitle(title) {
    this.ensureSpace(12);
    this._setColor(C.dark);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(11);
    this.pdf.text(String(title), MARGIN, this.y + 4);
    this.y += 10;
    return this;
  }

  section(title, subtitle = "") {
    this.sectionTitle(title);
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

  numberedList(items = []) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return this;
    list.forEach((item, idx) => {
      const lines = this.pdf.splitTextToSize(`${idx + 1}. ${safeLines(item, 400)}`, CONTENT_W - 4);
      lines.forEach((ln) => {
        this.ensureSpace(5);
        this._setColor(C.dark);
        this.pdf.setFont("helvetica", "normal");
        this.pdf.setFontSize(9);
        this.pdf.text(ln, MARGIN + 2, this.y);
        this.y += 4.8;
      });
    });
    this.y += 3;
    return this;
  }

  /** 2-column health / insight blocks like template Project Health section */
  healthPanel(blocks = []) {
    const items = (blocks || []).filter((b) => b?.title);
    if (!items.length) return this;
    const cols = 2;
    const gap = 4;
    const colW = (CONTENT_W - gap) / cols;
    const pad = 3;
    const minH = 22;

    for (let i = 0; i < items.length; i += cols) {
      const rowItems = [items[i], items[i + 1]].filter(Boolean);
      const bodies = rowItems.map((b) => this.pdf.splitTextToSize(safeLines(b.body, 500), colW - pad * 2));
      const maxLines = Math.max(...bodies.map((l) => l.length), 2);
      const boxH = Math.max(minH, 8 + maxLines * 4.2);
      this.ensureSpace(boxH + 6);

      rowItems.forEach((block, c) => {
        const x = MARGIN + c * (colW + gap);
        this.pdf.setDrawColor(...C.fieldBorder);
        this.pdf.setFillColor(...C.white);
        this.pdf.roundedRect(x, this.y, colW, boxH, 2, 2, "D");
        this._setColor(C.dark);
        this.pdf.setFont("helvetica", "bold");
        this.pdf.setFontSize(8.5);
        this.pdf.text(String(block.title), x + pad, this.y + 6);
        this._setColor(C.muted);
        this.pdf.setFont("helvetica", "normal");
        this.pdf.setFontSize(8);
        bodies[c].forEach((ln, li) => {
          this.pdf.text(ln, x + pad, this.y + 11 + li * 4.2, { maxWidth: colW - pad * 2 });
        });
      });
      this.y += boxH + 5;
    }
    return this;
  }

  signOff({ reportingPerson, jobTitle, date }) {
    return this._reportFields(
      [
        { label: "Reporting person", value: reportingPerson },
        { label: "Job title", value: jobTitle },
        { label: "Report author signature", value: reportingPerson },
        { label: "Reporting date", value: date || formatReportDate() }
      ],
      "Authorization"
    );
  }

  kpis(items = [], cols = 4) {
    const blocks = (items || []).map((k) => ({
      title: k.label,
      body: fmt(k.value)
    }));
    return this.healthPanel(blocks);
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
      this.pdf.setFillColor(...C.purple);
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
        this.pdf.setFillColor(...C.rowAlt);
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

  const meta = reportMeta(r, { ...data, userName });
  beginWorkforceReport(r, meta);

  if (isMainReport(reportType)) {
    buildEmployeeMainBrief(r, data);
    mainReportFooter(r);
    finishWorkforceReport(r, meta);
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

  finishWorkforceReport(r, meta);
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

  const meta = reportMeta(r, { ...data, signOffTitle: "Manager" });
  beginWorkforceReport(r, meta);

  if (isDivisionReport(reportType, "team_directory")) {
    buildManagerTeamDirectoryReport(r, data);
  } else if (isDivisionReport(reportType, "team_performance")) {
    buildManagerTeamPerformanceReport(r, data);
  } else if (isDivisionReport(reportType, "team_training")) {
    buildManagerTeamTrainingReport(r, data);
  } else {
    buildManagerTeamDirectoryReport(r, data);
  }

  finishWorkforceReport(r, meta);
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

  const meta = reportMeta(r, { ...data, signOffTitle: "HR Administrator" });
  beginWorkforceReport(r, meta);

  if (isDivisionReport(reportType, "employee_directory")) {
    buildHrEmployeeDirectoryReport(r, data);
  } else if (isDivisionReport(reportType, "employee_performance")) {
    buildHrEmployeePerformanceReport(r, data);
  } else if (isDivisionReport(reportType, "training_active")) {
    buildHrTrainingActiveReport(r, data);
  } else {
    buildHrEmployeeDirectoryReport(r, data);
  }

  finishWorkforceReport(r, meta);
  r.save(filename);
}
