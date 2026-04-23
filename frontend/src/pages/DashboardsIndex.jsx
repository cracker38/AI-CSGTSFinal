import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth } from "../auth/authStore";
import { dashboardPathForRole } from "../auth/roleRouting";

export default function DashboardsIndex() {
  const navigate = useNavigate();

  useEffect(() => {
    const auth = getAuth();
    navigate(dashboardPathForRole(auth?.role), { replace: true });
  }, [navigate]);

  return null;
}

