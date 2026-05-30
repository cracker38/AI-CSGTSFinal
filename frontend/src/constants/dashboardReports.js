export const HR_REPORTS = [
  {
    id: "employee_directory",
    title: "Employee directory",
    description: "Complete workforce register — every employee with contact details, department, job profile, manager assignment, and account status.",
    highlights: ["Full employee list", "Department headcount", "Manager assignments", "Pending registrations"],
    accent: "primary",
    icon: "directory",
    filename: "hr-employee-directory-report.pdf"
  },
  {
    id: "employee_performance",
    title: "Employee performance",
    description: "Organization-wide performance analytics — project success, skill improvement, training completion, and composite performance scores.",
    highlights: ["Performance scores", "Skill target progress", "Training completion", "Top performers"],
    accent: "secondary",
    icon: "performance",
    filename: "hr-employee-performance-report.pdf"
  },
  {
    id: "training_active",
    title: "Employees in training",
    description: "Live training roster — who is enrolled, course progress, learning sessions, verified study time, and pending enrollment requests.",
    highlights: ["Active assignments", "In-session learners", "Course progress", "Enrollment queue"],
    accent: "info",
    icon: "training",
    filename: "hr-employees-in-training-report.pdf"
  }
];

export const MANAGER_REPORTS = [
  {
    id: "team_directory",
    title: "Team directory",
    description: "Complete roster of your direct reports — contact profile, skills, workload, availability, and current performance snapshot.",
    highlights: ["Full team list", "Skills & workload", "Availability status", "Department breakdown"],
    accent: "primary",
    icon: "directory",
    filename: "manager-team-directory-report.pdf"
  },
  {
    id: "team_performance",
    title: "Team performance",
    description: "Performance analytics for your team — project delivery, skill improvement, training completion, and composite scores.",
    highlights: ["Performance scores", "Task completion", "Skill improvement", "Top performers"],
    accent: "secondary",
    icon: "performance",
    filename: "manager-team-performance-report.pdf"
  },
  {
    id: "team_training",
    title: "Team in training",
    description: "Team members enrolled in learning programs — course progress, live sessions, verified study time, and pending HR enrollments.",
    highlights: ["Active assignments", "In-session learners", "Course progress", "Pending enrollments"],
    accent: "info",
    icon: "training",
    filename: "manager-team-in-training-report.pdf"
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
