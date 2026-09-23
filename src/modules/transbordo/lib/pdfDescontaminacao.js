import { jsPDF } from "jspdf";
import { formatDateBr, periodLabel } from "./descontaminacao.js";

const M = 14;
const PW = 210;
const PH = 297;
const CW = PW - 2 * M;

const BLUE_DARK = [28, 53, 91];
const BLUE_MID = [37, 99, 195];
const GRAY_LABEL = [130, 140, 155];
const GRAY_ROW = [248, 249, 251];
const GRAY_BORDER = [220, 224, 230];
const BLACK = [30, 30, 30];

function setColor(doc, rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}
function setFill(doc, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function setDraw(doc, rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function addPageTitle(doc, title, subtitle) {
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  setColor(doc, BLUE_DARK);
  doc.text(title, M, 22);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  setColor(doc, GRAY_LABEL);
  const lines = doc.splitTextToSize(subtitle || "", CW);
  doc.text(lines, M, 29);
  const lineY = 29 + Math.max(0, lines.length - 1) * 4.5 + 4;
  setDraw(doc, BLUE_MID);
  doc.setLineWidth(0.6);
  doc.line(M, lineY, PW - M, lineY);
  doc.setLineWidth(0.2);
  return lineY + 10;
}

function addFooter(doc, emitidoPor) {
  const pages = doc.internal.getNumberOfPages();
  const nome = String(emitidoPor || "").trim() || "-";
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    setColor(doc, BLACK);
    doc.text(`Emitido por: ${nome}`, M, PH - 18);

    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.3);
    doc.line(M, PH - 13, PW - M, PH - 13);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, GRAY_LABEL);
    doc.text("ChemCtrl - Sistema de Controle de Produção", M, PH - 8);
    doc.text(`Página ${i} de ${pages}`, PW - M, PH - 8, { align: "right" });
  }
}

function addSectionTitle(doc, y, title) {
  setFill(doc, BLUE_MID);
  doc.rect(M, y, 2.5, 7, "F");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  setColor(doc, BLUE_DARK);
  doc.text(title, M + 5, y + 5.5);
  setColor(doc, BLACK);
  return y + 11;
}

function addInfoGrid(doc, y, pairs) {
  const cols = pairs.length;
  const colW = CW / cols;
  const rowH = 16;
  setDraw(doc, GRAY_BORDER);
  doc.setLineWidth(0.3);
  doc.rect(M, y, CW, rowH);
  pairs.forEach((cell, i) => {
    const x = M + i * colW;
    if (i > 0) {
      doc.line(x, y, x, y + rowH);
    }
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, GRAY_LABEL);
    doc.text(String(cell.label).toUpperCase(), x + 3, y + 5);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    setColor(doc, BLACK);
    const lines = doc.splitTextToSize(String(cell.value ?? "-"), colW - 6);
    doc.text(lines.slice(0, 2), x + 3, y + 11);
  });
  return y + rowH + 6;
}

function normalizeColWidths(widths) {
  const list = widths.map((w) => Math.max(12, Number(w) || 0));
  const sum = list.reduce((a, b) => a + b, 0);
  if (sum <= 0) return list.map(() => CW / list.length);
  return list.map((w) => (w / sum) * CW);
}

