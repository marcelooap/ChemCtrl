import { jsPDF } from "jspdf";
import { buildTransbordoViewModel } from "@transbordo/lib/transbordoViewData";

const M = 14;
const PW = 210;
const PH = 297;
const CW = PW - 2 * M;
const FOOTER_Y = PH - 18;
const CONTENT_BOTTOM = PH - 20;

const CARD_R = 2.5;
const CARD_GAP = 3;
const CARD_PAD = 4;
const COL_GAP = 3;

const BLUE = [40, 100, 215];
const BLUE_DARK = [29, 53, 87];
const BLUE_SOFT = [232, 240, 254];
const BG_SOFT = [245, 247, 250];
const BORDER = [220, 227, 237];
const TEXT = [31, 41, 55];
const MUTED = [100, 116, 139];
const WHITE = [255, 255, 255];

const FOOTER_TEXT = "ChemCtrl - Sistema de Controle de Produção";

function setColor(doc, rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}
function setFill(doc, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function setDraw(doc, rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function drawCard(doc, x, y, w, h, { fill = WHITE, stroke = BORDER } = {}) {
  setFill(doc, fill);
  setDraw(doc, stroke);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, CARD_R, CARD_R, "FD");
  doc.setLineWidth(0.2);
}

function drawSectionTitle(doc, y, title) {
  setFill(doc, BLUE);
  doc.roundedRect(M, y + 0.5, 2, 6, 0.6, 0.6, "F");
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  setColor(doc, BLUE_DARK);
  doc.text(String(title), M + 5, y + 5);
  setColor(doc, TEXT);
  return y + 10;
}

function drawMainHeader(doc, view) {
  let y = 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setColor(doc, MUTED);
  doc.text("ChemCtrl", M, y + 4);

  if (view.codigo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    const label = view.codigo;
    const w = doc.getTextWidth(label) + 7;
    const h = 6.2;
    const x = PW - M - w;
    setFill(doc, BLUE_SOFT);
    setDraw(doc, BLUE_SOFT);
    doc.roundedRect(x, y, w, h, h / 2, h / 2, "F");
    setColor(doc, BLUE);
    doc.text(label, x + w / 2, y + h / 2, { align: "center", baseline: "middle" });
  }

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  setColor(doc, BLUE_DARK);
  doc.text("Transbordo", M, y);

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, MUTED);
  const subtitle = [view.codigo, view.produtoNome, view.cliente !== "-" ? view.cliente : ""]
    .filter(Boolean)
    .join(" · ");
  doc.text(subtitle || "—", M, y);

  y += 5;
  setDraw(doc, BLUE);
  doc.setLineWidth(0.5);
  doc.line(M, y, PW - M, y);
  doc.setLineWidth(0.2);
  setColor(doc, TEXT);
  return y + 6;
}

function drawContinuedHeader(doc, view) {
  let y = 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setColor(doc, MUTED);
  const left = `${"Transbordo"}${view.codigo ? ` · ${view.codigo}` : ""}`;
  doc.text(left, M, y + 3);
  y += 8;
  setDraw(doc, BORDER);
  doc.setLineWidth(0.3);
  doc.line(M, y, PW - M, y);
  doc.setLineWidth(0.2);
  setColor(doc, TEXT);
  return y + 5;
}

function ensureSpace(doc, y, needed, view) {
  if (y + needed <= CONTENT_BOTTOM) return y;
  doc.addPage();
  return drawContinuedHeader(doc, view);
}

function addFooter(doc, view) {
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    setDraw(doc, BORDER);
    doc.setLineWidth(0.25);
    doc.line(M, FOOTER_Y, PW - M, FOOTER_Y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, MUTED);
    doc.text(FOOTER_TEXT, M, FOOTER_Y + 5);
    if (view.codigo) {
      doc.text(view.codigo, PW / 2, FOOTER_Y + 5, { align: "center" });
    }
    doc.text(`Página ${i} de ${total}`, PW - M, FOOTER_Y + 5, { align: "right" });
  }
  setColor(doc, TEXT);
}

