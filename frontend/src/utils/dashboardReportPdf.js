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

function buildManagerMainBrief(r, data) {
  const { kpis = [], team = [], gaps = [], projects = [], alerts = [], matches, matchReport } = data;
  r.section("Executive brief", "Team leadership snapshot — essentials for decision-making");
  r.kpis(kpis.slice(0, 4), 4);
  r.keyValueRows([
    ["Team size", team.length],
    ["Active projects", projects.filter((p) => p.status === "active").length || projects.length],
    ["Open alerts", alerts.length],
    ["Skill gaps tracked", gaps.length]
  ]);
  if (team.length) {
    r.section("Team at a glance");
    r.table(
      [
        { header: "Name", value: (row) => row.name },
        { header: "Role", value: (row) => row.role },
        { header: "Workload", value: (row) => fmtPct(row.workload_pct) },
        { header: "Availability", value: (row) => row.availability }
      ],
      team.slice(0, 8),
      { maxRows: 8 }
    );
  }
  if (gaps.length) {
    r.section("Top skill gaps");
    r.table(
      [
        { header: "Skill", value: (row) => row.skill },
        { header: "Gap score", value: (row) => row.gap_score ?? row.total_gap },
        { header: "Severity", value: (row) => row.severity }
      ],
      gaps.slice(0, 6),
      { maxRows: 6 }
    );
  }
  if (projects.length) {
    r.section("Active projects");
    r.table(
      [
        { header: "Project", value: (row) => row.name },
        { header: "Department", value: (row) => row.department },
        { header: "Status", value: (row) => row.status }
      ],
      projects.slice(0, 5),
      { maxRows: 5 }
    );
  }
  const matchRows = matches?.length ? matches : matchReport?.candidates || [];
  if (matchReport?.summary || matchRows.length) {
    r.section("AI matching highlight");
    if (matchReport?.summary) {
      r.kpis(
        [
          { label: "Project", value: matchReport.project?.name || "—" },
          { label: "Eligible", value: matchReport.summary.eligible_count },
          { label: "Best match", value: fmtPct(matchReport.summary.best_match_pct) }
        ],
        3
      );
    }
    r.table(
      [
        { header: "Employee", value: (row) => row.employee || row.employee_name },
        { header: "Match", value: (row) => fmtPct(row.match_pct) },
        { header: "Fit", value: (row) => row.fit_class }
      ],
      matchRows.slice(0, 5),
      { maxRows: 5 }
    );
  }
  if (alerts.length) {
    r.section("Alerts requiring attention");
    r.bullets(alerts.slice(0, 5).map((a) => safeLines(a.message, 120)));
  }
}