function addTable(doc, y, headers, rows, colWidths) {
  const widths = normalizeColWidths(colWidths);
  const aligns = headers.map(() => "center");
  const dataFs = 8.5;
  const lineH = 4.4;
  const cellPadX = 2.2;

  const textX = (x, w, align) => {
    if (align === "left") return x + cellPadX;
    if (align === "right") return x + w - cellPadX;
    return x + w / 2;
  };
  const pdfAlign = (align) =>
    align === "left" ? "left" : align === "right" ? "right" : "center";

  const drawHeader = (yy) => {
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    const headerLines = headers.map((header, i) =>
      doc.splitTextToSize(String(header || ""), Math.max(8, widths[i] - cellPadX * 2))
    );
    const maxLines = Math.max(1, ...headerLines.map((l) => l.length));
    const h = Math.max(8, maxLines * 3.6 + 3.2);
    setFill(doc, BLUE_DARK);
    doc.rect(M, yy, CW, h, "F");
    setColor(doc, [255, 255, 255]);
    let x = M;
    headerLines.forEach((lines, i) => {
      const blockH = lines.length * 3.6;
      const startY = yy + (h - blockH) / 2 + 3.6 / 2;
      lines.forEach((line, li) => {
        doc.text(line, x + widths[i] / 2, startY + li * 3.6, {
          align: "center",
          baseline: "middle",
        });
      });
      x += widths[i];
    });
    return yy + h;
  };

  const drawVLines = (yy, h) => {
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.1);
    let xLine = M;
    for (let i = 0; i < headers.length - 1; i++) {
      xLine += widths[i];
      doc.line(xLine, yy, xLine, yy + h);
    }
  };

  y = drawHeader(y);

  if (!rows.length) {
    const rowH = 10;
    setFill(doc, GRAY_ROW);
    doc.rect(M, y, CW, rowH, "F");
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.15);
    doc.line(M, y + rowH, M + CW, y + rowH);
    doc.setFontSize(8);
    setColor(doc, GRAY_LABEL);
    doc.text("Nenhuma descontaminação no período", M + CW / 2, y + rowH / 2, {
      align: "center",
      baseline: "middle",
    });
    setColor(doc, BLACK);
    return y + rowH + 4;
  }

  rows.forEach((row, ri) => {
    const cellLines = row.map((value, i) => {
      doc.setFontSize(dataFs);
      doc.setFont("helvetica", "normal");
      const raw = value == null || value === "" ? "-" : String(value);
      const parts = doc.splitTextToSize(raw, Math.max(8, widths[i] - cellPadX * 2));
      return parts.length ? parts : ["-"];
    });
    const maxLines = Math.max(1, ...cellLines.map((lines) => lines.length));
    const rowH = Math.max(8, maxLines * lineH + 3.2);

    if (y + rowH > PH - 30) {
      doc.addPage();
      y = 18;
      y = drawHeader(y);
    }

    if (ri % 2 === 0) {
      setFill(doc, GRAY_ROW);
      doc.rect(M, y, CW, rowH, "F");
    }
    drawVLines(y, rowH);
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.15);
    doc.line(M, y + rowH, M + CW, y + rowH);

    let x = M;
    cellLines.forEach((lines, i) => {
      const align = aligns[i] || "left";
      const blockH = lines.length * lineH;
      const startY = y + (rowH - blockH) / 2 + lineH / 2;
      doc.setFontSize(dataFs);
      doc.setFont("helvetica", "normal");
      setColor(doc, BLACK);
      lines.forEach((line, li) => {
        doc.text(line, textX(x, widths[i], align), startY + li * lineH, {
          align: pdfAlign(align),
          baseline: "middle",
        });
      });
      x += widths[i];
    });
    y += rowH;
  });

  setColor(doc, BLACK);
  return y + 4;
}

function fileStamp(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  if (!y || !m || !d) return "";
  return `${d}-${m}-${y}`;
}

/**
 * PDF das descontaminações já filtradas na tela.
 * O arquivo reflete exatamente as linhas recebidas.
 */
export function generateDescontaminacoesPDF(rows, { de, ate, emitidoPor } = {}) {
  const doc = new jsPDF({ format: "a4" });
  const periodo = periodLabel(de, ate);
  const total = rows?.length || 0;

  doc.setProperties({
    title: "Descontaminações",
    subject: periodo,
  });

  let y = addPageTitle(
    doc,
    "Descontaminações",
    "Relatório de descontaminação de isotanques"
  );
  y = addInfoGrid(doc, y, [
    { label: "Período", value: periodo },
    { label: "Registros", value: String(total) },
  ]);
  y = addSectionTitle(doc, y, "Descontaminações realizadas");

  const tableRows = (rows || []).map((row) => [
    formatDateBr(row.data_descontaminacao),
    row.tanka || "-",
    row.codigo_itku || "-",
    row.cliente_nome || "-",
    row.ultimo_produto || "-",
  ]);

  addTable(
    doc,
    y,
    ["Data", "Tanka", "Código ITKU", "Cliente", "Último produto"],
    tableRows,
    [28, 22, 40, 46, 46]
  );

  addFooter(doc, emitidoPor);

  const from = fileStamp(de);
  const to = fileStamp(ate);
  const filename =
    from && to
      ? `Descontaminação TANKA de ${from} a ${to}.pdf`
      : from
        ? `Descontaminação TANKA de ${from}.pdf`
        : to
          ? `Descontaminação TANKA até ${to}.pdf`
          : "Descontaminação TANKA.pdf";
  doc.save(filename);
}
