import { jsPDF } from "jspdf";
import {
  formatNum,
  formatCurrency,
  formatDensidade,
  roundVolume,
  roundMass,
} from "@transbordo/lib/format";
import {
  getEstoqueNotaFiscal,
  getEstoqueNotaFiscalTroca,
} from "@transbordo/lib/estoqueSaldo";

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

function safePdfFilenamePart(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addPageTitle(doc, title, subtitle) {
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  setColor(doc, BLUE_DARK);
  doc.text(title, M, 22);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  setColor(doc, GRAY_LABEL);
  doc.text(subtitle || "", M, 29);
  setDraw(doc, BLUE_MID);
  doc.setLineWidth(0.6);
  doc.line(M, 33, PW - M, 33);
  doc.setLineWidth(0.2);
  return 44;
}

function addFooter(doc) {
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
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

function addInfoGrid(doc, y, pairs, cols = 3) {
  const colW = CW / cols;
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
    currentRow.push({ label: p[0], value: p[1], span });
    usedCols += span;
    if (usedCols >= cols) {
      rowsData.push(currentRow);
      currentRow = [];
      usedCols = 0;
    }
  }
  if (currentRow.length > 0) rowsData.push(currentRow);

  const rowHeights = rowsData.map((row) => {
    let maxH = 14;
    row.forEach((cell) => {
      const cellW = colW * cell.span - 6;
      const lines = doc.splitTextToSize(
        String(cell.value != null ? cell.value : "-"),
        cellW
      );
      const textH = 5 + lines.length * 4.5 + 4;
      if (textH > maxH) maxH = textH;
    });
    return maxH;
  });
  const totalH = rowHeights.reduce((a, b) => a + b, 0);

  setDraw(doc, GRAY_BORDER);
  doc.setLineWidth(0.3);
  doc.rect(M, y, CW, totalH);

  let yy = y;
  rowsData.forEach((row, ri) => {
    const rowH = rowHeights[ri];
    let x = M;
    row.forEach((cell) => {
      const cellW = colW * cell.span;
      if (x > M) {
        setDraw(doc, GRAY_BORDER);
        doc.setLineWidth(0.3);
        doc.line(x, yy, x, yy + rowH);
      }
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      setColor(doc, GRAY_LABEL);
      doc.text(String(cell.label).toUpperCase(), x + 3, yy + 4.5);
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "bold");
      setColor(doc, BLACK);
      const lines = doc.splitTextToSize(
        String(cell.value != null ? cell.value : "-"),
        cellW - 6
      );
      doc.text(lines, x + 3, yy + 10);
      x += cellW;
    });
    if (ri < rowsData.length - 1) {
      setDraw(doc, GRAY_BORDER);
      doc.setLineWidth(0.3);
      doc.line(M, yy + rowH, M + CW, yy + rowH);
    }
    yy += rowH;
  });

  setColor(doc, BLACK);
  return y + totalH + 5;
}

function ensureSpace(doc, y, needed) {
  if (y + needed > PH - 20) {
    doc.addPage();
    return 20;
  }
  return y;
}

function addTable(doc, y, headers, rows, colWidths, totalsRow) {
  const dataFs = 8.5;
  const hdrFs = 7.5;
  const widths = colWidths || headers.map(() => CW / headers.length);
  const charW = dataFs * 0.182;

  const cellCenterX = (x, w) => x + w / 2;

  const drawHeader = (yy) => {
    const h = 8;
    setFill(doc, BLUE_DARK);
    doc.rect(M, yy, CW, h, "F");
    doc.setFontSize(hdrFs);
    doc.setFont("helvetica", "bold");
    setColor(doc, [255, 255, 255]);
    let x = M;
    headers.forEach((header, i) => {
      doc.text(header, cellCenterX(x, widths[i]), yy + h / 2, {
        align: "center",
        baseline: "middle",
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
  doc.setFontSize(dataFs);
  doc.setFont("helvetica", "normal");
  setColor(doc, BLACK);

  if (!rows.length) {
    const rowH = 8;
    setFill(doc, GRAY_ROW);
    doc.rect(M, y, CW, rowH, "F");
    drawVLines(y, rowH);
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.15);
    doc.line(M, y + rowH, M + CW, y + rowH);
    doc.setFontSize(8);
    setColor(doc, GRAY_LABEL);
    doc.text("Nenhum registro", cellCenterX(M, CW), y + rowH / 2, {
      align: "center",
      baseline: "middle",
    });
    setColor(doc, BLACK);
    return y + rowH + 4;
  }

  rows.forEach((r, ri) => {
    const rowH = 7.5;
    if (y + rowH > PH - 28) {
      doc.addPage();
      y = 20;
      y = drawHeader(y);
      doc.setFontSize(dataFs);
      doc.setFont("helvetica", "normal");
      setColor(doc, BLACK);
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
    r.forEach((c, i) => {
      const text = String(c != null ? c : "-");
      doc.setFontSize(dataFs);
      setColor(doc, BLACK);
      doc.setFont("helvetica", "normal");
      const availW = widths[i] - 4;
      const maxChars = Math.max(1, Math.floor(availW / charW));
      const display =
        text.length > maxChars ? `${text.substring(0, maxChars)}...` : text;
      doc.text(display, cellCenterX(x, widths[i]), y + rowH / 2, {
        align: "center",
        baseline: "middle",
      });
      x += widths[i];
    });
    y += rowH;
  });

  if (totalsRow) {
    const rowH = 8;
    if (y + rowH > PH - 28) {
      doc.addPage();
      y = 20;
    }
    setFill(doc, [235, 240, 250]);
    doc.rect(M, y, CW, rowH, "F");
    drawVLines(y, rowH);
    setDraw(doc, BLUE_MID);
    doc.setLineWidth(0.4);
    doc.line(M, y, M + CW, y);
    doc.setLineWidth(0.2);
    doc.setFontSize(dataFs);
    doc.setFont("helvetica", "bold");
    let x = M;
    totalsRow.forEach((c, i) => {
      const text = String(c != null ? c : "");
      setColor(doc, BLUE_DARK);
      if (text) {
        doc.text(text, cellCenterX(x, widths[i]), y + rowH / 2, {
          align: "center",
          baseline: "middle",
        });
      }
      x += widths[i];
    });
    y += rowH;
  }

  setColor(doc, BLACK);
  return y + 4;
}

/**
 * Relatório completo do item de estoque (A4).
 * Layout alinhado ao Relatório Fiscal e demais PDFs do ChemCtrl.
 */
export function generateRelatorioEstoquePDF({
  item,
  displayId,
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
      ["ID Entrada", idEntrada],
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
      ["Tipo", item.embalado ? "Embalado" : "Convencional"],
      ["Status WMS", item.status_wms ? "OK" : "NOK"],
      [
        "Origem",
        item.origem === "industrializacao" ? "ChemCtrl" : "Transbordo",
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
    ["Quantidade", `${fmtNum(item.quantidade, 0)} ${unidade}`],
    ["Saldo Atual", `${fmtNum(item.saldo_atual, 0)} ${unidade}`],
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
      fmtNum(roundVolume(d.volume || 0), 0),
      fmtNum(roundMass(d.pesoLiq || 0), 0),
    ]),
    [30, 24, 42, 28, 30, 28],
    destinosList.length > 0
      ? [
          "TOTAL",
          "",
          "",
          "",
          `${fmtNum(roundVolume(totalVol), 0)} L`,
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
      fmtNum(roundVolume(d.volume || 0), 0),
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
          `${fmtNum(roundVolume(totalVolHist), 0)} L`,
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
