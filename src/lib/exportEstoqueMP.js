import ExcelJS from 'exceljs';
import moment from 'moment';

/**
 * Exporta itens de estoque de matéria-prima para um arquivo .xlsx formatado.
 * @param {Array} items - Itens filtrados exibidos na tela
 */
export async function exportEstoqueMPToExcel(items) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ChemCtrl';
  wb.created = new Date();

  const ws = wb.addWorksheet('Estoque MP', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headers = ['COD. MP', 'MP', 'CLIENTE', 'LOTE', 'SALDO ATUAL', 'UNID.', 'VALIDADE'];
  ws.columns = [
    { header: headers[0], key: 'mp_code', width: 14 },
    { header: headers[1], key: 'mp_name', width: 36 },
    { header: headers[2], key: 'client', width: 22 },
    { header: headers[3], key: 'lot', width: 18 },
    { header: headers[4], key: 'current_stock', width: 16 },
    { header: headers[5], key: 'unit', width: 10 },
    { header: headers[6], key: 'expiry_date', width: 14 },
  ];

  // Cabeçalho: negrito, fundo azul do sistema, fonte branca
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2575D1' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 22;

  items.forEach(item => {
    const row = ws.addRow({
      mp_code: item.mp_code || '',
      mp_name: item.mp_name || '',
      client: item.client || '',
      lot: item.lot || '',
      current_stock: item.current_stock ?? 0,
      unit: item.unit || '',
      expiry_date: item.expiry_date
        ? moment(item.expiry_date).format('DD/MM/YYYY')
        : '',
    });
    // Saldo Atual como número com casas decimais
    const saldoCell = row.getCell(5);
    saldoCell.numFmt = '#,##0.00##';
    saldoCell.alignment = { horizontal: 'right' };
  });

  // AutoFiltro em todas as colunas
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  // Gerar arquivo
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fileName = `Estoque_MP_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.xlsx`;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
