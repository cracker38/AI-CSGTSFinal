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
import BrandLogo from "./BrandLogo";

const ACCENT_BORDER = {
  primary: "primary.main",
  secondary: "secondary.main",
  info: "info.main",
  warning: "warning.main",
  success: "success.main"
};

function ReportCard({ report, onDownload, downloadingId }) {
  const isMain = report.id === "main";
  const busy = downloadingId === report.id;

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        borderRadius: 3,
        borderColor: isMain ? ACCENT_BORDER[report.accent] || "primary.main" : "divider",
        borderWidth: isMain ? 2 : 1,
        position: "relative",
        overflow: "hidden",
        background: isMain
          ? "linear-gradient(145deg, rgba(25,118,210,0.06) 0%, rgba(46,125,50,0.05) 100%)"
          : "background.paper",
        boxShadow: isMain ? "0 10px 28px rgba(25,118,210,0.10)" : "none"
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: 4,
          bgcolor: ACCENT_BORDER[report.accent] || "primary.main"
        }}
      />
      <CardContent sx={{ p: { xs: 2, md: 2.5 }, pt: 2.5 }}>
        <Stack spacing={1.5} sx={{ height: "100%" }}>
          <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between" flexWrap="wrap" useFlexGap>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              {isMain ? (
                <Chip size="small" color="primary" label="Main report" sx={{ mb: 1, fontWeight: 700 }} />
              ) : null}
              <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.25 }}>
                {report.title}
              </Typography>
            </Box>
            <PictureAsPdfIcon color={isMain ? "primary" : "action"} sx={{ mt: isMain ? 3.5 : 0 }} />
          </Stack>

          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65, flex: 1 }}>
            {report.description}
          </Typography>

          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {(report.highlights || []).map((h) => (
              <Chip key={h} size="small" variant="outlined" label={h} />
            ))}
          </Stack>

          <Button
            variant={isMain ? "contained" : "outlined"}
            fullWidth
            disabled={Boolean(downloadingId)}
            onClick={() => onDownload(report)}
            startIcon={<PictureAsPdfIcon />}
            sx={{ mt: "auto", borderRadius: 2 }}
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
  downloadingId
}) {
  return (
    <Stack spacing={3}>
      <Card
        variant="outlined"
        sx={{
          borderRadius: 3,
          borderColor: "divider",
          background: "linear-gradient(135deg, rgba(25,118,210,0.08) 0%, rgba(46,125,50,0.06) 100%)"
        }}
      >
        <CardContent>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            alignItems={{ xs: "flex-start", md: "center" }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={2} alignItems="center">
              <BrandLogo size="lg" />
              <Box>
                <Typography variant="h5" fontWeight={800}>
                  {roleLabel} Reports
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560, mt: 0.5 }}>
                  Professional PDF exports with branded cover, KPIs, tables, and confidential footer.
                  Choose the main comprehensive report or a focused division below.
                </Typography>
              </Box>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        {reports.map((report) => (
          <Grid item xs={12} md={6} key={report.id}>
            <ReportCard report={report} onDownload={onDownload} downloadingId={downloadingId} />
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
