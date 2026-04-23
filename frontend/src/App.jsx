import React, { Suspense, lazy } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./auth/RequireAuth";
import RequireRole from "./auth/RequireRole";
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterEmployeePage = lazy(() => import("./pages/RegisterEmployeePage"));
const DashboardsIndex = lazy(() => import("./pages/DashboardsIndex"));
const EmployeeDashboard = lazy(() => import("./pages/EmployeeDashboard"));
const HrDashboard = lazy(() => import("./pages/HrDashboard"));
const ManagerDashboard = lazy(() => import("./pages/ManagerDashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const ExecutiveDashboard = lazy(() => import("./pages/ExecutiveDashboard"));

function RouteLoader() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 1.5
      }}
    >
      <CircularProgress size={28} />
      <Typography variant="body2" color="text.secondary">
        Loading workspace...
      </Typography>
    </Box>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterEmployeePage />} />

        <Route element={<RequireAuth />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/app" element={<DashboardsIndex />} />
          <Route path="/app/dashboards" element={<DashboardsIndex />} />

          <Route element={<RequireRole role="employee" />}>
            <Route path="/app/employee" element={<EmployeeDashboard />} />
          </Route>
          <Route element={<RequireRole role="manager" />}>
            <Route path="/app/manager" element={<ManagerDashboard />} />
          </Route>
          <Route element={<RequireRole role="hr" />}>
            <Route path="/app/hr" element={<HrDashboard />} />
          </Route>
          <Route element={<RequireRole role="executive" />}>
            <Route path="/app/executive" element={<ExecutiveDashboard />} />
          </Route>
          <Route element={<RequireRole role="admin" />}>
            <Route path="/app/admin" element={<AdminDashboard />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}

