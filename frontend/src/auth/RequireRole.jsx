import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getAuth } from "./authStore";
import { canAccessRoleRoute, dashboardPathForRole } from "./roleRouting";

export default function RequireRole({ role }) {
  const auth = getAuth();
  if (!auth?.role) return <Navigate to="/login" replace />;
  if (!canAccessRoleRoute(auth.role, role)) {
    return <Navigate to={dashboardPathForRole(auth.role)} replace />;
  }
  return <Outlet />;
}

