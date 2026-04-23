import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getAuth } from "./authStore";

export default function RequireAuth() {
  const auth = getAuth();
  const location = useLocation();

  if (!auth?.access_token) return <Navigate to="/login" replace state={{ from: location }} />;
  if (auth.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

