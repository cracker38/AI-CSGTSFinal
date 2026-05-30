export async function exportEmployeeDashboardReportLazy(data, filename) {
  const mod = await import("./dashboardReportPdf");
  return mod.exportEmployeeDashboardReport(data, filename);
}

export async function exportManagerDashboardReportLazy(data, filename) {
  const mod = await import("./dashboardReportPdf");
  return mod.exportManagerDashboardReport(data, filename);
}

export async function exportHrDashboardReportLazy(data, filename) {
  const mod = await import("./dashboardReportPdf");
  return mod.exportHrDashboardReport(data, filename);
}
