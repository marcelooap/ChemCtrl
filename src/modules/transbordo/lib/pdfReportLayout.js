/**
 * Cromo visual compartilhado pelos PDFs do Transbordo.
 * Mesmo padrão do PDF de checklist: marca, título, cards, tabelas em card e rodapé.
 * Não define conteúdo — só desenho.
 */

export const M = 14;
export const PW = 210;
export const PH = 297;
export const CW = PW - 2 * M;
export const FOOTER_TEXT = "ChemCtrl - Sistema de Controle de Produção";

export const CARD_R = 2.5;
export const CARD_GAP = 3;
export const CARD_PAD = 4;
export const COL_GAP = 3;

export const BLUE = [40, 100, 215];
export const BLUE_DARK = [29, 53, 87];
export const BLUE_SOFT = [232, 240, 254];
export const BG_SOFT = [245, 247, 250];
export const BORDER = [220, 227, 237];
export const TEXT = [31, 41, 55];
export const MUTED = [100, 116, 139];
export const WHITE = [255, 255, 255];

const CTX = "__ccPdfLayout";

export function setColor(doc, rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}
export function setFill(doc, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
export function setDraw(doc, rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

export function contentLimit(doc) {
  return doc.internal.pageSize.getHeight() - 20;
}

function pageWidth(doc) {
  return doc.internal.pageSize.getWidth();
}

function getCtx(doc) {
  return (
    doc[CTX] || {
      title: "",
      subtitle: "",
      badge: "",
      footerCenter: "",
      footerLeft: FOOTER_TEXT,
    }
  );
}

export function setPdfContext(doc, patch = {}) {
  doc[CTX] = { ...getCtx(doc), ...patch };
}

export function setPdfFooter(doc, { center, left } = {}) {
  const patch = {};
  if (center != null) patch.footerCenter = center;
  if (left != null) patch.footerLeft = left;
  setPdfContext(doc, patch);
}

export function drawCard(doc, x, y, w, h, { fill = WHITE, stroke = BORDER } = {}) {
  setFill(doc, fill);
  setDraw(doc, stroke);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, CARD_R, CARD_R, "FD");
  doc.setLineWidth(0.2);
}

export function drawSectionTitle(doc, y, title) {
  setFill(doc, BLUE);
  doc.roundedRect(M, y + 0.5, 2, 6, 0.6, 0.6, "F");
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  setColor(doc, BLUE_DARK);
  doc.text(String(title), M + 5, y + 5);
  setColor(doc, TEXT);
  return y + 10;
}

function drawBadge(doc, label, y) {
  const text = String(label || "").trim();
  if (!text) return;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const w = doc.getTextWidth(text) + 7;
  const h = 6.2;
  const x = pageWidth(doc) - M - w;
  setFill(doc, BLUE_SOFT);
  setDraw(doc, BLUE_SOFT);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, "F");
  setColor(doc, BLUE);
  doc.text(text, x + w / 2, y + h / 2, { align: "center", baseline: "middle" });
  setColor(doc, TEXT);
}

export function drawMainHeader(doc, opts = {}) {
  const title = opts.title || "";
  const subtitle = opts.subtitle || "";
  setPdfContext(doc, {
    title,
    subtitle,
    badge: opts.badge || "",
    footerCenter: opts.footerCenter || getCtx(doc).footerCenter || "",
    footerLeft: opts.footerLeft || FOOTER_TEXT,
  });

  const contentW = pageWidth(doc) - 2 * M;
  let y = 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setColor(doc, MUTED);
  doc.text("ChemCtrl", M, y + 4);

  if (opts.badge) drawBadge(doc, opts.badge, y);

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  setColor(doc, BLUE_DARK);
  const titleLines = doc.splitTextToSize(String(title), contentW);
  doc.text(titleLines, M, y);
  y += Math.max(6, titleLines.length * 6.2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, MUTED);
  const subLines = doc.splitTextToSize(String(subtitle || "—"), contentW);
  doc.text(subLines, M, y);
  y += subLines.length * 4.2 + 1.2;

  setDraw(doc, BLUE);
  doc.setLineWidth(0.5);
  doc.line(M, y, pageWidth(doc) - M, y);
  doc.setLineWidth(0.2);
  setColor(doc, TEXT);
  return y + 6;
}

export function drawContinuedHeader(doc) {
  const ctx = getCtx(doc);
  const contentW = pageWidth(doc) - 2 * M;
  let y = 12;
  let badgeW = 0;
  if (ctx.badge) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    badgeW = doc.getTextWidth(String(ctx.badge)) + 7;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setColor(doc, MUTED);
  const raw = `${ctx.title || "ChemCtrl"}${ctx.subtitle ? ` · ${ctx.subtitle}` : ""}`;
  const left = doc.splitTextToSize(raw, Math.max(40, contentW - badgeW - 4))[0];
  doc.text(left, M, y + 3);
  if (ctx.badge) drawBadge(doc, ctx.badge, y);
  y += 8;
  setDraw(doc, BORDER);
  doc.setLineWidth(0.3);
  doc.line(M, y, pageWidth(doc) - M, y);
  doc.setLineWidth(0.2);
  setColor(doc, TEXT);
  return y + 5;
}

