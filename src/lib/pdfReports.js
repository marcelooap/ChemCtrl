import { jsPDF } from 'jspdf';
// eslint-disable-next-line
import { getSignedFileUrl } from '@/api/storage'; // storage module (split from supabaseClient)

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

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

export function fmtNum(n, decimals = 0) {
  return (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function fmtDate(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '-'; }
}
export function fmtMoney(n) {
  return (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ensureSpace(doc, y, needed) {
  if (y + needed > PH - 20) { doc.addPage(); return 20; }
  return y;
}

function fmtDateTime(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '-'; }
}

function addPageTitle(doc, title, subtitle) {
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BLUE_DARK);
  doc.text(title, M, 22);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY_LABEL);
  doc.text(subtitle || '', M, 29);
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
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY_LABEL);
    doc.text('ChemCtrl - Sistema de Controle de Producao', M, PH - 8);
    doc.text('Pagina ' + i + ' de ' + pages, PW - M, PH - 8, { align: 'right' });
  }
}

function addSectionTitle(doc, y, title) {
  setFill(doc, BLUE_MID);
  doc.rect(M, y, 2.5, 7, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BLUE_DARK);
  doc.text(title, M + 5, y + 5.5);
  setColor(doc, BLACK);
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

  const rowHeights = rowsData.map(function(row) {
    let maxH = 14;
    row.forEach(function(cell) {
      const cellW = colW * cell.span - 6;
      const lines = doc.splitTextToSize(String(cell.value != null ? cell.value : '-'), cellW);
      const textH = 5 + lines.length * 4.5 + 4;
      if (textH > maxH) maxH = textH;
    });
    return maxH;
  });
  const totalH = rowHeights.reduce(function(a, b) { return a + b; }, 0);

  setDraw(doc, GRAY_BORDER);
  doc.setLineWidth(0.3);
  doc.rect(M, y, CW, totalH);

  let yy = y;
  rowsData.forEach(function(row, ri) {
    const rowH = rowHeights[ri];
    let x = M;
    row.forEach(function(cell) {
      const cellW = colW * cell.span;
      if (x > M) {
        setDraw(doc, GRAY_BORDER);
        doc.setLineWidth(0.3);
        doc.line(x, yy, x, yy + rowH);
      }
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      setColor(doc, GRAY_LABEL);
      doc.text(String(cell.label).toUpperCase(), x + 3, yy + 4.5);
      if (cell.value && typeof cell.value === 'object' && cell.value.__badge) {
        drawStatusBadge(doc, x + 3, yy + 11, cell.value.status);
      } else {
        doc.setFontSize(9.5);
        doc.setFont('helvetica', 'bold');
        setColor(doc, BLACK);
        const lines = doc.splitTextToSize(String(cell.value != null ? cell.value : '-'), cellW - 6);
        doc.text(lines, x + 3, yy + 10);
      }
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

function drawDiffArrow(doc, x, cellY, cellH, dir, color) {
  setFill(doc, color);
  const sz = 2.2;
  const cx = x + 2.5;
  const cy = cellY + cellH / 2;
  if (dir === 'up') {
    doc.triangle(cx - sz, cy + sz / 2, cx + sz, cy + sz / 2, cx, cy - sz, 'F');
  } else {
    doc.triangle(cx - sz, cy - sz / 2, cx + sz, cy - sz / 2, cx, cy + sz, 'F');
  }
}

function addTable(doc, y, headers, rows, colWidths, totalsRow, wrapCols, options) {
  const opts = options || {};
  const dataFs = opts.dataFontSize || 8.5;
  const hdrFs = opts.headerFontSize || 7.5;
  const colorFn = opts.coloredCols || null;
  const vLines = opts.verticalLines || false;
  const widths = colWidths || headers.map(function() { return CW / headers.length; });
  const wrapSet = new Set(wrapCols || []);
  const charW = dataFs * 0.182;

  const drawHeader = function(yy) {
    setFill(doc, BLUE_DARK);
    doc.rect(M, yy, CW, 8, 'F');
    doc.setFontSize(hdrFs);
    doc.setFont('helvetica', 'bold');
    setColor(doc, [255, 255, 255]);
    let x = M;
    headers.forEach(function(h, i) {
      doc.text(h, x + 2.5, yy + 5.5);
      x += widths[i];
    });
    return yy + 8;
  };

  const drawVLines = function(yy, h) {
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
  doc.setFont('helvetica', 'normal');
  setColor(doc, BLACK);

  rows.forEach(function(r, ri) {
    let rowH = 7.5;
    if (wrapSet.size > 0) {
      r.forEach(function(c, i) {
        if (wrapSet.has(i)) {
          doc.setFontSize(dataFs);
          doc.setFont('helvetica', 'normal');
          const lines = doc.splitTextToSize(String(c != null ? c : '-'), widths[i] - 5);
          const neededH = lines.length * 4 + 3.5;
          if (neededH > rowH) rowH = neededH;
        }
      });
    }
    if (y + rowH > PH - 28) {
      doc.addPage();
      y = 20;
      y = drawHeader(y);
      doc.setFontSize(dataFs);
      doc.setFont('helvetica', 'normal');
      setColor(doc, BLACK);
    }
    if (ri % 2 === 0) {
      setFill(doc, GRAY_ROW);
      doc.rect(M, y, CW, rowH, 'F');
    }
    if (colorFn) {
      let xOff = M;
      r.forEach(function(c, i) {
        const colors = colorFn(ri, i, c, r);
        if (colors && colors.fill) {
          setFill(doc, colors.fill);
          doc.rect(xOff, y, widths[i], rowH, 'F');
        }
        xOff += widths[i];
      });
    }
    if (vLines) drawVLines(y, rowH);
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.15);
    doc.line(M, y + rowH, M + CW, y + rowH);
    let x = M;
    r.forEach(function(c, i) {
      const text = String(c != null ? c : '-');
      const colors = colorFn ? colorFn(ri, i, c, r) : null;
      doc.setFontSize(dataFs);
      if (colors) {
        setColor(doc, colors.text);
        doc.setFont('helvetica', 'bold');
        if (colors.arrow) drawDiffArrow(doc, x + 1, y, rowH, colors.arrow, colors.text);
      } else {
        setColor(doc, BLACK);
        doc.setFont('helvetica', 'normal');
      }
      const hasArrow = colors && colors.arrow;
      const availW = hasArrow ? widths[i] - 8 : widths[i] - 5;
      const tx = hasArrow ? x + 6 : x + 2.5;
      if (wrapSet.has(i)) {
        const lines = doc.splitTextToSize(text, availW);
        doc.text(lines, tx, y + 4.5);
      } else {
        const maxChars = Math.floor(availW / charW);
        doc.text(text.length > maxChars ? text.substring(0, maxChars) + '...' : text, tx, y + 5.2);
      }
      x += widths[i];
    });
    y += rowH;
  });

  if (totalsRow) {
    if (y + 8 > PH - 28) {
      doc.addPage();
      y = 20;
    }
    setFill(doc, [235, 240, 250]);
    doc.rect(M, y, CW, 8, 'F');
    if (colorFn) {
      let xOff = M;
      totalsRow.forEach(function(c, i) {
        const colors = colorFn(-1, i, c, totalsRow);
        if (colors && colors.fill) {
          setFill(doc, colors.fill);
          doc.rect(xOff, y, widths[i], 8, 'F');
        }
        xOff += widths[i];
      });
    }
    if (vLines) drawVLines(y, 8);
    setDraw(doc, BLUE_MID);
    doc.setLineWidth(0.4);
    doc.line(M, y, M + CW, y);
    doc.setLineWidth(0.2);
    doc.setFontSize(dataFs);
    doc.setFont('helvetica', 'bold');
    let x = M;
    totalsRow.forEach(function(c, i) {
      const text = String(c != null ? c : '');
      const colors = colorFn ? colorFn(-1, i, c, totalsRow) : null;
      if (colors) {
        setColor(doc, colors.text);
        if (colors.arrow) drawDiffArrow(doc, x + 1, y, 8, colors.arrow, colors.text);
      } else {
        setColor(doc, BLUE_DARK);
      }
      const hasArrow = colors && colors.arrow;
      const availW = hasArrow ? widths[i] - 8 : widths[i] - 5;
      const tx = hasArrow ? x + 6 : x + 2.5;
      const maxChars = Math.floor(availW / charW);
      doc.text(text.length > maxChars ? text.substring(0, maxChars) + '...' : text, tx, y + 5.5);
      x += widths[i];
    });
    y += 8;
  }

  setColor(doc, BLACK);
  return y + 4;
}

const STATUS_COLORS = {
  'Aguardando Inicio': { fill: [243, 244, 246], text: [55, 65, 81] },
  'Em Producao':       { fill: [219, 234, 254], text: [29, 78, 216] },
  'Qualidade':         { fill: [254, 243, 199], text: [146, 64, 14] },
  'Envase':            { fill: [237, 233, 254], text: [91, 33, 182] },
  'Finalizado':        { fill: [220, 252, 231], text: [22, 101, 52] },
  'Cancelado':         { fill: [254, 226, 226], text: [153, 27, 27] },
};

function drawStatusBadge(doc, x, y, status) {
  const colors = STATUS_COLORS[status] || { fill: [243, 244, 246], text: [55, 65, 81] };
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  const textW = doc.getTextWidth(status);
  const padH = 2.5;
  const padV = 1.5;
  const bW = textW + padH * 2;
  const bH = 5.5;
  const r = 2.5;
  setFill(doc, colors.fill);
  setDraw(doc, colors.fill);
  doc.roundedRect(x, y - bH + padV, bW, bH, r, r, 'F');
  setColor(doc, colors.text);
  doc.text(status, x + padH, y);
  setColor(doc, BLACK);
  return bW;
}

export function generateRecipePDF(recipe) {
  const doc = new jsPDF();
  const idLabel = recipe.code ? (recipe.code + ' - ' + recipe.product_name) : recipe.product_name;
  let y = addPageTitle(doc, idLabel, 'Ficha de Formulacao e Especificacao Tecnica');
  y = addInfoGrid(doc, y, [
    ['Codigo Produto', recipe.code || '-'],
    ['Cliente', recipe.client || '-'],
    ['Preco Unitario', 'R$ ' + (recipe.price || 0).toFixed(4)],
    ['Revisao', recipe.revision || '-'],
    ['Data Revisao', recipe.revision_date || '-'],
    ['Densidade PA', (recipe.density || '-') + ' g/mL'],
    ['Validade', (recipe.validity_days || '-') + ' dias'],
  ], 3);
  y = addSectionTitle(doc, y, 'Materias Primas');
  const headers = ['CODIGO MP', 'NOME MP', 'DENS. (G/ML)', '% M/M', 'QTD. (KG)'];
  const mps = recipe.raw_materials || [];
  const rows = mps.map(function(m) {
    return [m.mp_code || '-', m.mp_name || '-', m.mp_density || '-', fmtNum(m.percentage, 2) + '%', fmtNum(m.quantity_kg, 3)];
  });
  const totalPct = mps.reduce(function(s, m) { return s + (m.percentage || 0); }, 0);
  const totalKg  = mps.reduce(function(s, m) { return s + (m.quantity_kg  || 0); }, 0);
  addTable(doc, y, headers, rows, [36, 68, 24, 24, 30], ['Total', '', '', fmtNum(totalPct, 2) + '%', fmtNum(totalKg, 3) + ' kg']);
  addFooter(doc);
  doc.save('receita-' + (recipe.product_name || 'receita').replace(/\s+/g, '-') + '.pdf');
}

export function generateOrderPDF(order, productions, containers) {
  const doc = new jsPDF();
  let y = addPageTitle(doc, 'Pedido ' + (order.order_number || ''), 'Relatorio de Pedido de Producao');
  y = addInfoGrid(doc, y, [
    ['Pedido Interno', order.order_number || '-'],
    ['Data', fmtDate(order.date)],
    ['Status', order.status || '-'],
    ['Produto', order.product || '-'],
    ['Cliente', order.client || '-'],
    ['Solicitante', order.requester || '-'],
    ['Pedido do Cliente', order.client_order || '-'],
    ['Previsao de Atendimento', fmtDate(order.expected_date)],
    ['Volume Pedido (L)', fmtNum(order.volume_ordered, 1)],
    ['Volume Produzido (L)', fmtNum(order.volume_produced, 1)],
    ['Volume Pendente (L)', fmtNum(order.volume_pending, 1)],
  ], 3);
  if (order.observations) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
    doc.text('OBSERVACOES', M, y); y += 5; setColor(doc, BLACK);
    const lines = doc.splitTextToSize(order.observations, CW);
    doc.text(lines, M, y); y += lines.length * 5 + 6;
  }
  y = addSectionTitle(doc, y, 'Ordens de Producao Vinculadas');
  if (!productions || productions.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Nenhuma OP vinculada a este pedido.', M, y); y += 10;
  } else {
    const headers = ['OP', 'STATUS', 'DATA FINALIZ.', 'VOLUME (L)', 'VASILHAMES'];
    const rows = productions.map(function(p) {
      const opContainers = (containers || []).filter(function(c) { return c.op_number === p.op_number; }).map(function(c) { return c.container_number; }).filter(Boolean);
      return [p.op_number || '-', p.status || '-', fmtDate(p.end_time), fmtNum(p.volume, 1) + ' L', opContainers.length ? opContainers.join(', ') : '-'];
    });
    const totalVol = productions.reduce(function(s, p) { return s + (p.volume || 0); }, 0);
    y = addTable(doc, y, headers, rows, [25, 32, 30, 28, 67], ['Total', '', '', fmtNum(totalVol, 1) + ' L', '']);
  }
  addFooter(doc);
  doc.save('pedido-' + (order.order_number || 'relatorio') + '.pdf');
}

export function generateProductionPDF(production, containers, stocks) {
  const doc = new jsPDF({ format: 'a4' });
  const stockUnitOf = function(mp) {
    if (stocks && mp.stock_id) {
      const s = stocks.find(function(x) { return x.id === mp.stock_id; });
      if (s && s.unit) return s.unit;
    }
    return 'kg';
  };
  const liveLotOf = function(mp) {
    if (stocks && mp.stock_id) {
      const s = stocks.find(function(x) { return x.id === mp.stock_id; });
      if (s && s.lot) return s.lot;
    }
    return mp.lot;
  };
  const opNum = production.op_number || '';
  const opTitle = opNum + (production.product ? ' - ' + production.product : '');
  let y = addPageTitle(doc, opTitle, 'Relatorio de Ordem de Producao');
  y = addInfoGrid(doc, y, [
    ['OP', production.op_number || '-'],
    ['Lote', production.lot || '-'],
    ['Etapa', { __badge: true, status: production.status || '-' }],
    ['Produto', production.product || '-'],
    ['Cliente', production.client || '-'],
    ['Pedido Cliente', production.client_order || '-'],
    ['Volume (L)', fmtNum(production.volume, 1) + ' L'],
    ['Massa (kg)', fmtNum(production.mass, 3) + ' kg'],
    ['Densidade', (production.density || '-') + ' g/mL'],
    ['Data Finalizacao', fmtDate(production.end_time)],
    ['Preco Unit.', 'R$ ' + (production.unit_price || 0).toFixed(4) + '/kg'],
    ['Valor Total', 'R$ ' + fmtMoney(production.total_value)],
    ['Prioridade', production.priority || '-'],
    ['Operador', production.operator || '-'],
    ['Embalagem', production.packaging_type || production.packaging_info || '-'],
  ], 3);
  if (production.observations) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
    doc.text('OBSERVACOES', M, y); y += 5; setColor(doc, BLACK);
    const lines = doc.splitTextToSize(production.observations, CW);
    doc.text(lines, M, y); y += lines.length * 5 + 6;
  }
  y = addSectionTitle(doc, y, 'Materias Primas Utilizadas');
  const mps = parseArr(production.raw_materials_used);
  if (mps.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Sem materias primas registradas.', M, y); y += 10;
  } else {
    const units = mps.map(stockUnitOf);
    const allSameUnit = units.length > 0 && units.every(function(u) { return u === units[0]; });
    const fiscalUnit = allSameUnit ? units[0] : '';
    const mpHeaders = ['CODIGO MP', 'NOME MP', 'LOTE', 'QTD. FISCAL', 'QTD. OP. (KG)'];
    const mpRows = mps.map(function(m, i) { return [m.mp_code || '-', m.mp_name || '-', liveLotOf(m) || '-', fmtNum(m.qty_fiscal, 3) + ' ' + units[i], fmtNum(m.qty_operational, 3) + ' kg']; });
    const tFiscal = mps.reduce(function(s, m) { return s + (m.qty_fiscal || 0); }, 0);
    const tOp = mps.reduce(function(s, m) { return s + (m.qty_operational || 0); }, 0);
    y = addTable(doc, y, mpHeaders, mpRows, [30, 62, 28, 34, 28], ['Total', '', '', (fiscalUnit ? fmtNum(tFiscal, 3) + ' ' + fiscalUnit : fmtNum(tFiscal, 3)), fmtNum(tOp, 3) + ' kg']);
  }
  if (containers && containers.length > 0) {
    y = addSectionTitle(doc, y, 'Embalagens Envasadas');
    const cHeaders = ['N EMBALAGEM', 'TIPO', 'VOLUME (L)', 'LIQ. (KG)', 'BRUTO (KG)'];
    const cRows = containers.map(function(c) { return [c.container_number || '-', c.type || '-', fmtNum(c.volume, 1), fmtNum(c.net_weight, 3), fmtNum(c.gross_weight, 3)]; });
    const tVol = containers.reduce(function(s, c) { return s + (c.volume || 0); }, 0);
    const tNet = containers.reduce(function(s, c) { return s + (c.net_weight || 0); }, 0);
    const tGross = containers.reduce(function(s, c) { return s + (c.gross_weight || 0); }, 0);
    addTable(doc, y, cHeaders, cRows, [50, 42, 30, 30, 30], ['Total', '', fmtNum(tVol, 1) + ' L', fmtNum(tNet, 3) + ' kg', fmtNum(tGross, 3) + ' kg']);
  }
  addFooter(doc);
  doc.save((production.op_number || 'producao') + '.pdf');
}

export function generateEnsaioPDF(test) {
  const doc = new jsPDF();
  let y = addPageTitle(doc, test.product || 'Ensaio', 'Cadastro de Controle de Qualidade - Especificacoes');
  y = addInfoGrid(doc, y, [
    ['Produto', test.product || '-'],
    ['Cliente', test.client || '-'],
    ['Revisao', test.revision || '-'],
    ['Data Revisao', test.revision_date || '-'],
    ['N de Analises', String((test.analyses || []).length)],
  ], 3);
  y = addSectionTitle(doc, y, 'Analises e Especificacoes');
  const headers = ['ANALISE', 'METODOLOGIA', 'UNIDADE', 'ESPECIFICACAO'];
  const rows = (test.analyses || []).map(function(a) {
    let spec = a.specification || '-';
    if (!['COR', 'ASPECTO'].includes((a.analysis_name || '').toUpperCase().trim())) {
      const min = a.min_limit != null ? fmtNum(a.min_limit, 3) : '';
      const max = a.max_limit != null ? fmtNum(a.max_limit, 3) : '';
      if (min && max) spec = min + ' - ' + max;
      else if (min) spec = '>= ' + min;
      else if (max) spec = '<= ' + max;
    }
    return [a.analysis_name || '-', a.methodology || '-', a.unit || '-', spec];
  });
  addTable(doc, y, headers, rows, [55, 45, 30, 52], null);
  addFooter(doc);
  doc.save('ensaio-' + (test.product || 'ensaio').replace(/\s+/g, '-') + '.pdf');
}

export async function generateCOAPDF(result, production, containers, recipe, options) {
  const doc = new jsPDF();
  const logoUrl = 'https://media.base44.com/images/public/6a3bc68b6dcf809125758419/afb4730f3_image.png';
  try {
    const resp = await fetch(logoUrl);
    const blob = await resp.blob();
    const reader = new FileReader();
    await new Promise(function(resolve) { reader.onload = resolve; reader.readAsDataURL(blob); });
    doc.addImage(reader.result, 'PNG', PW - M - 38, 8, 38, 18);
  } catch (_e) {}
  doc.setFontSize(20); doc.setFont('helvetica', 'bold'); setColor(doc, BLUE_DARK);
  doc.text('CERTIFICADO DE ANALISE', M, 22);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
  doc.text('COA - ' + (result.product || '') + ' - Lote ' + (result.lot || ''), M, 29);
  setDraw(doc, BLUE_MID); doc.setLineWidth(0.6); doc.line(M, 33, PW - M, 33); doc.setLineWidth(0.2);
  let y = 42;
  y = addSectionTitle(doc, y, '1 - Dados do Produto');
  const mfgDate = production && production.end_time ? fmtDate(production.end_time) : '-';
  let expDate = '-';
  if (production && production.end_time && recipe && recipe.validity_days) {
    const d = new Date(production.end_time);
    d.setDate(d.getDate() + Number(recipe.validity_days));
    expDate = d.toLocaleDateString('pt-BR');
  }
  const massKg = production && production.mass ? fmtNum(production.mass, 3) + ' kg' : '-';
  y = addInfoGrid(doc, y, [
    ['Fabricante', 'OFFSHORE TANKS COMERCIO E SERVICOS EM UNIDADES DE CARGA LTDA', 2],
    ['Lote', result.lot || '-'],
    ['Produto', result.product || '-'],
    ['Cliente', result.client || '-'],
    ['Pedido', (production && production.client_order) || '-'],
    ['Data de Fabricacao', mfgDate],
    ['Data de Validade', expDate],
    ['Quantidade', massKg],
    ['Resp. tecnico', 'Italo Giuseppe Cantisani CRQ III - 03213117'],
    ['Pais de Origem', 'Brasil'],
    ['Observacoes da COA', result.observations || 'Sem observacao.', 2],
  ], 2);
  y = addSectionTitle(doc, y, '2 - Controle de Qualidade');
  const headers = ['ENSAIO', 'METODOLOGIA', 'ESPECIFICACAO', 'UNID.', 'RESULTADO', 'FINAL'];
  const rows = (result.results || []).map(function(r) {
    const isText = ['COR', 'ASPECTO'].includes((r.analysis_name || '').toUpperCase().trim());
    let spec = r.specification || '';
    if (!isText) {
      const min = r.min_limit != null ? fmtNum(r.min_limit, 3) : '';
      const max = r.max_limit != null ? fmtNum(r.max_limit, 3) : '';
      spec = min && max ? (min + ' - ' + max) : min ? ('>= ' + min) : max ? ('<= ' + max) : '-';
    }
    return [r.analysis_name || '-', r.methodology || '-', spec, r.unit || '-', r.result || '-', r.status || '-'];
  });
  y = addTable(doc, y, headers, rows, [44, 44, 36, 14, 22, 22], null, [0, 1, 2, 4]);
  // Resultado final do laudo
  y = ensureSpace(doc, y, 14);
  const statuses = (result.results || []).map(function(r) { return r.status; });
  var finalStatus, finalColor;
  if (statuses.some(function(s) { return s === 'Reprovado'; })) { finalStatus = 'Reprovado'; finalColor = [153, 27, 27]; }
  else if (statuses.length && statuses.every(function(s) { return s === 'Aprovado'; })) { finalStatus = 'Aprovado'; finalColor = [22, 101, 52]; }
  else { finalStatus = result.status || '-'; finalColor = GRAY_LABEL; }
  y += 5;
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
  doc.text('RESULTADO FINAL', M, y);
  setColor(doc, finalColor);
  doc.text(String(finalStatus).toUpperCase(), PW - M, y, { align: 'right' });
  setColor(doc, BLACK);
  y += 6;
  doc.setFontSize(7); doc.setFont('helvetica', 'italic'); setColor(doc, GRAY_LABEL);
  const disclaimer = 'As informacoes apresentadas sao obtidas a partir de ensaios e verificacoes realizados em uma amostra representativa.';
  const disclaimerLines = doc.splitTextToSize(disclaimer, CW);
  doc.text(disclaimerLines, M, y); y += disclaimerLines.length * 3.5 + 3;
  // Frase de dispensa de assinatura - centralizada verticalmente e horizontalmente ao final da primeira pagina
  const footerLineY = PH - 13;
  const phraseCenterY = (y + 8 + footerLineY) / 2;
  doc.setFontSize(9); doc.setFont('helvetica', 'italic'); setColor(doc, GRAY_LABEL);
  doc.text('Documento gerado eletronicamente sem a necessidade de assinatura', PW / 2, phraseCenterY, { align: 'center' });
  addFooter(doc);
  if (result.sample_photo_url) {
    try {
      const signedUrl = await getSignedFileUrl(result.sample_photo_url);
      if (signedUrl) {
        const resp = await fetch(signedUrl);
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const correctedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const props = doc.getImageProperties(correctedDataUrl);
        const maxW = 160; const maxH = 170;
        const ratio = props.width / props.height;
        let imgW = maxW; let imgH = maxW / ratio;
        if (imgH > maxH) { imgH = maxH; imgW = maxH * ratio; }
        const imgX = (PW - imgW) / 2;
        doc.addPage();
        addPageTitle(doc, 'Foto da Amostra - Lote ' + (result.lot || '-'), 'Certificado de Analise (COA)');
        doc.addImage(correctedDataUrl, 'JPEG', imgX, 45, imgW, imgH);
        addFooter(doc);
      }
    } catch (_e) {}
  }
  if (options && options.returnBlob) {
    return doc.output('blob');
  }
  if (options && options.viewInNewTab) {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } else {
    doc.save('COA ' + (result.lot || result.op_number || 'relatorio') + '.pdf');
  }
}

export function generateBoletaPDF(container) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const PH_L = 210;
  const HALF = 297 / 2;

  function drawSide(offsetX) {
    const bM = offsetX + 8;
    const bW = HALF - 16;
    const regId = container.registration_id != null ? String(container.registration_id).padStart(2, '0') : '-';
    const envaseDate = container.created_date ? fmtDate(container.created_date) : '-';
    setDraw(doc, [160, 160, 160]); doc.setLineWidth(0.6);
    doc.rect(offsetX + 4, 4, HALF - 8, PH_L - 8);
    setFill(doc, BLUE_DARK); doc.rect(offsetX + 4, 4, HALF - 8, 16, 'F');
    doc.setFontSize(15); doc.setFont('helvetica', 'bold'); setColor(doc, [255, 255, 255]);
    doc.text(container.client || '-', bM + 2, 14);
    doc.setFontSize(12); doc.text('ID ' + regId, bM + bW, 14, { align: 'right' });
    let y = 26;
    const s1H = 22;
    setDraw(doc, GRAY_BORDER); doc.setLineWidth(0.3); doc.rect(bM, y, bW, s1H);
    const colW = bW / 3;
    doc.line(bM + colW, y, bM + colW, y + s1H);
    doc.line(bM + colW * 2, y, bM + colW * 2, y + s1H);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
    doc.text('N PLACA', bM + colW * 0.5, y + 5, { align: 'center' });
    doc.text('N BARRIL', bM + colW * 1.5, y + 5, { align: 'center' });
    doc.text('DATA', bM + colW * 2.5, y + 5, { align: 'center' });
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
    doc.text(String(container.container_number || '-'), bM + colW * 0.5, y + 16, { align: 'center' });
    doc.text(String(container.barril_number || '-'), bM + colW * 1.5, y + 16, { align: 'center' });
    doc.text(envaseDate, bM + colW * 2.5, y + 16, { align: 'center' });
    y += s1H + 4;
    const s2H = 26; const s2rowH = s2H / 2;
    doc.rect(bM, y, bW, s2H); doc.line(bM, y + s2rowH, bM + bW, y + s2rowH);
    const r1cy = y + s2rowH / 2; const r2cy = y + s2rowH + s2rowH / 2;
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
    doc.text('PRODUTO', bM + 3, r1cy - 2); doc.text('CLIENTE', bM + 3, r2cy - 2);
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
    doc.text(String(container.product || '-'), bM + bW / 2, r1cy + 2.5, { align: 'center' });
    doc.text(String(container.client || '-'), bM + bW / 2, r2cy + 2.5, { align: 'center' });
    y += s2H + 4;
    const s3H = 42;
    doc.rect(bM, y, bW, s3H); doc.line(bM + bW * 0.5, y, bM + bW * 0.5, y + s3H);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
    doc.text('LACRES', bM + 2, y + 5);
    const seals = (container.seals || '').split(/[,\n]/).map(function(s) { return s.trim(); }).filter(Boolean);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(doc, BLACK);
    if (seals.length === 0) { doc.text('-', bM + 2, y + 12); }
    else { seals.slice(0, 6).forEach(function(s, i) { doc.text(s, bM + 2, y + 12 + i * 4.5); }); }
    const rightCellX = bM + bW * 0.5; const rightCellW = bW * 0.5;
    const rightCX = rightCellX + rightCellW / 2; const s3RowH = s3H / 3;
    const rightItems = [
      { label: 'ESLINGA', value: String(container.sling || '-') },
      { label: 'GPS', value: String(container.gps || '-') },
      { label: 'MENOR TESTE', value: container.min_test_date ? fmtDate(container.min_test_date) : '-' },
    ];
    rightItems.forEach(function(item, i) {
      const rowY = y + i * s3RowH;
      if (i > 0) { setDraw(doc, GRAY_BORDER); doc.setLineWidth(0.2); doc.line(rightCellX, rowY, rightCellX + rightCellW, rowY); }
      const cy = rowY + s3RowH / 2;
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
      doc.text(item.label, rightCX, cy - 2, { align: 'center' });
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
      doc.text(item.value, rightCX, cy + 3, { align: 'center' });
    });
    y += s3H + 4;
    const s4H = 34;
    doc.rect(bM, y, bW, s4H); doc.line(bM + bW * 0.38, y, bM + bW * 0.38, y + s4H);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
    doc.text('RESPONSAVEL', bM + 2, y + 5);
    setFill(doc, [245, 245, 245]); doc.rect(bM + 2, y + 8, bW * 0.38 - 4, 22, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
    doc.text(String(container.operator || '-'), bM + bW * 0.19, y + 22, { align: 'center' });
    const wCellX = bM + bW * 0.38; const wCellW = bW * 0.62; const wCX = wCellX + wCellW / 2; const wRowH = s4H / 3;
    const weightRows = [
      { label: 'TARA', value: fmtNum(container.tare, 3) + ' kg' },
      { label: 'PESO LIQUIDO', value: fmtNum(container.net_weight, 3) + ' kg' },
      { label: 'PESO BRUTO', value: fmtNum(container.gross_weight, 3) + ' kg' },
    ];
    weightRows.forEach(function(r, i) {
      const rowY = y + i * wRowH;
      if (i > 0) { setDraw(doc, GRAY_BORDER); doc.setLineWidth(0.2); doc.line(wCellX, rowY, wCellX + wCellW, rowY); }
      const cy = rowY + wRowH / 2;
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
      doc.text(r.label, wCX, cy - 2, { align: 'center' });
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
      doc.text(r.value, wCX, cy + 3, { align: 'center' });
    });
    y += s4H + 4;
    const s5H = 20;
    setFill(doc, [240, 245, 255]); setDraw(doc, BLUE_MID); doc.setLineWidth(0.4);
    doc.rect(bM, y, bW, s5H, 'FD');
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); setColor(doc, BLUE_DARK);
    doc.text('QUANTIDADE ENVASADA', bM + 4, y + 8);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
    doc.text(fmtNum(container.volume, 3) + ' L', bM + bW - 4, y + 13, { align: 'right' });
  }

  drawSide(0);
  drawSide(HALF);
  doc.save((container.container_number || container.registration_id || 'vasilhame') + ' - Boleta.pdf');
}

export function generateStockPDF(item, consumption, movements) {
  const doc = new jsPDF();
  const title = ((item.entry_id || '') + ' - ' + (item.mp_name || '')).trim().replace(/^-\s*/, '');
  let y = addPageTitle(doc, title, 'Relatorio de Estoque de Materia Prima');
  y = addInfoGrid(doc, y, [
    ['ID Registro', item.entry_id || '-'],
    ['Data de Entrada', fmtDate(item.entry_date)],
    ['Codigo', item.mp_code || '-'],
    ['Nome', item.mp_name || '-'],
    ['Cliente', item.client || '-'],
    ['Lote', item.lot || '-'],
    ['Fornecedor', item.supplier || '-'],
    ['Unidade', item.unit || '-'],
    ['Data Fabricacao', fmtDate(item.manufacture_date)],
    ['Data Validade', fmtDate(item.expiry_date)],
    ['Estoque Inicial', fmtNum(item.initial_stock) + ' ' + (item.unit || '')],
    ['Saldo Atual', fmtNum(item.current_stock) + ' ' + (item.unit || '')],
    ['Preco Unitario (R$)', (item.unit_price || 0).toFixed(4)],
    ['Custo Total (R$)', 'R$ ' + fmtMoney((item.current_stock || 0) * (item.unit_price || 0))],
    ['Tipo de Embalagem', item.packaging_type || '-'],
    ['Capacidade Embalagem (kg)', fmtNum(item.packaging_capacity, 3)],
    ['Qtd. de Embalagens', fmtNum(item.packaging_quantity, 1)],
  ], 3);
  if (item.observations) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
    doc.text('OBSERVACOES', M, y); y += 5; setColor(doc, BLACK);
    const lines = doc.splitTextToSize(item.observations, CW);
    doc.text(lines, M, y); y += lines.length * 5 + 6;
  }
  y = addSectionTitle(doc, y, 'Ordens de Producao que utilizaram este lote');
  if (!consumption || consumption.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Nenhuma OP utilizou este lote.', M, y);
  } else {
    const headers = ['OP', 'PRODUTO', 'DATA', 'QTD. FISCAL (' + (item.unit || '') + ')', 'QTD. OP. (KG)'];
    const rows = consumption.map(function(c) {
      return [c.op_number || '-', (c.product || '-').substring(0, 30), fmtDate(c.date), fmtNum(c.qty_fiscal), fmtNum(c.qty_operational)];
    });
    const tFiscal = consumption.reduce(function(s, c) { return s + (c.qty_fiscal || 0); }, 0);
    const tOp = consumption.reduce(function(s, c) { return s + (c.qty_operational || 0); }, 0);
    y = addTable(doc, y, headers, rows, [25, 60, 25, 35, 37], ['Total', '', '', fmtNum(tFiscal) + ' ' + (item.unit || ''), fmtNum(tOp) + ' kg']);
  }
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Historico de Movimentacoes');
  if (!movements || movements.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Nenhuma movimentacao registrada.', M, y);
  } else {
    const mvHeaders = ['DATA', 'DESTINO', 'QTD. (' + (item.unit || '') + ')', 'SALDO ANTES', 'SALDO APOS', 'OPERADOR'];
    const mvRows = movements.map(function(m) {
      return [
        m.movement_date ? new Date(m.movement_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-',
        (m.destination || '-').substring(0, 28),
        '-' + fmtNum(m.quantity, 3),
        fmtNum(m.balance_before, 3),
        fmtNum(m.balance_after, 3),
        (m.operator || '-').substring(0, 18),
      ];
    });
    const totalMoved = movements.reduce(function(s, m) { return s + (m.quantity || 0); }, 0);
    y = addTable(doc, y, mvHeaders, mvRows, [30, 50, 22, 22, 22, 36], ['Total', '', '-' + fmtNum(totalMoved, 3) + ' ' + (item.unit || ''), '', '', '']);
  }
  addFooter(doc);
  doc.save('estoque-' + (item.entry_id || (item.mp_name || 'mp').replace(/\s+/g, '-')) + '.pdf');
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
    ['Data / Hora', movement.movement_date
      ? new Date(movement.movement_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '-'],
    ['Destino', movement.destination || '-'],
    ['Operador', movement.operator || '-'],
    ['Quantidade Movimentada (' + unit + ')', '-' + fmtNum(movement.quantity, 3) + ' ' + unit],
    ['Qtd. Fiscal (' + unit + ')', fmtNum(movement.quantity, 3) + ' ' + unit],
    ['Saldo Antes (' + unit + ')', fmtNum(movement.balance_before, 3) + ' ' + unit],
    ['Saldo Apos (' + unit + ')', fmtNum(movement.balance_after, 3) + ' ' + unit],
    ['Observacoes', movement.observations || '-', 3],
  ], 3);
  addFooter(doc);
  const safeName = (item.mp_name || 'mp').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  doc.save('movimentacao-' + safeName + '-' + dateStr.replace(/\//g, '-') + '.pdf');
}

export function generateTransferPDF(transfer, density, containers, recipeCode) {
  const doc = new jsPDF();
  const dens = density || 0;
  const parseArr = function(v) { return Array.isArray(v) ? v : (typeof v === 'string' ? (function() { try { return JSON.parse(v); } catch (e) { return []; } })() : []); };
  const _transfer = Object.assign({}, transfer, { origins: parseArr(transfer.origins), destinations: parseArr(transfer.destinations) });
  transfer = _transfer;
  var containerLot = {};
  (Array.isArray(containers) ? containers : []).forEach(function(c) { if (c.id && c.lot) containerLot[c.id] = c.lot; });
  var liveLot = function(o) { return (o.container_id && containerLot[o.container_id]) ? containerLot[o.container_id] : o.lot; };
  const hasExp = transfer.destinations.some(function(d) { return d.type === 'Expedição'; });
  const hasTrans = transfer.destinations.some(function(d) { return d.type === 'Transbordo'; });
  const title = hasExp && !hasTrans ? 'Expedição' : 'Transbordo';
  let y = addPageTitle(doc, (transfer.transfer_number || '-') + ' - ' + title, 'Relatorio de Transferencia de Produto');
  y = ensureSpace(doc, y, 50);
  y = addSectionTitle(doc, y, 'Dados Gerais');
  y = addInfoGrid(doc, y, [
    ['N Registro', transfer.transfer_number || '-'],
    ['Data', fmtDate(transfer.date)],
    ['Codigo Produto', recipeCode || '-'],
    ['Produto', transfer.product || '-'],
    ['Cliente', transfer.client || '-'],
    ['Operador', transfer.operator || '-'],
    ['Densidade PA', fmtNum(dens, 4) + ' g/mL'],
    ['Observacoes', transfer.observations || '-', 3],
  ], 3);
  y = ensureSpace(doc, y, 40);
  y = addSectionTitle(doc, y, 'Origens (Vasilhames)');
  const origins = transfer.origins || [];
  if (origins.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Nenhuma origem registrada.', M, y); y += 6;
  } else {
    const oHeaders = ['VASILHAME', 'BARRIL', 'LOTE', 'VOL. RETIRADO (L)', 'MASSA (kg)', 'SALDO RESTANTE (L)'];
    const oRows = origins.map(function(o) { return [o.container_number || '-', o.barril_number || '-', liveLot(o) || '-', fmtNum(o.volume_used, 0), fmtNum((o.volume_used || 0) * dens, 0), fmtNum(o.remaining_stock, 0)]; });
    const tUsed = origins.reduce(function(s, o) { return s + (o.volume_used || 0); }, 0);
    const tMass = origins.reduce(function(s, o) { return s + (o.volume_used || 0) * dens; }, 0);
    const tRem = origins.reduce(function(s, o) { return s + (o.remaining_stock || 0); }, 0);
    y = addTable(doc, y, oHeaders, oRows, [32, 22, 33, 33, 28, 34], ['Total', '', '', fmtNum(tUsed, 0) + ' L', fmtNum(tMass, 0) + ' kg', fmtNum(tRem, 0) + ' L']);
  }
  const dests = transfer.destinations || [];
  var lotTotals = {};
  origins.forEach(function(o) { var k = liveLot(o) || ''; lotTotals[k] = (lotTotals[k] || 0) + (parseFloat(o.volume_used) || 0); });
  var majorityLot = ''; var maxLotVol = -1;
  Object.keys(lotTotals).forEach(function(k) { if (lotTotals[k] > maxLotVol) { maxLotVol = lotTotals[k]; majorityLot = k; } });
  y = ensureSpace(doc, y, 35);
  y = addSectionTitle(doc, y, 'Destinos');
  if (dests.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Nenhum destino registrado.', M, y); y += 6;
  } else {
    const dHeaders = ['TIPO', 'IDENTIFICACAO', 'VOL. (L)', 'MASSA (kg)', 'EMBALAGEM'];
    const dRows = dests.map(function(d) { return [d.type || '-', d.placa || d.barril || '-', fmtNum(d.volume, 0), fmtNum(d.mass, 0), d.packaging_type || '-']; });
    const dVolTotal = dests.reduce(function(s, d) { return s + (d.volume || 0); }, 0);
    const dMassTotal = dests.reduce(function(s, d) { return s + (d.mass || 0); }, 0);
    y = addTable(doc, y, dHeaders, dRows, [25, 45, 35, 35, 40], ['Total', '', fmtNum(dVolTotal, 0) + ' L', fmtNum(dMassTotal, 0) + ' kg', '']);
  }
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Detalhes de Logistica');
  dests.forEach(function(d) {
    y = ensureSpace(doc, y, 45);
    var fields = d.type === 'Transbordo' ? [
      ['Tipo', d.type || '-'],
      ['N Placa', d.placa || '-'],
      ['N Barril', d.barril || '-'],
      ['Volume (L)', fmtNum(d.volume, 0)],
      ['Massa (kg)', fmtNum(d.mass, 0)],
      ['Tipo Embalagem', d.packaging_type || '-'],
      ['Lacres', d.seals || '-'],
      ['Eslinga', d.sling || '-'],
      ['GPS', d.gps || '-'],
      ['Data Menor Teste', d.min_test_date ? fmtDate(d.min_test_date) : '-'],
      ['Tara (kg)', fmtNum(d.tare, 0)],
    ] : [
      ['Tipo', d.type || '-'],
      ['Placa', d.placa || '-'],
      ['Motorista', d.driver || '-'],
      ['Volume (L)', fmtNum(d.volume, 0)],
      ['Massa (kg)', fmtNum(d.mass, 0)],
      ['Peso Liquido (kg)', fmtNum(d.net_weight, 0)],
      ['Tara (kg)', fmtNum(d.tare, 0)],
      ['Peso Bruto (kg)', fmtNum(d.gross_weight, 0)],
      ['Lacres', d.seals || '-'],
      ['Lote Final', majorityLot || '-'],
    ];
    y = addInfoGrid(doc, y, fields, 3);
  });
  addFooter(doc);
  doc.save(title + ' - ' + (transfer.transfer_number || 'registro') + '.pdf');
}

export function generateInventoryPDF(inventory) {
  const doc = new jsPDF({ format: 'a4' });
  let y = addPageTitle(doc, 'Inventario ' + (inventory.inventory_number || ''), 'Relatorio de Inventario Fisico de Estoque');
  const clients = parseArr(inventory.clients).length ? parseArr(inventory.clients) : [inventory.clients || '-'];
  const products = parseArr(inventory.products).length ? parseArr(inventory.products) : [inventory.products || '-'];
  const lots = parseArr(inventory.lots).length ? parseArr(inventory.lots) : [inventory.lots || '-'];
  y = addInfoGrid(doc, y, [
    ['N Inventario', inventory.inventory_number || '-'],
    ['Status', inventory.status || '-'],
    ['Cliente(s)', clients.join(', ') || '-', 2],
    ['Data de Abertura', fmtDateTime(inventory.opening_date)],
    ['Aberto por', inventory.opened_by || '-'],
    ['Data de Inicio', fmtDateTime(inventory.start_date)],
    ['Iniciado por', inventory.started_by || '-'],
    ['Data de Finalizacao', fmtDateTime(inventory.closing_date)],
    ['Finalizado por', inventory.closed_by || '-'],
    ['Produto(s)', products.join(', ') || '-', 2],
    ['Lote(s)', lots.join(', ') || '-', 2],
  ], 2);
  y = addSectionTitle(doc, y, 'Conferencia de Itens');
  const items = parseArr(inventory.items);
  if (items.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Nenhum item neste inventario.', M, y); y += 8;
  } else {
    const hasPkg = items.some(function(it) { return it.packaging_type || it.packaging_capacity; });
    const hasPkgQty = hasPkg && items.some(function(it) {
      return (it.registered_quantity && it.registered_quantity > 0) || (it.physical_packages && it.physical_packages > 0);
    });

    let headers, widths, wrapCols, stockColIdx, physColIdx, diffColIdx, diffPctColIdx;
    if (hasPkgQty) {
      headers = ['PRODUTO', 'CLIENTE', 'LOTE', 'EMBALAGEM', 'QTD. EMB.', 'ESTOQUE', 'FISICO', 'DIF.', 'DIF. %'];
      widths = [30, 26, 18, 22, 14, 20, 20, 16, 16];
      wrapCols = [0, 1, 2, 3];
      stockColIdx = 5; physColIdx = 6; diffColIdx = 7; diffPctColIdx = 8;
    } else if (hasPkg) {
      headers = ['PRODUTO', 'CLIENTE', 'LOTE', 'EMBALAGEM', 'ESTOQUE', 'FISICO', 'DIF.', 'DIF. %'];
      widths = [34, 28, 20, 24, 22, 22, 16, 16];
      wrapCols = [0, 1, 2, 3];
      stockColIdx = 4; physColIdx = 5; diffColIdx = 6; diffPctColIdx = 7;
    } else {
      headers = ['PRODUTO', 'CLIENTE', 'LOTE', 'ESTOQUE', 'FISICO', 'DIF.', 'DIF. %'];
      widths = [38, 32, 22, 24, 24, 22, 20];
      wrapCols = [0, 1, 2];
      stockColIdx = 3; physColIdx = 4; diffColIdx = 5; diffPctColIdx = 6;
    }

    const computed = items.map(function(it) {
      const unit = it.unit || 'kg';
      const physicalTotal = it.physical_total != null ? it.physical_total
        : ((it.physical_packages || 0) * (it.packaging_capacity || 0) + (it.fractional_qty || 0));
      const diff = it.difference != null ? it.difference : (physicalTotal - (it.registered_stock || 0));
      const diffPct = it.difference_pct != null ? it.difference_pct
        : ((it.registered_stock || 0) > 0 ? (diff / it.registered_stock) * 100 : 0);
      return { it: it, unit: unit, physicalTotal: physicalTotal, diff: diff, diffPct: diffPct };
    });

    const rows = computed.map(function(c) {
      const row = [c.it.product || '-', c.it.client || '-', c.it.lot || '-'];
      if (hasPkg) {
        row.push(c.it.packaging_type
          ? c.it.packaging_type + (c.it.packaging_capacity ? ' (' + fmtNum(c.it.packaging_capacity, 0) + ')' : '')
          : '-');
      }
      if (hasPkgQty) {
        const regQty = c.it.registered_quantity != null ? fmtNum(c.it.registered_quantity, 1) : '-';
        const physQty = c.it.physical_packages != null ? fmtNum(c.it.physical_packages, 0) : '-';
        row.push(regQty + '/' + physQty);
      }
      row.push(fmtNum(c.it.registered_stock, 1) + ' ' + c.unit);
      row.push(fmtNum(c.physicalTotal, 1) + ' ' + c.unit);
      row.push((c.diff >= 0 ? '+' : '') + fmtNum(c.diff, 1));
      row.push((c.diffPct >= 0 ? '+' : '') + fmtNum(c.diffPct, 1) + '%');
      return row;
    });

    const totalReg = computed.reduce(function(s, c) { return s + (c.it.registered_stock || 0); }, 0);
    const totalPhys = computed.reduce(function(s, c) { return s + c.physicalTotal; }, 0);
    const totalDiff = computed.reduce(function(s, c) { return s + c.diff; }, 0);
    const unit = (items[0] && items[0].unit) || 'kg';

    const totalsRow = [];
    for (let i = 0; i < headers.length; i++) {
      if (i === 0) totalsRow.push('TOTAL');
      else if (i === stockColIdx) totalsRow.push(fmtNum(totalReg, 1) + ' ' + unit);
      else if (i === physColIdx) totalsRow.push(fmtNum(totalPhys, 1) + ' ' + unit);
      else if (i === diffColIdx) totalsRow.push((totalDiff >= 0 ? '+' : '') + fmtNum(totalDiff, 1) + ' ' + unit);
      else totalsRow.push('');
    }

    const diffColorFn = function(ri, ci, cellValue) {
      if (ci !== diffColIdx && ci !== diffPctColIdx) return null;
      const str = String(cellValue || '');
      if (str.startsWith('-')) return { text: [153, 27, 27] };
      const numMatch = str.match(/[\d,]+/);
      const num = numMatch ? parseFloat(numMatch[0].replace(',', '.')) : 0;
      if (num === 0) return { text: [161, 98, 7] };
      return { text: [22, 101, 52] };
    };

    y = addTable(doc, y, headers, rows, widths, totalsRow, wrapCols, {
      dataFontSize: 7,
      headerFontSize: 6.5,
      coloredCols: diffColorFn,
      verticalLines: true,
    });

    y = ensureSpace(doc, y, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const summaryText = totalDiff > 0
      ? 'RESUMO: +' + fmtNum(totalDiff, 1) + ' ' + unit + ' (SOBRANDO PRODUTO)'
      : totalDiff < 0
      ? 'RESUMO: ' + fmtNum(totalDiff, 1) + ' ' + unit + ' (FALTANDO PRODUTO)'
      : 'RESUMO: 0 ' + unit + ' (SEM DIVERGENCIA)';
    setColor(doc, totalDiff > 0 ? [22, 101, 52] : totalDiff < 0 ? [153, 27, 27] : BLACK);
    doc.text(summaryText, M, y + 5);
    setColor(doc, BLACK);
  }
  addFooter(doc);
  doc.save('inventario-' + (inventory.inventory_number || 'relatorio') + '.pdf');
}

export function generateVasilhamesReportPDF(containers, recipe) {
  const doc = new jsPDF({ format: 'a4' });
  const product = (containers[0] && containers[0].product) || '-';
  const client = (containers[0] && containers[0].client) || '-';
  const productCode = (recipe && recipe.code) || '-';
  const totalVolume = containers.reduce(function(s, c) { return s + (c.volume || 0); }, 0);
  const totalMass = containers.reduce(function(s, c) { return s + (c.net_weight || 0); }, 0);
  const emissionDate = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  let y = addPageTitle(doc, product, 'Relatorio de Vasilhames');
  y = addInfoGrid(doc, y, [
    ['Codigo do Produto', productCode],
    ['Nome do Produto', product],
    ['Cliente', client],
    ['Qtd. Vasilhames', String(containers.length)],
    ['Volume Total', fmtNum(totalVolume, 0) + ' L'],
    ['Massa Total', fmtNum(totalMass, 0) + ' kg'],
    ['Data e Hora da Emissao', emissionDate, 3],
  ], 3);

  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Vasilhames Selecionados');
  const headers = ['N PLACA', 'N BARRIL', 'ESLINGA', 'LOTE', 'VOLUME (L)', 'MASSA (KG)'];
  const rows = containers.map(function(c) {
    return [c.container_number || '-', c.barril_number || '-', c.sling || '-', c.lot || '-', fmtNum(c.volume, 0), fmtNum(c.net_weight, 0)];
  });
  const widths = [30, 28, 30, 28, 26, 26];
  const totalsRow = ['', '', '', 'TOTAL', fmtNum(totalVolume, 0) + ' L', fmtNum(totalMass, 0) + ' kg'];
  y = addTable(doc, y, headers, rows, widths, totalsRow, [0, 1, 2, 3], { verticalLines: true });

  addFooter(doc);
  const safeName = (product || 'vasilhames').replace(/\s+/g, '-').toLowerCase();
  doc.save('relatorio-vasilhames-' + safeName + '.pdf');
}

export function generateClientStockPDF(opts) {
  const client = opts.client;
  const stocks = opts.stocks || [];
  const containers = opts.containers || [];
  const tanks = opts.tanks || [];
  const doc = new jsPDF();
  const clientLabel = client === 'Todos os Clientes' ? 'Todos os Clientes' : client;
  let y = addPageTitle(doc, 'Estoque - ' + clientLabel, 'Relatorio Completo de Estoque por Cliente');
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Resumo Geral');
  const totalMPVolume = stocks.reduce(function(s, i) { return s + (i.current_stock || 0); }, 0);
  const totalContainerVolume = containers.reduce(function(s, c) { return s + (c.volume || 0); }, 0);
  const totalContainerMass = containers.reduce(function(s, c) { return s + (c.net_weight || 0); }, 0);
  const totalTankVolume = tanks.reduce(function(s, t) { return s + (t.current_volume || 0); }, 0);
  y = addInfoGrid(doc, y, [
    ['Cliente', clientLabel, 2],
    ['Data do Relatorio', fmtDate(new Date().toISOString())],
    ['Total Itens MP', String(stocks.length)],
    ['Total Vasilhames', String(containers.length)],
    ['Total Tankas', String(tanks.length)],
    ['Saldo Total MP', fmtNum(totalMPVolume, 1)],
    ['Volume Total Vasilhames', fmtNum(totalContainerVolume, 1) + ' L'],
    ['Massa Total Vasilhames', fmtNum(totalContainerMass, 1) + ' kg'],
    ['Volume Total Tankagem', fmtNum(totalTankVolume, 1) + ' L'],
  ], 3);
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Estoque de Materia Prima');
  if (stocks.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Nenhum item de materia prima encontrado.', M, y); y += 8;
  } else {
    const mpHeaders = ['COD. MP', 'PRODUTO', 'LOTE', 'SALDO INICIAL', 'SALDO ATUAL', 'UN.', 'VALIDADE'];
    const mpRows = stocks.map(function(s) {
      return [(s.mp_code || '-').substring(0, 10), (s.mp_name || '-').substring(0, 24), (s.lot || '-').substring(0, 16), fmtNum(s.initial_stock, 1), fmtNum(s.current_stock, 1), s.unit || '-', fmtDate(s.expiry_date)];
    });
    y = addTable(doc, y, mpHeaders, mpRows, [22, 42, 30, 25, 25, 12, 26], null);
  }
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Vasilhames');
  if (containers.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Nenhum vasilhame encontrado.', M, y); y += 8;
  } else {
    const cHeaders = ['N EMBALAGEM', 'BARRIL', 'PRODUTO', 'LOTE', 'TIPO', 'VOL. (L)', 'LIQ. (KG)'];
    const cRows = containers.map(function(c) {
      return [(c.container_number || '-').substring(0, 16), (c.barril_number || '-').substring(0, 14), (c.product || '-').substring(0, 24), (c.lot || '-').substring(0, 16), (c.type || '-').substring(0, 18), fmtNum(c.volume, 1), fmtNum(c.net_weight, 1)];
    });
    const tVol = containers.reduce(function(s, c) { return s + (c.volume || 0); }, 0);
    const tNet = containers.reduce(function(s, c) { return s + (c.net_weight || 0); }, 0);
    y = addTable(doc, y, cHeaders, cRows, [26, 20, 40, 25, 25, 23, 23], ['Total', '', '', '', '', fmtNum(tVol, 1) + ' L', fmtNum(tNet, 1) + ' kg']);
  }
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Tankagem');
  if (tanks.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Nenhuma tanka encontrada.', M, y); y += 8;
  } else {
    const tHeaders = ['TANKA', 'PRODUTO', 'LOTE', 'VOLUME ATUAL (L)', 'TAXA DE OCUPACAO'];
    const tRows = tanks.map(function(t) {
      const vol = t.current_volume || 0;
      const cap = t.capacity || 26000;
      const pct = cap > 0 ? Math.min(100, (vol / cap) * 100) : 0;
      const prods = (t.computed_products || []).join(', ') || (t.product || '-');
      return [(t.name || '-').substring(0, 20), prods.substring(0, 30), (t.computed_lot || t.lot || '-').substring(0, 16), fmtNum(vol, 1), pct.toFixed(1) + '%'];
    });
    const tVol = tanks.reduce(function(s, t) { return s + (t.current_volume || 0); }, 0);
    y = addTable(doc, y, tHeaders, tRows, [35, 55, 30, 35, 27], ['Total', '', '', fmtNum(tVol, 1) + ' L', '']);
  }
  addFooter(doc);
  doc.save('estoque-cliente-' + (clientLabel || 'relatorio').replace(/\s+/g, '-').toLowerCase() + '.pdf');
}
