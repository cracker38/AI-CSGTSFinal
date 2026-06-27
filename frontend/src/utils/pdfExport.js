import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { drawBrandLogoPdf } from "./brandLogoPdf.js";

const PURPLE = [123, 104, 174];
const MUTED = [108, 117, 125];
const FIELD_BORDER = [222, 226, 230];

function formatReportDate(d = new Date()) {
  return new Date(d).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export async function exportElementToPdf(
  element,
  filename = "dashboard-view.pdf",
  options = {}
) {
  if (!element) return;
  const {
    title = "Workforce Status Report",
    role = "user",
    section = "overview",
    roleLabel = role,
    generatedAt = new Date()
  } = options;

  const canvas = await html2canvas(element, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false
  });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const headerH = 28;
  const footerH = 10;
  const contentTop = headerH + 4;
  const imgWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = contentTop;

  pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
  heightLeft -= pageHeight - contentTop - footerH - 4;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + contentTop;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - contentTop - footerH - 4;
  }

  const totalPages = pdf.getNumberOfPages();
  const dateText = formatReportDate(generatedAt);

  for (let i = 1; i <= totalPages; i += 1) {
    pdf.setPage(i);

    const barH = 18;
    const logoSize = 11;
    const barY = 6;
    pdf.setFillColor(...PURPLE);
    pdf.rect(margin, barY, pageWidth - margin * 2, barH, "F");
    drawBrandLogoPdf(pdf, margin + 4, barY + (barH - logoSize) / 2, logoSize);
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("AI-CSGTS", margin + 4 + logoSize + 3, barY + barH / 2 + 1);
    pdf.setFontSize(14);
    pdf.text(title, pageWidth / 2, barY + barH / 2 + 1.5, { align: "center" });

    pdf.setTextColor(...MUTED);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.text(`Section: ${section}`, margin, headerH - 2);
    pdf.text(`${roleLabel} · ${dateText}`, pageWidth - margin, headerH - 2, { align: "right" });

    pdf.setDrawColor(...FIELD_BORDER);
    pdf.line(margin, pageHeight - footerH, pageWidth - margin, pageHeight - footerH);
    drawBrandLogoPdf(pdf, margin, pageHeight - footerH + 0.5, 5.5);
    pdf.setTextColor(...MUTED);
    pdf.setFontSize(7.5);
    pdf.text("AI-CSGTS · Confidential workforce intelligence", margin + 8.5, pageHeight - 4);
    pdf.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 4, { align: "right" });
  }

  pdf.save(filename);
}