export function ensurePdfSpace(doc, y, needed) {
  if (y + needed <= contentLimit(doc)) return y;
  doc.addPage();
  return drawContinuedHeader(doc);
}

export function nextPage(doc) {
  doc.addPage();
  return drawContinuedHeader(doc);
}

export function paintFooter(doc) {
  const ctx = getCtx(doc);
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const w = pageWidth(doc);
    const h = doc.internal.pageSize.getHeight();
    const footerY = h - 18;
    setDraw(doc, BORDER);
    doc.setLineWidth(0.25);
    doc.line(M, footerY, w - M, footerY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, MUTED);
    doc.text(ctx.footerLeft || FOOTER_TEXT, M, footerY + 5);

    if (ctx.footerCenter) {
      const clipped =
        doc.splitTextToSize(String(ctx.footerCenter), (w - 2 * M) * 0.46)[0] || "";
      if (clipped) doc.text(clipped, w / 2, footerY + 5, { align: "center" });
    }

    doc.text(`Página ${i} de ${total}`, w - M, footerY + 5, { align: "right" });
  }
  setColor(doc, TEXT);
}

export function addInfoCards(doc, y, pairs, cols = 3) {
  const colW = (CW - COL_GAP * (cols - 1)) / cols;
  const labelFs = 6.5;
  const valueFs = 9.5;
  const lineH = 4.2;
  const padTop = 4;
  const padLabelGap = 8.5;
  const padBottom = 3.8;

  const normalized = (pairs || []).map((p) =>
    Array.isArray(p) ? p : [p?.label, p?.value, p?.span, p?.emphasize]
  );

  const rowsData = [];
  let currentRow = [];
  let usedCols = 0;
  for (const p of normalized) {
    const span = p[2] || 1;
    if (usedCols + span > cols && currentRow.length > 0) {
      rowsData.push(currentRow);
      currentRow = [];
      usedCols = 0;
    }
    currentRow.push({
      label: p[0],
      value: p[1],
      span,
      emphasize: Boolean(p[3]),
    });
    usedCols += span;
    if (usedCols >= cols) {
      rowsData.push(currentRow);
      currentRow = [];
      usedCols = 0;
    }
  }
  if (currentRow.length > 0) rowsData.push(currentRow);

  const measureLines = (text, width, emphasize) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(emphasize ? 11 : valueFs);
    return doc.splitTextToSize(
      String(text != null && text !== "" ? text : "-"),
      Math.max(8, width)
    );
  };

  for (const row of rowsData) {
    const spanSum = row.reduce((acc, cell) => acc + cell.span, 0);
    const stretch = spanSum < cols;
    const unitW = stretch ? (CW - COL_GAP * (row.length - 1)) / spanSum : colW;

    let maxH = padTop + padLabelGap + lineH + padBottom;
    row.forEach((cell) => {
      const cellW = unitW * cell.span + (stretch ? 0 : COL_GAP * (cell.span - 1));
      const lines = measureLines(cell.value, cellW - CARD_PAD * 2, cell.emphasize);
      const textH = padTop + padLabelGap + lines.length * lineH + padBottom;
      if (textH > maxH) maxH = textH;
    });

    y = ensurePdfSpace(doc, y, maxH + CARD_GAP);

    let x = M;
    row.forEach((cell) => {
      const cellW = unitW * cell.span + (stretch ? 0 : COL_GAP * (cell.span - 1));
      drawCard(doc, x, y, cellW, maxH, {
        fill: cell.emphasize ? BG_SOFT : WHITE,
      });

      doc.setFontSize(labelFs);
      doc.setFont("helvetica", "bold");
      setColor(doc, MUTED);
      doc.text(String(cell.label).toUpperCase(), x + CARD_PAD, y + padTop + 2);

      const lines = measureLines(cell.value, cellW - CARD_PAD * 2, cell.emphasize);
      setColor(doc, TEXT);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(cell.emphasize ? 11 : valueFs);
      doc.text(lines, x + CARD_PAD, y + padTop + padLabelGap);
      x += cellW + COL_GAP;
    });

    y += maxH + CARD_GAP;
  }

  setColor(doc, TEXT);
  return y + 1;
}

export function paintHeaderBand(doc, y, h, width = CW) {
  setFill(doc, BG_SOFT);
  doc.rect(M + 0.45, y + 0.45, width - 0.9, Math.max(1, h - 0.3), "F");
}

