export function dashboardPathForRole(role) {
  switch (role) {
    case "employee":
      return "/app/employee?section=home";
    case "manager":
      return "/app/manager?section=home";
    case "hr_admin":
      return "/app/hr?section=home";
    case "system_admin":
      return "/app/admin?section=users";
    default:
      return "/app";
  }
}

export function canAccessRoleRoute(userRole, routeRole) {
  // STRICT: no cross-access between dashboards unless explicitly allowed.
  // Backend RBAC still enforces the final decision.
  if (!userRole) return false;
  if (routeRole === "admin") return userRole === "system_admin";
  if (routeRole === "hr") return userRole === "hr_admin";
  if (routeRole === "manager") return userRole === "manager";
  if (routeRole === "employee") return userRole === "employee";
  return false;
}

