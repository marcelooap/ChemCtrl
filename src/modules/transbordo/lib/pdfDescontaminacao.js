import { jsPDF } from "jspdf";
import { formatDateBr, periodLabel } from "./descontaminacao.js";
import {
  M,
  CW,
  BG_SOFT as GRAY_ROW,
  BORDER as GRAY_BORDER,
  TEXT as BLACK,
  MUTED as GRAY_LABEL,
  setColor,
  setFill,
  setDraw,
  drawMainHeader,
  drawSectionTitle,
  addInfoCards,
  paintFooter,
  setPdfFooter,
  contentLimit,
  paintHeaderBand,
  closeTableCard,
  nextPage,
} from "@transbordo/lib/pdfReportLayout";

function addPageTitle(doc, title, subtitle) {
  return drawMainHeader(doc, { title, subtitle });
}

function addFooter(doc, emitidoPor) {
  const nome = String(emitidoPor || "").trim() || "-";
  setPdfFooter(doc, { center: `Emitido por: ${nome}` });
  paintFooter(doc);
}

function addSectionTitle(doc, y, title) {
  return drawSectionTitle(doc, y, title);
}

function addInfoGrid(doc, y, pairs) {
  return addInfoCards(
    doc,
    y,
    (pairs || []).map((cell) => [cell.label, cell.value]),
    Math.max(1, pairs?.length || 1)
  );
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
    paintHeaderBand(doc, yy, h);
    setColor(doc, GRAY_LABEL);
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
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.2);
    doc.line(M + 1.2, yy + h, M + CW - 1.2, yy + h);
    return yy + h;
  };

  let segmentTop = y;
  y = drawHeader(y);

  if (!rows.length) {
    const rowH = 10;
    doc.setFontSize(8);
    setColor(doc, GRAY_LABEL);
    doc.text("Nenhuma descontaminação no período", M + CW / 2, y + rowH / 2, {
      align: "center",
      baseline: "middle",
    });
    setColor(doc, BLACK);
    y += rowH;
    closeTableCard(doc, segmentTop, y);
    return y + 4;
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

    if (y + rowH > contentLimit(doc) && y > segmentTop + 8) {
      closeTableCard(doc, segmentTop, y);
      y = nextPage(doc);
      segmentTop = y;
      y = drawHeader(y);
    }

    if (ri % 2 === 0) {
      setFill(doc, GRAY_ROW);
      doc.rect(M + 0.45, y, CW - 0.9, rowH, "F");
    }
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.15);
    doc.line(M + 1.5, y + rowH, M + CW - 1.5, y + rowH);

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

  closeTableCard(doc, segmentTop, y);
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
