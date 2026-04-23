import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import AppShell from "../components/AppShell";
import { api } from "../api/client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { exportElementToPdfLazy } from "../utils/pdfExportLazy";
import { getChartTheme } from "../utils/chartTheme";
import { exportRowsToCsv } from "../utils/csvExport";
import { useThemeMode } from "../theme/ThemeModeContext";

const SECTIONS = [
  { key: "kpi", label: "KPI overview" },
  { key: "risk", label: "Risk analysis" },
  { key: "forecast", label: "Strategic forecast" }
];

export default function ExecutiveDashboard() {
  const exportRef = useRef(null);
  const [activeSection, setActiveSection] = useState("kpi");
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState(null);
  const [topGaps, setTopGaps] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const { mode } = useThemeMode();
  const { colors, tooltipStyle } = getChartTheme(mode);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const k = await api.get("/analytics/org/kpis");
        const g = await api.get("/analytics/org/skill-gaps/top");
        setKpis(k.data);
        setTopGaps(g.data?.top_gaps || []);
      } catch (err) {
        setError(err?.response?.data?.detail || "Failed to load executive analytics");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const headline = useMemo(
    () => [
      { label: "Active workforce", value: kpis?.active_users ?? 0 },
      { label: "Pending approvals", value: kpis?.pending_users ?? 0 },
      { label: "Strategic risks", value: topGaps.length }
    ],
    [kpis, topGaps.length]
  );
  const filteredTopGaps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? topGaps.filter((g) => g.skill.toLowerCase().includes(q)) : topGaps;
  }, [topGaps, search]);

  return (
    <AppShell title="Executive Dashboard">
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Grid container spacing={2}>
          {headline.map((h) => (
            <Grid item xs={12} md={4} key={h.label}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    {h.label}
                  </Typography>
                  <Typography variant="h4" fontWeight={900}>
                    {h.value}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <Card variant="outlined" sx={{ position: "sticky", top: 84 }}>
              <CardContent>
                <Typography variant="h6" fontWeight={900} sx={{ mb: 1 }}>
                  Executive view
                </Typography>
                <List sx={{ p: 0 }}>
                  {SECTIONS.map((s) => (
                    <ListItemButton
                      key={s.key}
                      selected={activeSection === s.key}
                      onClick={() => setActiveSection(s.key)}
                      sx={{ borderRadius: 2, mb: 0.5 }}
                    >
                      <ListItemText primary={s.label} />
                    </ListItemButton>
                  ))}
                </List>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={9}>
            <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
              <Button
                variant="outlined"
                onClick={() =>
                  exportElementToPdfLazy(exportRef.current, `executive-${activeSection}.pdf`, {
                    role: "executive",
                    section: activeSection,
                    title: "Executive Dashboard Report"
                  })
                }
              >
                Export PDF
              </Button>
            </Stack>
            <div ref={exportRef}>
            {loading ? (
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <CircularProgress size={22} />
                    <Typography>Loading strategic analytics...</Typography>
                  </Stack>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "kpi" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Organizational KPI overview
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {Object.entries(kpis || {}).map(([k, v]) => (
                          <TableRow key={k}>
                            <TableCell>{k}</TableCell>
                            <TableCell>{typeof v === "object" ? JSON.stringify(v) : String(v)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "risk" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Risk analysis: skill shortages
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <TextField size="small" label="Search skill risk" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2 }} />
                  <Box sx={{ width: "100%", height: 280, mb: 2 }}>
                    <ResponsiveContainer>
                      <BarChart data={filteredTopGaps.slice(0, 10)}>
                        <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
                        <XAxis dataKey="skill" hide />
                        <YAxis />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="total_gap" fill={colors.warning} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                  <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        exportRowsToCsv("executive-risks.csv", filteredTopGaps, [
                          { header: "Skill", value: (r) => r.skill },
                          { header: "Risk Score", value: (r) => r.total_gap }
                        ])
                      }
                    >
                      Export CSV
                    </Button>
                  </Stack>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Skill</TableCell>
                          <TableCell align="right">Risk score (total gap)</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredTopGaps.map((g) => (
                          <TableRow key={g.skill}>
                            <TableCell>{g.skill}</TableCell>
                            <TableCell align="right">{g.total_gap}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            {!loading && activeSection === "forecast" ? (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" fontWeight={800}>
                    Strategic recommendations
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  {topGaps.length === 0 ? (
                    <Alert severity="info">No strategic gaps detected yet.</Alert>
                  ) : (
                    <Stack spacing={1}>
                      {filteredTopGaps.slice(0, 5).map((g) => (
                        <Alert key={g.skill} severity="warning">
                          Prioritize upskilling/hiring plans for <b>{g.skill}</b> (gap score: {g.total_gap}).
                        </Alert>
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            ) : null}
            </div>
          </Grid>
        </Grid>
      </Stack>
    </AppShell>
  );
}

