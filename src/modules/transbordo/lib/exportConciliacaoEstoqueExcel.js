/**
 * Exportação sob demanda da conciliação ChemCtrl × Proteus.
 * ExcelJS é carregado só quando o usuário baixa o resultado.
 */
import {
  mergeDuplicateLotRows,
  sortConciliacaoRows,
} from "@transbordo/lib/conciliacaoEstoque";


const HEADER_FILL = {
  base: "FF5B9BD5", // Código / Produto / Cliente / Lote
  chemCtrl: "FF2F5496", // Saldo ChemCtrl (azul mais forte)
  proteus: "FFED7D31", // Saldo Proteus (laranja)
  diff: "FF808080", // Diferença (cinza)
};

const HEADER_COLORS = [
  HEADER_FILL.base,
  HEADER_FILL.base,
  HEADER_FILL.base,
  HEADER_FILL.base,
  HEADER_FILL.chemCtrl,
  HEADER_FILL.proteus,
  HEADER_FILL.diff,
];

/** Formato numérico PT-BR com 3 casas (exibe 1.000,000 no Excel em português). */
const NUM_FMT_PT_BR = "#,##0.000";

const CENTER_MIDDLE = {
  vertical: "middle",
  horizontal: "center",
  wrapText: false,
};

/** Nome: Consolidado dd-mm-aa hhmm (':' trocado por 'h' — inválido no Windows). */
function formatConsolidadoFileName(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const aa = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `Consolidado ${dd}-${mm}-${aa} ${hh}h${min}.xlsx`;
}

function solidFill(argb) {
  return {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb },
  };
}

function applyDifferenceStyle(cell, value) {
  if (value == null || value === "") return;
  if (value > 0) {
    cell.font = { color: { argb: "FF166534" }, bold: true };
  } else if (value < 0) {
    cell.font = { color: { argb: "FFB91C1C" }, bold: true };
  } else {
    cell.font = { color: { argb: "FF6B7280" } };
  }
}

export async function exportConciliacaoEstoqueExcel(rows = [], options = {}) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Conciliação", {
    properties: { defaultColWidth: 16 },
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = [
    "Código",
    "Produto",
    "Cliente",
    "Lote",
    "Saldo ChemCtrl",
    "Saldo Proteus",
    "Diferença",
  ];

  const headerRow = ws.addRow(headers);
  headerRow.height = 22;

  // Pinta somente as colunas com informação (não a linha inteira)
  for (let col = 1; col <= headers.length; col++) {
    const cell = headerRow.getCell(col);
    cell.value = headers[col - 1];
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = solidFill(HEADER_COLORS[col - 1]);
    cell.alignment = { ...CENTER_MIDDLE };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD0D0D0" } },
      left: { style: "thin", color: { argb: "FFD0D0D0" } },
      bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
      right: { style: "thin", color: { argb: "FFD0D0D0" } },
    };
  }

  // Rede final: unificar lotes que só diferem por zero à esquerda
  const dataRows = sortConciliacaoRows(mergeDuplicateLotRows(rows));

  for (const item of dataRows) {
    const saldoChem =
      item.saldoChemCtrl == null ? 0 : Number(item.saldoChemCtrl);
    const saldoProt =
      item.saldoProteus == null ? 0 : Number(item.saldoProteus);
    const diff =
      item.diferenca == null
        ? Number((saldoChem - saldoProt).toFixed(3))
        : Number(item.diferenca);

    const row = ws.addRow([
      String(item.codigo ?? ""),
      item.produto ?? "",
      item.cliente ?? "",
      item.lote ?? "",
      saldoChem,
      saldoProt,
      diff,
    ]);

    row.height = 18;

    for (let col = 1; col <= headers.length; col++) {
      const cell = row.getCell(col);
      cell.alignment = { ...CENTER_MIDDLE };

      if (col === 1) {
        cell.value = String(item.codigo ?? "");
        cell.numFmt = "@";
      }

      // Saldo ChemCtrl / Saldo Proteus / Diferença
      if (col >= 5) {
        cell.value = Number(cell.value) || 0;
        cell.numFmt = NUM_FMT_PT_BR;
      }
    }

    applyDifferenceStyle(row.getCell(7), diff);
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, ws.rowCount), column: headers.length },
  };

  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 36;
  ws.getColumn(3).width = 28;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 16;
  ws.getColumn(7).width = 14;

  const fileName = options.fileName || formatConsolidadoFileName();

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  return fileName;
}