export function closeTableCard(doc, top, bottom, width = CW) {
  const h = bottom - top;
  if (h < 1) return;
  setDraw(doc, BORDER);
  doc.setLineWidth(0.25);
  doc.roundedRect(M, top, width, h, CARD_R, CARD_R, "S");
  doc.setLineWidth(0.2);
}

function fitWidths(widths, count) {
  const list =
    widths && widths.length === count
      ? widths.map((w) => Math.max(8, Number(w) || 0))
      : Array.from({ length: count }, () => CW / Math.max(1, count));
  const sum = list.reduce((a, b) => a + b, 0) || 1;
  const scaled = list.map((w) => (w / sum) * CW);
  scaled[scaled.length - 1] += CW - scaled.reduce((a, b) => a + b, 0);
  return scaled;
}

/**
 * Tabela em card com cabeçalho suave, no mesmo desenho do PDF de transbordo/checklist.
 * `rows` é matriz de textos. Não altera os valores recebidos.
 */
export function drawSoftTable(doc, y, options = {}) {
  const headers = options.headers || [];
  const rows = options.rows || [];
  const widths = fitWidths(options.widths, headers.length);
  const aligns = options.aligns || headers.map(() => "center");
  const dataFs = options.fontSize ?? 8;
  const hdrFs = options.headerSize ?? 6.5;
  const lineH = options.lineH ?? 3.6;
  const cellPadX = 1.8;
  const emptyText = options.emptyText ?? "—";

  const textX = (x, w, align) => {
    if (align === "left") return x + cellPadX;
    if (align === "right") return x + w - cellPadX;
    return x + w / 2;
  };
  const pdfAlign = (align) =>
    align === "left" ? "left" : align === "right" ? "right" : "center";

  const wrap = (value, colW, fontSize, fontStyle) => {
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(fontSize);
    const raw = value == null || value === "" ? "-" : String(value);
    const parts = doc.splitTextToSize(raw, Math.max(6, colW - cellPadX * 2));
    return parts.length ? parts : ["-"];
  };

  const headerLines = headers.map((header, i) =>
    wrap(String(header || "").toUpperCase(), widths[i], hdrFs, "bold")
  );
  const headerH = Math.max(8, Math.max(...headerLines.map((l) => l.length)) * 3.2 + 3.2);

  const drawHeader = (yy) => {
    paintHeaderBand(doc, yy, headerH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(hdrFs);
    setColor(doc, MUTED);
    let x = M;
    headerLines.forEach((lines, i) => {
      const blockH = lines.length * 3.2;
      const startY = yy + (headerH - blockH) / 2 + 2.4;
      lines.forEach((line, li) => {
        doc.text(String(line), x + widths[i] / 2, startY + li * 3.2, {
          align: "center",
        });
      });
      x += widths[i];
    });
    setDraw(doc, BORDER);
    doc.setLineWidth(0.2);
    doc.line(M + 1.2, yy + headerH, M + CW - 1.2, yy + headerH);
    setColor(doc, TEXT);
    return yy + headerH;
  };

  let segmentTop = y;
  y = drawHeader(y);

  const close = (bottom) => closeTableCard(doc, segmentTop, bottom);

  if (!rows.length) {
    const rowH = 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, MUTED);
    doc.text(emptyText, M + CW / 2, y + rowH / 2, {
      align: "center",
      baseline: "middle",
    });
    setColor(doc, TEXT);
    y += rowH;
    close(y);
    return y + 4;
  }

  rows.forEach((row, ri) => {
    const cellLines = headers.map((_, i) => wrap(row?.[i], widths[i], dataFs, "normal"));
    const maxLines = Math.max(1, ...cellLines.map((lines) => lines.length));
    const rowH = Math.max(7.2, maxLines * lineH + 2.4);

    const limit = contentLimit(doc);
    if (y + rowH > limit && y > segmentTop + headerH + 1) {
      close(y);
      y = nextPage(doc);
      segmentTop = y;
      y = drawHeader(y);
    }

    if (ri % 2 === 0) {
      setFill(doc, BG_SOFT);
      doc.rect(M + 0.45, y, CW - 0.9, rowH, "F");
    }

    let x = M;
    cellLines.forEach((lines, i) => {
      const align = aligns[i] || "center";
      const blockH = lines.length * lineH;
      const startY = y + (rowH - blockH) / 2 + lineH * 0.75;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(dataFs);
      setColor(doc, TEXT);
      lines.forEach((line, li) => {
        doc.text(line, textX(x, widths[i], align), startY + li * lineH, {
          align: pdfAlign(align),
        });
      });
      x += widths[i];
    });

    y += rowH;
    if (ri < rows.length - 1) {
      setDraw(doc, BORDER);
      doc.setLineWidth(0.15);
      doc.line(M + 1.5, y, M + CW - 1.5, y);
    }
  });

  close(y);
  setColor(doc, TEXT);
  return y + 4;
}