function addInfoCards(doc, y, pairs, cols, view) {
  const colW = (CW - COL_GAP * (cols - 1)) / cols;
  const labelFs = 6.5;
  const valueFs = 9.5;
  const lineH = 4.2;
  const padTop = 4;
  const padLabelGap = 8.5;
  const padBottom = 3.8;

  const rowsData = [];
  let currentRow = [];
  let usedCols = 0;
  for (const p of pairs) {
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
    return doc.splitTextToSize(String(text != null && text !== "" ? text : "-"), Math.max(8, width));
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

    y = ensureSpace(doc, y, maxH + CARD_GAP, view);

    let x = M;
    row.forEach((cell) => {
      const cellW = unitW * cell.span + (stretch ? 0 : COL_GAP * (cell.span - 1));
      drawCard(doc, x, y, cellW, maxH, { fill: cell.emphasize ? BG_SOFT : WHITE });

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

function addChipCard(doc, y, title, values, view) {
  const items = (values || []).map((v) => String(v || "").trim()).filter(Boolean);
  const chipPadX = 2.8;
  const chipH = 7;
  const chipGap = 2.2;
  const chipFs = 9;
  const titleH = 8;
  const pad = CARD_PAD;
  const numbers = items.length ? items : ["-"];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(chipFs);
  const chipWidths = numbers.map((n) => doc.getTextWidth(String(n)) + chipPadX * 2);
  const lines = [];
  let current = [];
  let used = 0;
  const innerW = CW - pad * 2;
  chipWidths.forEach((w, i) => {
    const next = used === 0 ? w : used + chipGap + w;
    if (next > innerW && current.length) {
      lines.push(current);
      current = [i];
      used = w;
    } else {
      current.push(i);
      used = next;
    }
  });
  if (current.length) lines.push(current);

  const bodyH = lines.length * chipH + Math.max(0, lines.length - 1) * chipGap;
  const totalH = pad + titleH + bodyH + pad;
  y = ensureSpace(doc, y, totalH + 2, view);
  drawCard(doc, M, y, CW, totalH);

  setFill(doc, BLUE);
  doc.roundedRect(M + pad, y + pad + 0.4, 1.8, 5.2, 0.5, 0.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setColor(doc, BLUE_DARK);
  doc.text(String(title), M + pad + 4, y + pad + 4.5);

  let cy = y + pad + titleH;
  lines.forEach((idxs) => {
    let cx = M + pad;
    idxs.forEach((i) => {
      const w = chipWidths[i];
      if (items.length) {
        setFill(doc, BG_SOFT);
        setDraw(doc, BORDER);
        doc.roundedRect(cx, cy, w, chipH, 1.6, 1.6, "FD");
        setColor(doc, TEXT);
      } else {
        setColor(doc, MUTED);
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(chipFs);
      doc.text(String(numbers[i]), cx + chipPadX, cy + chipH / 2, { baseline: "middle" });
      cx += w + chipGap;
    });
    cy += chipH + chipGap;
  });

  setColor(doc, TEXT);
  return y + totalH + CARD_GAP + 1;
}

function sameDestinoGroup(a, b) {
  return Boolean(a && b && a.groupSize > 1 && a.groupId === b.groupId);
}

function prepareTableRows(doc, columns, rows) {
  const lineH = 3.5;
  const prepared = rows.map((row) => {
    const cells = columns.map((col) => {
      doc.setFont("helvetica", col.bold ? "bold" : "normal");
      doc.setFontSize(8);
      const text = String(row[col.key] != null && row[col.key] !== "" ? row[col.key] : "-");
      return doc.splitTextToSize(text, Math.max(8, col.width - 3));
    });
    const contentLines = cells.map((lines, i) => (columns[i].spanGroup ? 1 : lines.length));
    const lines = Math.max(1, ...contentLines);
    return { cells, h: Math.max(7.2, lines * lineH + 2.6), row };
  });

  const spanIndex = columns.findIndex((col) => col.spanGroup);
  if (spanIndex >= 0) {
    let i = 0;
    while (i < prepared.length) {
      const size = prepared[i].row?.groupSize > 1 ? prepared[i].row.groupSize : 1;
      if (size > 1 && prepared[i].row.groupIndex === 0) {
        const need = Math.max(7.2, prepared[i].cells[spanIndex].length * lineH + 2.6);
        const have = prepared.slice(i, i + size).reduce((sum, item) => sum + item.h, 0);
        if (need > have) prepared[i + size - 1].h += need - have;
      }
      i += size;
    }
  }

  return prepared;
}

function drawTableHeader(doc, y, h, columns) {
  setFill(doc, BG_SOFT);
  doc.rect(M + 0.3, y + 0.3, CW - 0.6, h - 0.3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  setColor(doc, MUTED);
  let x = M;
  columns.forEach((col) => {
    const lines = doc.splitTextToSize(String(col.label).toUpperCase(), Math.max(8, col.width - 3));
    const textY = y + (h - lines.length * 2.8) / 2 + 2.4;
    doc.text(lines, x + col.width / 2, textY, { align: "center" });
    x += col.width;
  });
  setDraw(doc, BORDER);
  doc.setLineWidth(0.2);
  doc.line(M + 1, y + h, M + CW - 1, y + h);
  setColor(doc, TEXT);
}

function drawCellText(doc, x, y, h, col, lines) {
  const lineH = 3.5;
  doc.setFont("helvetica", col.bold ? "bold" : "normal");
  doc.setFontSize(8);
  setColor(doc, col.color || TEXT);
  const textH = lines.length * lineH;
  const textY = y + (h - textH) / 2 + 2.6;
  doc.text(lines, x + col.width / 2, textY, { align: "center" });
}

function drawTableRow(doc, y, h, columns, prepared, skipSpan) {
  let x = M;
  columns.forEach((col, i) => {
    if (!(skipSpan && col.spanGroup)) {
      drawCellText(doc, x, y, h, col, prepared.cells[i]);
    }
    x += col.width;
  });
  setColor(doc, TEXT);
}

function drawSpanCell(doc, y, h, columns, prepared) {
  const index = columns.findIndex((col) => col.spanGroup);
  if (index < 0) return;
  let x = M;
  for (let i = 0; i < index; i++) x += columns[i].width;
  drawCellText(doc, x, y, h, columns[index], prepared.cells[index]);
  setColor(doc, TEXT);
}

function destinoColumns(view) {
  const cols = [];
  if (view.showEmbalagem) cols.push({ key: "embalagem", label: "Embalagem", bold: true });
  cols.push({ key: "lote", label: "Lote" });
  if (view.showQtd) cols.push({ key: "qtd", label: "Qtd. embalagens" });
  cols.push({ key: "volume", label: "Volume (L)", bold: true, color: BLUE });
  cols.push({ key: "massa", label: "Massa (kg)" });
  cols.push({ key: "lacre", label: "Lacre", spanGroup: true });

  const weights = cols.map((col) => {
    if (col.key === "embalagem") return 1.25;
    if (col.key === "qtd") return 0.9;
    if (col.key === "lacre") return 1.35;
    if (col.key === "volume" || col.key === "massa") return 0.95;
    return 1;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  cols.forEach((col, i) => {
    col.width = (CW * weights[i]) / sum;
  });
  return cols;
}

function origemColumns() {
  const weights = [1.15, 1.7, 1, 1.15, 0.95];
  const keys = [
    { key: "origem", label: "Origem", bold: true },
    { key: "produto", label: "Produto" },
    { key: "lote", label: "Lote" },
    { key: "volume", label: "Vol. retirado (L)", bold: true },
    { key: "massa", label: "Massa (kg)" },
  ];
  const sum = weights.reduce((a, b) => a + b, 0);
  return keys.map((col, i) => ({ ...col, width: (CW * weights[i]) / sum }));
}

function drawDataTable(doc, y, view, title, columns, rows) {
  y = ensureSpace(doc, y, 32, view);
  y = drawSectionTitle(doc, y, title);

  const prepared = rows.length ? prepareTableRows(doc, columns, rows) : [];
  const headerLines = Math.max(
    1,
    ...columns.map((col) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      return doc.splitTextToSize(String(col.label).toUpperCase(), Math.max(8, col.width - 3)).length;
    })
  );
  const headerH = Math.max(8, headerLines * 2.8 + 3.2);

  if (!prepared.length) {
    const h = headerH + 8;
    y = ensureSpace(doc, y, h, view);
    drawCard(doc, M, y, CW, h);
    drawTableHeader(doc, y, headerH, columns);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, MUTED);
    doc.text("—", M + CW / 2, y + headerH + 5, { align: "center" });
    setColor(doc, TEXT);
    return y + h + CARD_GAP + 2;
  }

  const groupBlock = (start) => {
    const row = prepared[start]?.row;
    if (!(row?.groupSize > 1) || row.groupIndex !== 0) return 1;
    let n = 0;
    while (
      start + n < prepared.length &&
      prepared[start + n].row?.groupId === row.groupId
    ) {
      n += 1;
    }
    return Math.max(1, n);
  };

  let index = 0;
  while (index < prepared.length) {
    const room = () => CONTENT_BOTTOM - y - headerH;
    const take = (space) => {
      let count = 0;
      let body = 0;
      while (index + count < prepared.length) {
        const n = groupBlock(index + count);
        let blockH = 0;
        for (let g = 0; g < n; g++) blockH += prepared[index + count + g].h;
        if (body + blockH <= space) {
          body += blockH;
          count += n;
          continue;
        }
        if (count === 0 && n > 1 && blockH > space) return { count: 0, body: 0 };
        break;
      }
      return { count, body };
    };

    let chunk = take(room());
    if (chunk.count === 0 && y > 40) {
      doc.addPage();
      y = drawContinuedHeader(doc, view);
      chunk = take(room());
    }
    if (chunk.count === 0) {
      chunk = { count: 1, body: prepared[index].h };
    }

    const used = headerH + chunk.body;
    drawCard(doc, M, y, CW, used);
    drawTableHeader(doc, y, headerH, columns);
    let ry = y + headerH;
    for (let k = 0; k < chunk.count; k++) {
      const item = prepared[index + k];
      const prev = k > 0 ? prepared[index + k - 1].row : null;
      const mixed = item.row?.groupSize > 1;
      const fragmentStart = mixed && !sameDestinoGroup(prev, item.row);
      drawTableRow(doc, ry, item.h, columns, item, mixed);
      if (fragmentStart) {
        let spanH = item.h;
        let look = k + 1;
        while (
          look < chunk.count &&
          sameDestinoGroup(item.row, prepared[index + look].row)
        ) {
          spanH += prepared[index + look].h;
          look += 1;
        }
        drawSpanCell(doc, ry, spanH, columns, item);
      }
      ry += item.h;
      const next = k + 1 < chunk.count ? prepared[index + k + 1].row : null;
      if (k < chunk.count - 1 && !sameDestinoGroup(item.row, next)) {
        setDraw(doc, BORDER);
        doc.setLineWidth(0.15);
        doc.line(M + 1.5, ry, M + CW - 1.5, ry);
      }
    }

    y += used + 2.5;
    index += chunk.count;
  }

  return y + 2;
}

export function buildTransbordoViewPdfDoc(input = {}) {
  const view = buildTransbordoViewModel(input);
  if (!view) return null;

  const doc = new jsPDF({ format: "a4", orientation: "portrait", unit: "mm" });
  doc.setProperties({ title: view.codigo || "Transbordo" });

  let y = drawMainHeader(doc, view);
  y = addInfoCards(
    doc,
    y,
    [
      ["Data", view.data],
      ["Cliente", view.cliente],
      ["Densidade", view.densidade],
      ["Produto", view.produto, 3, true],
    ],
    3,
    view
  );
  y = addChipCard(doc, y, "Operadores", view.operadores, view);
  if (view.observacoes) {
    y = addInfoCards(doc, y, [["Observações", view.observacoes, 3]], 3, view);
  }

  y = drawDataTable(doc, y, view, "Origens", origemColumns(), view.origemRows);
  y = drawDataTable(doc, y, view, "Destinos", destinoColumns(view), view.destinoRows);
  addInfoCards(
    doc,
    y,
    [
      ["Volume total", view.volumeTotal, 1, true],
      [view.massaCaption, view.massaTotal, 1, true],
    ],
    2,
    view
  );

  addFooter(doc, view);
  return { doc, view };
}

export function downloadTransbordoViewPdf(input = {}) {
  const built = buildTransbordoViewPdfDoc(input);
  if (!built) return;
  built.doc.save(built.view.fileName);
}
