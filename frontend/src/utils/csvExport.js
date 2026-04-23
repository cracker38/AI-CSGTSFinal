function escapeCsv(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportRowsToCsv(filename, rows, columns) {
  if (!rows || rows.length === 0 || !columns || columns.length === 0) return;
  const header = columns.map((c) => escapeCsv(c.header)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escapeCsv(c.value(row))).join(","))
    .join("\n");
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

