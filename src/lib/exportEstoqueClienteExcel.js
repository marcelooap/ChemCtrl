import ExcelJS from 'exceljs';
import i18n from '@/i18n';

export async function exportEstoqueClienteExcel({
  client,
  stocks,
  containers,
  recipes = [],
}) {
  const codeByProduct = {};

  recipes.forEach((recipe) => {
    if (recipe.product_name && recipe.code) {
      codeByProduct[recipe.product_name] = recipe.code;
    }
  });

  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet(i18n.t('clients.export.sheetName'), {
    properties: {
      defaultColWidth: 18,
    },
    views: [
      {
        state: "frozen",
        ySplit: 1,
      },
    ],
  });

  const headers = [
    i18n.t('clients.export.columns.code'),
    i18n.t('clients.export.columns.product'),
    i18n.t('clients.export.columns.lot'),
    i18n.t('clients.export.columns.stockQty'),
    i18n.t('clients.export.columns.unit'),
    i18n.t('clients.export.columns.packaging'),
    i18n.t('clients.export.columns.storageType'),
  ];

  const headerRow = ws.addRow(headers);

  headerRow.font = {
    bold: true,
    color: {
      argb: "FFFFFFFF",
    },
  };

  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: "FF2575D1",
    },
  };

  headerRow.alignment = {
    vertical: "middle",
    horizontal: "center",
  };

  headerRow.height = 22;

  // Matérias-primas
  stocks.forEach((stock) => {
    ws.addRow([
      stock.mp_code || "—",
      stock.mp_name || "—",
      stock.lot || "—",
      stock.current_stock || 0,
      stock.unit || "—",
      stock.packaging_type || "—",
      "Matéria Prima",
    ]);
  });

  // Produtos acabados
  containers.forEach((container) => {
    const embalagem = container.barril_number
      ? `${container.container_number || ""} (${container.barril_number})`
      : container.container_number || "—";

    ws.addRow([
      codeByProduct[container.product] || "—",
      container.product || "—",
      container.lot || "—",
      container.volume || 0,
      "L",
      embalagem,
      "Produto Acabado",
    ]);
  });

  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);

    row.alignment = {
      vertical: "middle",
    };

    row.height = 18;

    if (i % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: "FFF3F4F6",
        },
      };
    }
  }

  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 36;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 24;
  ws.getColumn(7).width = 20;

  const fileName = `estoque_cliente_${client
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toLowerCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`;

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
}