function buildHrMainBrief(r, data) {
  const {
    headerKpis = [],
    overviewMetrics = {},
    kpis,
    gapTable = [],
    topGaps = [],
    deptGaps = [],
    gapSeverity = {},
    pending = [],
    complianceData = {},
    trainingPlan = {},
    recentHrActions = [],
    cvPendingCount = 0
  } = data;
  r.section("Executive brief", "Organization-wide workforce intelligence — leadership summary");
  r.kpis(headerKpis.slice(0, 4), 4);
  r.kpis(
    [
      { label: "Departments", value: overviewMetrics.departments },
      { label: "Training active", value: overviewMetrics.trainingInProgress },
      { label: "Certs expiring", value: overviewMetrics.certificationsExpiringSoon },
      { label: "CV pending", value: cvPendingCount }
    ],
    4
  );
  if (kpis) {
    r.keyValueRows([
      ["Total employees", kpis.users_by_role?.employee ?? overviewMetrics.totalEmployees],
      ["Managers", kpis.users_by_role?.manager],
      ["Pending approvals", pending.length],
      ["Open org gaps", overviewMetrics.gapsCount ?? gapTable.length]
    ]);
  }
  r.section("Gap severity overview");
  r.kpis(
    [
      { label: "High", value: gapSeverity.HIGH || 0 },
      { label: "Medium", value: gapSeverity.MEDIUM || 0 },
      { label: "Low", value: gapSeverity.LOW || 0 }
    ],
    3
  );
  const gaps = gapTable.length ? gapTable : topGaps;
  if (gaps.length) {
    r.table(
      [
        { header: "Skill", value: (row) => row.skill },
        { header: "Org gap", value: (row) => row.gap ?? row.total_gap },
        { header: "Severity", value: (row) => row.severity }
      ],
      gaps.slice(0, 8),
      { maxRows: 8 }
    );
  }
  if (deptGaps.length) {
    r.section("Departments most affected");
    r.table(
      [
        { header: "Department", value: (row) => row.department },
        { header: "Gap score", value: (row) => row.gap_score ?? row.total_gap }
      ],
      deptGaps.slice(0, 5),
      { maxRows: 5 }
    );
  }
  const budget = trainingPlan.budget || {};
  r.section("Operational priorities");
  r.kpis(
    [
      { label: "Training completion", value: fmtPct(trainingPlan.training_completion_rate_pct) },
      { label: "Budget committed", value: budget.committed_spend != null ? `$${budget.committed_spend}` : "—" },
      { label: "Compliance gaps", value: complianceData?.alerts?.missing ?? 0 },
      { label: "Expiring certs", value: complianceData?.alerts?.expiring_soon ?? 0 }
    ],
    4
  );
  if (recentHrActions.length) {
    r.section("Recent HR actions");
    r.table(
      [
        { header: "Action", value: (row) => safeLines(row.action || row.action_type, 40) },
        { header: "Target", value: (row) => row.target_name || row.employee_name },
        { header: "Status", value: (row) => row.status }
      ],
      recentHrActions.slice(0, 5),
      { maxRows: 5 }
    );
  }
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
  const {
    managerName,
    sectionLabel,
    kpis = [],
    overview,
    team = [],
    gaps = [],
    projects = [],
    workload = [],
    performance = [],
    alerts = [],
    matches = [],
    matchReport,
    catalogRequests = [],
    projectDailyReports = [],
    selectedProject
  } = data;

  const reportType = data.reportType || "main";

  const r = new ReportBuilder({
    title: data.reportTitle || "Manager Workforce Report",
    subtitle: data.reportSubtitle || "Team operations, skill gaps, projects, matching, and performance intelligence",
    role: "manager",
    roleLabel: managerName ? `Manager · ${managerName}` : "Manager",
    section: data.section || "full",
    sectionLabel: sectionLabel || "Full dashboard"
  });

  r.coverBlock();
  if (isMainReport(reportType)) {
    buildManagerMainBrief(r, data);
    mainReportFooter(r);
    r.save(filename);
    return;
  }

  if (isDivisionReport(reportType, "team_ops") || isDivisionReport(reportType, "skills_gaps")) {
    r.section("Team overview");
    r.kpis(kpis, 4);
    if (overview?.summary) r.paragraph(overview.summary);
  }

  if (isDivisionReport(reportType, "team_ops")) {
  r.section("Team members", `${team.length} member(s)`);
  r.table(
    [
      { header: "Name", value: (row) => row.name },
      { header: "Role", value: (row) => row.role },
      { header: "Dept", value: (row) => row.department },
      { header: "Workload", value: (row) => fmtPct(row.workload_pct) },
      { header: "Availability", value: (row) => row.availability },
      { header: "Skills", value: (row) => (row.skills || []).slice(0, 4).map((s) => s.name).join(", ") }
    ],
    team,
    { maxRows: 25 }
  );
  }

  if (isDivisionReport(reportType, "skills_gaps")) {
  r.section("Skill gap analysis");
  r.table(
    [
      { header: "Skill", value: (row) => row.skill },
      { header: "Gap score", value: (row) => row.gap_score ?? row.total_gap },
      { header: "Affected", value: (row) => row.affected_employees ?? row.employees_affected },
      { header: "Severity", value: (row) => row.severity }
    ],
    gaps,
    { maxRows: 25 }
  );
  }

  if (isDivisionReport(reportType, "projects_matching")) {
  r.section("Projects", `${projects.length} project(s)`);
  r.table(
    [
      { header: "Name", value: (row) => row.name },
      { header: "Department", value: (row) => row.department },
      { header: "Status", value: (row) => row.status },
      { header: "Deadline", value: (row) => (row.deadline || "").slice(0, 10) },
      { header: "Headcount", value: (row) => row.required_employees }
    ],
    projects,
    { maxRows: 20 }
  );

  if (selectedProject) {
    r.paragraph(`Focus project: ${selectedProject.name} (${selectedProject.department || "—"})`);
  }
  }

  if (isDivisionReport(reportType, "team_ops")) {
  r.section("Workload & availability");
  r.table(
    [
      { header: "Employee", value: (row) => row.name || row.employee },
      { header: "Workload %", value: (row) => row.workload_pct },
      { header: "Projects", value: (row) => row.project_count ?? row.assignments },
      { header: "Status", value: (row) => row.status || row.availability }
    ],
    workload,
    { maxRows: 25 }
  );

  r.section("Performance monitoring");
  r.table(
    [
      { header: "Employee", value: (row) => row.name || row.employee },
      { header: "Completion", value: (row) => fmtPct(row.completion_rate_pct ?? row.completion_pct) },
      { header: "Reports", value: (row) => row.reports_submitted },
      { header: "Risk", value: (row) => row.risk_level || row.risk }
    ],
    performance,
    { maxRows: 25 }
  );

  if (projectDailyReports?.length) {
    r.section("Project daily reports");
    r.table(
      [
        { header: "Employee", value: (row) => row.employee_name || row.employee },
        { header: "Date", value: (row) => row.work_date },
        { header: "Hours", value: (row) => row.hours_spent },
        { header: "Progress", value: (row) => fmtPct(row.progress_pct) },
        { header: "Summary", value: (row) => safeLines(row.summary, 70) }
      ],
      projectDailyReports,
      { maxRows: 25 }
    );
  }

  r.section("Alerts & risks");
  r.table(
    [
      { header: "Type", value: (row) => row.type },
      { header: "Employee", value: (row) => row.employee || row.employee_name },
      { header: "Message", value: (row) => safeLines(row.message, 90) },
      { header: "Severity", value: (row) => row.severity }
    ],
    alerts,
    { maxRows: 20 }
  );
  }

  if (isDivisionReport(reportType, "projects_matching")) {
  const matchRows = matches?.length ? matches : matchReport?.candidates || [];
  if (matchRows.length) {
    r.section("AI employee matching", matchReport?.project?.name ? `Project: ${matchReport.project.name}` : "");
    if (matchReport?.summary) {
      r.kpis(
        [
          { label: "Team size", value: matchReport.summary.team_size },
          { label: "Ranked", value: matchReport.summary.candidates_ranked },
          { label: "Eligible", value: matchReport.summary.eligible_count },
          { label: "Best match", value: fmtPct(matchReport.summary.best_match_pct) }
        ],
        4
      );
    }
    r.table(
      [
        { header: "Employee", value: (row) => row.employee || row.employee_name },
        { header: "Match %", value: (row) => fmtPct(row.match_pct) },
        { header: "Fit", value: (row) => row.fit_class },
        { header: "Eligible", value: (row) => (row.eligible ? "Yes" : "No") },
        { header: "CV quality", value: (row) => fmtPct(row.cv_quality_pct) },
        { header: "Dept match", value: (row) => (row.department_match ? "Yes" : "No") }
      ],
      matchRows,
      { maxRows: 20 }
    );
    matchRows.slice(0, 5).forEach((m) => {
      if (m.analysis_bullets?.length) {
        r.paragraph(`${m.employee || "Candidate"} — rationale:`);
        r.bullets(m.analysis_bullets.slice(0, 4));
      }
    });
  }

  r.section("Master data requests");
  r.table(
    [
      { header: "Type", value: (row) => row.request_type },
      { header: "Value", value: (row) => row.value },
      { header: "Status", value: (row) => row.status },
      { header: "By", value: (row) => row.requested_by_name || row.requested_by }
    ],
    catalogRequests,
    { maxRows: 15 }
  );
  }

  r.save(filename);
}

