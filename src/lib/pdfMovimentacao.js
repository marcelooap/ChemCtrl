import { jsPDF } from 'jspdf';
import { fmtNum, fmtDate } from '@/lib/pdfReports.js';

const M = 14;
const PW = 210;
const PH = 297;
const CW = PW - 2 * M;
const BLUE_DARK  = [28, 53, 91];
const BLUE_MID   = [37, 99, 195];
const GRAY_LABEL = [130, 140, 155];
const GRAY_ROW   = [248, 249, 251];
const GRAY_BORDER= [220, 224, 230];
const BLACK      = [30, 30, 30];

function setColor(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }
function setFill(doc, rgb)  { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setDraw(doc, rgb)  { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }

function addPageTitle(doc, title, subtitle) {
  doc.setFontSize(22); doc.setFont('helvetica', 'bold'); setColor(doc, BLUE_DARK);
  doc.text(title, M, 22);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
  doc.text(subtitle || '', M, 29);
  setDraw(doc, BLUE_MID); doc.setLineWidth(0.6); doc.line(M, 33, PW - M, 33); doc.setLineWidth(0.2);
  return 44;
}

function addFooter(doc) {
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    setDraw(doc, GRAY_BORDER); doc.setLineWidth(0.3); doc.line(M, PH - 13, PW - M, PH - 13);
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
    doc.text('ChemCtrl - Sistema de Controle de Producao', M, PH - 8);
    doc.text('Pagina ' + i + ' de ' + pages, PW - M, PH - 8, { align: 'right' });
  }
}

function addSectionTitle(doc, y, title) {
  setFill(doc, BLUE_MID); doc.rect(M, y, 2.5, 7, 'F');
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); setColor(doc, BLUE_DARK);
  doc.text(title, M + 5, y + 5.5); setColor(doc, BLACK);
  return y + 11;
}

function addInfoGrid(doc, y, pairs, cols) {
  cols = cols || 3;
  const colW = CW / cols;
  const rowsData = [];
  let currentRow = [];
  let usedCols = 0;
  for (const p of pairs) {
    const span = p[2] || 1;
    if (usedCols + span > cols && currentRow.length > 0) { rowsData.push(currentRow); currentRow = []; usedCols = 0; }
    currentRow.push({ label: p[0], value: p[1], span });
    usedCols += span;
    if (usedCols >= cols) { rowsData.push(currentRow); currentRow = []; usedCols = 0; }
  }
  if (currentRow.length > 0) rowsData.push(currentRow);

  const rowHeights = rowsData.map(function(row) {
    let maxH = 14;
    row.forEach(function(cell) {
      const lines = doc.splitTextToSize(String(cell.value != null ? cell.value : '-'), colW * cell.span - 6);
      const textH = 5 + lines.length * 4.5 + 4;
      if (textH > maxH) maxH = textH;
    });
    return maxH;
  });
  const totalH = rowHeights.reduce(function(a, b) { return a + b; }, 0);
  setDraw(doc, GRAY_BORDER); doc.setLineWidth(0.3); doc.rect(M, y, CW, totalH);

  let yy = y;
  rowsData.forEach(function(row, ri) {
    const rowH = rowHeights[ri];
    let x = M;
    row.forEach(function(cell) {
      const cellW = colW * cell.span;
      if (x > M) { setDraw(doc, GRAY_BORDER); doc.setLineWidth(0.3); doc.line(x, yy, x, yy + rowH); }
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
      doc.text(String(cell.label).toUpperCase(), x + 3, yy + 4.5);
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
      const lines = doc.splitTextToSize(String(cell.value != null ? cell.value : '-'), cellW - 6);
      doc.text(lines, x + 3, yy + 10);
      x += cellW;
    });
    if (ri < rowsData.length - 1) { setDraw(doc, GRAY_BORDER); doc.setLineWidth(0.3); doc.line(M, yy + rowH, M + CW, yy + rowH); }
    yy += rowH;
  });
  setColor(doc, BLACK);
  return y + totalH + 5;
}

export function generateMovimentacaoPDF(item, movement) {
  const doc = new jsPDF();
  const unit = item.unit || movement.unit || '';
  const dateStr = movement.movement_date
    ? new Date(movement.movement_date).toLocaleDateString('pt-BR')
    : 'sem-data';
  let y = addPageTitle(doc, 'Movimentacao - ' + (item.mp_name || ''), 'Relatorio de Movimentacao de Materia Prima - ' + dateStr);
  y = addSectionTitle(doc, y, 'Dados da Materia Prima');
  y = addInfoGrid(doc, y, [
    ['ID Registro', item.entry_id || '-'],
    ['Data de Entrada', fmtDate(item.entry_date)],
    ['Codigo MP', item.mp_code || '-'],
    ['Nome', item.mp_name || '-'],
    ['Cliente', item.client || '-'],
    ['Lote', item.lot || '-'],
    ['Fornecedor', item.supplier || '-'],
    ['Unidade', unit || '-'],
    ['Data Fabricacao', fmtDate(item.manufacture_date)],
    ['Data Validade', fmtDate(item.expiry_date)],
    ['Tipo de Embalagem', item.packaging_type || '-'],
    ['Capacidade Embalagem', item.packaging_capacity ? (fmtNum(item.packaging_capacity, 3) + ' kg') : '-'],
    ['Qtd. de Embalagens', fmtNum(item.packaging_quantity, 1)],
    ['Estoque Inicial', fmtNum(item.initial_stock, 3) + ' ' + unit],
    ['Saldo Atual', fmtNum(item.current_stock, 3) + ' ' + unit],
    ['Preco Unitario (R$)', (item.unit_price || 0).toFixed(4)],
  ], 3);
  y = addSectionTitle(doc, y, 'Dados da Movimentacao');
  y = addInfoGrid(doc, y, [
    ['Produto', item.mp_name || '-'],
    ['Cliente', item.client || '-'],
    ['Lote', item.lot || '-'],
    ['Destino', movement.destination || '-'],
    ['Quantidade de Baixa (' + unit + ')', fmtNum(movement.quantity, 3) + ' ' + unit],
    ['Estoque Final (' + unit + ')', fmtNum(movement.balance_after, 3) + ' ' + unit],
    ['Observacoes', movement.observations || '-', 3],
  ], 3);
  addFooter(doc);
  const safeName = (item.mp_name || 'mp').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  doc.save('movimentacao-' + safeName + '-' + dateStr.replace(/\//g, '-') + '.pdf');
}
