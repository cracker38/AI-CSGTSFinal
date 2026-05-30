export const HR_REPORTS = [
  {
    id: "main",
    title: "Main workforce report",
    description: "Executive brief — org KPIs, gap severity, top priorities, and operational highlights in a concise leadership PDF.",
    highlights: ["Org KPIs & gap severity", "Top skill gaps", "Training & compliance snapshot", "Recent HR actions"],
    accent: "primary",
    filename: "hr-main-workforce-report.pdf"
  },
  {
    id: "executive",
    title: "Executive summary",
    description: "Leadership view of headcount, departments, open gaps, and severity distribution across the organization.",
    highlights: ["Employee & department counts", "Organization skill gaps", "Gap severity breakdown", "Department gap ranking"],
    accent: "secondary",
    filename: "hr-executive-summary.pdf"
  },
  {
    id: "training_compliance",
    title: "Training & compliance",
    description: "Training budget, recommended programs, live assignments, enrollments, and certification compliance status.",
    highlights: ["Budget & completion rate", "Recommended programs", "Active assignments", "Certification alerts"],
    accent: "info",
    filename: "hr-training-compliance-report.pdf"
  },
  {
    id: "talent",
    title: "Talent & workforce records",
    description: "Employee directory, pending registrations, recruitment insights, talent pipeline, and performance support data.",
    highlights: ["Employee records", "Pending approvals", "Recruitment priorities", "Recent HR actions"],
    accent: "success",
    filename: "hr-talent-workforce-report.pdf"
  }
];

export const MANAGER_REPORTS = [
  {
    id: "main",
    title: "Main team report",
    description: "Executive brief — team KPIs, roster snapshot, top gaps, active projects, and alerts in a concise leadership PDF.",
    highlights: ["Team KPIs", "Team at a glance", "Top skill gaps", "Projects & alerts"],
    accent: "primary",
    filename: "manager-main-team-report.pdf"
  },
  {
    id: "team_ops",
    title: "Team operations",
    description: "Team members, workload distribution, performance monitoring, daily project reports, and operational alerts.",
    highlights: ["Team roster & skills", "Workload & availability", "Performance metrics", "Risk alerts"],
    accent: "secondary",
    filename: "manager-team-operations-report.pdf"
  },
  {
    id: "skills_gaps",
    title: "Skills & gap analysis",
    description: "Team skill overview, heatmap coverage, and prioritized skill gap analysis for staffing decisions.",
    highlights: ["Skill distribution", "Gap scores by skill", "Affected employees", "Severity indicators"],
    accent: "warning",
    filename: "manager-skills-gaps-report.pdf"
  },
  {
    id: "projects_matching",
    title: "Projects & AI matching",
    description: "Active projects, assignment context, AI employee matching scores, eligibility, and match rationale.",
    highlights: ["Project requirements", "Match percentages", "CV quality signals", "Skill breakdown"],
    accent: "info",
    filename: "manager-projects-matching-report.pdf"
  }
];

export const EMPLOYEE_REPORTS = [
  {
    id: "main",
    title: "Main personal report",
    description: "Executive brief — profile snapshot, key insights, priority gaps, training summary, and project highlights.",
    highlights: ["Profile & alignment", "Key insights", "Priority skill gaps", "Training & projects snapshot"],
    accent: "primary",
    filename: "employee-main-workforce-report.pdf"
  },
  {
    id: "competency",
    title: "Competency & CV intelligence",
    description: "Profile, parsed work history, CV parser confidence, skill inventory, and gap analysis with CV evidence.",
    highlights: ["Work history from CV", "Role alignment score", "Skill levels", "Gap severity & notes"],
    accent: "secondary",
    filename: "employee-competency-cv-report.pdf"
  },
  {
    id: "training",
    title: "Training & development",
    description: "AI training recommendations, enrollment status, active courses, completed certifications, and career goals.",
    highlights: ["Recommended courses", "HR enrollment status", "Learning progress", "Development goals"],
    accent: "info",
    filename: "employee-training-development-report.pdf"
  },
  {
    id: "projects",
    title: "Projects & activity",
    description: "Assigned projects, daily report history, career path suggestions, notifications, and compliance items.",
    highlights: ["Project progress", "Daily reports", "Career paths", "HR notifications"],
    accent: "success",
    filename: "employee-projects-activity-report.pdf"
  }
];
