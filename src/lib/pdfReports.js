import jsPDF from 'jspdf';

const parseArr = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

// ─── Layout constants ─────────────────────────────────────────────────────────
const M = 14;          // margin
const PW = 210;        // page width (A4)
const PH = 297;        // page height (A4)
const CW = PW - 2 * M; // content width

// ─── Color palette (matching reference PDF) ──────────────────────────────────
const BLUE_DARK  = [28, 53, 91];   // title / table header bg
const BLUE_MID   = [37, 99, 195];  // section accent bar
const GRAY_LABEL = [130, 140, 155];
const GRAY_ROW   = [248, 249, 251];
const GRAY_BORDER= [220, 224, 230];
const BLACK      = [30, 30, 30];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setColor(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }
function setFill(doc, rgb)  { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setDraw(doc, rgb)  { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }

export function fmtNum(n, decimals = 0) {
  return (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '—'; }
}
export function fmtMoney(n) {
  return (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Page break helper ──────────────────────────────────────────────────────
function ensureSpace(doc, y, needed) {
  if (y + needed > PH - 20) { doc.addPage(); return 20; }
  return y;
}

// ─── Duration formatter (ms → "Xh Ymin Zs") ──────────────────────────────────
function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}min ${s}s`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}

function fmtDateTime(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}

// ─── Page header (title + subtitle, no background) ───────────────────────────
function addPageTitle(doc, title, subtitle) {
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BLUE_DARK);
  doc.text(title, M, 22);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY_LABEL);
  doc.text(subtitle || '', M, 29);

  // horizontal rule
  setDraw(doc, BLUE_MID);
  doc.setLineWidth(0.6);
  doc.line(M, 33, PW - M, 33);
  doc.setLineWidth(0.2);

  return 44;
}

// ─── Footer ──────────────────────────────────────────────────────────────────
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
    doc.text('ChemCtrl · Sistema de Controle de Produção', M, PH - 8);
    doc.text(`Página ${i} de ${pages}`, PW - M, PH - 8, { align: 'right' });
  }
}

// ─── Section title with left accent bar ──────────────────────────────────────
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

// ─── Info grid (bordered cells, label + value, supports span + text wrap) ────
function addInfoGrid(doc, y, pairs, cols = 3) {
  const colW = CW / cols;

  // Build rows respecting optional span (p[2])
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

  // Dynamic row heights based on wrapped text
  const rowHeights = rowsData.map(row => {
    let maxH = 14;
    row.forEach(cell => {
      const cellW = colW * cell.span - 6;
      const lines = doc.splitTextToSize(String(cell.value ?? '—'), cellW);
      const textH = 5 + lines.length * 4.5 + 4;
      if (textH > maxH) maxH = textH;
    });
    return maxH;
  });
  const totalH = rowHeights.reduce((a, b) => a + b, 0);

  // outer border
  setDraw(doc, GRAY_BORDER);
  doc.setLineWidth(0.3);
  doc.rect(M, y, CW, totalH);

  // Render cells
  let yy = y;
  rowsData.forEach((row, ri) => {
    const rowH = rowHeights[ri];
    let x = M;
    row.forEach(cell => {
      const cellW = colW * cell.span;
      // vertical divider
      if (x > M) {
        setDraw(doc, GRAY_BORDER);
        doc.setLineWidth(0.3);
        doc.line(x, yy, x, yy + rowH);
      }
      // label
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      setColor(doc, GRAY_LABEL);
      doc.text(String(cell.label).toUpperCase(), x + 3, yy + 4.5);
      // value (wrapped)
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      setColor(doc, BLACK);
      const lines = doc.splitTextToSize(String(cell.value ?? '—'), cellW - 6);
      doc.text(lines, x + 3, yy + 10);
      x += cellW;
    });
    // horizontal divider between rows
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

// ─── Table ───────────────────────────────────────────────────────────────────
function addTable(doc, y, headers, rows, colWidths, totalsRow, wrapCols) {
  const widths = colWidths || headers.map(() => CW / headers.length);
  const wrapSet = new Set(wrapCols || []);

  const drawHeader = (yy) => {
    setFill(doc, BLUE_DARK);
    doc.rect(M, yy, CW, 8, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    setColor(doc, [255, 255, 255]);
    let x = M;
    headers.forEach((h, i) => {
      doc.text(h, x + 2.5, yy + 5.5);
      x += widths[i];
    });
    return yy + 8;
  };

  y = drawHeader(y);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  setColor(doc, BLACK);

  rows.forEach((r, ri) => {
    // Calculate dynamic row height for wrapped columns
    let rowH = 7.5;
    if (wrapSet.size > 0) {
      r.forEach((c, i) => {
        if (wrapSet.has(i)) {
          const lines = doc.splitTextToSize(String(c ?? '—'), widths[i] - 5);
          const neededH = lines.length * 4 + 3.5;
          if (neededH > rowH) rowH = neededH;
        }
      });
    }

    if (y + rowH > PH - 28) {
      doc.addPage();
      y = 20;
      y = drawHeader(y);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      setColor(doc, BLACK);
    }

    if (ri % 2 === 0) {
      setFill(doc, GRAY_ROW);
      doc.rect(M, y, CW, rowH, 'F');
    }

    // row bottom border
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.15);
    doc.line(M, y + rowH, M + CW, y + rowH);

    let x = M;
    r.forEach((c, i) => {
      const text = String(c ?? '—');
      if (wrapSet.has(i)) {
        const lines = doc.splitTextToSize(text, widths[i] - 5);
        doc.text(lines, x + 2.5, y + 4.5);
      } else {
        const maxChars = Math.floor((widths[i] - 5) / 1.55);
        doc.text(text.length > maxChars ? text.substring(0, maxChars) + '…' : text, x + 2.5, y + 5.2);
      }
      x += widths[i];
    });
    y += rowH;
  });

  // totals row
  if (totalsRow) {
    setFill(doc, [235, 240, 250]);
    doc.rect(M, y, CW, 8, 'F');
    setDraw(doc, BLUE_MID);
    doc.setLineWidth(0.4);
    doc.line(M, y, M + CW, y);
    doc.setLineWidth(0.2);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    setColor(doc, BLUE_DARK);
    let x = M;
    totalsRow.forEach((c, i) => {
      doc.text(String(c ?? ''), x + 2.5, y + 5.5);
      x += widths[i];
    });
    y += 8;
  }

  setColor(doc, BLACK);
  return y + 4;
}

// ─── RECEITA PDF ─────────────────────────────────────────────────────────────
export function generateRecipePDF(recipe) {
  const doc = new jsPDF();
  const idLabel = recipe.code ? `${recipe.code} — ${recipe.product_name}` : recipe.product_name;
  let y = addPageTitle(doc, idLabel, 'Ficha de Formulação e Especificação Técnica');

  y = addInfoGrid(doc, y, [
    ['Código Produto', recipe.code || '—'],
    ['Cliente', recipe.client || '—'],
    ['Preço Unitário', `R$ ${(recipe.price || 0).toFixed(4)}`],
    ['Revisão', recipe.revision || '—'],
    ['Data Revisão', recipe.revision_date || '—'],
    ['Densidade PA', `${recipe.density || '—'} g/mL`],
    ['Validade', `${recipe.validity_days || '—'} dias`],
  ], 3);

  y = addSectionTitle(doc, y, 'Matérias Primas');

  const headers = ['CÓDIGO MP', 'NOME MP', 'DENS. (G/ML)', '% M/M', 'QTD. (KG)'];
  const mps = recipe.raw_materials || [];
  const rows = mps.map(m => [
    m.mp_code || '—',
    m.mp_name || '—',
    m.mp_density || '—',
    fmtNum(m.percentage, 2) + '%',
    fmtNum(m.quantity_kg, 3),
  ]);
  const totalPct = mps.reduce((s, m) => s + (m.percentage || 0), 0);
  const totalKg  = mps.reduce((s, m) => s + (m.quantity_kg  || 0), 0);
  const totalsRow = ['Total', '', '', fmtNum(totalPct, 2) + '%', fmtNum(totalKg, 3) + ' kg'];

  addTable(doc, y, headers, rows, [36, 68, 24, 24, 30], totalsRow);

  addFooter(doc);
  doc.save(`receita-${(recipe.product_name || 'receita').replace(/\s+/g, '-')}.pdf`);
}

// ─── PEDIDO PDF ──────────────────────────────────────────────────────────────
export function generateOrderPDF(order, productions, containers) {
  const doc = new jsPDF();
  let y = addPageTitle(doc, `Pedido ${order.order_number || ''}`, 'Relatório de Pedido de Produção');

  y = addInfoGrid(doc, y, [
    ['Pedido Interno', order.order_number || '—'],
    ['Data', fmtDate(order.date)],
    ['Status', order.status || '—'],
    ['Produto', order.product || '—'],
    ['Cliente', order.client || '—'],
    ['Solicitante', order.requester || '—'],
    ['Pedido do Cliente', order.client_order || '—'],
    ['Previsão de Atendimento', fmtDate(order.expected_date)],
    ['Volume Pedido (L)', fmtNum(order.volume_ordered, 1)],
    ['Volume Produzido (L)', fmtNum(order.volume_produced, 1)],
    ['Volume Pendente (L)', fmtNum(order.volume_pending, 1)],
  ], 3);

  if (order.observations) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY_LABEL);
    doc.text('OBSERVAÇÕES', M, y);
    y += 5;
    setColor(doc, BLACK);
    const lines = doc.splitTextToSize(order.observations, CW);
    doc.text(lines, M, y);
    y += lines.length * 5 + 6;
  }

  y = addSectionTitle(doc, y, 'Ordens de Produção Vinculadas');

  if (!productions || productions.length === 0) {
    doc.setFontSize(9);
    setColor(doc, GRAY_LABEL);
    doc.text('Nenhuma OP vinculada a este pedido.', M, y);
    y += 10;
  } else {
    const headers = ['OP', 'STATUS', 'DATA FINALIZ.', 'VOLUME (L)', 'VASILHAMES'];
    const rows = productions.map(p => {
      // Collect containers linked to this OP
      const opContainers = (containers || [])
        .filter(c => c.op_number === p.op_number)
        .map(c => c.container_number)
        .filter(Boolean);
      return [
        p.op_number || '—',
        p.status || '—',
        fmtDate(p.end_time),
        fmtNum(p.volume, 1) + ' L',
        opContainers.length ? opContainers.join(', ') : '—',
      ];
    });
    const totalVol = productions.reduce((s, p) => s + (p.volume || 0), 0);
    const totalsRow = ['Total', '', '', fmtNum(totalVol, 1) + ' L', ''];
    y = addTable(doc, y, headers, rows, [25, 32, 30, 28, 67], totalsRow);
  }

  addFooter(doc);
  doc.save(`pedido-${order.order_number || 'relatorio'}.pdf`);
}

// ─── PRODUÇÃO PDF ────────────────────────────────────────────────────────────
export function generateProductionPDF(production, containers) {
  const doc = new jsPDF({ format: 'a4' });
  let y = addPageTitle(doc, `OP ${production.op_number || ''}`, 'Relatório de Ordem de Produção');

  y = addInfoGrid(doc, y, [
    ['OP', production.op_number || '—'],
    ['Lote', production.lot || '—'],
    ['Etapa', production.status || '—'],
    ['Produto', production.product || '—'],
    ['Cliente', production.client || '—'],
    ['Revisão Receita', production.recipe_revision || '—'],
    ['Volume (L)', fmtNum(production.volume, 1) + ' L'],
    ['Massa (kg)', fmtNum(production.mass, 3) + ' kg'],
    ['Densidade', (production.density || '—') + ' g/mL'],
    ['Data Finalização', fmtDate(production.end_time)],
    ['Preço Unit.', `R$ ${(production.unit_price || 0).toFixed(4)}/kg`],
    ['Valor Total', `R$ ${fmtMoney(production.total_value)}`],
    ['Prioridade', production.priority || '—'],
    ['Operador', production.operator || '—'],
    ['Embalagem', production.packaging_type || production.packaging_info || '—'],
  ], 3);

  if (production.observations) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY_LABEL);
    doc.text('OBSERVAÇÕES', M, y);
    y += 5;
    setColor(doc, BLACK);
    const lines = doc.splitTextToSize(production.observations, CW);
    doc.text(lines, M, y);
    y += lines.length * 5 + 6;
  }

  y = addSectionTitle(doc, y, 'Matérias Primas Utilizadas');
  const mps = parseArr(production.raw_materials_used);
  if (mps.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text('Sem matérias primas registradas.', M, y); y += 10;
  } else {
    const mpHeaders = ['CÓDIGO MP', 'NOME MP', 'LOTE', 'QTD. FISCAL', 'QTD. OP. (KG)'];
    const mpRows = mps.map(m => [m.mp_code || '—', m.mp_name || '—', m.lot || '—', fmtNum(m.qty_fiscal, 3) + ' kg', fmtNum(m.qty_operational, 3) + ' kg']);
    const tFiscal = mps.reduce((s, m) => s + (m.qty_fiscal || 0), 0);
    const tOp = mps.reduce((s, m) => s + (m.qty_operational || 0), 0);
    y = addTable(doc, y, mpHeaders, mpRows, [30, 68, 30, 30, 24], ['Total', '', '', fmtNum(tFiscal, 3) + ' kg', fmtNum(tOp, 3) + ' kg']);
  }

  if (containers && containers.length > 0) {
    y = addSectionTitle(doc, y, 'Embalagens Envasadas');
    const cHeaders = ['Nº EMBALAGEM', 'TIPO', 'VOLUME (L)', 'LÍQ. (KG)', 'BRUTO (KG)'];
    const cRows = containers.map(c => [c.container_number || '—', c.type || '—', fmtNum(c.volume, 1), fmtNum(c.net_weight, 3), fmtNum(c.gross_weight, 3)]);
    const tVol = containers.reduce((s, c) => s + (c.volume || 0), 0);
    const tNet = containers.reduce((s, c) => s + (c.net_weight || 0), 0);
    const tGross = containers.reduce((s, c) => s + (c.gross_weight || 0), 0);
    addTable(doc, y, cHeaders, cRows, [50, 42, 30, 30, 30], ['Total', '', fmtNum(tVol, 1) + ' L', fmtNum(tNet, 3) + ' kg', fmtNum(tGross, 3) + ' kg']);
  }

  // ─── Tempo de Produção
  const startMs = production.start_time ? new Date(production.start_time).getTime() : null;
  const endMs = production.end_time ? new Date(production.end_time).getTime() : null;
  const qcStartMs = production.qc_start_time ? new Date(production.qc_start_time).getTime() : null;
  const envaseStartMs = production.envase_start_time ? new Date(production.envase_start_time).getTime() : null;
  const createdMs = production.date ? new Date(production.date).getTime() : null;
  const pauseMs = production.total_pause_ms || 0;

  if (startMs && endMs) {
    // Always render Tempo de Produção on page 2
    doc.addPage();
    y = addPageTitle(doc, `OP ${production.op_number || ''}`, 'Tempo de Produção');
    y = addSectionTitle(doc, y, 'Tempo de Produção');

    // Stage durations
    const stageWaiting = (startMs && createdMs) ? (startMs - createdMs) : null;
    const stageProduction = (qcStartMs && startMs) ? (qcStartMs - startMs - pauseMs) : ((endMs && startMs) ? (endMs - startMs - pauseMs) : null);
    const stageQuality = (envaseStartMs && qcStartMs) ? (envaseStartMs - qcStartMs) : null;
    const stageEnvase = (endMs && envaseStartMs) ? (endMs - envaseStartMs) : null;
    const totalProductionMs = endMs - startMs - pauseMs;

    y = addInfoGrid(doc, y, [
      ['Início da OP', fmtDateTime(production.start_time)],
      ['Término (Envase)', fmtDateTime(production.end_time)],
      ['Início CQ', fmtDateTime(production.qc_start_time)],
      ['Início Envase', fmtDateTime(production.envase_start_time)],
      ['Tempo em Aguardando Início', fmtDuration(stageWaiting)],
      ['Tempo em Produção', fmtDuration(stageProduction)],
      ['Tempo em Qualidade', fmtDuration(stageQuality)],
      ['Tempo em Envase', fmtDuration(stageEnvase)],
      ['Tempo de Pausa', fmtDuration(pauseMs)],
      ['Tempo Total de Produção', fmtDuration(totalProductionMs), 2],
    ], 2);
  }

  addFooter(doc);
  doc.save(`op-${production.op_number || 'producao'}.pdf`);
}

// ─── ENSAIO PDF ───────────────────────────────────────────────────────────────
export function generateEnsaioPDF(test) {
  const doc = new jsPDF();
  let y = addPageTitle(doc, test.product || 'Ensaio', 'Cadastro de Controle de Qualidade — Especificações');

  y = addInfoGrid(doc, y, [
    ['Produto', test.product || '—'],
    ['Cliente', test.client || '—'],
    ['Revisão', test.revision || '—'],
    ['Data Revisão', test.revision_date || '—'],
    ['Nº de Análises', String((test.analyses || []).length)],
  ], 3);

  y = addSectionTitle(doc, y, 'Análises e Especificações');
  const headers = ['ANÁLISE', 'METODOLOGIA', 'UNIDADE', 'ESPECIFICAÇÃO'];
  const rows = (test.analyses || []).map(a => {
    let spec = a.specification || '—';
    if (!['COR', 'ASPECTO'].includes((a.analysis_name || '').toUpperCase().trim())) {
      const min = a.min_limit != null ? fmtNum(a.min_limit, 3) : '';
      const max = a.max_limit != null ? fmtNum(a.max_limit, 3) : '';
      if (min && max) spec = `${min} — ${max}`;
      else if (min) spec = `≥ ${min}`;
      else if (max) spec = `≤ ${max}`;
    }
    return [a.analysis_name || '—', a.methodology || '—', a.unit || '—', spec];
  });
  addTable(doc, y, headers, rows, [55, 45, 30, 52], null);

  addFooter(doc);
  doc.save(`ensaio-${(test.product || 'ensaio').replace(/\s+/g, '-')}.pdf`);
}

// ─── COA PDF ─────────────────────────────────────────────────────────────────
export async function generateCOAPDF(result, production, containers, recipe) {
  const doc = new jsPDF();

  // ── Header with logo ──────────────────────────────────────────────────────
  const logoUrl = 'https://media.base44.com/images/public/6a3bc68b6dcf809125758419/afb4730f3_image.png';
  try {
    const resp = await fetch(logoUrl);
    const blob = await resp.blob();
    const reader = new FileReader();
    await new Promise(resolve => { reader.onload = resolve; reader.readAsDataURL(blob); });
    const dataUrl = reader.result;
    // Logo on right side, header area
    doc.addImage(dataUrl, 'PNG', PW - M - 38, 8, 38, 18);
  } catch (e) { /* skip if logo fails */ }

  // Title on left
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BLUE_DARK);
  doc.text('CERTIFICADO DE ANÁLISE', M, 22);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY_LABEL);
  doc.text(`COA · ${result.product || ''} · Lote ${result.lot || ''}`, M, 29);
  setDraw(doc, BLUE_MID);
  doc.setLineWidth(0.6);
  doc.line(M, 33, PW - M, 33);
  doc.setLineWidth(0.2);
  let y = 44;

  // ── 1 — Dados do Produto ─────────────────────────────────────────────────
  y = addSectionTitle(doc, y, '1 — Dados do Produto');

  // Calculate dates
  const mfgDate = production?.end_time ? fmtDate(production.end_time) : '—';
  let expDate = '—';
  if (production?.end_time && recipe?.validity_days) {
    const d = new Date(production.end_time);
    d.setDate(d.getDate() + Number(recipe.validity_days));
    expDate = d.toLocaleDateString('pt-BR');
  }
  const massKg = production?.mass ? fmtNum(production.mass, 3) + ' kg' : '—';

  y = addInfoGrid(doc, y, [
    ['Fabricante', 'OFFSHORE TANKS COMÉRCIO E SERVIÇOS EM UNIDADES DE CARGA LTDA', 2],
    ['Lote', result.lot || '—'],
    ['Produto', result.product || '—'],
    ['Cliente', result.client || '—'],
    ['Pedido', production?.client_order || '—'],
    ['Data de Fabricação', mfgDate],
    ['Data de Validade', expDate],
    ['Quantidade', massKg],
    ['Resp. técnico', 'Italo Giuseppe Cantisani CRQ III – 03213117'],
    ['País de Origem', 'Brasil'],
    ['Observações da COA', result.observations || 'Sem observação.', 2],
  ], 2);

  // ── 2 — Controle de Qualidade ─────────────────────────────────────────────
  y = addSectionTitle(doc, y, '2 — Controle de Qualidade');

  const headers = ['ENSAIO', 'METODOLOGIA', 'ESPECIFICAÇÃO', 'UNID.', 'RESULTADO', 'FINAL'];
  const rows = (result.results || []).map(r => {
    const isText = ['COR', 'ASPECTO'].includes((r.analysis_name || '').toUpperCase().trim());
    let spec = r.specification || '';
    if (!isText) {
      const min = r.min_limit != null ? fmtNum(r.min_limit, 3) : '';
      const max = r.max_limit != null ? fmtNum(r.max_limit, 3) : '';
      spec = min && max ? `${min} — ${max}` : min ? `≥ ${min}` : max ? `≤ ${max}` : '—';
    }
    return [r.analysis_name || '—', r.methodology || '—', spec, r.unit || '—', r.result || '—', r.status || '—'];
  });
  y = addTable(doc, y, headers, rows, [30, 28, 52, 16, 28, 28], null, [2]);

  // Disclaimer text below table
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'italic');
  setColor(doc, GRAY_LABEL);
  const disclaimer = 'As informações apresentadas são obtidas a partir de ensaios e verificações realizados em uma amostra representativa. As amostras do produto foram coletadas conforme os critérios estabelecidos na norma ABNT NBR 5764.';
  const disclaimerLines = doc.splitTextToSize(disclaimer, CW);
  doc.text(disclaimerLines, M, y);
  y += disclaimerLines.length * 4 + 5;

  // ── 3 — Embalagens ────────────────────────────────────────────────────────
  y = addSectionTitle(doc, y, '3 — Embalagens');
  if (containers && containers.length > 0) {
    const parts = containers.map(c => {
      const num = c.container_number || '—';
      const barril = c.barril_number ? ` (${c.barril_number})` : '';
      const vol = fmtNum(c.volume, 3) + ' L';
      return `${num}${barril} — ${vol}`;
    });
    const embText = parts.join(' / ');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    setColor(doc, BLACK);
    const embLines = doc.splitTextToSize(embText, CW);
    doc.text(embLines, M, y);
    y += embLines.length * 5 + 4;
  } else {
    doc.setFontSize(9);
    setColor(doc, GRAY_LABEL);
    doc.text('Nenhuma embalagem registrada para este lote.', M, y);
    y += 8;
  }

  // ── Footer certificate text ───────────────────────────────────────────────
  y = ensureSpace(doc, y, 20);
  y += 4;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  setColor(doc, GRAY_LABEL);
  doc.text('Certificado emitido eletronicamente sem necessidade de ser assinado.', PW / 2, y, { align: 'center' });

  addFooter(doc);
  doc.save(`COA-${result.lot || result.op_number || 'relatorio'}.pdf`);
}

// ─── BOLETA PDF ───────────────────────────────────────────────────────────────
export function generateBoletaPDF(container) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const PH_L = 210;
  const HALF = 297 / 2;

  function drawSide(offsetX) {
    const bM = offsetX + 8;
    const bW = HALF - 16;
    const regId = container.registration_id != null ? String(container.registration_id).padStart(2, '0') : '—';
    const envaseDate = container.created_date ? fmtDate(container.created_date) : '—';

    // Outer border
    setDraw(doc, [160, 160, 160]);
    doc.setLineWidth(0.6);
    doc.rect(offsetX + 4, 4, HALF - 8, PH_L - 8);

    // Header bar
    setFill(doc, BLUE_DARK);
    doc.rect(offsetX + 4, 4, HALF - 8, 16, 'F');
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    setColor(doc, [255, 255, 255]);
    doc.text(container.client || '—', bM + 2, 14);
    doc.setFontSize(12);
    doc.text(`ID ${regId}`, bM + bW, 14, { align: 'right' });

    let y = 26;

    // ── Section 1: N° PLACA | N° BARRIL | DATA — equal widths, all bold ──
    const s1H = 22;
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.3);
    doc.rect(bM, y, bW, s1H);
    const colW = bW / 3;
    doc.line(bM + colW, y, bM + colW, y + s1H);
    doc.line(bM + colW * 2, y, bM + colW * 2, y + s1H);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GRAY_LABEL);
    doc.text('N° PLACA', bM + colW * 0.5, y + 5, { align: 'center' });
    doc.text('N° BARRIL', bM + colW * 1.5, y + 5, { align: 'center' });
    doc.text('DATA', bM + colW * 2.5, y + 5, { align: 'center' });

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    setColor(doc, BLACK);
    doc.text(String(container.container_number || '—'), bM + colW * 0.5, y + 16, { align: 'center' });
    doc.text(String(container.barril_number || '—'), bM + colW * 1.5, y + 16, { align: 'center' });
    doc.text(envaseDate, bM + colW * 2.5, y + 16, { align: 'center' });
    y += s1H + 4;

    // ── Section 2: PRODUTO / CLIENTE — two rows ──
    const s2H = 24;
    doc.rect(bM, y, bW, s2H);
    doc.line(bM, y + s2H / 2, bM + bW, y + s2H / 2);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GRAY_LABEL);
    doc.text('PRODUTO', bM + 2, y + 4.5);
    doc.text('CLIENTE', bM + 2, y + s2H / 2 + 4.5);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    setColor(doc, BLACK);
    doc.text(String(container.product || '—'), bM + 28, y + 4.5);
    doc.text(String(container.client || '—'), bM + 28, y + s2H / 2 + 4.5);
    y += s2H + 4;

    // ── Section 3: LACRES | ESLINGA / GPS / MENOR TESTE ──
    const s3H = 42;
    doc.rect(bM, y, bW, s3H);
    doc.line(bM + bW * 0.5, y, bM + bW * 0.5, y + s3H);

    // Left: Lacres
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GRAY_LABEL);
    doc.text('LACRES', bM + 2, y + 5);

    const seals = (container.seals || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, BLACK);
    if (seals.length === 0) {
      doc.text('—', bM + 2, y + 12);
    } else {
      seals.slice(0, 6).forEach((s, i) => doc.text(s, bM + 2, y + 12 + i * 4.5));
    }

    // Right: Eslinga / GPS / Menor Teste — aligned rows
    const rightX = bM + bW * 0.5 + 4;
    const rightLabelW = 26;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GRAY_LABEL);
    doc.text('ESLINGA', rightX, y + 5);
    doc.text('GPS', rightX, y + 17);
    doc.text('MENOR TESTE', rightX, y + 29);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    setColor(doc, BLACK);
    doc.text(String(container.sling || '—'), rightX + rightLabelW, y + 5);
    doc.text(String(container.gps || '—'), rightX + rightLabelW, y + 17);
    doc.text(container.min_test_date ? fmtDate(container.min_test_date) : '—', rightX + rightLabelW, y + 29);
    y += s3H + 4;

    // ── Section 4: RESPONSÁVEL | PESOS — two columns ──
    const s4H = 34;
    doc.rect(bM, y, bW, s4H);
    doc.line(bM + bW * 0.38, y, bM + bW * 0.38, y + s4H);

    // Left: Responsável
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GRAY_LABEL);
    doc.text('RESPONSÁVEL', bM + 2, y + 5);

    setFill(doc, [245, 245, 245]);
    doc.rect(bM + 2, y + 8, bW * 0.38 - 4, 22, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    setColor(doc, BLACK);
    doc.text(String(container.operator || '—'), bM + bW * 0.19, y + 22, { align: 'center' });

    // Right: Pesos
    const wX = bM + bW * 0.38 + 4;
    const wLabelW = 34;
    const wValX = wX + wLabelW;
    const rows = [
      { label: 'TARA', value: fmtNum(container.tare, 3) + ' kg' },
      { label: 'PESO LÍQUIDO', value: fmtNum(container.net_weight, 3) + ' kg' },
      { label: 'PESO BRUTO', value: fmtNum(container.gross_weight, 3) + ' kg' },
    ];
    rows.forEach((r, i) => {
      const ry = y + 5 + i * 9;
      if (i > 0) {
        setDraw(doc, GRAY_BORDER);
        doc.setLineWidth(0.2);
        doc.line(wX, ry - 3, bM + bW - 2, ry - 3);
      }
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      setColor(doc, GRAY_LABEL);
      doc.text(r.label, wX, ry);
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      setColor(doc, BLACK);
      doc.text(r.value, wValX, ry);
    });
    y += s4H + 4;

    // ── Section 5: QUANTIDADE ENVASADA — full width highlight ──
    const s5H = 20;
    setFill(doc, [240, 245, 255]);
    setDraw(doc, BLUE_MID);
    doc.setLineWidth(0.4);
    doc.rect(bM, y, bW, s5H, 'FD');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(doc, BLUE_DARK);
    doc.text('QUANTIDADE ENVASADA', bM + 4, y + 8);

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    setColor(doc, BLACK);
    doc.text(fmtNum(container.volume, 3) + ' L', bM + bW - 4, y + 13, { align: 'right' });
  }

  drawSide(0);
  drawSide(HALF);

  doc.save(`boleta-${container.registration_id || container.container_number || 'vasilhame'}.pdf`);
}

// ─── ESTOQUE MP PDF ───────────────────────────────────────────────────────────
export function generateStockPDF(item, consumption) {
  const doc = new jsPDF();
  const title = `${item.entry_id || ''} — ${item.mp_name || ''}`.trim().replace(/^—\s*/, '');
  let y = addPageTitle(doc, title, 'Relatório de Estoque de Matéria Prima');

  y = addInfoGrid(doc, y, [
    ['ID Registro', item.entry_id || '—'],
    ['Data de Entrada', fmtDate(item.entry_date)],
    ['Código', item.mp_code || '—'],
    ['Nome', item.mp_name || '—'],
    ['Cliente', item.client || '—'],
    ['Lote', item.lot || '—'],
    ['Fornecedor', item.supplier || '—'],
    ['Unidade', item.unit || '—'],
    ['Data Fabricação', fmtDate(item.manufacture_date)],
    ['Data Validade', fmtDate(item.expiry_date)],
    ['Estoque Inicial', `${fmtNum(item.initial_stock)} ${item.unit}`],
    ['Saldo Atual', `${fmtNum(item.current_stock)} ${item.unit}`],
    ['Preço Unitário (R$)', (item.unit_price || 0).toFixed(4)],
    ['Custo Total (R$)', 'R$ ' + fmtMoney((item.current_stock || 0) * (item.unit_price || 0))],
    ['Tipo de Embalagem', item.packaging_type || '—'],
    ['Capacidade Embalagem (kg)', fmtNum(item.packaging_capacity, 3)],
    ['Qtd. de Embalagens', fmtNum(item.packaging_quantity, 1)],
  ], 3);

  if (item.observations) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY_LABEL);
    doc.text('OBSERVAÇÕES', M, y);
    y += 5;
    setColor(doc, BLACK);
    const lines = doc.splitTextToSize(item.observations, CW);
    doc.text(lines, M, y);
    y += lines.length * 5 + 6;
  }

  y = addSectionTitle(doc, y, 'Ordens de Produção que utilizaram este lote');

  if (!consumption || consumption.length === 0) {
    doc.setFontSize(9);
    setColor(doc, GRAY_LABEL);
    doc.text('Nenhuma OP utilizou este lote.', M, y);
  } else {
    const headers = ['OP', 'PRODUTO', 'DATA', `QTD. FISCAL (${item.unit})`, 'QTD. OP. (KG)'];
    const rows = consumption.map(c => [
      c.op_number || '—',
      (c.product || '—').substring(0, 30),
      fmtDate(c.date),
      fmtNum(c.qty_fiscal),
      fmtNum(c.qty_operational),
    ]);
    const tFiscal = consumption.reduce((s, c) => s + (c.qty_fiscal || 0), 0);
    const tOp     = consumption.reduce((s, c) => s + (c.qty_operational || 0), 0);
    const totalsRow = ['Total', '', '', fmtNum(tFiscal) + ` ${item.unit}`, fmtNum(tOp) + ' kg'];
    addTable(doc, y, headers, rows, [25, 60, 25, 35, 37], totalsRow);
  }

  addFooter(doc);
  doc.save(`estoque-${item.entry_id || (item.mp_name || 'mp').replace(/\s+/g, '-')}.pdf`);
}

// ─── TRANSBORDO / EXPEDIÇÃO PDF ──────────────────────────────────────────────
export function generateTransferPDF(transfer, density) {
  const doc = new jsPDF();
  const dens = density || 0;
  const title = (transfer.destinations || []).some(d => d.type === 'Expedição') && !(transfer.destinations || []).some(d => d.type === 'Transbordo')
    ? 'Expedição' : 'Transbordo';
  let y = addPageTitle(doc, `${transfer.transfer_number || '—'} — ${title}`, 'Relatório de Transferência de Produto');

  // ─── Dados Gerais
  y = ensureSpace(doc, y, 50);
  y = addSectionTitle(doc, y, 'Dados Gerais');
  y = addInfoGrid(doc, y, [
    ['N° Registro', transfer.transfer_number || '—'],
    ['Data', fmtDate(transfer.date)],
    ['Produto', transfer.product || '—'],
    ['Cliente', transfer.client || '—'],
    ['Operador', transfer.operator || '—'],
    ['Densidade PA', `${fmtNum(dens, 4)} g/mL`],
    ['Observações', transfer.observations || '—', 3],
  ], 3);

  // ─── Origens
  y = ensureSpace(doc, y, 40);
  y = addSectionTitle(doc, y, 'Origens (Vasilhames)');
  const origins = transfer.origins || [];
  if (origins.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL);
    doc.text('Nenhuma origem registrada.', M, y); y += 6;
  } else {
    const oHeaders = ['VASILHAME', 'BARRIL', 'LOTE', 'VOL. RETIRADO (L)', 'SALDO RESTANTE (L)'];
    const oRows = origins.map(o => [
      o.container_number || '—',
      o.barril_number || '—',
      o.lot || '—',
      fmtNum(o.volume_used, 3),
      fmtNum(o.remaining_stock, 3),
    ]);
    const tUsed = origins.reduce((s, o) => s + (o.volume_used || 0), 0);
    const tRem = origins.reduce((s, o) => s + (o.remaining_stock || 0), 0);
    const oTotals = ['Total', '', '', fmtNum(tUsed, 3) + ' L', fmtNum(tRem, 3) + ' L'];
    y = addTable(doc, y, oHeaders, oRows, [40, 30, 35, 40, 40], oTotals);
  }

  // ─── Resumo por Lote
  y = ensureSpace(doc, y, 35);
  y = addSectionTitle(doc, y, 'Resumo por Lote');
  const lotMap = {};
  origins.forEach(o => {
    const key = o.lot || 'Sem Lote';
    if (!lotMap[key]) lotMap[key] = { volume: 0, mass: 0 };
    lotMap[key].volume += parseFloat(o.volume_used) || 0;
    lotMap[key].mass += (parseFloat(o.volume_used) || 0) * dens;
  });
  const lotKeys = Object.keys(lotMap);
  if (lotKeys.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL);
    doc.text('Nenhum lote identificado.', M, y); y += 6;
  } else {
    const lHeaders = ['LOTE', 'VOLUME (L)', 'MASSA (kg)'];
    const lRows = lotKeys.map(k => [k, fmtNum(lotMap[k].volume, 3), fmtNum(lotMap[k].mass, 3)]);
    const lVolTotal = lotKeys.reduce((s, k) => s + lotMap[k].volume, 0);
    const lMassTotal = lotKeys.reduce((s, k) => s + lotMap[k].mass, 0);
    const lTotals = ['Total', fmtNum(lVolTotal, 3) + ' L', fmtNum(lMassTotal, 3) + ' kg'];
    y = addTable(doc, y, lHeaders, lRows, [80, 50, 50], lTotals);
  }

  // ─── Destinos
  y = ensureSpace(doc, y, 35);
  y = addSectionTitle(doc, y, 'Destinos');
  const dests = transfer.destinations || [];
  if (dests.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL);
    doc.text('Nenhum destino registrado.', M, y); y += 6;
  } else {
    const dHeaders = ['TIPO', 'IDENTIFICAÇÃO', 'VOL. (L)', 'MASSA (kg)', 'EMBALAGEM'];
    const dRows = dests.map(d => [
      d.type || '—',
      d.placa || d.barril || '—',
      fmtNum(d.volume, 3),
      fmtNum(d.mass, 3),
      d.packaging_type || '—',
    ]);
    const dVolTotal = dests.reduce((s, d) => s + (d.volume || 0), 0);
    const dMassTotal = dests.reduce((s, d) => s + (d.mass || 0), 0);
    const dTotals = ['Total', '', fmtNum(dVolTotal, 3) + ' L', fmtNum(dMassTotal, 3) + ' kg', ''];
    y = addTable(doc, y, dHeaders, dRows, [25, 45, 35, 35, 40], dTotals);
  }

  // ─── Detalhes dos Destinos (logística)
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Detalhes de Logística');
  dests.forEach((d, i) => {
    y = ensureSpace(doc, y, 45);
    y = addInfoGrid(doc, y, [
      ['Tipo', d.type || '—'],
      [d.type === 'Transbordo' ? 'N° Placa' : 'Placa', d.placa || '—'],
      [d.type === 'Transbordo' ? 'N° Barril' : 'Motorista', d.barril || d.driver || '—'],
      ['Volume (L)', fmtNum(d.volume, 3)],
      ['Massa (kg)', fmtNum(d.mass, 3)],
      ['Tipo Embalagem', d.packaging_type || '—'],
      ['Lacres', d.seals || '—'],
      ['Eslinga', d.sling || '—'],
      ['GPS', d.gps || '—'],
      ['Data Menor Teste', d.min_test_date ? fmtDate(d.min_test_date) : '—'],
      ['Tara (kg)', fmtNum(d.tare, 3)],
      ['Peso Líquido (kg)', fmtNum(d.net_weight, 3)],
      ['Peso Bruto (kg)', fmtNum(d.gross_weight, 3)],
    ], 3);
  });

  // ─── Totais Gerais
  y = ensureSpace(doc, y, 35);
  y = addSectionTitle(doc, y, 'Totais Gerais');
  const totalVolUsed = origins.reduce((s, o) => s + (parseFloat(o.volume_used) || 0), 0);
  const totalMassUsed = totalVolUsed * dens;
  const totalVolDest = dests.reduce((s, d) => s + (parseFloat(d.volume) || 0), 0);
  const totalMassDest = dests.reduce((s, d) => s + (parseFloat(d.mass) || 0), 0);
  y = addInfoGrid(doc, y, [
    ['Volume Total Retirado', `${fmtNum(totalVolUsed, 3)} L`],
    ['Massa Total Retirada', `${fmtNum(totalMassUsed, 3)} kg`],
    ['Volume Total Destino', `${fmtNum(totalVolDest, 3)} L`],
    ['Massa Total Destino', `${fmtNum(totalMassDest, 3)} kg`],
  ], 2);

  addFooter(doc);
  doc.save(`transbordo-${transfer.transfer_number || 'registro'}.pdf`);
}

// ─── INVENTÁRIO PDF ────────────────────────────────────────────────────────────
export function generateInventoryPDF(inventory) {
  const doc = new jsPDF();
  let y = addPageTitle(doc, `Inventário ${inventory.inventory_number || ''}`, 'Relatório de Inventário Físico de Estoque');

  const clients = parseArr(inventory.clients).length ? parseArr(inventory.clients) : [inventory.clients || '—'];
  const products = parseArr(inventory.products).length ? parseArr(inventory.products) : [inventory.products || '—'];
  const lots = parseArr(inventory.lots).length ? parseArr(inventory.lots) : [inventory.lots || '—'];

  y = addInfoGrid(doc, y, [
    ['Nº Inventário', inventory.inventory_number || '—'],
    ['Status', inventory.status || '—'],
    ['Cliente(s)', clients.join(', ') || '—', 2],
    ['Data de Abertura', fmtDateTime(inventory.opening_date)],
    ['Aberto por', inventory.opened_by || '—'],
    ['Data de Início', fmtDateTime(inventory.start_date)],
    ['Iniciado por', inventory.started_by || '—'],
    ['Data de Finalização', fmtDateTime(inventory.closing_date)],
    ['Finalizado por', inventory.closed_by || '—'],
    ['Produto(s)', products.join(', ') || '—', 2],
    ['Lote(s)', lots.join(', ') || '—', 2],
  ], 2);

  y = addSectionTitle(doc, y, 'Conferência de Itens');

  const items = parseArr(inventory.items);
  if (items.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL);
    doc.text('Nenhum item neste inventário.', M, y); y += 8;
  } else {
    const headers = ['PRODUTO', 'CLIENTE', 'LOTE', 'QTD. ESTOQUE', 'QTD. FÍSICA', 'DIFERENÇA', 'DIF. %'];
    const rows = items.map(it => {
      const unit = it.unit || 'kg';
      const physicalTotal = it.physical_total != null ? it.physical_total : ((it.physical_packages || 0) * (it.packaging_capacity || 0) + (it.fractional_qty || 0));
      const diff = it.difference != null ? it.difference : (physicalTotal - (it.registered_stock || 0));
      const diffPct = it.difference_pct != null ? it.difference_pct : ((it.registered_stock || 0) > 0 ? (diff / it.registered_stock) * 100 : 0);
      return [
        (it.product || '—'),
        (it.client || '—'),
        (it.lot || '—'),
        fmtNum(it.registered_stock, 1) + ' ' + unit,
        fmtNum(physicalTotal, 1) + ' ' + unit,
        (diff >= 0 ? '+' : '') + fmtNum(diff, 1) + ' ' + unit,
        (diffPct >= 0 ? '+' : '') + fmtNum(diffPct, 1) + '%',
      ];
    });
    y = addTable(doc, y, headers, rows, [44, 28, 22, 26, 26, 22, 14], null, [0, 1, 2]);
  }

  // Color-code differences
  items.forEach((it, idx) => {
    if (idx >= items.length) return;
  });

  addFooter(doc);
  doc.save(`inventario-${inventory.inventory_number || 'relatorio'}.pdf`);
}

// ─── ESTOQUE CLIENTE PDF ───────────────────────────────────────────────────────
export function generateClientStockPDF({ client, stocks, containers, tanks }) {
  const doc = new jsPDF();
  const clientLabel = client === 'Todos os Clientes' ? 'Todos os Clientes' : client;
  let y = addPageTitle(doc, `Estoque — ${clientLabel}`, 'Relatório Completo de Estoque por Cliente');

  // ── Resumo Geral
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Resumo Geral');
  const totalMPVolume = stocks.reduce((s, i) => s + (i.current_stock || 0), 0);
  const totalContainerVolume = containers.reduce((s, c) => s + (c.volume || 0), 0);
  const totalContainerMass = containers.reduce((s, c) => s + (c.net_weight || 0), 0);
  const totalTankVolume = tanks.reduce((s, t) => s + (t.current_volume || 0), 0);

  y = addInfoGrid(doc, y, [
    ['Cliente', clientLabel, 2],
    ['Data do Relatório', fmtDate(new Date().toISOString())],
    ['Total Itens MP', String(stocks.length)],
    ['Total Vasilhames', String(containers.length)],
    ['Total Tankas', String(tanks.length)],
    ['Saldo Total MP', fmtNum(totalMPVolume, 1)],
    ['Volume Total Vasilhames', fmtNum(totalContainerVolume, 1) + ' L'],
    ['Massa Total Vasilhames', fmtNum(totalContainerMass, 1) + ' kg'],
    ['Volume Total Tankagem', fmtNum(totalTankVolume, 1) + ' L'],
  ], 3);

  // ── Matéria Prima
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Estoque de Matéria Prima');
  if (stocks.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL);
    doc.text('Nenhum item de matéria prima encontrado.', M, y); y += 8;
  } else {
    const mpHeaders = ['CÓD. MP', 'PRODUTO', 'LOTE', 'SALDO INICIAL', 'SALDO ATUAL', 'UN.', 'VALIDADE'];
    const mpRows = stocks.map(s => [
      (s.mp_code || '—').substring(0, 10),
      (s.mp_name || '—').substring(0, 24),
      (s.lot || '—').substring(0, 16),
      fmtNum(s.initial_stock, 1),
      fmtNum(s.current_stock, 1),
      s.unit || '—',
      fmtDate(s.expiry_date),
    ]);
    y = addTable(doc, y, mpHeaders, mpRows, [22, 42, 30, 25, 25, 12, 26], null);
  }

  // ── Vasilhames
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Vasilhames');
  if (containers.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL);
    doc.text('Nenhum vasilhame encontrado.', M, y); y += 8;
  } else {
    const cHeaders = ['N° EMBALAGEM', 'BARRIL', 'PRODUTO', 'LOTE', 'TIPO', 'VOL. (L)', 'LÍQ. (KG)'];
    const cRows = containers.map(c => [
      (c.container_number || '—').substring(0, 16),
      (c.barril_number || '—').substring(0, 14),
      (c.product || '—').substring(0, 24),
      (c.lot || '—').substring(0, 16),
      (c.type || '—').substring(0, 18),
      fmtNum(c.volume, 1),
      fmtNum(c.net_weight, 1),
    ]);
    const tVol = containers.reduce((s, c) => s + (c.volume || 0), 0);
    const tNet = containers.reduce((s, c) => s + (c.net_weight || 0), 0);
    y = addTable(doc, y, cHeaders, cRows, [26, 20, 40, 25, 25, 23, 23], ['Total', '', '', '', '', fmtNum(tVol, 1) + ' L', fmtNum(tNet, 1) + ' kg']);
  }

  // ── Tankagem
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, 'Tankagem');
  if (tanks.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL);
    doc.text('Nenhuma tanka encontrada.', M, y); y += 8;
  } else {
    const tHeaders = ['TANKA', 'PRODUTO', 'LOTE', 'VOLUME ATUAL (L)', 'TAXA DE OCUPAÇÃO'];
    const tRows = tanks.map(t => {
      const vol = t.current_volume || 0;
      const cap = t.capacity || 26000;
      const pct = cap > 0 ? Math.min(100, (vol / cap) * 100) : 0;
      const products = (t.computed_products || []).join(', ') || (t.product || '—');
      return [
        (t.name || '—').substring(0, 20),
        products.substring(0, 30),
        (t.computed_lot || t.lot || '—').substring(0, 16),
        fmtNum(vol, 1),
        pct.toFixed(1) + '%',
      ];
    });
    const tVol = tanks.reduce((s, t) => s + (t.current_volume || 0), 0);
    y = addTable(doc, y, tHeaders, tRows, [35, 55, 30, 35, 27], ['Total', '', '', fmtNum(tVol, 1) + ' L', '']);
  }

  addFooter(doc);
  const fileName = `estoque-cliente-${(clientLabel || 'relatorio').replace(/\s+/g, '-').toLowerCase()}.pdf`;
  doc.save(fileName);
}
