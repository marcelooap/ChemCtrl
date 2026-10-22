import { jsPDF } from "jspdf";
import {
  formatNum,
  formatVolume,
  formatQuantidade,
  formatCurrency,
  formatDensidade,
  roundVolume,
  roundMass,
} from "@transbordo/lib/format";
import {
  getEstoqueNotaFiscal,
  getEstoqueNotaFiscalTroca,
} from "@transbordo/lib/estoqueSaldo";
import {
  resolveTipoRecebimentoEstoque,
  getTipoRecebimentoLabel,
} from "@transbordo/lib/tipoRecebimento";
import { formatEstoqueCodigo } from "@transbordo/lib/estoqueCodigo";
import {
  M,
  CW,
  CARD_R,
  BLUE as BLUE_MID,
  BLUE,
  BLUE_DARK,
  BLUE_SOFT,
  BG_SOFT as GRAY_ROW,
  BORDER as GRAY_BORDER,
  TEXT as BLACK,
  MUTED as GRAY_LABEL,
  WHITE,
  setColor,
  setFill,
  setDraw,
  drawMainHeader,
  drawSectionTitle,
  addInfoCards,
  paintFooter,
  ensurePdfSpace,
  contentLimit,
  closeTableCard,
  nextPage,
} from "@transbordo/lib/pdfReportLayout";

