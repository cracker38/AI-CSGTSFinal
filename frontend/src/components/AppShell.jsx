import React from "react";
import {
  AppBar,
  Box,
  Button,
  Container,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import { useLocation, useNavigate } from "react-router-dom";
import { clearAuth, getAuth } from "../auth/authStore";
import { canAccessRoleRoute } from "../auth/roleRouting";
import { useThemeMode } from "../theme/ThemeModeContext";

const drawerWidth = 260;

function navItemsForRole(role) {
  const items = [];
  if (role === "system_admin") {
    return [
      { label: "User management", to: "/app/admin?section=users", match: "/app/admin?section=users" },
      { label: "Master data", to: "/app/admin?section=masterdata", match: "/app/admin?section=masterdata" },
      { label: "Roles & permissions", to: "/app/admin?section=permissions", match: "/app/admin?section=permissions" },
      { label: "System configuration", to: "/app/admin?section=config", match: "/app/admin?section=config" },
      { label: "Integrations", to: "/app/admin?section=integrations", match: "/app/admin?section=integrations" },
      { label: "Audit logs", to: "/app/admin?section=audit", match: "/app/admin?section=audit" },
      { label: "Import / Export", to: "/app/admin?section=data", match: "/app/admin?section=data" },
      { label: "System health", to: "/app/admin?section=health", match: "/app/admin?section=health" },
      { label: "Backup & recovery", to: "/app/admin?section=backup", match: "/app/admin?section=backup" }
    ];
  }
  if (role === "hr_admin") {
    return [
      { label: "HR Dashboard", to: "/app/hr?section=home", match: "/app/hr?section=home" },
      { label: "Master data control", to: "/app/hr?section=masterdata", match: "/app/hr?section=masterdata" },
      { label: "Organization skill gaps", to: "/app/hr?section=gaps", match: "/app/hr?section=gaps" },
      { label: "Training planning & budget", to: "/app/hr?section=training", match: "/app/hr?section=training" },
      { label: "Certification & compliance", to: "/app/hr?section=compliance", match: "/app/hr?section=compliance" },
      { label: "Recruitment insights", to: "/app/hr?section=recruitment", match: "/app/hr?section=recruitment" },
      { label: "Talent pipeline", to: "/app/hr?section=pipeline", match: "/app/hr?section=pipeline" },
      { label: "CV validation & skill verification", to: "/app/hr?section=cv", match: "/app/hr?section=cv" },
      { label: "Performance review support", to: "/app/hr?section=performance", match: "/app/hr?section=performance" },
      { label: "Employee records", to: "/app/hr?section=records", match: "/app/hr?section=records" }
    ];
  }
  if (role === "employee") {
    return [
      { label: "Employee Dashboard", to: "/app/employee?section=home", match: "/app/employee?section=home" },
      { label: "Career focus & résumé", to: "/app/employee?section=cvfocus", match: "/app/employee?section=cvfocus" },
      { label: "Personal profile", to: "/app/employee?section=profile", match: "/app/employee?section=profile" },
      { label: "Skill inventory", to: "/app/employee?section=skills", match: "/app/employee?section=skills" },
      { label: "Self-assessment", to: "/app/employee?section=assessment", match: "/app/employee?section=assessment" },
      { label: "Skill gaps", to: "/app/employee?section=gaps", match: "/app/employee?section=gaps" },
      { label: "My projects", to: "/app/employee?section=projects", match: "/app/employee?section=projects" },
      { label: "Training recommendations", to: "/app/employee?section=recs", match: "/app/employee?section=recs" },
      { label: "Training progress", to: "/app/employee?section=progress", match: "/app/employee?section=progress" },
      { label: "Career paths", to: "/app/employee?section=career", match: "/app/employee?section=career" },
      { label: "Goals & development plan", to: "/app/employee?section=goals", match: "/app/employee?section=goals" },
      { label: "Notifications", to: "/app/employee?section=notifications", match: "/app/employee?section=notifications" }
    ];
  }
  if (role === "manager") {
    return [
      { label: "Manager Dashboard", to: "/app/manager?section=home", match: "/app/manager?section=home" },
      { label: "Team members", to: "/app/manager?section=team", match: "/app/manager?section=team" },
      { label: "Team skill overview", to: "/app/manager?section=skills", match: "/app/manager?section=skills" },
      { label: "Skill gap analysis", to: "/app/manager?section=gaps", match: "/app/manager?section=gaps" },
      { label: "Project management", to: "/app/manager?section=projects", match: "/app/manager?section=projects" },
      { label: "AI employee matching", to: "/app/manager?section=matching", match: "/app/manager?section=matching" },
      { label: "Project assignment", to: "/app/manager?section=assignment", match: "/app/manager?section=assignment" },
      { label: "Master data requests", to: "/app/manager?section=requests", match: "/app/manager?section=requests" },
      { label: "Workload & availability", to: "/app/manager?section=workload", match: "/app/manager?section=workload" },
      { label: "Performance monitoring", to: "/app/manager?section=performance", match: "/app/manager?section=performance" },
      { label: "Alerts & risks", to: "/app/manager?section=alerts", match: "/app/manager?section=alerts" }
    ];
  }
  if (canAccessRoleRoute(role, "employee")) {
    items.push({
      label: "Employee Dashboard",
      to: "/app/employee?section=home",
      match: "/app/employee?section=home"
    });
  }
  if (canAccessRoleRoute(role, "manager")) {
    items.push({
      label: "Manager Dashboard",
      to: "/app/manager?section=home",
      match: "/app/manager?section=home"
    });
  }
  if (canAccessRoleRoute(role, "hr")) {
    items.push({
      label: "HR Dashboard",
      to: "/app/hr?section=home",
      match: "/app/hr?section=home"
    });
  }
  if (canAccessRoleRoute(role, "admin")) {
    items.push({
      label: "Admin Dashboard",
      to: "/app/admin?section=users",
      match: "/app/admin?section=users"
    });
  }
  return items;
}

export default function AppShell({ title, children }) {
  const muiTheme = useTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("md"));
  const navigate = useNavigate();
  const location = useLocation();
  const auth = getAuth();
  const role = auth?.role;
  const items = role ? navItemsForRole(role) : [];
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { mode, toggleMode } = useThemeMode();

  /** Drawer sits below AppBar; scroll nav so Chrome/desktop shows every link (overflow was clipped before). */
  const drawerPaperFlex = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    boxSizing: "border-box"
  };

  const navScrollAreaSx = {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    px: 0.5,
    pb: 2,
    WebkitOverflowScrolling: "touch"
  };

  const navContent = (
    <>
      <Box sx={{ px: 2, pt: 2, pb: 1, flexShrink: 0 }}>
        <Box
          sx={{
            borderRadius: 2.5,
            p: 1.5,
            border: "1px solid",
            borderColor: "divider",
            background: "linear-gradient(135deg, rgba(25,118,210,0.12) 0%, rgba(46,125,50,0.10) 100%)"
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary", letterSpacing: "0.08em" }}>
            AI-CSGTS
          </Typography>
          <Typography variant="subtitle2" fontWeight={800}>
            Navigation
          </Typography>
        </Box>
      </Box>
      <Box sx={navScrollAreaSx} component="nav" aria-label="Workspace sections">
        <List sx={{ py: 0, px: 1 }}>
          {items.map((it) => (
            <ListItemButton
              key={`${it.label}|${it.match || it.to}`}
              selected={
                it.match
                  ? `${location.pathname}${location.search}` === it.match
                  : location.pathname === it.to
              }
              sx={{
                borderRadius: 2,
                mb: 0.5,
                px: 1.5,
                py: 0.9,
                border: "1px solid transparent",
                "&:hover": {
                  bgcolor: "action.hover"
                },
                "&.Mui-selected": {
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  borderColor: "primary.main",
                  boxShadow: "0 6px 16px rgba(27,94,32,0.24)",
                  "& .MuiListItemText-primary": {
                    fontWeight: 700
                  },
                  "&:hover": {
                    bgcolor: "primary.dark"
                  }
                }
              }}
              onClick={() => {
                navigate(it.to);
                setMobileOpen(false);
              }}
            >
              <ListItemText primary={it.label} primaryTypographyProps={{ variant: "body2" }} />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </>
  );

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      <AppBar position="sticky" elevation={0} sx={{ borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}>
        <Toolbar sx={{ gap: 2 }}>
          {auth && isMobile ? (
            <IconButton color="inherit" onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
          ) : null}
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {title || "AI-CSGTS"}
          </Typography>
          <IconButton color="inherit" onClick={toggleMode}>
            {mode === "dark" ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
          {auth ? (
            <>
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.85)" }}>
                {auth.email} · {auth.role}
              </Typography>
              <Button
                color="inherit"
                onClick={() => {
                  clearAuth();
                  navigate("/login");
                }}
              >
                Logout
              </Button>
            </>
          ) : (
            <Button color="inherit" onClick={() => navigate("/login")}>
              Login
            </Button>
          )}
        </Toolbar>
      </AppBar>
      <Box
        sx={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          width: "100%"
        }}
      >
        {auth ? (
          <>
            {isMobile ? (
              <Drawer
                variant="temporary"
                open={mobileOpen}
                onClose={() => setMobileOpen(false)}
                ModalProps={{ keepMounted: true }}
                sx={{
                  "& .MuiDrawer-paper": {
                    ...drawerPaperFlex,
                    width: drawerWidth,
                    borderRadius: 9,
                    maxHeight: "100%"
                  }
                }}
              >
                {navContent}
              </Drawer>
            ) : (
              <Drawer
                variant="permanent"
                sx={{
                  width: drawerWidth,
                  flexShrink: 0,
                  alignSelf: "stretch",
                  "& .MuiDrawer-paper": {
                    ...drawerPaperFlex,
                    width: drawerWidth,
                    borderRight: "1px solid",
                    borderColor: "divider",
                    borderTopRightRadius: 18,
                    borderBottomRightRadius: 18
                  }
                }}
              >
                {navContent}
              </Drawer>
            )}
          </>
        ) : null}

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}>
          <Container sx={{ py: 4 }}>{children}</Container>
        </Box>
      </Box>
    </Box>
  );
}

