export async function exportElementToPdfLazy(element, filename, options) {
  const mod = await import("./pdfExport");
  return mod.exportElementToPdf(element, filename, options);
}