function fmtDate(d) {
  if (!d) return "-";
  const raw = String(d);
  const date = raw.includes("T")
    ? new Date(raw)
    : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function fmtNum(n, decimals = 0) {
  if (n == null || n === "") return formatNum(0, decimals);
  return formatNum(n, decimals);
}

function fmtVolume(n) {
  return formatVolume(n, { empty: "0" });
}

/** Placa e barril na mesma célula: "placa (barril)", ou só o número existente. */
function formatEmbalagem(placa, barril) {
  const p = String(placa || "").trim();
  const b = String(barril || "").trim();
  const pOk = p && p !== "-";
  const bOk = b && b !== "-";
  if (pOk && bOk) return `${p} (${b})`;
  if (pOk) return p;
  if (bOk) return b;
  return "-";
}

function safePdfFilenamePart(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Data local no nome do PDF: 16-10-26. */
function formatPdfFileDate(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

function addPageTitle(doc, title, subtitle) {
  return drawMainHeader(doc, { title, subtitle });
}

function pageBox(doc) {
  return {
    w: doc.internal.pageSize.getWidth(),
    h: doc.internal.pageSize.getHeight(),
  };
}

function addFooter(doc) {
  paintFooter(doc);
}

function addSectionTitle(doc, y, title) {
  return drawSectionTitle(doc, y, title);
}

function addInfoGrid(doc, y, pairs, cols = 3) {
  return addInfoCards(doc, y, pairs, cols);
}

function ensureSpace(doc, y, needed) {
  return ensurePdfSpace(doc, y, needed);
}

function measurePdfText(doc, value, fontSize, fontStyle) {
  doc.setFont("helvetica", fontStyle);
  doc.setFontSize(fontSize);
  const items = Array.isArray(value) ? value : [value];
  let max = 0;
  for (const item of items) {
    if (item == null || item === "") continue;
    max = Math.max(max, doc.getTextWidth(String(item)));
  }
  return max;
}

/**
 * Larguras pelo conteúdo, somando a largura útil da página.
 * Colunas flexíveis (ex.: produto) absorvem o espaço que sobra e,
 * se a tabela estourar, são as primeiras a encolher — as demais
 * permanecem na largura do texto, em uma linha.
 * wrapCols não entram na medição do conteúdo: o texto quebra dentro
 * da largura que sobrar, sem empurrar as outras colunas.
 */
function fitColWidths(doc, headers, rows, totalsRow, options = {}) {
  const dataFs = options.dataFs ?? 8.5;
  const hdrFs = options.hdrFs ?? 7.5;
  const cellPadX = options.cellPadX ?? 2.2;
  const slack = options.slack ?? 1.6;
  const total = options.total ?? CW;
  const flexCols = new Set(options.flexCols || []);
  const wrapCols = new Set(options.wrapCols || []);
  const pad = cellPadX * 2 + slack;

  const mins = headers.map((header, i) => {
    let w = measurePdfText(doc, header, hdrFs, "bold");
    if (!wrapCols.has(i)) {
      for (const row of rows || []) {
        w = Math.max(w, measurePdfText(doc, row?.[i], dataFs, "normal"));
      }
      if (totalsRow) {
        w = Math.max(w, measurePdfText(doc, totalsRow[i], dataFs, "bold"));
      }
    }
    return w + pad;
  });

  if (Number(options.wrapMin) > 0) {
    for (const i of wrapCols) {
      mins[i] = Math.max(mins[i], options.wrapMin);
    }
  }

  const sum = mins.reduce((a, b) => a + b, 0);
  if (sum <= total + 0.01) {
    const extra = total - sum;
    const out = mins.slice();
    const flex = [...flexCols].filter((i) => i >= 0 && i < out.length);
    if (!flex.length || extra <= 0) {
      const widest = out.indexOf(Math.max(...out));
      if (widest >= 0) out[widest] += extra;
      return out;
    }
    const flexSum = flex.reduce((s, i) => s + out[i], 0) || flex.length;
    for (const i of flex) out[i] += extra * (out[i] / flexSum);
    return out;
  }

  const out = mins.slice();
  let overflow = sum - total;
  const flex = [...flexCols].filter((i) => i >= 0 && i < out.length);
  if (flex.length && overflow > 0) {
    const floors = flex.map((i) => {
      const headerW = measurePdfText(doc, headers[i], hdrFs, "bold") + pad;
      return Math.min(out[i], Math.max(headerW, options.flexMin ?? 28));
    });
    const shrinkable = flex.reduce(
      (s, i, idx) => s + Math.max(0, out[i] - floors[idx]),
      0
    );
    if (shrinkable > 0) {
      const take = Math.min(overflow, shrinkable);
      flex.forEach((i, idx) => {
        const room = Math.max(0, out[i] - floors[idx]);
        out[i] -= (room / shrinkable) * take;
      });
      overflow -= take;
    }
  }

  if (overflow > 0.05) {
    const scale = total / out.reduce((a, b) => a + b, 0);
    return out.map((w) => w * scale);
  }
  return out;
}

/** Normaliza larguras para somar exatamente CW (largura útil da página). */
function normalizeColWidths(widths, total = CW) {
  const list = (widths || []).map((w) => Math.max(8, Number(w) || 0));
  const sum = list.reduce((a, b) => a + b, 0);
  if (sum <= 0) return list.map(() => total / Math.max(1, list.length));
  if (Math.abs(sum - total) < 0.01) return list;
  return list.map((w) => (w / sum) * total);
}

/**
 * Tabela com quebra de linha automática (sem truncar com "...").
 * Aumenta a altura da linha conforme o conteúdo e respeita os limites da página.
 */
function addTable(doc, y, headers, rows, colWidths, totalsRow, badgeCols = [], options = {}) {
  const dataFs = options.dataFs ?? 8.5;
  const hdrFs = options.hdrFs ?? 7.5;
  const lineH = options.lineH ?? 4.6;
  const rowPad = options.rowPad ?? 2;
  const cellPadX = options.cellPadX ?? 2.2;
  const widths = normalizeColWidths(
    colWidths || headers.map(() => CW / headers.length)
  );
  const badgeSet = new Set(badgeCols);
  const badgeTones = options.badgeTones || {};
  const aligns = options.align || headers.map(() => "center");

  const cellCenterX = (x, w) => x + w / 2;

  const wrapValue = (value, colW) => {
    const maxW = Math.max(6, colW - cellPadX * 2);
    doc.setFontSize(dataFs);
    doc.setFont("helvetica", "normal");

    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) {
        const raw = String(item != null && item !== "" ? item : "-");
        const parts = doc.splitTextToSize(raw, maxW);
        out.push(...(parts.length ? parts : ["-"]));
      }
      return out.length ? out : ["-"];
    }

    const raw = String(value != null && value !== "" ? value : "-");
    const parts = doc.splitTextToSize(raw, maxW);
    return parts.length ? parts : ["-"];
  };

  const textX = (x, w, align) => {
    if (align === "left") return x + cellPadX;
    if (align === "right") return x + w - cellPadX;
    return cellCenterX(x, w);
  };

  const pdfAlign = (align) =>
    align === "left" ? "left" : align === "right" ? "right" : "center";

  const drawHeader = (yy) => {
    doc.setFontSize(hdrFs);
    doc.setFont("helvetica", "bold");
    const headerLines = headers.map((header, i) => {
      const maxW = Math.max(6, widths[i] - cellPadX * 2);
      return doc.splitTextToSize(String(header || ""), maxW);
    });
    const maxLines = Math.max(1, ...headerLines.map((l) => l.length));
    const h = Math.max(8, maxLines * 3.8 + 3);
    const r = Math.min(CARD_R, h / 2);

    setFill(doc, BLUE_DARK);
    doc.roundedRect(M, yy, CW, h, r, r, "F");
    if (h > r) doc.rect(M, yy + h - r, CW, r, "F");
    setColor(doc, WHITE);
    let x = M;
    headerLines.forEach((lines, i) => {
      const blockH = lines.length * 3.8;
      const startY = yy + (h - blockH) / 2 + 3.8 / 2;
      lines.forEach((line, li) => {
        doc.text(line, textX(x, widths[i], "center"), startY + li * 3.8, {
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

  const drawBadgeAt = (label, cx, cy, maxW) => {
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    const tw = doc.getTextWidth(label) + 4;
    const bw = Math.min(Math.max(tw, 14), Math.max(14, maxW - 2));
    const bh = 4.6;
    setFill(doc, [220, 252, 231]);
    doc.roundedRect(cx - bw / 2, cy - bh / 2, bw, bh, 1.2, 1.2, "F");
    setColor(doc, [21, 128, 61]);
    const safe = doc.splitTextToSize(label, bw - 3)[0] || label;
    doc.text(safe, cx, cy, { align: "center", baseline: "middle" });
  };

  const drawAmberBadge = (lines, cellX, cellW, rowY, rowH) => {
    const content = (lines || [])
      .map((line) => String(line || "").trim())
      .filter((line) => line && line !== "-");
    if (!content.length) return false;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    const padX = 2.2;
    const padY = 1.05;
    const textW = Math.max(...content.map((line) => doc.getTextWidth(line)));
    const bw = Math.min(Math.max(cellW - 1.8, 8), Math.max(textW + padX * 2, 12));
    const bh = Math.max(4.8, content.length * lineH + padY * 2);
    const bx = cellX + (cellW - bw) / 2;
    const by = rowY + (rowH - bh) / 2;

    setFill(doc, [254, 249, 195]);
    doc.roundedRect(bx, by, bw, bh, 1.3, 1.3, "F");
    setColor(doc, [120, 53, 15]);
    content.forEach((line, li) => {
      const cy =
        by + bh / 2 - ((content.length - 1) * lineH) / 2 + li * lineH;
      doc.text(line, bx + bw / 2, cy, { align: "center", baseline: "middle" });
    });
    return true;
  };

  let segmentTop = y;
  y = drawHeader(y);
  doc.setFontSize(dataFs);
  doc.setFont("helvetica", "normal");
  setColor(doc, BLACK);

  if (!rows.length) {
    const rowH = 8;
    doc.setFontSize(8);
    setColor(doc, GRAY_LABEL);
    doc.text("Nenhum registro", cellCenterX(M, CW), y + rowH / 2, {
      align: "center",
      baseline: "middle",
    });
    setColor(doc, BLACK);
    y += rowH;
    closeTableCard(doc, segmentTop, y);
    return y + 4;
  }

  rows.forEach((r, ri) => {
    const cellLines = r.map((c, i) => wrapValue(c, widths[i]));
    const maxLines = Math.max(1, ...cellLines.map((lines) => lines.length));
    const rowH = Math.max(7.5, maxLines * lineH + rowPad * 2);

    if (y + rowH > contentLimit(doc) && y > segmentTop + 8) {
      closeTableCard(doc, segmentTop, y);
      y = nextPage(doc);
      segmentTop = y;
      y = drawHeader(y);
      doc.setFontSize(dataFs);
      doc.setFont("helvetica", "normal");
      setColor(doc, BLACK);
    }
    if (ri % 2 === 1) {
      setFill(doc, GRAY_ROW);
      doc.rect(M + 0.45, y, CW - 0.9, rowH, "F");
    }
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.15);
    doc.line(M + 1.5, y + rowH, M + CW - 1.5, y + rowH);

    let x = M;
    cellLines.forEach((lines, i) => {
      if (badgeTones[i] === "amber" && drawAmberBadge(lines, x, widths[i], y, rowH)) {
        x += widths[i];
        return;
      }

      const align = aligns[i] || "center";
      const blockH = lines.length * lineH;
      const startY = y + (rowH - blockH) / 2 + lineH / 2;

      lines.forEach((raw, li) => {
        const cy = startY + li * lineH;
        const label = raw || "-";

        if (badgeSet.has(i) && label && label !== "-") {
          drawBadgeAt(label, cellCenterX(x, widths[i]), cy, widths[i]);
        } else {
          doc.setFontSize(dataFs);
          setColor(doc, BLACK);
          doc.setFont("helvetica", "normal");
          doc.text(label, textX(x, widths[i], align), cy, {
            align: pdfAlign(align),
            baseline: "middle",
          });
        }
      });
      x += widths[i];
    });
    y += rowH;
  });

  if (totalsRow) {
    const totalLines = totalsRow.map((c, i) => {
      const maxW = Math.max(6, widths[i] - cellPadX * 2);
      doc.setFontSize(dataFs);
      doc.setFont("helvetica", "bold");
      if (c == null || c === "") return [""];
      const parts = doc.splitTextToSize(String(c), maxW);
      return parts.length ? parts : [""];
    });
    const maxLines = Math.max(1, ...totalLines.map((l) => Math.max(1, l.length)));
    const rowH = Math.max(8, maxLines * lineH + rowPad * 2);
    if (y + rowH > contentLimit(doc) && y > segmentTop + 8) {
      closeTableCard(doc, segmentTop, y);
      y = nextPage(doc);
      segmentTop = y;
    }
    setFill(doc, BLUE_SOFT);
    doc.rect(M + 0.45, y, CW - 0.9, rowH, "F");
    setDraw(doc, BLUE_MID);
    doc.setLineWidth(0.35);
    doc.line(M + 1.5, y, M + CW - 1.5, y);
    doc.setLineWidth(0.2);
    doc.setFontSize(dataFs);
    doc.setFont("helvetica", "bold");
    let x = M;
    totalLines.forEach((lines, i) => {
      const align = aligns[i] || "center";
      const blockH = lines.length * lineH;
      const startY = y + (rowH - blockH) / 2 + lineH / 2;
      setColor(doc, BLUE_DARK);
      lines.forEach((text, li) => {
        if (!text) return;
        doc.text(text, textX(x, widths[i], align), startY + li * lineH, {
          align: pdfAlign(align),
          baseline: "middle",
        });
      });
      x += widths[i];
    });
    y += rowH;
  }

  closeTableCard(doc, segmentTop, y);
  setColor(doc, BLACK);
  return y + 6;
}

/**
 * Relatório completo do item de estoque (A4).
 * Layout no padrão visual do PDF de checklist.
 */
export function generateRelatorioEstoquePDF({
  item,
  displayId,
  estoqueCodigo,
  destinosList = [],
  historicoTransbordos = [],
  saidasHistorico = [],
}) {
  if (!item) return;

  const doc = new jsPDF({ format: "a4" });
  const unidade = item.unidade_medida || "kg";
  const codigo = item.produto_codigo || "-";
  const produto = item.produto_nome || "-";
  const lote = item.lote || "-";
  const idEstoque =
    estoqueCodigo || formatEstoqueCodigo(item.codigo_estoque);
  const idEntrada = displayId || item.entrada_codigo || "-";
  const custoTotal =
    (Number(item.saldo_atual) || 0) * (Number(item.preco_unitario) || 0);

  const title =
    codigo !== "-"
      ? `${codigo}${produto !== "-" ? ` - ${produto}` : ""}`
      : produto !== "-"
        ? produto
        : "Relatório de Estoque";

  let y = addPageTitle(doc, title, "Relatório de Estoque");

  y = ensureSpace(doc, y, 40);
  y = addSectionTitle(doc, y, "Identificação");
  y = addInfoGrid(
    doc,
    y,
    [
      ["ID", idEstoque],
      ["Entrada", idEntrada],
      ["Código", codigo],
      ["Lote", lote],
      ["Produto", produto, 2],
      ["Cliente", item.cliente_nome || "-"],
    ],
    3
  );

  y = ensureSpace(doc, y, 40);
  y = addSectionTitle(doc, y, "Dados do Produto");
  y = addInfoGrid(
    doc,
    y,
    [
      ["Tipo", getTipoRecebimentoLabel(resolveTipoRecebimentoEstoque(item))],
      ["Status WMS", item.status_wms ? "OK" : "NOK"],
      [
        "Origem",
        item.origem === "industrializacao" || item.origem === "MATERIA_PRIMA"
          ? "Matéria-prima"
          : "Armazenagem",
      ],
      ["Recebimento", fmtDate(item.created_at || item.created_date)],
    ],
    3
  );

  y = ensureSpace(doc, y, 40);
  y = addSectionTitle(doc, y, "Recebimento / Fiscal");
  y = addInfoGrid(
    doc,
    y,
    [
      ["Nota Fiscal", getEstoqueNotaFiscal(item) || "-"],
      ["Troca Fiscal", getEstoqueNotaFiscalTroca(item) || "-"],
      ["Densidade", formatDensidade(item.densidade) || "-"],
      ["Fabricação", fmtDate(item.data_fabricacao)],
      ["Validade", fmtDate(item.data_validade)],
    ],
    3
  );

  const estoquePairs = [
    ["Quantidade", `${formatQuantidade(item.quantidade, { empty: "0" })} ${unidade}`],
    ["Saldo Atual", `${formatQuantidade(item.saldo_atual, { empty: "0" })} ${unidade}`],
    ["Unidade", unidade],
    ["Preço Unitário", formatCurrency(item.preco_unitario)],
    ["Custo Total", formatCurrency(custoTotal)],
  ];
  if (item.embalado) {
    estoquePairs.push(
      ["Peso Líquido", `${fmtNum(item.peso_liquido, 0)}`],
      [
        "Qtd. Embalagens",
        item.quantidade_embalagens != null
          ? String(item.quantidade_embalagens)
          : "-",
      ]
    );
  }

  y = ensureSpace(doc, y, 40);
  y = addSectionTitle(doc, y, "Estoque");
  y = addInfoGrid(doc, y, estoquePairs, 3);

  if (item.granel_pesagem) {
    y = ensureSpace(doc, y, 35);
    y = addSectionTitle(doc, y, "Pesagem Granel");
    y = addInfoGrid(
      doc,
      y,
      [
        ["Ticket", item.granel_ticket || "-"],
        ["Peso Bruto (kg)", fmtNum(item.granel_peso_bruto, 0)],
        ["Peso Líquido (kg)", fmtNum(item.granel_peso_liquido, 0)],
        [
          "Margem",
          item.granel_margem === "dentro"
            ? "Dentro"
            : item.granel_margem === "fora"
              ? "Fora"
              : "-",
        ],
      ],
      3
    );
  }

  const totalVol = destinosList.reduce(
    (s, d) => s + (Number(d.volume) || 0),
    0
  );
  const totalMass = destinosList.reduce(
    (s, d) => s + (Number(d.pesoLiq) || 0),
    0
  );

  y = ensureSpace(doc, y, 36);
  y = addSectionTitle(doc, y, "Destinos (Transbordo)");
  y = addTable(
    doc,
    y,
    ["TRANSBORDO", "DATA", "DESTINO", "TIPO", "VOLUME (L)", "PESO LÍQ."],
    destinosList.map((d) => [
      d.codigo || "-",
      fmtDate(d.data),
      d.destino || "-",
      d.tipo || "-",
      fmtVolume(roundVolume(d.volume || 0)),
      fmtNum(roundMass(d.pesoLiq || 0), 0),
    ]),
    [30, 24, 42, 28, 30, 28],
    destinosList.length > 0
      ? [
          "TOTAL",
          "",
          "",
          "",
          `${fmtVolume(roundVolume(totalVol))} L`,
          `${fmtNum(roundMass(totalMass), 0)} kg`,
        ]
      : null
  );

  const totalVolHist = historicoTransbordos.reduce(
    (s, d) => s + (Number(d.volume) || 0),
    0
  );
  const totalMassHist = historicoTransbordos.reduce(
    (s, d) => s + (Number(d.pesoLiq) || 0),
    0
  );

  y = ensureSpace(doc, y, 36);
  y = addSectionTitle(doc, y, "Histórico de Embalagens");
  y = addTable(
    doc,
    y,
    ["TRANSBORDO", "DATA", "ORIGEM", "DESTINO", "TIPO", "VOLUME (L)", "PESO LÍQ."],
    historicoTransbordos.map((d) => [
      d.codigo || "-",
      fmtDate(d.data),
      d.origem || "-",
      d.destino || "-",
      d.tipo || "-",
      fmtVolume(roundVolume(d.volume || 0)),
      fmtNum(roundMass(d.pesoLiq || 0), 0),
    ]),
    [26, 20, 32, 32, 24, 24, 24],
    historicoTransbordos.length > 0
      ? [
          "TOTAL",
          "",
          "",
          "",
          "",
          `${fmtVolume(roundVolume(totalVolHist))} L`,
          `${fmtNum(roundMass(totalMassHist), 0)} kg`,
        ]
      : null
  );

  y = ensureSpace(doc, y, 36);
  y = addSectionTitle(doc, y, "Histórico de Saídas");
  y = addTable(
    doc,
    y,
    ["SAÍDA", "DATA", "TIPO", "QUANTIDADE", "STATUS", "RESPONSÁVEL"],
    saidasHistorico.map((s) => [
      s.codigo || "-",
      fmtDate(s.data),
      s.tipo || "-",
      `${fmtNum(s.quantidade, 0)} ${s.unidade || ""}`.trim(),
      s.status || "-",
      s.responsavel || "-",
    ]),
    [28, 26, 26, 32, 36, 34],
    null
  );

  addFooter(doc);

  const fileBase =
    safePdfFilenamePart(codigo) ||
    safePdfFilenamePart(lote) ||
    safePdfFilenamePart(idEntrada) ||
    "estoque";
  doc.save(`${fileBase} - Relatório de Estoque.pdf`);
}

function hexToRgb(hex) {
  const h = String(hex || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [229, 231, 235];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function ellipsisText(doc, text, maxWidth) {
  const raw = String(text || "—").replace(/\s+/g, " ").trim() || "—";
  if (doc.getTextWidth(raw) <= maxWidth) return raw;
  let cut = raw;
  while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/** Cápsula no mesmo critério do TankSilo: líquido sobe de baixo, cor do produto. */
function drawPdfSilo(doc, x, y, w, h, pct, fillHex) {
  const radius = Math.min(w / 2, h / 2);
  const inset = 0.4;
  const pctClamped = Math.max(0, Math.min(100, Number(pct) || 0));
  const innerH = h - inset * 2;
  const fillH = innerH * (pctClamped / 100);

  doc.setFillColor(255, 255, 255);
  setDraw(doc, [203, 213, 225]);
  doc.setLineWidth(0.45);
  doc.roundedRect(x, y, w, h, radius, radius, "FD");

  if (fillH > 0.3) {
    doc.saveGraphicsState();
    doc.roundedRect(
      x + inset,
      y + inset,
      w - inset * 2,
      innerH,
      Math.max(0.6, radius - inset),
      Math.max(0.6, radius - inset),
      null
    );
    doc.clip();
    doc.discardPath();
    const [r, g, b] = hexToRgb(fillHex);
    doc.setFillColor(r, g, b);
    doc.rect(x, y + h - inset - fillH, w, fillH + inset + 0.2, "F");
    doc.restoreGraphicsState();
    setDraw(doc, [203, 213, 225]);
    doc.setLineWidth(0.45);
    doc.roundedRect(x, y, w, h, radius, radius, "S");
  }
}

function drawSiloLabel(doc, text, centerX, y, maxWidth, fontSize, style) {
  doc.setFont("helvetica", style);
  doc.setFontSize(fontSize);
  setColor(doc, style === "bold" ? BLACK : [55, 65, 80]);
  doc.text(ellipsisText(doc, text, maxWidth), centerX, y, { align: "center" });
}

/** Badge laranja claro, no mesmo lugar do silo na tela. */
function drawSiloObsBadge(doc, text, centerX, y, maxWidth) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  const label = ellipsisText(doc, text, Math.max(8, maxWidth - 3));
  const bw = Math.min(maxWidth, doc.getTextWidth(label) + 3.2);
  const bh = 3.4;
  const x = centerX - bw / 2;
  doc.setFillColor(255, 237, 213);
  doc.roundedRect(x, y - bh / 2, bw, bh, 1, 1, "F");
  doc.setTextColor(154, 52, 18);
  doc.text(label, centerX, y, { align: "center", baseline: "middle" });
}

/**
 * Última(s) folha(s) em paisagem, com os silos do filtro.
 * Uma página cabe 24 tankas (8 × 3). O excedente segue em outra folha paisagem.
 */
function addTankaSiloPages(doc, tanks = []) {
  const cols = 8;
  const rows = 3;
  const perPage = cols * rows;
  const pageCount = Math.max(1, Math.ceil(tanks.length / perPage));
  const totalVolume = tanks.reduce(
    (sum, tk) => sum + (Number(tk.volumeAtual) || 0),
    0
  );

  for (let page = 0; page < pageCount; page++) {
    doc.addPage("a4", "l");
    const { w, h } = pageBox(doc);
    const slice = tanks.slice(page * perPage, (page + 1) * perPage);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, GRAY_LABEL);
    doc.text("ChemCtrl", M, 12);
    doc.setFontSize(15);
    setColor(doc, BLUE_DARK);
    doc.text("Tankas", M, 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setColor(doc, GRAY_LABEL);
    const continuation =
      pageCount > 1 ? ` · folha ${page + 1} de ${pageCount}` : "";
    doc.text(`${tanks.length} tanka(s)${continuation}`, M, 26);
    doc.setFont("helvetica", "bold");
    setColor(doc, BLACK);
    doc.text(`${fmtVolume(totalVolume)} L`, w - M, 20, { align: "right" });
    setDraw(doc, BLUE);
    doc.setLineWidth(0.5);
    doc.line(M, 30, w - M, 30);
    doc.setLineWidth(0.2);

    if (slice.length === 0) {
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      setColor(doc, GRAY_LABEL);
      doc.text("Nenhuma tanka no filtro.", w / 2, h / 2, { align: "center" });
      continue;
    }

    const top = 36;
    const bottom = h - 24;
    const gridW = w - 2 * M;
    const gridH = bottom - top;
    const slotW = gridW / cols;
    const slotH = gridH / rows;
    const siloW = Math.min(20, slotW - 10);
    const siloH = Math.min(slotH - 18, siloW * 1.85);

    slice.forEach((tk, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const slotX = M + col * slotW;
      const slotY = top + row * slotH;
      const x = slotX + (slotW - siloW) / 2;
      const y = slotY + 1;
      const volume = Number(tk.volumeAtual) || 0;
      const cap = Number(tk.capacidade) || 0;
      const pct = cap > 0 ? (volume / cap) * 100 : 0;
      const nome = tk.tanka || tk.tankaCodigo || tk.codigo_itku || "—";
      const produto = tk.produto || tk.produto_nome || "—";

      drawPdfSilo(doc, x, y, siloW, siloH, pct, tk.fillColor);

      const volumeLabel = `${fmtVolume(volume)} L`;
      const pctLabel = `${fmtNum(Math.min(pct, 100), 1)}%`;
      doc.setFont("helvetica", "bold");
      let volumeSize = 8;
      doc.setFontSize(volumeSize);
      const innerW = siloW - 3;
      while (volumeSize > 5.5 && doc.getTextWidth(volumeLabel) > innerW) {
        volumeSize -= 0.5;
        doc.setFontSize(volumeSize);
      }
      setColor(doc, BLACK);
      doc.text(volumeLabel, x + siloW / 2, y + siloH / 2 - 0.4, {
        align: "center",
        baseline: "middle",
      });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(Math.max(6, volumeSize - 1.5));
      doc.text(pctLabel, x + siloW / 2, y + siloH / 2 + 3.4, {
        align: "center",
        baseline: "middle",
      });

      const labelW = slotW - 2;
      drawSiloLabel(doc, nome, slotX + slotW / 2, y + siloH + 5, labelW, 8, "bold");
      drawSiloLabel(
        doc,
        produto,
        slotX + slotW / 2,
        y + siloH + 9,
        labelW,
        7,
        "normal"
      );
      const obs = String(tk.observacao || "").trim();
      if (obs) {
        drawSiloObsBadge(doc, obs, slotX + slotW / 2, y + siloH + 13.2, labelW);
      }
    });
  }
}

/**
 * Relatório consolidado de Estoque Envio (produtos + vasilhames + tankas).
 * Layout no padrão visual do PDF de checklist.
 * A última folha é paisagem, com os silos coloridos do filtro.
 */
export function generateEstoqueEnvioPDF({
  client,
  products = [],
  containers = [],
  containersSummary = [],
  tanks = [],
}) {
  const clientLabel = client || "Todos os clientes";
  const doc = new jsPDF({ format: "a4" });

  let y = addPageTitle(
    doc,
    `Estoque Envio — ${clientLabel}`,
    "Relatório consolidado de estoque para envio"
  );

  const totalProdutoSaldo = products.reduce(
    (s, p) => s + (Number(p.saldo) || 0),
    0
  );
  const totalProdutoReservado = products.reduce(
    (s, p) => s + (Number(p.saldoReservado) || 0),
    0
  );
  const totalProdutoFinal = products.reduce(
    (s, p) => s + (Number(p.saldoFinal ?? p.saldo) || 0),
    0
  );
  const totalContainerVolume = containers.reduce(
    (s, c) => s + (Number(c.volume) || 0),
    0
  );

  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, "Estoque de produtos");
  if (products.length === 0) {
    doc.setFontSize(9);
    setColor(doc, GRAY_LABEL);
    doc.text("Nenhum produto com saldo no filtro.", M, y);
    y += 8;
  } else {
    // Produto recebe a maior fatia; demais colunas compactas e proporcionais
    y = addTable(
      doc,
      y,
      ["CÓDIGO", "PRODUTO", "SALDO ATUAL", "RESERVADO", "SALDO FINAL", "UN."],
      products.map((p) => [
        p.codigo || "-",
        p.produto || "-",
        fmtNum(p.saldo, 3),
        fmtNum(p.saldoReservado, 0),
        fmtNum(p.saldoFinal ?? p.saldo, 3),
        p.unidade || "-",
      ]),
      [22, 78, 24, 22, 24, 12],
      [
        "TOTAL",
        "",
        fmtNum(totalProdutoSaldo, 3),
        fmtNum(totalProdutoReservado, 0),
        fmtNum(totalProdutoFinal, 3),
        "",
      ],
      [],
      {
        align: ["center", "left", "center", "center", "center", "center"],
      }
    );
  }

  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, "Vasilhames — Resumo por produto / capacidade");
  if (!containersSummary.length) {
    doc.setFontSize(9);
    setColor(doc, GRAY_LABEL);
    doc.text("Nenhum vasilhame para resumir no filtro.", M, y);
    y += 8;
  } else {
    const fmtCap = (total, reservado) => {
      const t = Number(total) || 0;
      const r = Number(reservado) || 0;
      return r > 0 ? `${fmtNum(t, 0)} (${fmtNum(r, 0)} res.)` : fmtNum(t, 0);
    };

    const sum5000 = containersSummary.reduce(
      (s, r) => s + (Number(r.cap5000) || 0),
      0
    );
    const sum1500 = containersSummary.reduce(
      (s, r) => s + (Number(r.cap1500) || 0),
      0
    );
    const sumOutros = containersSummary.reduce(
      (s, r) => s + (Number(r.outros) || 0),
      0
    );
    const sumFrac = containersSummary.reduce(
      (s, r) => s + (Number(r.fracionados) || 0),
      0
    );
    const sumTotal = containersSummary.reduce(
      (s, r) => s + (Number(r.total) || 0),
      0
    );
    const sum5000Res = containersSummary.reduce(
      (s, r) => s + (Number(r.cap5000Reservado) || 0),
      0
    );
    const sum1500Res = containersSummary.reduce(
      (s, r) => s + (Number(r.cap1500Reservado) || 0),
      0
    );
    const sumOutrosRes = containersSummary.reduce(
      (s, r) => s + (Number(r.outrosReservado) || 0),
      0
    );
    const sumFracRes = containersSummary.reduce(
      (s, r) => s + (Number(r.fracionadosReservado) || 0),
      0
    );
    const sumTotalRes = containersSummary.reduce(
      (s, r) => s + (Number(r.totalReservado) || 0),
      0
    );

    y = addTable(
      doc,
      y,
      [
        "CÓDIGO",
        "PRODUTO",
        "5.000 L",
        "1.500 L",
        "OUTROS",
        "FRACIONADOS",
        "TOTAL",
      ],
      containersSummary.map((r) => [
        r.codigo || "-",
        r.produto || "-",
        fmtCap(r.cap5000, r.cap5000Reservado),
        fmtCap(r.cap1500, r.cap1500Reservado),
        fmtCap(r.outros, r.outrosReservado),
        fmtCap(r.fracionados, r.fracionadosReservado),
        fmtCap(r.total, r.totalReservado),
      ]),
      [22, 48, 26, 26, 24, 28, 26],
      [
        "TOTAL",
        "",
        fmtCap(sum5000, sum5000Res),
        fmtCap(sum1500, sum1500Res),
        fmtCap(sumOutros, sumOutrosRes),
        fmtCap(sumFrac, sumFracRes),
        fmtCap(sumTotal, sumTotalRes),
      ],
      [],
      {
        align: [
          "center",
          "left",
          "center",
          "center",
          "center",
          "center",
          "center",
        ],
      }
    );
  }

  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, "Vasilhames");
  if (containers.length === 0) {
    doc.setFontSize(9);
    setColor(doc, GRAY_LABEL);
    doc.text("Nenhum vasilhame no filtro.", M, y);
    y += 8;
  } else {
    const vasilhameHeaders = [
      "EMBALAGEM",
      "PRODUTO",
      "LOTE",
      "VOLUME",
      "STATUS",
      "OBSERVAÇÃO",
    ];
    const containersSorted = [...containers].sort((a, b) => {
      const prodA = String(a.produto_nome || "").trim() || "—";
      const prodB = String(b.produto_nome || "").trim() || "—";
      const byProd = prodA.localeCompare(prodB, "pt-BR", { sensitivity: "base" });
      if (byProd !== 0) return byProd;
      return formatEmbalagem(a.placa, a.barril).localeCompare(
        formatEmbalagem(b.placa, b.barril),
        "pt-BR",
        { numeric: true, sensitivity: "base" }
      );
    });
    const vasilhameRows = containersSorted.map((c) => [
      formatEmbalagem(c.placa, c.barril),
      c.produto_nome || "-",
      c.lote || "-",
      fmtVolume(c.volume),
      c.statusReserva || (c.reservado ? "Reservado" : "Livre"),
      String(c.observacao || "").trim() || "-",
    ]);
    const vasilhameTotals = [
      "TOTAL",
      "",
      "",
      `${fmtVolume(totalContainerVolume)} L`,
      "",
      "",
    ];
    // Embalagem, lote, volume e status ficam em uma linha.
    // Produto e observação absorvem o espaço; só a observação quebra linha.
    const vasilhameWidths = fitColWidths(
      doc,
      vasilhameHeaders,
      vasilhameRows,
      vasilhameTotals,
      { flexCols: [1, 5], wrapCols: [5], flexMin: 28, wrapMin: 42 }
    );
    y = addTable(
      doc,
      y,
      vasilhameHeaders,
      vasilhameRows,
      vasilhameWidths,
      vasilhameTotals,
      [],
      {
        align: ["center", "left", "center", "center", "center", "center"],
        badgeTones: { 5: "amber" },
      }
    );
  }

  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, "Tankas");
  const tankRows = [];
  let totalTankVolume = 0;

  // Agrupa visualmente: mesmo produto juntos; depois ordena pela identificação da tanka
  const tanksSorted = [...(tanks || [])].sort((a, b) => {
    const prodA = String(a.produto || a.produto_nome || "").trim() || "—";
    const prodB = String(b.produto || b.produto_nome || "").trim() || "—";
    const byProd = prodA.localeCompare(prodB, "pt-BR", { sensitivity: "base" });
    if (byProd !== 0) return byProd;
    const nomeA = String(
      a.tankaCodigo || a.tanka || a.codigo_itku || ""
    ).trim();
    const nomeB = String(
      b.tankaCodigo || b.tanka || b.codigo_itku || ""
    ).trim();
    return nomeA.localeCompare(nomeB, undefined, { numeric: true });
  });

  for (const tk of tanksSorted) {
    const tankaNome =
      tk.tankaCodigo || tk.tanka || tk.codigo_itku || "-";
    const produto = tk.produto || tk.produto_nome || "-";
    const cap = Number(tk.capacidade) || 26000;
    const lotes =
      Array.isArray(tk.lotes) && tk.lotes.length > 0
        ? tk.lotes
        : [
            {
              lote: tk.lote || "",
              quantidade_l: Number(tk.volumeAtual) || 0,
            },
          ];

    const loteLines = [];
    const volumeLines = [];
    let tankaVolume = 0;

    for (const l of lotes) {
      const vol = Number(l.quantidade_l) || 0;
      tankaVolume += vol;
      totalTankVolume += vol;
      loteLines.push(l.lote || "-");
      volumeLines.push(fmtVolume(vol));
    }

    if (lotes.length > 1) {
      volumeLines.push(`Total ${fmtVolume(tankaVolume)}`);
    }

    const ocupacaoPct = cap > 0 ? Math.min(100, (tankaVolume / cap) * 100) : 0;
    tankRows.push([
      tankaNome,
      produto,
      loteLines,
      volumeLines,
      `${ocupacaoPct.toFixed(1)}%`,
    ]);
  }

  if (tankRows.length === 0) {
    doc.setFontSize(9);
    setColor(doc, GRAY_LABEL);
    doc.text("Nenhuma tanka no filtro.", M, y);
    y += 8;
  } else {
    y = addTable(
      doc,
      y,
      ["TANKA", "PRODUTO", "LOTE", "VOLUME ATUAL", "OCUPAÇÃO"],
      tankRows,
      [28, 66, 30, 34, 24],
      ["TOTAL", "", "", `${fmtVolume(totalTankVolume)} L`, ""],
      [4], // coluna ocupação com badge verde (apenas PDF)
      {
        align: ["center", "left", "center", "center", "center"],
      }
    );
  }

  addTankaSiloPages(doc, tanks);
  addFooter(doc);
  const clienteArquivo = safePdfFilenamePart(clientLabel) || "Cliente";
  doc.save(`Estoque ${clienteArquivo} ${formatPdfFileDate()}.pdf`);
}
