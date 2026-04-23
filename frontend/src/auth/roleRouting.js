export function dashboardPathForRole(role) {
  switch (role) {
    case "employee":
      return "/app/employee";
    case "manager":
      return "/app/manager";
    case "hr_admin":
      return "/app/hr";
    case "executive":
      return "/app/executive";
    case "system_admin":
      return "/app/admin";
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
  if (routeRole === "executive") return userRole === "executive";
  if (routeRole === "employee") return userRole === "employee";
  return false;
}

