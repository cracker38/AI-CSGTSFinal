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
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
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
  Typography
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
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
  { key: "config", label: "System configuration" },
  { key: "integrations", label: "Integrations" },
  { key: "audit", label: "Audit logs" },
  { key: "data", label: "Import / Export" },
  { key: "health", label: "System health" },
  { key: "backup", label: "Backup & recovery" }
];

export default function AdminDashboard() {
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
  const [settings, setSettings] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [permMatrix, setPermMatrix] = useState(null);
  const [backups, setBackups] = useState([]);
  const [masterCatalog, setMasterCatalog] = useState({ departments: [], job_titles: [], primary_skills: [] });
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

  const [settingForm, setSettingForm] = useState({ key: "cors_origins", value: { origins: ["http://localhost:5173"] } });
  const [integrationForm, setIntegrationForm] = useState({ name: "", type: "lms", enabled: false, config: {} });
  const [backupLabel, setBackupLabel] = useState("Nightly snapshot");
  const [settingJsonText, setSettingJsonText] = useState(JSON.stringify({ origins: ["http://localhost:5173"] }));
  const [integrationJsonText, setIntegrationJsonText] = useState(JSON.stringify({}));
  const [uploadFile, setUploadFile] = useState(null);
  const [success, setSuccess] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(8);
  const [confirmAction, setConfirmAction] = useState(null);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState("desc");

  const kpis = useMemo(
    () => [
      { label: "Total users", value: allUsers.length },
      { label: "Active users", value: allUsers.filter((u) => u.status === "active").length },
      { label: "Pending approvals", value: pending.length },
      { label: "Integrations", value: integrations.length },
      { label: "Audit events", value: auditLogs.length }
    ],
    [allUsers, pending.length, integrations.length, auditLogs.length]
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
      const sRes = await api.get("/admin/system/settings");
      setSettings(sRes.data);
      const iRes = await api.get("/admin/system/integrations");
      setIntegrations(iRes.data);
      const pm = await api.get("/admin/system/roles-permissions");
      setPermMatrix(pm.data?.matrix || null);
      const bRes = await api.get("/admin/system/backups?limit=30");
      setBackups(bRes.data);
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
    }
  }, [searchParams]);

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

  async function upsertSetting(e) {
    e.preventDefault();
    setError("");
    try {
      const parsed = JSON.parse(settingJsonText);
      await api.put("/admin/system/settings", { ...settingForm, value: parsed });
      setSuccess("System setting saved.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Invalid JSON or failed to save setting"));
    }
  }

  async function upsertIntegration(e) {
    e.preventDefault();
    setError("");
    try {
      const parsed = JSON.parse(integrationJsonText);
      await api.put("/admin/system/integrations", { ...integrationForm, config: parsed });
      setIntegrationForm({ name: "", type: "lms", enabled: false, config: {} });
      setIntegrationJsonText(JSON.stringify({}));
      setSuccess("Integration updated.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Invalid JSON or failed to save integration"));
    }
  }

  async function requestBackup(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/admin/system/backups", { label: backupLabel });
      setSuccess("Backup request submitted.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to request backup"));
    }
  }

  async function uploadImportFile() {
    if (!uploadFile) return;
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      await api.post("/admin/system/import/users", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setUploadFile(null);
      setSuccess("Import file uploaded.");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to upload import file"));
    }
  }

  function SectionPanel({ children }) {
    return (
      <Card variant="outlined">
        <CardContent>{children}</CardContent>
      </Card>
    );
  }

  return (
    <AppShell title="Admin Dashboard">
      <Stack spacing={2}>
        {loading ? <LinearProgress /> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Grid container spacing={2}>
          {kpis.map((k) => (
            <Grid item xs={12} sm={6} md={3} key={k.label}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    {k.label}
                  </Typography>
                  <Typography variant="h4" fontWeight={900}>
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
                          <option value="executive">Executive</option>
                        </TextField>
                      </Grid>
                    </Grid>
                    <Stack direction="row" justifyContent="flex-end">
                      <Button type="submit" variant="contained" disabled={creating}>
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
                  <Typography variant="h6" fontWeight={800}>
                    User directory & management
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    View all users, activate/disable accounts, and reset passwords to the default.
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mb: 1 }}>
                    <TextField
                      size="small"
                      label="Search users"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      fullWidth
                    />
                    <Button variant="outlined" onClick={refreshUsers}>
                      Search
                    </Button>
                    <TextField
                      select
                      size="small"
                      label="Role"
                      value={roleFilter}
                      onChange={(e) => setRoleFilter(e.target.value)}
                      sx={{ minWidth: 150 }}
                    >
                      <MenuItem value="all">All</MenuItem>
                      <MenuItem value="employee">Employee</MenuItem>
                      <MenuItem value="manager">Manager</MenuItem>
                      <MenuItem value="hr_admin">HR Admin</MenuItem>
                      <MenuItem value="executive">Executive</MenuItem>
                      <MenuItem value="system_admin">System Admin</MenuItem>
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label="Status"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      sx={{ minWidth: 140 }}
                    >
                      <MenuItem value="all">All</MenuItem>
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="pending_approval">Pending</MenuItem>
                      <MenuItem value="disabled">Disabled</MenuItem>
                    </TextField>
                  </Stack>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mb: 1 }}>
                    <Chip
                      color={selectedUserIds.length ? "primary" : "default"}
                      label={selectedUserIds.length ? `${selectedUserIds.length} selected` : "No rows selected"}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!selectedUserIds.length}
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
                      onClick={() =>
                        setConfirmAction({
                          title: "Reset selected user passwords?",
                          description: `Reset ${selectedUserIds.length} selected users to Password123.`,
                          onConfirm: () => bulkResetPasswordDefault()
                        })
                      }
                    >
                      Bulk reset Password123
                    </Button>
                  </Stack>
                  <TableContainer>
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
                          <TableRow key={u.id}>
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
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                {u.status !== "active" ? (
                                  <Button size="small" variant="outlined" onClick={() => setUserStatus(u.id, "active")}>
                                    Activate
                                  </Button>
                                ) : (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="warning"
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
                                <Button size="small" variant="outlined" onClick={() => forcePwdChange(u.id)}>
                                  Force password change
                                </Button>
                                <Button
                                  size="small"
                                  variant="contained"
                                  color="warning"
                                  onClick={() =>
                                    setConfirmAction({
                                      title: "Reset password to default?",
                                      description: `Reset ${u.full_name}'s password to Password123 and require change on next login.`,
                                      onConfirm: () => resetPasswordToDefault(u.id)
                                    })
                                  }
                                >
                                  Reset to Password123
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <TablePagination
                    component="div"
                    rowsPerPageOptions={[5, 8, 15, 25]}
                    count={filteredUsers.length}
                    rowsPerPage={rowsPerPage}
                    page={page}
                    onPageChange={(_, next) => setPage(next)}
                    onRowsPerPageChange={(e) => {
                      setRowsPerPage(parseInt(e.target.value, 10));
                      setPage(0);
                    }}
                  />
                  <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
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

                <SectionPanel>
                  <Typography variant="h6" fontWeight={800}>
                    Activity timeline (latest)
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Recent system actions for quick operational awareness.
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  {auditLogs.length === 0 ? (
                    <Alert severity="info">No recent activity found.</Alert>
                  ) : (
                    <Stack spacing={1}>
                      {auditLogs.slice(0, 8).map((log) => (
                        <Card key={log.id} variant="outlined" sx={{ bgcolor: "background.default" }}>
                          <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
                              <Box>
                                <Typography variant="body2" fontWeight={700}>
                                  {log.action}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {log.entity_type}:{log.entity_id}
                                </Typography>
                              </Box>
                              <Typography variant="caption" color="text.secondary">
                                {new Date(log.created_at).toLocaleString()}
                              </Typography>
                            </Stack>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  )}
                </SectionPanel>
              </Stack>
            ) : null}

            {!loading && activeSection === "permissions" ? (
              <SectionPanel>
                <Typography variant="h6" fontWeight={800}>
                  Roles & permissions matrix
                </Typography>
                <Divider sx={{ my: 2 }} />
                {permMatrix ? (
                  <Stack spacing={2}>
                    {Object.entries(permMatrix).map(([role, permissions]) => (
                      <Box key={role}>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                          {role}
                        </Typography>
                        <Stack direction="row" flexWrap="wrap" gap={1}>
                          {permissions.map((p) => (
                            <Chip key={p} label={p} size="small" />
                          ))}
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
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
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
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

            {!loading && activeSection === "config" ? (
              <SectionPanel>
                <Typography variant="h6" fontWeight={800}>
                  System configuration
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Stack spacing={2} component="form" onSubmit={upsertSetting}>
                  <TextField
                    label="Setting key"
                    value={settingForm.key}
                    onChange={(e) => setSettingForm({ ...settingForm, key: e.target.value })}
                    fullWidth
                    required
                  />
                  <TextField
                    label="Setting value (JSON)"
                    value={settingJsonText}
                    onChange={(e) => setSettingJsonText(e.target.value)}
                    fullWidth
                    multiline
                    minRows={3}
                    helperText="Valid JSON required"
                  />
                  <Stack direction="row" justifyContent="flex-end">
                    <Button type="submit" variant="contained">
                      Save setting
                    </Button>
                  </Stack>
                </Stack>
                <Divider sx={{ my: 2 }} />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Key</TableCell>
                        <TableCell>Value</TableCell>
                        <TableCell>Updated at</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {settings.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{s.key}</TableCell>
                          <TableCell sx={{ maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {JSON.stringify(s.value)}
                          </TableCell>
                          <TableCell>{new Date(s.updated_at).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </SectionPanel>
            ) : null}

            {!loading && activeSection === "integrations" ? (
              <SectionPanel>
                <Typography variant="h6" fontWeight={800}>
                  Integration settings
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Stack spacing={2} component="form" onSubmit={upsertIntegration}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={5}>
                      <TextField
                        label="Name"
                        value={integrationForm.name}
                        onChange={(e) => setIntegrationForm({ ...integrationForm, name: e.target.value })}
                        fullWidth
                        required
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label="Type"
                        value={integrationForm.type}
                        onChange={(e) => setIntegrationForm({ ...integrationForm, type: e.target.value })}
                        fullWidth
                        required
                        select
                        SelectProps={{ native: true }}
                      >
                        <option value="hris">HRIS</option>
                        <option value="lms">LMS</option>
                        <option value="jira">Jira</option>
                        <option value="asana">Asana</option>
                      </TextField>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={integrationForm.enabled}
                            onChange={(e) => setIntegrationForm({ ...integrationForm, enabled: e.target.checked })}
                          />
                        }
                        label="Enabled"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        label="Config (JSON)"
                        value={integrationJsonText}
                        onChange={(e) => setIntegrationJsonText(e.target.value)}
                        fullWidth
                        multiline
                        minRows={3}
                      />
                    </Grid>
                  </Grid>
                  <Stack direction="row" justifyContent="flex-end">
                    <Button type="submit" variant="contained">
                      Save integration
                    </Button>
                  </Stack>
                </Stack>
                <Divider sx={{ my: 2 }} />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Enabled</TableCell>
                        <TableCell>Updated at</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {integrations.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.name}</TableCell>
                          <TableCell>{i.type}</TableCell>
                          <TableCell>{i.enabled ? "Yes" : "No"}</TableCell>
                          <TableCell>{new Date(i.updated_at).toLocaleString()}</TableCell>
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
                <Divider sx={{ my: 2 }} />
                <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }}>
                  <Button variant="contained" href="http://127.0.0.1:8010/api/v1/admin/system/export/users.csv">
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
                  <Button variant="contained" onClick={uploadImportFile} disabled={!uploadFile}>
                    Upload import file
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

            {!loading && activeSection === "backup" ? (
              <SectionPanel>
                <Typography variant="h6" fontWeight={800}>
                  Backup & recovery
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Stack component="form" spacing={2} onSubmit={requestBackup}>
                  <TextField
                    label="Backup label"
                    value={backupLabel}
                    onChange={(e) => setBackupLabel(e.target.value)}
                    fullWidth
                    required
                  />
                  <Stack direction="row" justifyContent="flex-end">
                    <Button type="submit" variant="contained">
                      Request backup
                    </Button>
                  </Stack>
                </Stack>
                <Divider sx={{ my: 2 }} />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Label</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Requested by</TableCell>
                        <TableCell>Created at</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {backups.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>{b.label}</TableCell>
                          <TableCell>{b.status}</TableCell>
                          <TableCell>{b.requested_by_user_id}</TableCell>
                          <TableCell>{new Date(b.created_at).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </SectionPanel>
            ) : null}
            </div>
          </Grid>
        </Grid>
      </Stack>
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
      <Snackbar open={Boolean(success)} autoHideDuration={3000} onClose={() => setSuccess("")}>
        <Alert severity="success" variant="filled" onClose={() => setSuccess("")}>
          {success}
        </Alert>
      </Snackbar>
    </AppShell>
  );
}

