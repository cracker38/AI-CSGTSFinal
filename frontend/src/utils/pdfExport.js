import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export async function exportElementToPdf(
  element,
  filename = "dashboard-view.pdf",
  options = {}
) {
  if (!element) return;
  const {
    title = "AI-CSGTS Dashboard Report",
    role = "user",
    section = "overview",
    logoText = "AI-CSGTS",
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
  const headerH = 22;
  const footerH = 10;
  const imgWidth = pageWidth - 16;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = headerH + 6;

  pdf.addImage(imgData, "PNG", 8, position, imgWidth, imgHeight);
  heightLeft -= pageHeight - headerH - footerH - 8;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + headerH + 6;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 8, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - headerH - footerH - 8;
  }

  const totalPages = pdf.getNumberOfPages();
  const metaText = `Role: ${role} | Section: ${section}`;
  const dateText = `Generated: ${new Date(generatedAt).toLocaleString()}`;

  for (let i = 1; i <= totalPages; i += 1) {
    pdf.setPage(i);

    pdf.setFillColor(248, 250, 252);
    pdf.rect(0, 0, pageWidth, headerH, "F");
    pdf.setFillColor(25, 118, 210);
    pdf.rect(0, 0, 3, headerH, "F");
    pdf.setTextColor(25, 35, 55);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(logoText, 8, 8);
    pdf.setFontSize(11);
    pdf.text(title, 8, 15);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(metaText, pageWidth - 8, 8, { align: "right" });
    pdf.text(dateText, pageWidth - 8, 15, { align: "right" });
    pdf.setDrawColor(226, 232, 240);
    pdf.line(8, headerH + 1, pageWidth - 8, headerH + 1);

    pdf.setFillColor(248, 250, 252);
    pdf.rect(0, pageHeight - footerH, pageWidth, footerH, "F");
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(8);
    pdf.text("Confidential — AI-CSGTS Workforce Intelligence", 8, pageHeight - 4);
    pdf.text(`Page ${i} of ${totalPages}`, pageWidth - 8, pageHeight - 4, { align: "right" });
  }

  pdf.save(filename);
}

