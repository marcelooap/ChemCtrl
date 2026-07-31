import { jsPDF } from "jspdf";
import { formatNum, roundVolume, roundMass } from "@chemflow/lib/format";
import {
  aggregateComposicaoByLote,
  getDominantLote,
  getLoteEnvaseDate,
  seedComposicaoFromVasilhame,
} from "@chemflow/lib/vasilhameComposicao";

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
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("pt-BR");
  }
  const raw = String(d);
  const date = raw.includes("T") ? new Date(raw) : new Date(raw + "T00:00:00");
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

/** Garante que a soma das larguras = CW (evita cortar a última coluna). */
function normalizeWidths(widths) {
  const list = (widths || []).map((w) => Math.max(0, Number(w) || 0));
  if (list.length === 0) return list;
  const sum = list.reduce((a, b) => a + b, 0);
  if (sum <= 0) return list.map(() => CW / list.length);
  if (Math.abs(sum - CW) < 0.05) return list;
  const scale = CW / sum;
  const scaled = list.map((w) => w * scale);
  // Corrige arredondamento na última coluna
  const adj = CW - scaled.reduce((a, b) => a + b, 0);
  scaled[scaled.length - 1] += adj;
  return scaled;
}

/**
 * Calcula larguras com base no maior texto de cada coluna (cabeçalho + células).
 * Espaço sobrando vai para a coluna flexível (padrão: índice 1 = produto).
 */