export function exportHrDashboardReport(data, filename = "hr-workforce-report.pdf") {
  const {
    sectionLabel,
    headerKpis = [],
    overviewMetrics = {},
    kpis,
    records = [],
    pending = [],
    gapTable = [],
    deptGaps = [],
    gapSeverity = {},
    complianceData = {},
    trainingPlan = {},
    hrOpenTrainings = [],
    hrPendingEnrollments = [],
    cvValidation = [],
    recruitmentData = {},
    pipelineData = {},
    performanceData = {},
    recentHrActions = [],
    topGaps = []
  } = data;

  const reportType = data.reportType || "main";

  const r = new ReportBuilder({
    title: data.reportTitle || "HR Workforce Intelligence Report",
    subtitle: data.reportSubtitle || "Organization-wide analytics, compliance, training, recruitment, and talent pipeline",
    role: "hr_admin",
    roleLabel: "HR Administration",
    section: data.section || "full",
    sectionLabel: sectionLabel || "Full dashboard"
  });

  r.coverBlock();
  if (isMainReport(reportType)) {
    buildHrMainBrief(r, data);
    mainReportFooter(r);
    r.save(filename);
    return;
  }

  if (isDivisionReport(reportType, "executive")) {
  r.section("Organization snapshot");
  r.kpis(headerKpis, 4);
  r.kpis(
    [
      { label: "Active projects", value: overviewMetrics.activeProjects },
      { label: "Training in progress", value: overviewMetrics.trainingInProgress },
      { label: "Certs expiring soon", value: overviewMetrics.certificationsExpiringSoon },
      { label: "CV validations pending", value: data.cvPendingCount ?? 0 }
    ],
    4
  );

  if (kpis) {
    r.keyValueRows([
      ["Total users", kpis.total_users],
      ["Employees", kpis.users_by_role?.employee],
      ["Managers", kpis.users_by_role?.manager],
      ["Departments tracked", overviewMetrics.departments]
    ]);
  }

  r.section("Organization skill gaps");
  r.kpis(
    [
      { label: "High severity", value: gapSeverity.HIGH || 0 },
      { label: "Medium", value: gapSeverity.MEDIUM || 0 },
      { label: "Low", value: gapSeverity.LOW || 0 }
    ],
    3
  );
  r.table(
    [
      { header: "Skill", value: (row) => row.skill },
      { header: "Org gap", value: (row) => row.gap ?? row.total_gap },
      { header: "Severity", value: (row) => row.severity }
    ],
    gapTable.length ? gapTable : topGaps,
    { maxRows: 30 }
  );

  r.section("Gaps by department");
  r.table(
    [
      { header: "Department", value: (row) => row.department },
      { header: "Gap score", value: (row) => row.gap_score ?? row.total_gap },
      { header: "Top skill", value: (row) => row.top_skill || row.skill }
    ],
    deptGaps,
    { maxRows: 20 }
  );
  }

  if (isDivisionReport(reportType, "talent")) {
  r.section("Employee records", `${records.filter((x) => x.role === "employee").length} employee(s)`);
  r.table(
    [
      { header: "Name", value: (row) => row.full_name },
      { header: "Email", value: (row) => row.email },
      { header: "Department", value: (row) => row.department },
      { header: "Job title", value: (row) => row.job_title },
      { header: "Primary skill", value: (row) => row.primary_skill }
    ],
    records.filter((x) => x.role === "employee"),
    { maxRows: 35 }
  );

  r.section("Pending registrations", `${pending.length} awaiting approval`);
  r.table(
    [
      { header: "Name", value: (row) => row.full_name },
      { header: "Email", value: (row) => row.email },
      { header: "Department", value: (row) => row.department },
      { header: "Role", value: (row) => row.role }
    ],
    pending,
    { maxRows: 15 }
  );

  r.section("Recruitment insights");
  r.table(
    [
      { header: "Missing skill", value: (row) => row.skill },
      { header: "Demand", value: (row) => row.demand ?? row.gap },
      { header: "Suggestion", value: (row) => safeLines(row.suggestion || row.hiring_suggestion, 60) }
    ],
    recruitmentData?.missing_skills || recruitmentData?.hiring_suggestions || [],
    { maxRows: 15 }
  );

  r.section("Talent pipeline");
  r.table(
    [
      { header: "Employee", value: (row) => row.full_name || row.employee_name },
      { header: "Readiness", value: (row) => row.readiness_band || row.readiness },
      { header: "Target role", value: (row) => row.target_role || row.target_job_title },
      { header: "Notes", value: (row) => safeLines(row.notes || row.summary, 60) }
    ],
    pipelineData?.rows || [],
    { maxRows: 20 }
  );

  r.section("Performance review support");
  r.table(
    [
      { header: "Employee", value: (row) => row.full_name || row.employee_name },
      { header: "Gap avg", value: (row) => row.gap_avg },
      { header: "Training", value: (row) => row.training_status || row.training_recommendation },
      { header: "Focus", value: (row) => safeLines(row.focus_area || row.priority_skill, 50) }
    ],
    performanceData?.rows || [],
    { maxRows: 20 }
  );

  r.section("CV validation queue", `${cvValidation.length} employee(s)`);
  r.table(
    [
      { header: "Employee", value: (row) => row.full_name || row.employee_name },
      { header: "Primary skill", value: (row) => row.primary_skill },
      { header: "Status", value: (row) => row.validation_status || row.status },
      { header: "CV skills", value: (row) => (row.cv_skills || []).slice(0, 4).join(", ") }
    ],
    cvValidation,
    { maxRows: 20 }
  );

  r.section("Recent HR actions");
  r.table(
    [
      { header: "Action", value: (row) => row.action || row.action_type },
      { header: "Target", value: (row) => row.target_name || row.employee_name },
      { header: "Status", value: (row) => row.status },
      { header: "When", value: (row) => (row.created_at || "").slice(0, 16).replace("T", " ") }
    ],
    recentHrActions,
    { maxRows: 20 }
  );
  }

  if (isDivisionReport(reportType, "training_compliance")) {
  const budget = trainingPlan.budget || {};
  r.section("Training planning & budget");
  r.kpis(
    [
      { label: "Budget total", value: budget.total != null ? `$${budget.total}` : "—" },
      { label: "Committed", value: budget.committed_spend != null ? `$${budget.committed_spend}` : "—" },
      { label: "Recommended", value: budget.recommended_investment != null ? `$${budget.recommended_investment}` : "—" },
      { label: "Completion rate", value: fmtPct(trainingPlan.training_completion_rate_pct) }
    ],
    4
  );
  r.table(
    [
      { header: "Program", value: (row) => row.program || row.course },
      { header: "Skill", value: (row) => row.skill || row.target_skill },
      { header: "Priority", value: (row) => row.priority_score ?? row.priority },
      { header: "Est. cost", value: (row) => row.estimated_cost ?? row.cost }
    ],
    trainingPlan.programs || [],
    { maxRows: 20 }
  );

  r.section("Live training assignments");
  r.table(
    [
      { header: "Employee", value: (row) => row.employee_name || row.full_name },
      { header: "Course", value: (row) => row.course_title || row.course },
      { header: "Progress", value: (row) => fmtPct(row.progress_pct) },
      { header: "Status", value: (row) => row.status }
    ],
    hrOpenTrainings,
    { maxRows: 25 }
  );

  r.section("Enrollment requests pending", `${hrPendingEnrollments.length} request(s)`);
  r.table(
    [
      { header: "Employee", value: (row) => row.employee_name },
      { header: "Course", value: (row) => row.course },
      { header: "Skill", value: (row) => row.skill },
      { header: "Requested", value: (row) => (row.created_at || "").slice(0, 10) }
    ],
    hrPendingEnrollments,
    { maxRows: 20 }
  );

  r.section("Certification & compliance");
  r.kpis(
    [
      { label: "Expiring soon", value: complianceData?.alerts?.expiring_soon ?? 0 },
      { label: "Missing certs", value: complianceData?.alerts?.missing ?? 0 }
    ],
    2
  );
  r.table(
    [
      { header: "Employee", value: (row) => row.employee_name || row.full_name },
      { header: "Certification", value: (row) => row.certification },
      { header: "Status", value: (row) => row.status },
      { header: "Expires", value: (row) => (row.expires_at || row.valid_until || "").slice(0, 10) }
    ],
    complianceData?.rows || [],
    { maxRows: 25 }
  );
  }

  r.save(filename);
}
