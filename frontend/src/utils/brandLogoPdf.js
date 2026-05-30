/** jsPDF brand mark drawer (mm units) — shared by report PDFs. */
export function drawBrandLogoPdf(pdf, x, y, sizeMm = 10) {
  const cx = x + sizeMm / 2;
  const cy = y + sizeMm / 2;

  pdf.setFillColor(25, 118, 210);
  pdf.triangle(cx, y, x + sizeMm, y + sizeMm * 0.28, x, y + sizeMm * 0.28, "F");
  pdf.setFillColor(46, 125, 50);
  pdf.triangle(cx, y + sizeMm, x + sizeMm, y + sizeMm * 0.72, x, y + sizeMm * 0.72, "F");

  pdf.setDrawColor(255, 255, 255);
  pdf.setLineWidth(0.25);
  pdf.circle(cx, cy - sizeMm * 0.08, sizeMm * 0.22, "FD");

  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(Math.max(5, sizeMm * 0.55));
  pdf.text("AI", cx, cy + sizeMm * 0.12, { align: "center" });
}
