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
    useCORS: true
  });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = 210;
  const pageHeight = 297;
  const imgWidth = pageWidth - 16;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 24;

  pdf.addImage(imgData, "PNG", 8, position, imgWidth, imgHeight);
  heightLeft -= pageHeight - 36;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + 24;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 8, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - 36;
  }

  const totalPages = pdf.getNumberOfPages();
  const metaText = `Role: ${role} | Section: ${section}`;
  const dateText = `Generated: ${new Date(generatedAt).toLocaleString()}`;

  for (let i = 1; i <= totalPages; i += 1) {
    pdf.setPage(i);

    // Header
    pdf.setFillColor(245, 247, 250);
    pdf.rect(0, 0, pageWidth, 16, "F");
    pdf.setTextColor(25, 35, 55);
    pdf.setFontSize(10);
    pdf.text(logoText, 8, 6.5);
    pdf.setFontSize(11);
    pdf.text(title, 8, 12);
    pdf.setFontSize(9);
    pdf.text(metaText, pageWidth - 8, 6.5, { align: "right" });
    pdf.text(dateText, pageWidth - 8, 12, { align: "right" });

    // Footer
    pdf.setFillColor(245, 247, 250);
    pdf.rect(0, pageHeight - 10, pageWidth, 10, "F");
    pdf.setTextColor(60, 72, 88);
    pdf.setFontSize(9);
    pdf.text("Confidential - Workforce Intelligence", 8, pageHeight - 4);
    pdf.text(`Page ${i} of ${totalPages}`, pageWidth - 8, pageHeight - 4, { align: "right" });
  }

  pdf.save(filename);
}

