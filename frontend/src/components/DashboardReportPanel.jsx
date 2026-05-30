import React from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Typography
} from "@mui/material";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import GroupsIcon from "@mui/icons-material/Groups";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import SchoolIcon from "@mui/icons-material/School";
import BrandLogo from "./BrandLogo";

const ACCENT_BORDER = {
  primary: "primary.main",
  secondary: "secondary.main",
  info: "info.main",
  warning: "warning.main",
  success: "success.main"
};

const REPORT_ICONS = {
  directory: GroupsIcon,
  performance: TrendingUpIcon,
  training: SchoolIcon
};

function ReportCard({ report, onDownload, downloadingId, showMainBadge }) {
  const isMain = showMainBadge && report.id === "main";
  const busy = downloadingId === report.id;
  const IconComponent = REPORT_ICONS[report.icon] || PictureAsPdfIcon;
  const accent = ACCENT_BORDER[report.accent] || "primary.main";

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        borderRadius: 3,
        borderColor: accent,
        borderWidth: 1.5,
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(160deg, rgba(25,118,210,0.04) 0%, rgba(255,255,255,1) 55%)`,
        transition: "box-shadow 0.2s ease, transform 0.2s ease",
        "&:hover": {
          boxShadow: "0 12px 32px rgba(25,118,210,0.12)",
          transform: "translateY(-2px)"
        }
      }}
    >
      <Box sx={{ position: "absolute", top: 0, left: 0, width: "100%", height: 5, bgcolor: accent }} />
      <CardContent sx={{ p: { xs: 2, md: 2.75 }, pt: 3 }}>
        <Stack spacing={2} sx={{ height: "100%" }}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start" justifyContent="space-between">
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: accent,
                flexShrink: 0,
                boxShadow: 2
              }}
            >
              <IconComponent sx={{ fontSize: 26, color: "#fff" }} />
            </Box>
            <PictureAsPdfIcon sx={{ color: "text.disabled", mt: 0.5 }} />
          </Stack>

          <Box sx={{ flex: 1 }}>
            {isMain ? (
              <Chip size="small" color="primary" label="Main report" sx={{ mb: 1, fontWeight: 700 }} />
            ) : null}
            <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.3, mb: 0.75 }}>
              {report.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65 }}>
              {report.description}
            </Typography>
          </Box>

          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {(report.highlights || []).map((h) => (
              <Chip key={h} size="small" variant="outlined" label={h} sx={{ fontSize: "0.72rem" }} />
            ))}
          </Stack>

          <Button
            variant="contained"
            color={report.accent === "secondary" ? "secondary" : report.accent === "info" ? "info" : "primary"}
            fullWidth
            disabled={Boolean(downloadingId)}
            onClick={() => onDownload(report)}
            startIcon={<PictureAsPdfIcon />}
            sx={{ mt: "auto", borderRadius: 2, py: 1.1, fontWeight: 700 }}
          >
            {busy ? "Generating PDF…" : "Download PDF"}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function DashboardReportPanel({
  roleLabel,
  reports,
  onDownload,
  downloadingId,
  layout = "default",
  headerSubtitle,
  showMainBadge = true
}) {
  const isThreeCol = layout === "three";
  const gridMd = isThreeCol ? 4 : 6;

  return (
    <Stack spacing={3}>
      <Card
        variant="outlined"
        sx={{
          borderRadius: 3,
          borderColor: "divider",
          overflow: "hidden",
          background: "linear-gradient(135deg, rgba(25,118,210,0.10) 0%, rgba(46,125,50,0.07) 50%, rgba(255,255,255,0.95) 100%)"
        }}
      >
        <Box sx={{ height: 4, background: "linear-gradient(90deg, #1976d2 0%, #2e7d32 50%, #0288d1 100%)" }} />
        <CardContent sx={{ py: 3 }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2.5}
            alignItems={{ xs: "flex-start", md: "center" }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={2.5} alignItems="center">
              <BrandLogo size="lg" />
              <Box>
                <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.2}>
                  Workforce intelligence
                </Typography>
                <Typography variant="h5" fontWeight={800}>
                  {roleLabel} Reports
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 620, mt: 0.75, lineHeight: 1.65 }}>
                  {headerSubtitle ||
                    "Professional PDF exports with branded cover, KPIs, tables, and confidential footer. Choose the main comprehensive report or a focused division below."}
                </Typography>
              </Box>
            </Stack>
            <Chip
              label={`${reports.length} division${reports.length === 1 ? "" : "s"}`}
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 700, px: 1 }}
            />
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={2.5}>
        {reports.map((report) => (
          <Grid item xs={12} md={gridMd} key={report.id}>
            <ReportCard
              report={report}
              onDownload={onDownload}
              downloadingId={downloadingId}
              showMainBadge={showMainBadge}
            />
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