function autoFitColWidths(doc, headers, rows, totalsRow, opts = {}) {
  const dataFs = opts.dataFs ?? 7.5;
  const hdrFs = opts.hdrFs ?? 6.5;
  const pad = opts.pad ?? 2.5;
  const flexIndex = opts.flexIndex ?? 1;
  const minWidths = opts.minWidths || headers.map(() => 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(hdrFs);
  const measured = headers.map((h, i) =>
    Math.max(minWidths[i] || 12, doc.getTextWidth(String(h || "")) + pad)
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(dataFs);
  (rows || []).forEach((row) => {
    row.forEach((cell, i) => {
      const w = doc.getTextWidth(String(cell != null ? cell : "")) + pad;
      if (w > measured[i]) measured[i] = w;
    });
  });
  if (totalsRow) {
    doc.setFont("helvetica", "bold");
    totalsRow.forEach((cell, i) => {
      if (!cell) return;
      const w = doc.getTextWidth(String(cell)) + pad;
      if (w > measured[i]) measured[i] = w;
    });
  }

  const sum = measured.reduce((a, b) => a + b, 0);
  if (sum < CW && flexIndex >= 0 && flexIndex < measured.length) {
    measured[flexIndex] += CW - sum;
    return measured;
  }
  return normalizeWidths(measured);
}

function addTable(doc, y, headers, rows, colWidths, totalsRow, opts = {}) {
  const dataFs = opts.dataFs ?? 8.5;
  const hdrFs = opts.hdrFs ?? 7.5;
  const widths = normalizeWidths(
    colWidths || headers.map(() => CW / headers.length)
  );

  const cellCenterX = (x, w) => x + w / 2;

  const fitText = (text, colW, fontSize, fontStyle = "normal") => {
    const raw = String(text != null ? text : "-");
    const availW = Math.max(2, colW - 2.2);
    let fs = fontSize;
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(fs);
    if (doc.getTextWidth(raw) <= availW) return { text: raw, fontSize: fs };
    while (fs > 5.5) {
      fs -= 0.5;
      doc.setFontSize(fs);
      if (doc.getTextWidth(raw) <= availW) return { text: raw, fontSize: fs };
    }
    let t = raw;
    while (t.length > 1 && doc.getTextWidth(`${t}…`) > availW) {
      t = t.slice(0, -1);
    }
    return { text: `${t}…`, fontSize: fs };
  };

  const drawCellText = (value, x, w, yy, rowH, fontSize, fontStyle, color) => {
    const fitted = fitText(value, w, fontSize, fontStyle);
    setColor(doc, color);
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(fitted.fontSize);
    doc.text(fitted.text, cellCenterX(x, w), yy + rowH / 2, {
      align: "center",
      baseline: "middle",
    });
  };

  const drawHeader = (yy) => {
    const h = 8;
    setFill(doc, BLUE_DARK);
    doc.rect(M, yy, CW, h, "F");
    let x = M;
    headers.forEach((header, i) => {
      drawCellText(header, x, widths[i], yy, h, hdrFs, "bold", [255, 255, 255]);
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
  setColor(doc, BLACK);

  rows.forEach((r, ri) => {
    const rowH = 7.5;
    if (y + rowH > PH - 28) {
      doc.addPage();
      y = 20;
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
    r.forEach((c, i) => {
      drawCellText(c, x, widths[i], y, rowH, dataFs, "normal", BLACK);
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
    let x = M;
    totalsRow.forEach((c, i) => {
      if (c != null && String(c) !== "") {
        drawCellText(c, x, widths[i], y, rowH, dataFs, "bold", BLUE_DARK);
      }
      x += widths[i];
    });
    y += rowH;
  }

  setColor(doc, BLACK);
  return y + 4;
}

function buildComposicaoRows(vasilhame) {
  const seeded = seedComposicaoFromVasilhame(vasilhame);
  const agg = aggregateComposicaoByLote(seeded);
  if (agg.length > 0) {
    return agg.map((c) => ({
      lote: c.lote || "-",
      volume: roundVolume(c.quantidade_l || 0),
      massa: roundMass(c.quantidade_kg || 0),
      data: getLoteEnvaseDate(c),
    }));
  }
  return [
    {
      lote: vasilhame.lote || "-",
      volume: roundVolume(vasilhame.volume || 0),
      massa: roundMass(vasilhame.peso_liquido || 0),
      data: vasilhame.created_at || vasilhame.created_date || null,
    },
  ];
}

/**
 * Relatório Fiscal da embalagem (A4).
 * Layout alinhado aos relatórios fiscais do ChemCtrl.
 */
export function generateRelatorioFiscalPDF(vasilhame) {
  if (!vasilhame) return;

  const doc = new jsPDF({ format: "a4" });
  const placa = vasilhame.placa || "-";
  const produto = vasilhame.produto_nome || "-";
  const title =
    placa !== "-"
      ? `${placa}${produto !== "-" ? " - " + produto : ""}`
      : produto !== "-"
        ? produto
        : "Relatório Fiscal";

  const regId =
    vasilhame.codigo != null && vasilhame.codigo !== ""
      ? String(vasilhame.codigo)
      : "-";
  const lote =
    getDominantLote(vasilhame.composicao) || vasilhame.lote || "-";

  let y = addPageTitle(doc, title, "Relatório Fiscal da Embalagem");
  y = addInfoGrid(
    doc,
    y,
    [
      ["ID Registro", regId],
      ["N Placa", placa],
      ["N Barril", vasilhame.barril || "-"],
      ["Código", vasilhame.produto_codigo || "-"],
      ["Produto", produto],
      ["Cliente", vasilhame.cliente_nome || "-"],
      ["Nº OP", vasilhame.numero_op || "-"],
      ["Lote", lote],
      ["Eslinga", vasilhame.eslinga || "-"],
      ["Volume", fmtNum(vasilhame.volume, 0) + " L"],
      ["Peso Líquido", fmtNum(vasilhame.peso_liquido, 0) + " kg"],
      ["Peso Bruto", fmtNum(vasilhame.peso_bruto, 0) + " kg"],
      ["Tara", fmtNum(vasilhame.tara, 0) + " kg"],
      [
        "Densidade",
        vasilhame.densidade != null && vasilhame.densidade !== ""
          ? String(vasilhame.densidade)
          : "-",
      ],
      ["Responsável", vasilhame.responsavel || "-"],
    ],
    3
  );

  const composicao = buildComposicaoRows(vasilhame);
  const totalVol = composicao.reduce((s, c) => s + (c.volume || 0), 0);
  const totalMass = composicao.reduce((s, c) => s + (c.massa || 0), 0);

  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, "Composição por Lote");

  const headers = ["LOTE", "VOLUME (L)", "MASSA (KG)", "DATA DE ENVASE"];
  const rows = composicao.map((c) => [
    c.lote || "-",
    fmtNum(c.volume, 0),
    fmtNum(c.massa, 0),
    fmtDate(c.data),
  ]);
  const totalsRow = [
    "TOTAL",
    fmtNum(totalVol, 0) + " L",
    fmtNum(totalMass, 0) + " kg",
    "",
  ];
  y = addTable(doc, y, headers, rows, [55, 40, 40, 47], totalsRow);

  addFooter(doc);

  const fileBase =
    safePdfFilenamePart(placa) ||
    safePdfFilenamePart(vasilhame.codigo) ||
    "embalagem";
  doc.save(`${fileBase} - Relatório Fiscal.pdf`);
}

/**
 * Monta linhas de lote a partir do vasilhame (composição / mistura).
 * Uma linha por lote. Se o volume solicitado for parcial, proporcionaliza.
 */
function buildSaidaConvencionalLoteRows(item, vasilhame) {
  const codigo = item.produto_codigo || vasilhame?.produto_codigo || "-";
  const produto = item.produto_nome || vasilhame?.produto_nome || "-";
  const embalagem = `${item.vasilhame_placa || vasilhame?.placa || "—"} - ${
    item.vasilhame_barril || vasilhame?.barril || "—"
  }`;
  const tara = roundMass(vasilhame?.tara ?? item.tara ?? 0);
  const volumeAlvo = roundVolume(item.volume_solicitado || 0);

  const source = vasilhame
    ? {
        ...vasilhame,
        // Se já expedido (volume 0), reconstrói a partir da composição ou do snapshot da saída
        volume:
          (vasilhame.volume || 0) > 0
            ? vasilhame.volume
            : volumeAlvo ||
              roundVolume(
                (vasilhame.composicao || []).reduce(
                  (s, c) => s + (c.quantidade_l || 0),
                  0
                )
              ),
        peso_liquido:
          (vasilhame.peso_liquido || 0) > 0
            ? vasilhame.peso_liquido
            : item.peso_liquido || 0,
        lote: vasilhame.lote || item.lote || "",
      }
    : {
        volume: volumeAlvo,
        peso_liquido: item.peso_liquido || 0,
        lote: item.lote || "",
        composicao: [],
        densidade:
          volumeAlvo > 0 && item.peso_liquido
            ? item.peso_liquido / volumeAlvo
            : 0,
      };

  const composicao = buildComposicaoRows(source).filter((c) => (c.volume || 0) > 0);
  if (composicao.length === 0) {
    return [
      {
        codigo,
        produto,
        embalagem,
        lote: item.lote || "-",
        volume: volumeAlvo,
        massa: roundMass(item.peso_liquido || item.quantidade_solicitada || 0),
        tara,
      },
    ];
  }

  const totalVol = composicao.reduce((s, c) => s + (c.volume || 0), 0);
  const scale =
    volumeAlvo > 0 && totalVol > 0 && Math.abs(volumeAlvo - totalVol) > 0.5
      ? volumeAlvo / totalVol
      : 1;

  return composicao.map((c) => ({
    codigo,
    produto,
    embalagem,
    lote: c.lote || "-",
    volume: roundVolume((c.volume || 0) * scale),
    massa: roundMass((c.massa || 0) * scale),
    tara,
  }));
}

function buildSaidaEmbaladoRow(item, entrada) {
  return {
    codigo: item.produto_codigo || entrada?.produto_codigo || "-",
    produto: item.produto_nome || entrada?.produto_nome || "-",
    lote: item.lote || entrada?.lote || "-",
    qtdEmbalagens: item.quantidade_embalagens ?? 0,
    total: roundMass(item.quantidade_solicitada || 0),
    unidade: entrada?.unidade_medida || item.unidade_medida || "kg",
  };
}

/**
 * Relatório Fiscal da Saída (A4) — mesmo modelo visual do Relatório Fiscal.
 * Tabelas separadas por tipo (Embalado / Convencional), só quando houver itens.
 */
export function generateRelatorioFiscalSaidaPDF(
  saida,
  { vasilhames = [], entradas = [] } = {}
) {
  if (!saida) return;

  const doc = new jsPDF({ format: "a4" });
  const codigo = saida.codigo || "-";
  const title = codigo !== "-" ? `Saída ${codigo}` : "Relatório Fiscal — Saída";

  let y = addPageTitle(doc, title, "Relatório Fiscal da Saída");
  y = addInfoGrid(
    doc,
    y,
    [
      ["Código", codigo],
      ["Cliente", saida.cliente_nome || "-"],
      ["Solicitante", saida.usuario_criador || "-"],
      ["Data Solicitação", fmtDate(saida.data_solicitacao)],
      ["Data Programada", fmtDate(saida.data_programada)],
      [
        "Status",
        saida.status === "enviado_fiscal" ? "Enviado ao Fiscal" : "Aguardando",
      ],
      ["Qtd. Total", fmtNum(saida.quantidade_total, 0) + " kg"],
      ["Responsável", saida.usuario_responsavel || "-"],
      ["Observações", saida.observacoes || "-", 3],
    ],
    3
  );

  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));
  const entradaById = new Map((entradas || []).map((e) => [e.id, e]));

  const embaladoRows = [];
  const convencionalRows = [];

  (saida.itens || []).forEach((item) => {
    if (item.tipo === "embalado") {
      const entrada = item.entrada_id ? entradaById.get(item.entrada_id) : null;
      embaladoRows.push(buildSaidaEmbaladoRow(item, entrada));
      return;
    }
    const v = item.vasilhame_id ? vasilhameById.get(item.vasilhame_id) : null;
    convencionalRows.push(...buildSaidaConvencionalLoteRows(item, v));
  });

  const tableOpts = { dataFs: 7.2, hdrFs: 6.2 };

  const drawTypedTable = (sectionTitle, headers, rows, totalsRow, minWidths) => {
    if (!rows.length) return;
    y = ensureSpace(doc, y, 36);
    y = addSectionTitle(doc, y, sectionTitle);
    const colWidths = autoFitColWidths(doc, headers, rows, totalsRow, {
      ...tableOpts,
      flexIndex: 1,
      minWidths,
      pad: 2.2,
    });
    y = addTable(doc, y, headers, rows, colWidths, totalsRow, tableOpts);
    y += 4;
  };

  if (embaladoRows.length > 0) {
    const headers = [
      "CÓDIGO",
      "PRODUTO",
      "LOTE",
      "QTD EMBALAGENS",
      "TOTAL",
      "UNIDADE",
    ];
    const rows = embaladoRows.map((r) => [
      r.codigo || "-",
      r.produto || "-",
      r.lote || "-",
      fmtNum(r.qtdEmbalagens, 1),
      fmtNum(r.total, 0),
      r.unidade || "kg",
    ]);
    const totalEmb = embaladoRows.reduce(
      (s, r) => s + (Number(r.qtdEmbalagens) || 0),
      0
    );
    const totalMass = embaladoRows.reduce((s, r) => s + (r.total || 0), 0);
    const unidade =
      embaladoRows.length === 1
        ? embaladoRows[0].unidade || "kg"
        : [...new Set(embaladoRows.map((r) => r.unidade || "kg"))].length === 1
          ? embaladoRows[0].unidade || "kg"
          : "";
    const totalsRow = [
      "TOTAL",
      "",
      "",
      fmtNum(totalEmb, 1),
      fmtNum(totalMass, 0),
      unidade,
    ];
    drawTypedTable(
      "Itens Embalados (Devolução Fiscal)",
      headers,
      rows,
      totalsRow,
      [18, 36, 22, 24, 20, 18]
    );
  }

  if (convencionalRows.length > 0) {
    const headers = [
      "CÓDIGO",
      "PRODUTO",
      "EMBALAGEM",
      "LOTE",
      "VOLUME (L)",
      "MASSA (KG)",
      "TARA (KG)",
    ];
    const rows = convencionalRows.map((r) => [
      r.codigo || "-",
      r.produto || "-",
      r.embalagem || "-",
      r.lote || "-",
      fmtNum(r.volume, 0),
      fmtNum(r.massa, 0),
      fmtNum(r.tara, 0),
    ]);
    const totalVol = convencionalRows.reduce((s, r) => s + (r.volume || 0), 0);
    const totalMass = convencionalRows.reduce((s, r) => s + (r.massa || 0), 0);
    const totalsRow = [
      "TOTAL",
      "",
      "",
      "",
      fmtNum(totalVol, 0) + " L",
      fmtNum(totalMass, 0) + " kg",
      "",
    ];
    drawTypedTable(
      "Itens Convencionais (Devolução Fiscal)",
      headers,
      rows,
      totalsRow,
      [16, 30, 28, 18, 18, 18, 16]
    );
  }

  addFooter(doc);

  const fileBase = safePdfFilenamePart(codigo) || "saida";
  doc.save(`${fileBase} - Relatório Fiscal.pdf`);
}
