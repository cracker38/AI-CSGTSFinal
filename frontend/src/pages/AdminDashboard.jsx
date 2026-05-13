import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Menu,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../api/client";
import { exportElementToPdfLazy } from "../utils/pdfExportLazy";
import { exportRowsToCsv } from "../utils/csvExport";
import { getApiErrorMessage } from "../utils/apiError";

const SECTIONS = [
  { key: "users", label: "User management" },
  { key: "masterdata", label: "Master data" },
  { key: "permissions", label: "Roles & permissions" },
  { key: "audit", label: "Audit logs" },
  { key: "data", label: "Import / Export" },
  { key: "health", label: "System health" }
];

export default function AdminDashboard() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isSmallMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const exportRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState("users");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [pending, setPending] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [auditLogs, setAuditLogs] = useState([]);
  const [health, setHealth] = useState(null);
  const [masterCatalog, setMasterCatalog] = useState({ departments: [], job_titles: [], primary_skills: [] });
  const [permMatrix, setPermMatrix] = useState(null);
  const [catalogRequests, setCatalogRequests] = useState([]);
  const [departmentInput, setDepartmentInput] = useState("");
  const [jobTitleInput, setJobTitleInput] = useState("");
  const [skillInput, setSkillInput] = useState("");

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    temporary_password: "",
    role: "hr_admin"
  });

  const [uploadFile, setUploadFile] = useState(null);
  const [success, setSuccess] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(8);
  const [confirmAction, setConfirmAction] = useState(null);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState("desc");
  const [rowMenuAnchorEl, setRowMenuAnchorEl] = useState(null);
  const [rowMenuUser, setRowMenuUser] = useState(null);
  const [rowMenuPosition, setRowMenuPosition] = useState(null);

  const kpis = useMemo(
    () => [
      { label: "Total users", value: allUsers.length },
      { label: "Active users", value: allUsers.filter((u) => u.status === "active").length },
      { label: "Pending approvals", value: pending.length },
      { label: "Audit events", value: auditLogs.length }
    ],
    [allUsers, pending.length, auditLogs.length]
  );

  const sortedUsers = useMemo(() => {
    const filtered = allUsers.filter((u) => {
      const matchesRole = roleFilter === "all" || u.role === roleFilter;
      const matchesStatus = statusFilter === "all" || u.status === statusFilter;
      return matchesRole && matchesStatus;
    });
    return [...filtered].sort((a, b) => {
      const av = a[sortBy] ?? "";
      const bv = b[sortBy] ?? "";
      if (sortBy === "created_at") {
        const at = new Date(av).getTime();
        const bt = new Date(bv).getTime();
        return sortOrder === "asc" ? at - bt : bt - at;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [allUsers, roleFilter, statusFilter, sortBy, sortOrder]);

  const filteredUsers = sortedUsers;

  const pagedUsers = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredUsers.slice(start, start + rowsPerPage);
  }, [filteredUsers, page, rowsPerPage]);

  async function load() {
    setLoading(true);
    try {
      setError("");
      const pRes = await api.get("/admin/users/pending");
      setPending(pRes.data);
      const uRes = await api.get("/admin/users");
      setAllUsers(uRes.data);
      const aRes = await api.get("/admin/system/audit-logs?limit=50");
      setAuditLogs(aRes.data);
      const hRes = await api.get("/admin/system/health");
      setHealth(hRes.data);
      const pm = await api.get("/admin/system/roles-permissions");
      setPermMatrix(pm.data?.matrix || null);
      const catalogRes = await api.get("/master-data/catalog");
      setMasterCatalog(catalogRes.data || { departments: [], job_titles: [], primary_skills: [] });
      const requestsRes = await api.get("/master-data/requests");
      setCatalogRequests(requestsRes.data || []);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load admin dashboard"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const section = searchParams.get("section");
    const allowed = new Set(SECTIONS.map((s) => s.key));
    if (section && allowed.has(section)) {
      setActiveSection(section);
    } else if (section && !allowed.has(section)) {
      const next = new URLSearchParams(searchParams);
      next.set("section", "users");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function approve(userId) {
    setError("");
    try {
      await api.post(`/admin/users/${userId}/approve`);
      setSuccess("Employee approved successfully.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Approval failed"));
    }
  }

  async function createPrivileged(e) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await api.post("/admin/users/create-privileged", form);
      setForm({ full_name: "", email: "", temporary_password: "", role: "hr_admin" });
      setSuccess("Privileged user created.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to create user"));
    } finally {
      setCreating(false);
    }
  }

  async function refreshUsers() {
    try {
      const uRes = await api.get("/admin/users", {
        params: {
          q: userSearch || undefined,
          role: roleFilter !== "all" ? roleFilter : undefined,
          status: statusFilter !== "all" ? statusFilter : undefined
        }
      });
      setAllUsers(uRes.data);
      setPage(0);
      setSelectedUserIds([]);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to refresh users"));
    }
  }

  async function setUserStatus(userId, status) {
    setError("");
    try {
      await api.patch(`/admin/users/${userId}/status`, { status });
      setSuccess(`User status updated to ${status}.`);
      await refreshUsers();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to update user status"));
    }
  }

  async function forcePwdChange(userId) {
    setError("");
    try {
      await api.post(`/admin/users/${userId}/force-password-change`);
      setSuccess("User will be required to change password on next login.");
      await refreshUsers();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to force password change"));
    }
  }

  async function resetPasswordToDefault(userId) {
    setError("");
    try {
      await api.post(`/admin/users/${userId}/reset-password-default`);
      setSuccess("Password reset to default Password123.");
      await refreshUsers();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to reset password"));
    }
  }

  async function bulkSetStatus(status) {
    setError("");
    try {
      await Promise.all(selectedUserIds.map((id) => api.patch(`/admin/users/${id}/status`, { status })));
      setSuccess(`Updated ${selectedUserIds.length} users to ${status}.`);
      await refreshUsers();
    } catch (err) {
      setError(getApiErrorMessage(err, "Bulk status update failed"));
    }
  }

  async function bulkResetPasswordDefault() {
    setError("");
    try {
      await Promise.all(selectedUserIds.map((id) => api.post(`/admin/users/${id}/reset-password-default`)));
      setSuccess(`Reset passwords for ${selectedUserIds.length} users.`);
      await refreshUsers();
    } catch (err) {
      setError(getApiErrorMessage(err, "Bulk password reset failed"));
    }
  }

  function toggleSort(field) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortOrder("asc");
  }

  function openRowMenu(event, user) {
    event.preventDefault();
    setRowMenuAnchorEl(event.currentTarget);
    setRowMenuUser(user);
    setRowMenuPosition({
      top: event.clientY + 6,
      left: event.clientX - 6
    });
  }

  function closeRowMenu() {
    setRowMenuAnchorEl(null);
    setRowMenuUser(null);
    setRowMenuPosition(null);
  }

  async function downloadUsersCsv() {
    setError("");
    try {
      const res = await api.get("/admin/system/export/users.csv", { responseType: "blob" });
      const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "users_export.csv";
      a.click();
      window.URL.revokeObjectURL(url);
      setSuccess("User export downloaded.");
    } catch (err) {
      setError(getApiErrorMessage(err, "Export failed"));
    }
  }

  function openEditUser(u) {
    setEditUser(u);
    setEditForm({
      full_name: u.full_name || "",
      email: u.email || "",
      phone_number: u.phone_number || "",
      country: u.country || "",
      department: u.department || "",
      job_title: u.job_title || "",
      experience_level: u.experience_level || "",
      primary_skill: u.primary_skill || "",
      role: u.role || "employee",
      status: u.status || "active",
      manager_id: u.manager_id || ""
    });
    setEditOpen(true);
  }

  async function saveEditUser() {
    if (!editUser) return;
    setError("");
    try {
      const payload = {
        full_name: editForm.full_name,
        email: editForm.email,
        phone_number: editForm.phone_number,
        country: editForm.country,
        department: editForm.department,
        job_title: editForm.job_title,
        experience_level: editForm.experience_level,
        primary_skill: editForm.primary_skill
      };
      if (editUser.role !== "system_admin") {
        payload.role = editForm.role;
        payload.status = editForm.status;
      }
      if (editUser.role === "employee") {
        const m = (editForm.manager_id || "").trim();
        payload.manager_id = m || null;
      }
      await api.patch(`/admin/users/${editUser.id}`, payload);
      setSuccess("User updated.");
      setEditOpen(false);
      setEditUser(null);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to update user"));
    }
  }

  async function deleteAdminUser(user) {
    setError("");
    try {
      await api.delete(`/admin/users/${user.id}`);
      setSuccess(`Deleted ${user.email}.`);
      closeRowMenu();
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to delete user"));
    }
  }

  async function addCatalogValue(endpoint, name, clearFn) {
    if (!name.trim()) return;
    setError("");
    try {
      await api.post(endpoint, { name: name.trim(), active: true });
      clearFn("");
      setSuccess("Catalog updated.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to update catalog"));
    }
  }

  async function reviewRequest(requestId, statusValue) {
    setError("");
    try {
      await api.post(`/master-data/requests/${requestId}/review`, { status: statusValue });
      setSuccess(`Request ${statusValue}.`);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to review request"));
    }
  }

  async function uploadImportFile() {
    if (!uploadFile) return;
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await api.post("/admin/system/import/users", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setUploadFile(null);
      const { created, updated, errors, message } = res.data || {};
      const errText =
        Array.isArray(errors) && errors.length
          ? ` Row errors: ${errors.slice(0, 5).map((e) => `row ${e.row}: ${e.detail}`).join("; ")}${errors.length > 5 ? "…" : ""}`
          : "";
      setSuccess(`${message || "Import complete."}${errText}`);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to import users"));
    }
  }

  function SectionPanel({ children }) {
    return (
      <Card variant="outlined" sx={{ borderRadius: 3, borderColor: "divider", boxShadow: "0 8px 22px rgba(0,0,0,0.06)" }}>
        <CardContent sx={{ p: { xs: 1.5, sm: 2, md: 2.5 } }}>{children}</CardContent>
      </Card>
    );
  }

  return (
    <AppShell title="Admin Dashboard">
      <Stack spacing={2}>
        {loading ? <LinearProgress /> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Card
          variant="outlined"
          sx={{
            borderRadius: 3,
            borderColor: "divider",
            background: "linear-gradient(135deg, rgba(25,118,210,0.10) 0%, rgba(46,125,50,0.08) 100%)"
          }}
        >
          <CardContent>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1.2}
              alignItems={{ xs: "flex-start", md: "center" }}
              justifyContent="space-between"
            >
              <Box>
                <Typography variant="h5" fontWeight={800}>System Admin Control Center</Typography>
                <Typography variant="body2" color="text.secondary">
                  Monitor platform health, manage users, audit activity, and import or export directory data.
                </Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} width={{ xs: "100%", md: "auto" }}>
                <Button variant="outlined" onClick={load} startIcon={<RefreshIcon />} fullWidth={isMobile}>
                  Refresh data
                </Button>
                <Button
                  variant="contained"
                  fullWidth={isMobile}
                  onClick={() =>
                    exportElementToPdfLazy(exportRef.current, `admin-${activeSection}.pdf`, {
                      role: "system_admin",
                      section: activeSection,
                      title: "System Admin Dashboard Report"
                    })
                  }
                >
                  Export PDF
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Grid container spacing={2}>
          {kpis.map((k, idx) => (
            <Grid item xs={12} sm={6} md={3} key={k.label}>
              <Card
                variant="outlined"
                sx={{
                  borderRadius: 3,
                  borderColor: "divider",
                  height: "100%",
                  position: "relative",
                  overflow: "hidden",
                  background:
                    idx % 2 === 0
                      ? "linear-gradient(145deg, rgba(25,118,210,0.08) 0%, rgba(255,255,255,0.02) 100%)"
                      : "linear-gradient(145deg, rgba(46,125,50,0.08) 0%, rgba(255,255,255,0.02) 100%)"
                }}
              >
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    height: 4,
                    width: "100%",
                    bgcolor: idx % 2 === 0 ? "secondary.main" : "primary.main"
                  }}
                />
                <CardContent sx={{ pt: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.4 }}>
                    {k.label}
                  </Typography>
                  <Typography variant="h4" fontWeight={900} sx={{ fontSize: { xs: "1.8rem", md: "2.1rem" } }}>
                    {k.value}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
              <Tooltip title="Refresh all data">
                <IconButton size="small" onClick={load}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Button
                variant="outlined"
                onClick={() =>
                  exportElementToPdfLazy(exportRef.current, `admin-${activeSection}.pdf`, {
                    role: "system_admin",
                    section: activeSection,
                    title: "System Admin Dashboard Report"
                  })
                }
              >
                Export PDF
              </Button>
            </Stack>
            <div ref={exportRef}>
            {loading ? (
              <SectionPanel>
                <Stack direction="row" spacing={2} alignItems="center">
                  <CircularProgress size={22} />
                  <Typography>Loading admin modules...</Typography>
                </Stack>
              </SectionPanel>
            ) : null}

            {!loading && activeSection === "users" ? (
              <Stack spacing={2}>
                <SectionPanel>
                  <Typography variant="h6" fontWeight={800}>
                    Create privileged accounts
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    You can create only `HR Admin`, `Manager`, and `Executive` accounts.
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Stack component="form" spacing={2} onSubmit={createPrivileged}>
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Full name"
                          value={form.full_name}
                          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                          fullWidth
                          required
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Email"
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                          fullWidth
                          required
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Temporary password"
                          type="password"
                          value={form.temporary_password}
                          onChange={(e) => setForm({ ...form, temporary_password: e.target.value })}
                          fullWidth
                          required
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Role"
                          value={form.role}
                          onChange={(e) => setForm({ ...form, role: e.target.value })}
                          fullWidth
                          required
                          select
                          SelectProps={{ native: true }}
                        >
                          <option value="hr_admin">HR Admin</option>
                          <option value="manager">Manager</option>
                        </TextField>
                      </Grid>
                    </Grid>
                    <Stack direction="row" justifyContent="flex-end">
                      <Button type="submit" variant="contained" disabled={creating} fullWidth={isMobile}>
                        {creating ? "Creating..." : "Create user"}
                      </Button>
                    </Stack>
                  </Stack>
                </SectionPanel>

                <SectionPanel>
                  <Typography variant="h6" fontWeight={800}>
                    Pending employee approvals
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  {pending.length === 0 ? (
                    <Alert severity="info">No pending approvals.</Alert>
                  ) : isMobile ? (
                    <Stack spacing={1.2}>
                      {pending.map((u) => (
                        <Card key={u.id} variant="outlined" sx={{ borderRadius: 2 }}>
                          <CardContent sx={{ "&:last-child": { pb: 2 } }}>
                            <Stack spacing={0.9}>
                              <Typography fontWeight={700}>{u.full_name}</Typography>
                              <Typography variant="body2" color="text.secondary">{u.email}</Typography>
                              <Stack direction="row" flexWrap="wrap" gap={0.8}>
                                <Chip size="small" label={u.department} />
                                <Chip size="small" variant="outlined" label={u.job_title} />
                              </Stack>
                              <Button size="small" variant="contained" onClick={() => approve(u.id)}>
                                Approve
                              </Button>
                            </Stack>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  ) : (
                    <>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Name</TableCell>
                              <TableCell>Email</TableCell>
                              <TableCell>Department</TableCell>
                              <TableCell>Job title</TableCell>
                              <TableCell align="right">Action</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {pending.map((u) => (
                              <TableRow key={u.id} hover>
                                <TableCell>{u.full_name}</TableCell>
                                <TableCell>{u.email}</TableCell>
                                <TableCell>{u.department}</TableCell>
                                <TableCell>{u.job_title}</TableCell>
                                <TableCell align="right">
                                  <Button size="small" variant="contained" onClick={() => approve(u.id)}>
                                    Approve
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() =>
                            exportRowsToCsv("admin-pending-approvals.csv", pending, [
                              { header: "Name", value: (r) => r.full_name },
                              { header: "Email", value: (r) => r.email },
                              { header: "Department", value: (r) => r.department },
                              { header: "Job Title", value: (r) => r.job_title }
                            ])
                          }
                        >
                          Export CSV
                        </Button>
                      </Stack>
                    </>
                  )}
                </SectionPanel>

                <SectionPanel>
                  <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                    <Box>
                      <Typography variant="h6" fontWeight={800}>
                        User Directory
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Manage account status, password policy, and administrative actions.
                      </Typography>
                    </Box>
                    <Chip label={`${filteredUsers.length} users`} color="primary" variant="outlined" />
                  </Stack>
                  <Divider sx={{ my: 2 }} />
                  <Grid container spacing={1.2} sx={{ mb: 1 }}>
                    <Grid item xs={12} md={5}>
                      <TextField
                        size="small"
                        label="Search users"
                        placeholder="Name, email, department..."
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        fullWidth
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <TextField
                        select
                        size="small"
                        label="Role"
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        fullWidth
                      >
                        <MenuItem value="all">All</MenuItem>
                        <MenuItem value="employee">Employee</MenuItem>
                        <MenuItem value="manager">Manager</MenuItem>
                        <MenuItem value="hr_admin">HR Admin</MenuItem>
                        <MenuItem value="system_admin">System Admin</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid item xs={12} sm={6} md={2}>
                      <TextField
                        select
                        size="small"
                        label="Status"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        fullWidth
                      >
                        <MenuItem value="all">All</MenuItem>
                        <MenuItem value="active">Active</MenuItem>
                        <MenuItem value="pending_approval">Pending</MenuItem>
                        <MenuItem value="disabled">Disabled</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid item xs={12} md={2}>
                      <Button variant="contained" onClick={refreshUsers} fullWidth>
                        Apply
                      </Button>
                    </Grid>
                  </Grid>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mb: 1.5, p: 1.2, borderRadius: 2, bgcolor: "action.hover" }}>
                    <Chip
                      color={selectedUserIds.length ? "primary" : "default"}
                      label={selectedUserIds.length ? `${selectedUserIds.length} selected` : "No rows selected"}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!selectedUserIds.length}
                      fullWidth={isMobile}
                      onClick={() =>
                        setConfirmAction({
                          title: "Activate selected users?",
                          description: `Activate ${selectedUserIds.length} selected users.`,
                          onConfirm: () => bulkSetStatus("active")
                        })
                      }
                    >
                      Bulk activate
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="warning"
                      disabled={!selectedUserIds.length}
                      fullWidth={isMobile}
                      onClick={() =>
                        setConfirmAction({
                          title: "Disable selected users?",
                          description: `Disable ${selectedUserIds.length} selected users.`,
                          onConfirm: () => bulkSetStatus("disabled")
                        })
                      }
                    >
                      Bulk disable
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      color="warning"
                      disabled={!selectedUserIds.length}
                      fullWidth={isMobile}
                      onClick={() =>
                        setConfirmAction({
                          title: "Reset selected user passwords?",
                          description: `Reset ${selectedUserIds.length} selected users to Password123.`,
                          onConfirm: () => bulkResetPasswordDefault()
                        })
                      }
                    >
                      Bulk reset password
                    </Button>
                  </Stack>
                  {isMobile ? (
                    <Stack spacing={1.2}>
                      {pagedUsers.map((u) => (
                        <Card key={u.id} variant="outlined" sx={{ borderRadius: 2.2, borderColor: "divider" }}>
                          <CardContent sx={{ "&:last-child": { pb: 2 } }}>
                            <Stack spacing={1}>
                              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                                <Typography fontWeight={700}>{u.full_name}</Typography>
                                <Checkbox
                                  checked={selectedUserIds.includes(u.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) setSelectedUserIds([...selectedUserIds, u.id]);
                                    else setSelectedUserIds(selectedUserIds.filter((id) => id !== u.id));
                                  }}
                                />
                              </Stack>
                              <Typography variant="body2" color="text.secondary">{u.email}</Typography>
                              <Stack direction="row" flexWrap="wrap" gap={0.8}>
                                <Chip size="small" label={u.role} />
                                <Chip size="small" label={u.status} color={u.status === "active" ? "success" : u.status === "disabled" ? "warning" : "default"} />
                                <Chip size="small" variant="outlined" label={u.must_change_password ? "Force password change" : "Standard password"} />
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                Created {new Date(u.created_at).toLocaleDateString()}
                              </Typography>
                              <Stack spacing={0.8}>
                                {u.status !== "active" ? (
                                  <Button size="small" variant="outlined" onClick={() => setUserStatus(u.id, "active")} fullWidth>
                                    Activate
                                  </Button>
                                ) : (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="warning"
                                    fullWidth
                                    onClick={() =>
                                      setConfirmAction({
                                        title: "Disable user account?",
                                        description: `Disable ${u.full_name} (${u.email}). They will no longer access the platform until reactivated.`,
                                        onConfirm: () => setUserStatus(u.id, "disabled")
                                      })
                                    }
                                  >
                                    Disable
                                  </Button>
                                )}
                                <Button size="small" variant="outlined" onClick={() => forcePwdChange(u.id)} fullWidth>
                                  Force password change
                                </Button>
                                <Button
                                  size="small"
                                  variant="contained"
                                  color="warning"
                                  fullWidth
                                  onClick={() =>
                                    setConfirmAction({
                                      title: "Reset password to default?",
                                      description: `Reset ${u.full_name}'s password to Password123 and require change on next login.`,
                                      onConfirm: () => resetPasswordToDefault(u.id)
                                    })
                                  }
                                >
                                  Reset password
                                </Button>
                                <Button size="small" variant="outlined" onClick={() => openEditUser(u)} fullWidth>
                                  Edit user
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="error"
                                  fullWidth
                                  onClick={() =>
                                    setConfirmAction({
                                      title: "Permanently delete user?",
                                      description: `Delete ${u.full_name} (${u.email}). This cannot be undone.`,
                                      onConfirm: () => deleteAdminUser(u)
                                    })
                                  }
                                >
                                  Delete user
                                </Button>
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  ) : (
                    <TableContainer sx={{ borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={pagedUsers.length > 0 && pagedUsers.every((u) => selectedUserIds.includes(u.id))}
                                indeterminate={
                                  pagedUsers.some((u) => selectedUserIds.includes(u.id)) &&
                                  !pagedUsers.every((u) => selectedUserIds.includes(u.id))
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    const merge = new Set([...selectedUserIds, ...pagedUsers.map((u) => u.id)]);
                                    setSelectedUserIds(Array.from(merge));
                                  } else {
                                    const removeSet = new Set(pagedUsers.map((u) => u.id));
                                    setSelectedUserIds(selectedUserIds.filter((id) => !removeSet.has(id)));
                                  }
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <TableSortLabel active={sortBy === "full_name"} direction={sortOrder} onClick={() => toggleSort("full_name")}>
                                Name
                              </TableSortLabel>
                            </TableCell>
                            <TableCell>
                              <TableSortLabel active={sortBy === "email"} direction={sortOrder} onClick={() => toggleSort("email")}>
                                Email
                              </TableSortLabel>
                            </TableCell>
                            <TableCell>
                              <TableSortLabel active={sortBy === "role"} direction={sortOrder} onClick={() => toggleSort("role")}>
                                Role
                              </TableSortLabel>
                            </TableCell>
                            <TableCell>
                              <TableSortLabel active={sortBy === "status"} direction={sortOrder} onClick={() => toggleSort("status")}>
                                Status
                              </TableSortLabel>
                            </TableCell>
                            <TableCell>Password Policy</TableCell>
                            <TableCell>
                              <TableSortLabel active={sortBy === "created_at"} direction={sortOrder} onClick={() => toggleSort("created_at")}>
                                Created
                              </TableSortLabel>
                            </TableCell>
                            <TableCell align="right">Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {pagedUsers.map((u) => (
                          <TableRow key={u.id} hover>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  checked={selectedUserIds.includes(u.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedUserIds([...selectedUserIds, u.id]);
                                    } else {
                                      setSelectedUserIds(selectedUserIds.filter((id) => id !== u.id));
                                    }
                                  }}
                                />
                              </TableCell>
                              <TableCell>{u.full_name}</TableCell>
                              <TableCell>{u.email}</TableCell>
                              <TableCell>
                                <Chip size="small" label={u.role} />
                              </TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  label={u.status}
                                  color={u.status === "active" ? "success" : u.status === "disabled" ? "warning" : "default"}
                                />
                              </TableCell>
                              <TableCell>{u.must_change_password ? "Force change on next login" : "Standard"}</TableCell>
                              <TableCell>{new Date(u.created_at).toLocaleDateString()}</TableCell>
                            <TableCell align="right">
                              <IconButton
                                size="small"
                                onClick={(e) => openRowMenu(e, u)}
                                sx={{
                                  borderRadius: 1.5,
                                  "&:hover": {
                                    bgcolor: "transparent",
                                    color: "primary.main"
                                  }
                                }}
                              >
                                <MoreVertIcon fontSize="small" />
                              </IconButton>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                  <TablePagination
                    component="div"
                    rowsPerPageOptions={isSmallMobile ? [5, 8, 15] : [5, 8, 15, 25]}
                    count={filteredUsers.length}
                    rowsPerPage={rowsPerPage}
                    page={page}
                    onPageChange={(_, next) => setPage(next)}
                    onRowsPerPageChange={(e) => {
                      setRowsPerPage(parseInt(e.target.value, 10));
                      setPage(0);
                    }}
                    sx={{
                      ".MuiTablePagination-toolbar": {
                        px: { xs: 0.5, sm: 1.5 },
                        flexWrap: "wrap",
                        rowGap: 0.5
                      }
                    }}
                  />
                  <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      fullWidth={isSmallMobile}
                      onClick={() =>
                        exportRowsToCsv("admin-user-directory.csv", filteredUsers, [
                          { header: "Name", value: (r) => r.full_name },
                          { header: "Email", value: (r) => r.email },
                          { header: "Role", value: (r) => r.role },
                          { header: "Status", value: (r) => r.status }
                        ])
                      }
                    >
                      Export CSV
                    </Button>
                  </Stack>
                </SectionPanel>

              </Stack>
            ) : null}

            {!loading && activeSection === "permissions" ? (
              <SectionPanel>
                <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                  <Box>
                    <Typography variant="h6" fontWeight={800}>
                      Roles & permissions
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Access map for each role in the platform.
                    </Typography>
                  </Box>
                  <Chip
                    label={`${permMatrix ? Object.keys(permMatrix).length : 0} roles`}
                    color="primary"
                    variant="outlined"
                    sx={{ alignSelf: "flex-start" }}
                  />
                </Stack>
                <Divider sx={{ my: 2 }} />
                {permMatrix ? (
                  <Grid container spacing={1.5}>
                    {Object.entries(permMatrix).map(([role, permissions]) => (
                      <Grid item xs={12} md={6} key={role}>
                        <Card variant="outlined" sx={{ borderRadius: 2.5, borderColor: "divider", height: "100%" }}>
                          <CardContent sx={{ p: 2 }}>
                            <Stack spacing={1.2}>
                              <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="subtitle1" fontWeight={800} sx={{ textTransform: "capitalize" }}>
                                  {role.replace("_", " ")}
                                </Typography>
                                <Chip size="small" label={`${permissions.length} permissions`} />
                              </Stack>
                              <Stack direction="row" flexWrap="wrap" gap={0.8}>
                                {permissions.map((p) => (
                                  <Chip
                                    key={p}
                                    label={p.replace(/_/g, " ")}
                                    size="small"
                                    variant="outlined"
                                    sx={{ borderRadius: 1.5 }}
                                  />
                                ))}
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                ) : (
                  <Alert severity="info">No permission matrix available.</Alert>
                )}
              </SectionPanel>
            ) : null}

            {!loading && activeSection === "masterdata" ? (
              <SectionPanel>
                <Typography variant="h6" fontWeight={800}>
                  Master data administration
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  System admin can override all catalog values and review all manager requests.
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={12} md={4}>
                    <Stack direction="row" spacing={1}>
                      <TextField size="small" label="Department" value={departmentInput} onChange={(e) => setDepartmentInput(e.target.value)} fullWidth />
                      <Button variant="contained" onClick={() => addCatalogValue("/master-data/departments", departmentInput, setDepartmentInput)}>Add</Button>
                    </Stack>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Stack direction="row" spacing={1}>
                      <TextField size="small" label="Job title" value={jobTitleInput} onChange={(e) => setJobTitleInput(e.target.value)} fullWidth />
                      <Button variant="contained" onClick={() => addCatalogValue("/master-data/job-titles", jobTitleInput, setJobTitleInput)}>Add</Button>
                    </Stack>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Stack direction="row" spacing={1}>
                      <TextField size="small" label="Primary skill" value={skillInput} onChange={(e) => setSkillInput(e.target.value)} fullWidth />
                      <Button variant="contained" onClick={() => addCatalogValue("/master-data/skills", skillInput, setSkillInput)}>Add</Button>
                    </Stack>
                  </Grid>
                </Grid>
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={12} md={4}><Alert severity="info">Departments: {masterCatalog.departments.length}</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity="info">Job titles: {masterCatalog.job_titles.length}</Alert></Grid>
                  <Grid item xs={12} md={4}><Alert severity="info">Primary skills: {masterCatalog.primary_skills.length}</Alert></Grid>
                </Grid>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Manager catalog requests
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Type</TableCell>
                        <TableCell>Value</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {catalogRequests.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.request_type}</TableCell>
                          <TableCell>{r.value}</TableCell>
                          <TableCell>{r.status}</TableCell>
                          <TableCell align="right">
                            {r.status === "pending" ? (
                              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="flex-end">
                                <Button size="small" variant="outlined" color="success" onClick={() => reviewRequest(r.id, "approved")}>Approve</Button>
                                <Button size="small" variant="outlined" color="error" onClick={() => reviewRequest(r.id, "rejected")}>Reject</Button>
                              </Stack>
                            ) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </SectionPanel>
            ) : null}

            {!loading && activeSection === "audit" ? (
              <SectionPanel>
                <Typography variant="h6" fontWeight={800}>
                  Audit logs & activity tracking
                </Typography>
                <Divider sx={{ my: 2 }} />
                {auditLogs.length === 0 ? (
                  <Alert severity="info">No audit events yet.</Alert>
                ) : (
                  <>
                    <TableContainer sx={{ maxHeight: 520 }}>
                      <Table stickyHeader size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Time</TableCell>
                            <TableCell>Action</TableCell>
                            <TableCell>Entity</TableCell>
                            <TableCell>Actor</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {auditLogs.map((l) => (
                            <TableRow key={l.id}>
                              <TableCell>{new Date(l.created_at).toLocaleString()}</TableCell>
                              <TableCell>{l.action}</TableCell>
                              <TableCell>{`${l.entity_type}:${l.entity_id}`}</TableCell>
                              <TableCell>{l.actor_user_id || "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() =>
                          exportRowsToCsv("admin-audit-logs.csv", auditLogs, [
                            { header: "Time", value: (r) => r.created_at },
                            { header: "Action", value: (r) => r.action },
                            { header: "Entity Type", value: (r) => r.entity_type },
                            { header: "Entity ID", value: (r) => r.entity_id },
                            { header: "Actor", value: (r) => r.actor_user_id || "" }
                          ])
                        }
                      >
                        Export CSV
                      </Button>
                    </Stack>
                  </>
                )}
              </SectionPanel>
            ) : null}

            {!loading && activeSection === "data" ? (
              <SectionPanel>
                <Typography variant="h6" fontWeight={800}>
                  Data import / export tools
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Export matches the import template (UTF-8 CSV with header). Re-importing the same file updates existing users by{" "}
                  <code>id</code> or <code>email</code>. New rows need at least <code>email</code> and optional{" "}
                  <code>role</code>, <code>status</code>, profile fields, and <code>password</code> (otherwise a temporary password is set and the user must change it on first login).
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }}>
                  <Button variant="contained" onClick={() => void downloadUsersCsv()}>
                    Export users CSV
                  </Button>
                  <Button variant="outlined" component="label">
                    Select import CSV
                    <input
                      hidden
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    />
                  </Button>
                  <Button variant="contained" onClick={() => void uploadImportFile()} disabled={!uploadFile}>
                    Run import
                  </Button>
                  <Typography variant="body2" color="text.secondary">
                    {uploadFile ? `Selected: ${uploadFile.name}` : "No file selected"}
                  </Typography>
                </Stack>
              </SectionPanel>
            ) : null}

            {!loading && activeSection === "health" ? (
              <SectionPanel>
                <Typography variant="h6" fontWeight={800}>
                  System health monitoring
                </Typography>
                <Divider sx={{ my: 2 }} />
                {health ? (
                  <Stack direction="row" spacing={2}>
                    <Chip label={`API: ${health.ok ? "Healthy" : "Down"}`} color={health.ok ? "success" : "error"} />
                    <Chip label={`Database: ${health.db_ok ? "Connected" : "Disconnected"}`} color={health.db_ok ? "success" : "error"} />
                  </Stack>
                ) : (
                  <Alert severity="warning">No health data available.</Alert>
                )}
              </SectionPanel>
            ) : null}

            </div>
          </Grid>
        </Grid>
      </Stack>
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit user</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Full name"
              value={editForm.full_name || ""}
              onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
              fullWidth
            />
            <TextField
              label="Email"
              type="email"
              value={editForm.email || ""}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              fullWidth
            />
            <TextField
              label="Phone"
              value={editForm.phone_number || ""}
              onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })}
              fullWidth
            />
            <TextField
              label="Country"
              value={editForm.country || ""}
              onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
              fullWidth
            />
            <TextField
              label="Department"
              value={editForm.department || ""}
              onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
              fullWidth
            />
            <TextField
              label="Job title"
              value={editForm.job_title || ""}
              onChange={(e) => setEditForm({ ...editForm, job_title: e.target.value })}
              fullWidth
            />
            <TextField
              label="Experience level"
              value={editForm.experience_level || ""}
              onChange={(e) => setEditForm({ ...editForm, experience_level: e.target.value })}
              fullWidth
            />
            <TextField
              label="Primary skill"
              value={editForm.primary_skill || ""}
              onChange={(e) => setEditForm({ ...editForm, primary_skill: e.target.value })}
              fullWidth
            />
            {editUser?.role === "employee" ? (
              <TextField
                label="Manager user ID (UUID)"
                value={editForm.manager_id || ""}
                onChange={(e) => setEditForm({ ...editForm, manager_id: e.target.value })}
                fullWidth
                helperText="Leave empty to clear manager assignment"
              />
            ) : null}
            {editUser?.role !== "system_admin" ? (
              <>
                <TextField
                  label="Role"
                  value={editForm.role || "employee"}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  fullWidth
                  select
                  SelectProps={{ native: true }}
                >
                  <option value="employee">employee</option>
                  <option value="manager">manager</option>
                  <option value="hr_admin">hr_admin</option>
                  <option value="executive">executive</option>
                </TextField>
                <TextField
                  label="Status"
                  value={editForm.status || "active"}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  fullWidth
                  select
                  SelectProps={{ native: true }}
                >
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                  <option value="pending_approval">pending_approval</option>
                </TextField>
              </>
            ) : (
              <Alert severity="info">System administrator: role and status are locked; profile fields can be updated.</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void saveEditUser()}>
            Save changes
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(confirmAction)} onClose={() => setConfirmAction(null)}>
        <DialogTitle>{confirmAction?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirmAction?.description}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmAction(null)}>Cancel</Button>
          <Button
            color="warning"
            variant="contained"
            onClick={async () => {
              const run = confirmAction?.onConfirm;
              setConfirmAction(null);
              if (run) await run();
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
      <Menu
        anchorEl={rowMenuAnchorEl}
        open={Boolean(rowMenuAnchorEl && rowMenuUser)}
        onClose={closeRowMenu}
        anchorReference={rowMenuPosition ? "anchorPosition" : "anchorEl"}
        anchorPosition={rowMenuPosition || undefined}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            borderRadius: 2,
            minWidth: 210,
            "& .MuiMenuItem-root": {
              borderRadius: 1.2,
              mx: 0.6,
              my: 0.2,
              "&:hover": {
                bgcolor: "transparent",
                color: "primary.main"
              }
            }
          }
        }}
      >
        <MenuItem
          onClick={() => {
            const user = rowMenuUser;
            closeRowMenu();
            if (user) openEditUser(user);
          }}
        >
          Edit user
        </MenuItem>
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            const user = rowMenuUser;
            closeRowMenu();
            if (!user) return;
            setConfirmAction({
              title: "Permanently delete user?",
              description: `Delete ${user.full_name} (${user.email}). This cannot be undone.`,
              onConfirm: () => deleteAdminUser(user)
            });
          }}
        >
          Delete user
        </MenuItem>
        {rowMenuUser?.status !== "active" ? (
          <MenuItem
            onClick={() => {
              const user = rowMenuUser;
              closeRowMenu();
              if (user) void setUserStatus(user.id, "active");
            }}
          >
            Activate
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              const user = rowMenuUser;
              closeRowMenu();
              if (!user) return;
              setConfirmAction({
                title: "Disable user account?",
                description: `Disable ${user.full_name} (${user.email}). They will no longer access the platform until reactivated.`,
                onConfirm: () => setUserStatus(user.id, "disabled")
              });
            }}
          >
            Disable
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            const user = rowMenuUser;
            closeRowMenu();
            if (user) void forcePwdChange(user.id);
          }}
        >
          Force password change
        </MenuItem>
        <MenuItem
          onClick={() => {
            const user = rowMenuUser;
            closeRowMenu();
            if (!user) return;
            setConfirmAction({
              title: "Reset password to default?",
              description: `Reset ${user.full_name}'s password to Password123 and require change on next login.`,
              onConfirm: () => resetPasswordToDefault(user.id)
            });
          }}
        >
          Reset password
        </MenuItem>
      </Menu>
      <Snackbar open={Boolean(success)} autoHideDuration={3000} onClose={() => setSuccess("")}>
        <Alert severity="success" variant="filled" onClose={() => setSuccess("")}>
          {success}
        </Alert>
      </Snackbar>
    </AppShell>
  );
}

