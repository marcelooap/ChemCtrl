import { jsPDF } from 'jspdf';
import i18n from '@/i18n';
import {
  fmtDate as fmtDateIntl,
  fmtDateTime as fmtDateTimeIntl,
  fmtNumber,
  fmtCurrency,
} from '@/i18n/formatters';
import {
  containerLiveNetWeight,
  containerLiveGrossWeight,
  resolveProductDensity,
  stockUnitPriceOf,
} from '@/lib/productionViewUtils';
import {
  allocateMpQuantitiesByNetWeight,
  aggregateAllocatedMaterials,
} from '@/lib/productionFiscalShare';
import { materialsFromOriginRows } from '@/lib/containerOrigins';
import {
  containerDisplayVolume,
  containerDisplayNetWeight,
  containerDisplayGrossWeight,
} from '@/lib/fractionalSupply';
import { calcPriceWithoutTax } from '@/lib/recipePricing';
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

export function getPdfLabels(locale) {
  const lang = locale || i18n.language || 'pt-BR';
  const t = (key, opts) => i18n.t(key, { ...opts, lng: lang });
  return { lang, t };
}

function makePdfFormatters(lang) {
  const dash = '-';
  const fmtDate = (d, opts) => {
    const r = fmtDateIntl(d, opts, lang);
    return r === '—' ? dash : r;
  };
  const fmtDateTime = (d, opts) => {
    const r = fmtDateTimeIntl(d, opts, lang);
    return r === '—' ? dash : r;
  };
  const fmtNum = (n, decimals = 0) =>
    fmtNumber(n ?? 0, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }, lang);
  const fmtMoney = (n) => fmtCurrency(n ?? 0, 'BRL', lang);
  const na = () => i18n.t('common.notApplicable', { lng: lang });
  return { fmtDate, fmtDateTime, fmtNum, fmtMoney, na, dash };
}

export function fmtNum(n, decimals = 0) {
  return makePdfFormatters(i18n.language || 'pt-BR').fmtNum(n, decimals);
}
export function fmtDate(d) {
  return makePdfFormatters(i18n.language || 'pt-BR').fmtDate(d);
}
export function fmtMoney(n) {
  return makePdfFormatters(i18n.language || 'pt-BR').fmtMoney(n);
}

function ensureSpace(doc, y, needed) {
  if (y + needed > PH - 20) { doc.addPage(); return 20; }
  return y;
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

function addFooter(doc, lang) {
  const { t } = getPdfLabels(lang);
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    setDraw(doc, GRAY_BORDER);
    doc.setLineWidth(0.3);
    doc.line(M, PH - 13, PW - M, PH - 13);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY_LABEL);
    doc.text(t('pdf.footer'), M, PH - 8);
    doc.text(t('pdf.page', { current: i, total: pages }), PW - M, PH - 8, { align: 'right' });
  }
}

function addDiagonalWatermark(doc, text) {
  const pages = doc.internal.getNumberOfPages();
  const label = String(text);
  // Referência visual: ~45°, centralizada, atravessando a página sem cortar nas bordas
  const angle = 45;

  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.13 }));
    doc.setFont('helvetica', 'bold');

    // Tamanho proporcional à largura útil (equivalente ao print de referência)
    doc.setFontSize(10);
    const unitWidth = doc.getTextWidth(label) || 1;
    const targetWidth = CW * 0.92;
    const fontSize = Math.max(32, Math.min(46, (targetWidth) / (unitWidth / 10)));
    doc.setFontSize(fontSize);

    setColor(doc, [168, 174, 184]);
    doc.text(label, PW / 2, PH / 2, {
      align: 'center',
      baseline: 'middle',
      angle,
    });
    doc.restoreGraphicsState();
    setColor(doc, BLACK);
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

export function generateRecipePDF(recipe, options) {
  const { hideMpNames } = options || {};
  const { lang, t } = getPdfLabels();
  const { fmtDate, fmtNum } = makePdfFormatters(lang);
  const doc = new jsPDF();
  const idLabel = recipe.code ? (recipe.code + ' - ' + recipe.product_name) : recipe.product_name;
  let y = addPageTitle(doc, idLabel, t('pdf.recipe.subtitle'));
  const priceFmt = { minimumFractionDigits: 4, maximumFractionDigits: 4 };
  const priceWithTax = recipe.price || 0;
  y = addInfoGrid(doc, y, [
    [t('pdf.fields.productCode'), recipe.code || '-'],
    [t('pdf.common.client'), recipe.client || '-'],
    [t('pdf.recipe.fields.priceWithTax'), hideMpNames ? '*****' : fmtCurrency(priceWithTax, 'BRL', lang, priceFmt)],
    [t('pdf.recipe.fields.priceWithoutTax'), hideMpNames ? '*****' : fmtCurrency(calcPriceWithoutTax(priceWithTax), 'BRL', lang, priceFmt)],
    [t('pdf.recipe.fields.revision'), recipe.revision || '-'],
    [t('pdf.fields.revisionDate'), recipe.revision_date || '-'],
    [t('pdf.fields.densityPA'), (recipe.density || '-') + ' ' + t('pdf.common.densityUnit')],
    [t('pdf.fields.validity'), recipe.validity_days ? t('pdf.common.days', { count: recipe.validity_days }) : '-'],
  ], 3);
  y = addSectionTitle(doc, y, t('pdf.recipe.sectionRawMaterials'));
  const headers = [
    t('pdf.recipe.columns.mpCode'),
    t('pdf.recipe.columns.mpName'),
    t('pdf.recipe.columns.density'),
    t('pdf.recipe.columns.percentMM'),
    t('pdf.recipe.columns.qtyKg'),
  ];
  const mps = recipe.raw_materials || [];
  const rows = mps.map(function(m) {
    return [m.mp_code || '-', hideMpNames ? '*******' : (m.mp_name || '-'), m.mp_density || '-', fmtNum(m.percentage, 2) + '%', fmtNum(m.quantity_kg, 3)];
  });
  const totalPct = mps.reduce(function(s, m) { return s + (m.percentage || 0); }, 0);
  const totalKg  = mps.reduce(function(s, m) { return s + (m.quantity_kg  || 0); }, 0);
  y = addTable(doc, y, headers, rows, [36, 68, 24, 24, 30], [t('pdf.common.total'), '', '', fmtNum(totalPct, 2) + '%', fmtNum(totalKg, 3) + ' kg']);

  const confidential = t('pdf.recipe.confidentialNotice');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  setColor(doc, GRAY_LABEL);
  const confidentialLines = doc.splitTextToSize(confidential, CW);
  const confidentialY = Math.max(y + 10, PH - 22 - confidentialLines.length * 4);
  doc.text(confidentialLines, PW / 2, confidentialY, { align: 'center' });
  setColor(doc, BLACK);

  addDiagonalWatermark(doc, t('pdf.recipe.confidentialWatermark'));
  addFooter(doc, lang);
  doc.save('receita-' + (recipe.product_name || 'receita').replace(/\s+/g, '-') + '.pdf');
}

export function generateOrderPDF(order, productions, containers) {
  const { lang, t } = getPdfLabels();
  const { fmtDate, fmtNum } = makePdfFormatters(lang);
  const doc = new jsPDF();
  let y = addPageTitle(doc, t('pdf.order.title', { number: order.order_number || '' }), t('pdf.order.subtitle'));
  y = addInfoGrid(doc, y, [
    [t('pdf.fields.internalOrder'), order.order_number || '-'],
    [t('pdf.common.date'), fmtDate(order.date)],
    [t('pdf.common.status'), order.status || '-'],
    [t('pdf.common.product'), order.product || '-'],
    [t('pdf.common.client'), order.client || '-'],
    [t('pdf.fields.requester'), order.requester || '-'],
    [t('pdf.fields.clientOrder'), order.client_order || '-'],
    [t('pdf.fields.expectedDate'), fmtDate(order.expected_date)],
    [t('pdf.fields.volumeOrdered'), fmtNum(order.volume_ordered, 1)],
    [t('pdf.fields.volumeProduced'), fmtNum(order.volume_produced, 1)],
    [t('pdf.fields.volumePending'), fmtNum(order.volume_pending, 1)],
  ], 3);
  if (order.observations) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
    doc.text(t('pdf.common.observations'), M, y); y += 5; setColor(doc, BLACK);
    const lines = doc.splitTextToSize(order.observations, CW);
    doc.text(lines, M, y); y += lines.length * 5 + 6;
  }
  y = addSectionTitle(doc, y, t('pdf.order.sectionOps'));
  if (!productions || productions.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.order.noOps'), M, y); y += 10;
  } else {
    const headers = [
      t('pdf.order.columns.op'),
      t('pdf.order.columns.status'),
      t('pdf.order.columns.date'),
      t('pdf.order.columns.volumeL'),
      t('pdf.order.columns.containers'),
    ];
    const rows = productions.map(function(p) {
      const opContainers = (containers || []).filter(function(c) { return c.op_number === p.op_number; }).map(function(c) { return c.container_number; }).filter(Boolean);
      return [p.op_number || '-', p.status || '-', fmtDate(p.end_time), fmtNum(p.volume, 1) + ' L', opContainers.length ? opContainers.join(', ') : '-'];
    });
    const totalVol = productions.reduce(function(s, p) { return s + (p.volume || 0); }, 0);
    y = addTable(doc, y, headers, rows, [25, 32, 30, 28, 67], [t('pdf.common.total'), '', '', fmtNum(totalVol, 1) + ' L', '']);
  }
  addFooter(doc, lang);
  doc.save('pedido-' + (order.order_number || 'relatorio') + '.pdf');
}

/**
 * Shared OP fiscal report layout.
 * @param {object} [options]
 * @param {Array} [options.materials] - override raw materials (tank-scoped reports)
 * @param {Array} [options.recipes]
 * @param {string} [options.extraNote] - optional note after the info grid
 * @param {string} [options.subtitle] - title subtitle override
 */
function formatProductionDuration(ms, t) {
  if (!ms || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0
    ? t('production.list.durationHours', { hours: h, minutes: m })
    : t('production.list.durationMinutes', { minutes: m });
}

function drawPhaseTimeCard(doc, y, title, accent, rows) {
  const cardH = 24;
  y = ensureSpace(doc, y, cardH + 4);
  setFill(doc, accent.bg);
  setDraw(doc, accent.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, CW, cardH, 1.5, 1.5, 'FD');
  setFill(doc, accent.border);
  doc.rect(M, y, 2.5, cardH, 'F');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  setColor(doc, accent.title);
  doc.text(title, M + 6, y + 6.5);
  const colW = (CW - 12) / Math.max(rows.length, 1);
  rows.forEach(function(row, i) {
    const x = M + 6 + i * colW;
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GRAY_LABEL);
    doc.text(String(row[0]).toUpperCase(), x, y + 12.5);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    setColor(doc, accent.value || BLACK);
    const lines = doc.splitTextToSize(String(row[1] != null ? row[1] : '-'), colW - 4);
    doc.text(lines[0] || '-', x, y + 18.5);
  });
  setColor(doc, BLACK);
  return y + cardH + 4;
}

function drawMetricCards(doc, y, cards) {
  const gap = 3;
  const cardW = (CW - gap * (cards.length - 1)) / cards.length;
  const cardH = 22;
  y = ensureSpace(doc, y, cardH + 4);
  cards.forEach(function(card, i) {
    const x = M + i * (cardW + gap);
    setFill(doc, card.bg);
    setDraw(doc, card.border || GRAY_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GRAY_LABEL);
    doc.text(String(card.label).toUpperCase(), x + 3, y + 6);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    setColor(doc, card.color || BLUE_DARK);
    doc.text(String(card.value), x + 3, y + 13.5);
    if (card.sub) {
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'normal');
      setColor(doc, GRAY_LABEL);
      doc.text(String(card.sub), x + 3, y + 18.5);
    }
  });
  setColor(doc, BLACK);
  return y + cardH + 6;
}

function drawProductionTimesSection(doc, y, production, t, fmtDateTime) {
  const startMs = production.start_time ? new Date(production.start_time).getTime() : null;
  if (!startMs) return y;

  const endMs = production.end_time ? new Date(production.end_time).getTime() : null;
  const qcStartMs = production.qc_start_time ? new Date(production.qc_start_time).getTime() : null;
  const envaseStartMs = production.envase_start_time ? new Date(production.envase_start_time).getTime() : null;
  const pauseMs = production.total_pause_ms || 0;
  const na = t('common.notAvailable');

  const prodMs = (qcStartMs && startMs)
    ? (qcStartMs - startMs - pauseMs)
    : (endMs && startMs && !qcStartMs) ? (endMs - startMs - pauseMs) : null;
  const qcMs = (envaseStartMs && qcStartMs) ? (envaseStartMs - qcStartMs) : null;
  const envaseMs = (endMs && envaseStartMs) ? (endMs - envaseStartMs) : null;
  const totalMs = (endMs && startMs) ? ((prodMs || 0) + (qcMs || 0) + (envaseMs || 0)) : null;

  const fmtDur = function(ms) { return formatProductionDuration(ms, t) || na; };
  const prodDurLabel = fmtDur(prodMs) + (pauseMs > 0
    ? t('production.list.pauseLabel', { duration: fmtDur(pauseMs) })
    : '');

  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, t('pdf.production.sectionTimes'));

  y = drawPhaseTimeCard(doc, y, t('pdf.production.phaseProduction'), {
    bg: [239, 246, 255],
    border: [37, 99, 195],
    title: [29, 78, 216],
    value: [29, 78, 216],
  }, [
    [t('production.fields.startTime'), production.start_time ? fmtDateTime(production.start_time) : na],
    [t('production.fields.endTime'), qcStartMs
      ? fmtDateTime(production.qc_start_time)
      : (endMs ? fmtDateTime(production.end_time) : na)],
    [t('production.list.timeMinusPause'), prodDurLabel],
  ]);

  y = drawPhaseTimeCard(doc, y, t('pdf.production.phaseQuality'), {
    bg: [255, 251, 235],
    border: [217, 119, 6],
    title: [180, 83, 9],
    value: [180, 83, 9],
  }, [
    [t('production.fields.startTime'), production.qc_start_time ? fmtDateTime(production.qc_start_time) : na],
    [t('production.fields.endTime'), envaseStartMs ? fmtDateTime(production.envase_start_time) : na],
    [t('pdf.production.duration'), fmtDur(qcMs)],
  ]);

  y = drawPhaseTimeCard(doc, y, t('pdf.production.phasePackaging'), {
    bg: [250, 245, 255],
    border: [126, 34, 206],
    title: [107, 33, 168],
    value: [107, 33, 168],
  }, [
    [t('production.fields.startTime'), production.envase_start_time ? fmtDateTime(production.envase_start_time) : na],
    [t('production.fields.endTime'), endMs ? fmtDateTime(production.end_time) : na],
    [t('pdf.production.duration'), fmtDur(envaseMs)],
  ]);

  if (totalMs) {
    y = ensureSpace(doc, y, 18);
    setFill(doc, [240, 253, 244]);
    setDraw(doc, [22, 163, 74]);
    doc.setLineWidth(0.4);
    doc.roundedRect(M, y, CW, 14, 1.5, 1.5, 'FD');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(doc, [21, 128, 61]);
    doc.text(t('pdf.production.totalTime'), M + 4, y + 5.5);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY_LABEL);
    doc.text(t('pdf.production.totalTimeBreakdown'), M + 4, y + 11);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    setColor(doc, [21, 128, 61]);
    doc.text(fmtDur(totalMs), PW - M - 4, y + 9, { align: 'right' });
    setColor(doc, BLACK);
    y += 18;
  }
  return y;
}

function drawProductionCostSection(doc, y, production, stocks, recipes, t, fmtNum, fmtMoney) {
  const mps = parseArr(production.raw_materials_used);
  const mpCostRows = mps.map(function(m) {
    const price = stockUnitPriceOf(m, stocks);
    const qty = m.qty_fiscal || 0;
    const unit = (stocks && m.stock_id)
      ? ((stocks.find(function(x) { return x.id === m.stock_id; }) || {}).unit || 'kg')
      : 'kg';
    return { name: m.mp_name, unit: unit, price: price, qty: qty, cost: price * qty };
  });
  const totalMpCost = mpCostRows.reduce(function(s, r) { return s + r.cost; }, 0);
  const recipe = (recipes || []).find(function(r) { return r.product_name === production.product; });
  const productPrice = recipe?.price || production.unit_price || 0;
  const mass = production.mass || 0;
  const moCost = productPrice * mass;
  const totalCost = totalMpCost + moCost;
  const costPerKg = mass > 0 ? totalCost / mass : 0;
  const pctMp = totalCost > 0 ? (totalMpCost / totalCost) * 100 : 0;
  const pctMo = totalCost > 0 ? (moCost / totalCost) * 100 : 0;

  y = ensureSpace(doc, y, 40);
  y = addSectionTitle(doc, y, t('pdf.production.sectionCosts'));

  const costHeaders = [
    t('pdf.production.costColumns.rawMaterial'),
    t('pdf.production.columns.qtyFiscal'),
    t('pdf.production.costColumns.unitPrice'),
    t('pdf.production.costColumns.cost'),
  ];
  const costRows = mpCostRows.map(function(r) {
    return [
      r.name || '-',
      fmtNum(r.qty, 3) + ' ' + r.unit,
      fmtNum(r.price, 4),
      fmtMoney(r.cost),
    ];
  });
  costRows.push([
    t('pdf.production.laborCost'),
    t('pdf.production.laborFormula', { price: fmtNum(productPrice, 4), mass: fmtNum(mass, 3) }),
    '',
    fmtMoney(moCost),
  ]);

  y = addTable(
    doc,
    y,
    costHeaders,
    costRows,
    [70, 42, 36, 34],
    [t('pdf.production.totalCost'), '', '', fmtMoney(totalCost)],
  );

  y = drawMetricCards(doc, y, [
    {
      label: t('pdf.production.costMp'),
      value: fmtMoney(totalMpCost),
      sub: t('pdf.production.percentOfTotal', { percent: pctMp.toFixed(1) }),
      bg: [239, 246, 255],
      border: [191, 219, 254],
      color: BLUE_MID,
    },
    {
      label: t('pdf.production.costMo'),
      value: fmtMoney(moCost),
      sub: t('pdf.production.percentOfTotal', { percent: pctMo.toFixed(1) }),
      bg: [250, 245, 255],
      border: [221, 214, 254],
      color: [107, 33, 168],
    },
    {
      label: t('pdf.production.totalCost'),
      value: fmtMoney(totalCost),
      bg: [240, 253, 244],
      border: [187, 247, 208],
      color: [21, 128, 61],
    },
    {
      label: t('pdf.production.costPerKg'),
      value: fmtMoney(costPerKg),
      bg: [255, 251, 235],
      border: [253, 230, 138],
      color: [180, 83, 9],
    },
  ]);
  return y;
}

function drawProductionReport(doc, production, containers, stocks, options = {}) {
  const { lang, t } = getPdfLabels();
  const { fmtDate, fmtDateTime, fmtNum, fmtMoney, na } = makePdfFormatters(lang);
  const recipes = options.recipes || [];
  const complete = !!options.complete;
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
  const pkgs = containers && containers.length > 0 ? containers : [];
  let packagingLabel = production.packaging_type || production.packaging_info || '-';
  if (pkgs.length === 1) {
    packagingLabel = pkgs[0].container_number || packagingLabel;
  } else if (pkgs.length > 1) {
    packagingLabel = t('pdf.production.fields.packagingCount', {
      count: String(pkgs.length).padStart(2, '0'),
    });
  }

  const infoPairs = [
    [t('pdf.production.fields.op'), production.op_number || '-'],
    [t('pdf.common.lot'), production.lot || '-'],
    [t('pdf.production.fields.stage'), { __badge: true, status: production.status || '-' }],
    [t('pdf.common.product'), production.product || '-'],
    [t('pdf.common.client'), production.client || '-'],
    [t('pdf.production.fields.clientOrder'), production.client_order || '-'],
    [t('pdf.production.fields.volumeL'), fmtNum(production.volume, 1) + ' L'],
    [t('pdf.production.fields.massKg'), fmtNum(production.mass, 3) + ' kg'],
    [t('pdf.fields.density'), (production.density || '-') + ' ' + t('pdf.common.densityUnit')],
    [t('pdf.production.fields.finishDate'), fmtDate(production.end_time)],
    [t('pdf.production.fields.unitPrice'), fmtCurrency(production.unit_price || 0, 'BRL', lang) + t('pdf.common.perKg')],
    [t('pdf.production.fields.totalValue'), fmtMoney(production.total_value)],
    [t('pdf.fields.priority'), production.priority || '-'],
    [t('pdf.common.operator'), production.operator || '-'],
    [t('pdf.production.fields.packaging'), packagingLabel],
  ];
  if (complete) {
    infoPairs.push(
      [t('pdf.production.fields.revision'), production.recipe_revision || '-'],
      [t('pdf.production.fields.startTime'), production.start_time ? fmtDateTime(production.start_time) : '-'],
      [t('pdf.production.fields.qcStart'), production.qc_start_time ? fmtDateTime(production.qc_start_time) : '-'],
      [t('pdf.production.fields.packagingStart'), production.envase_start_time ? fmtDateTime(production.envase_start_time) : '-'],
      [t('pdf.production.fields.bypassQc'), production.bypass_qc ? t('common.yes') : t('common.no')],
    );
  }

  let y = addPageTitle(doc, opTitle, options.subtitle || t('pdf.production.subtitle'));
  y = addInfoGrid(doc, y, infoPairs, 3);
  if (options.extraNote) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
    const noteLines = doc.splitTextToSize(options.extraNote, CW);
    doc.text(noteLines, M, y); y += noteLines.length * 5 + 4; setColor(doc, BLACK);
  }
  if (production.observations) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
    doc.text(t('pdf.common.observations'), M, y); y += 5; setColor(doc, BLACK);
    const lines = doc.splitTextToSize(production.observations, CW);
    doc.text(lines, M, y); y += lines.length * 5 + 6;
  }
  y = addSectionTitle(doc, y, t('pdf.production.sectionRawMaterials'));
  const mps = options.materials != null ? options.materials : parseArr(production.raw_materials_used);
  if (mps.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.production.noRawMaterials'), M, y); y += 10;
  } else {
    const units = mps.map(stockUnitOf);
    const allSameUnit = units.length > 0 && units.every(function(u) { return u === units[0]; });
    const fiscalUnit = allSameUnit ? units[0] : '';
    const mpHeaders = [
      t('pdf.production.columns.code'),
      t('pdf.production.columns.name'),
      t('pdf.production.columns.lot'),
      t('pdf.production.columns.qtyFiscal'),
      t('pdf.production.columns.qtyOperational'),
    ];
    const mpRows = mps.map(function(m, i) { return [m.mp_code || '-', m.mp_name || '-', liveLotOf(m) || '-', fmtNum(m.qty_fiscal, 3) + ' ' + units[i], fmtNum(m.qty_operational, 3) + ' kg']; });
    const tFiscal = mps.reduce(function(s, m) { return s + (m.qty_fiscal || 0); }, 0);
    const tOp = mps.reduce(function(s, m) { return s + (m.qty_operational || 0); }, 0);
    y = addTable(doc, y, mpHeaders, mpRows, [30, 62, 28, 34, 28], [t('pdf.common.total'), '', '', (fiscalUnit ? fmtNum(tFiscal, 3) + ' ' + fiscalUnit : fmtNum(tFiscal, 3)), fmtNum(tOp, 3) + ' kg']);
  }
  if (containers && containers.length > 0) {
    y = addSectionTitle(doc, y, t('pdf.production.sectionPackaging'));
    const cHeaders = [
      t('pdf.production.packagingColumns.container'),
      t('pdf.production.packagingColumns.type'),
      t('pdf.production.packagingColumns.volume'),
      t('pdf.production.packagingColumns.netWeight'),
      t('pdf.production.packagingColumns.grossWeight'),
      t('pdf.production.packagingColumns.tare'),
    ];
    const cRows = containers.map(function(c, i) {
      const tareVal = (c.tare != null && c.tare !== '') ? fmtNum(c.tare, 3) : na();
      const liveNet = containerLiveNetWeight(c, production, recipes);
      const liveGross = containerLiveGrossWeight(c, production, recipes);
      const seq = String(i + 1).padStart(2, '0');
      const label = complete
        ? (seq + ' - ' + (c.container_number || '-'))
        : (c.container_number || '-');
      return [label, c.type || '-', fmtNum(c.volume, 1), fmtNum(liveNet, 0), fmtNum(liveGross, 0), tareVal];
    });
    const tVol = containers.reduce(function(s, c) { return s + (c.volume || 0); }, 0);
    const tNet = containers.reduce(function(s, c) { return s + containerLiveNetWeight(c, production, recipes); }, 0);
    const tGross = containers.reduce(function(s, c) { return s + containerLiveGrossWeight(c, production, recipes); }, 0);
    y = addTable(doc, y, cHeaders, cRows, [42, 36, 26, 26, 26, 26], [t('pdf.common.total'), '', fmtNum(tVol, 1) + ' L', fmtNum(tNet, 0) + ' kg', fmtNum(tGross, 0) + ' kg', '']);
  }

  if (complete) {
    y = drawProductionTimesSection(doc, y, production, t, fmtDateTime);
    y = drawProductionCostSection(doc, y, production, stocks, recipes, t, fmtNum, fmtMoney);
  }

  addFooter(doc, lang);
}

export function generateProductionPDF(production, containers, stocks, recipes = []) {
  const { t } = getPdfLabels();
  const doc = new jsPDF({ format: 'a4' });
  drawProductionReport(doc, production, containers, stocks, {
    recipes,
    complete: true,
    subtitle: t('pdf.production.completeSubtitle'),
  });
  doc.save(productionOpPdfFilename(production.op_number));
}

function safePdfFilenamePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Complete OP report (all tanks or no tanks yet): OP57.pdf */
function productionOpPdfFilename(opNumber) {
  return (safePdfFilenamePart(opNumber) || 'producao') + '.pdf';
}

/**
 * Tank fiscal report naming:
 * - full OP (all tanks / no tank split) → OP57.pdf
 * - specific tank(s) → OP60 - 15918-9.pdf
 */
function productionTankFiscalPdfFilename(opNumber, tankLabels, isFullOp) {
  const op = safePdfFilenamePart(opNumber) || 'producao';
  if (isFullOp) return op + '.pdf';
  const tanks = (tankLabels || []).map(safePdfFilenamePart).filter(Boolean);
  if (tanks.length === 0) return op + '.pdf';
  return op + ' - ' + tanks.join(', ') + '.pdf';
}

/** Prefer the live viewing production when resolving MP data for PDF. */
function productionsWithViewer(productions, viewerProduction) {
  if (!viewerProduction?.id) return Array.isArray(productions) ? productions : [];
  const list = Array.isArray(productions) ? productions.slice() : [];
  const idx = list.findIndex((p) => p.id === viewerProduction.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...viewerProduction };
  else list.push(viewerProduction);
  return list;
}

/**
 * Full OP fiscal report (all MP quantities, no tank split).
 * Used when envase has not been registered yet.
 */
export function generateProductionOpFiscalPDF(production, stocks, recipes = []) {
  const { t } = getPdfLabels();
  const doc = new jsPDF({ format: 'a4' });
  drawProductionReport(doc, production, [], stocks, {
    recipes,
    subtitle: t('pdf.production.tanksSubtitle'),
  });
  doc.save(productionOpPdfFilename(production.op_number));
  return true;
}

/**
 * Fiscal report scoped to selected tanks: MP quantities proportional to live net weight.
 * Returns false if total net weight is zero (caller should show a toast).
 * When all tanks are selected, filename is OP.pdf and MP qtys match the visualization screen.
 */
export function generateProductionTanksPDF(production, allContainers, selectedContainers, stocks, recipes = []) {
  const { t } = getPdfLabels();
  const selected = Array.isArray(selectedContainers) ? selectedContainers : [];
  const all = Array.isArray(allContainers) ? allContainers : [];
  if (selected.length === 0) return false;

  const mps = parseArr(production.raw_materials_used);
  const selectedIds = new Set(selected.map(function(c) { return c.id; }).filter(Boolean));
  const isFullOp = all.length > 0 && selected.length === all.length
    && all.every(function(c) { return selectedIds.has(c.id); });

  let materials = mps;
  if (!isFullOp) {
    const allocation = allocateMpQuantitiesByNetWeight(mps, all, production, recipes, 3);
    if (allocation.totalNet <= 0) return false;
    materials = aggregateAllocatedMaterials(mps, allocation, selected, all);
  } else if (mps.length === 0) {
    return false;
  }

  const selectedNet = selected.reduce(function(s, c) {
    return s + containerLiveNetWeight(c, production, recipes);
  }, 0);
  const selectedVol = selected.reduce(function(s, c) {
    return s + (parseFloat(c.volume) || 0);
  }, 0);
  if (!isFullOp && selectedNet <= 0) return false;

  const unitPrice = parseFloat(production.unit_price) || 0;
  const labels = selected.map(function(c) { return c.container_number || '-'; }).join(', ');
  const tankLabels = selected.map(function(c) { return c.container_number; }).filter(Boolean)
    .filter(function(v, i, a) { return a.indexOf(v) === i; });
  const snapshot = {
    ...production,
    mass: selectedNet,
    volume: selectedVol,
    total_value: unitPrice * selectedNet,
  };

  const doc = new jsPDF({ format: 'a4' });
  drawProductionReport(doc, snapshot, selected, stocks, {
    materials,
    recipes,
    subtitle: t('pdf.production.tanksSubtitle'),
    extraNote: isFullOp ? null : t('pdf.production.selectedTanksNote', { tanks: labels }),
  });
  doc.save(productionTankFiscalPdfFilename(production.op_number, tankLabels, isFullOp));
  return true;
}

/**
 * Fiscal report for selected container-origin rows (multi-OP composition).
 * Full OP selection → exact raw_materials_used from the OP on screen (same as visualization).
 * Partial selection → scaled from each origin OP (with viewing production preferred when synced).
 */
export function generateProductionOriginsPDF(viewerProduction, selectedRows, productions, stocks, recipes = [], allRows = null) {
  const { t } = getPdfLabels();
  const selected = Array.isArray(selectedRows) ? selectedRows : [];
  if (selected.length === 0) return false;

  const syncedProductions = productionsWithViewer(productions, viewerProduction);
  const totalRows = Array.isArray(allRows) ? allRows.length : selected.length;
  const isFullOp = totalRows > 0 && selected.length === totalRows;

  const materials = isFullOp
    ? parseArr(viewerProduction?.raw_materials_used)
    : materialsFromOriginRows(selected, syncedProductions, 3);

  if (!materials.length && selected.every((r) => (parseFloat(r.volume) || 0) <= 0)) return false;

  const selectedVol = selected.reduce((s, r) => s + (parseFloat(r.volume) || 0), 0);
  if (selectedVol <= 0) return false;

  const selectedNet = selected.reduce((s, r) => {
    const dens = resolveProductDensity(
      syncedProductions.find((p) => p.id === r.production_id) || viewerProduction,
      r.container,
      recipes
    );
    const vol = parseFloat(r.volume) || 0;
    if (dens && vol > 0) return s + Math.round(vol * dens);
    return s + Math.round(vol * (parseFloat(viewerProduction?.density) || 1));
  }, 0);

  // Synthetic packaging rows for PDF table (one per origin)
  const displayContainers = selected.map((r, i) => ({
    ...(r.container || {}),
    id: r.key || r.origin?.id || `origin-${i}`,
    volume: parseFloat(r.volume) || 0,
    net_weight: (() => {
      const dens = resolveProductDensity(
        syncedProductions.find((p) => p.id === r.production_id) || viewerProduction,
        r.container,
        recipes
      );
      const vol = parseFloat(r.volume) || 0;
      return dens ? Math.round(vol * dens) : Math.round(vol * (parseFloat(viewerProduction?.density) || 1));
    })(),
    op_number: r.op_number || r.container?.op_number,
    lot: r.lot || r.container?.lot,
    _origin_label: r.op_number,
  }));

  const unitPrice = parseFloat(viewerProduction?.unit_price) || 0;
  const labels = selected.map((r) => {
    const placa = r.container?.container_number || '-';
    const op = r.op_number || '';
    return op ? `${placa} (${op})` : placa;
  }).join(', ');
  const tankLabels = selected.map((r) => r.container?.container_number).filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  const snapshot = {
    ...viewerProduction,
    mass: selectedNet,
    volume: selectedVol,
    total_value: unitPrice * selectedNet,
  };

  const doc = new jsPDF({ format: 'a4' });
  drawProductionReport(doc, snapshot, displayContainers, stocks, {
    materials,
    recipes,
    subtitle: t('pdf.production.originsSubtitle'),
    extraNote: isFullOp ? null : t('pdf.production.selectedOriginsNote', { tanks: labels }),
  });
  doc.save(productionTankFiscalPdfFilename(viewerProduction?.op_number, tankLabels, isFullOp));
  return true;
}

export function generateEnsaioPDF(test) {
  const { lang, t } = getPdfLabels();
  const { fmtNum } = makePdfFormatters(lang);
  const doc = new jsPDF();
  let y = addPageTitle(doc, test.product || t('pdf.ensaio.defaultTitle'), t('pdf.ensaio.subtitle'));
  y = addInfoGrid(doc, y, [
    [t('pdf.common.product'), test.product || '-'],
    [t('pdf.common.client'), test.client || '-'],
    [t('pdf.recipe.fields.revision'), test.revision || '-'],
    [t('pdf.fields.revisionDate'), test.revision_date || '-'],
    [t('pdf.ensaio.fields.analysisCount'), String((test.analyses || []).length)],
  ], 3);
  y = addSectionTitle(doc, y, t('pdf.ensaio.sectionAnalyses'));
  const headers = [
    t('pdf.ensaio.columns.analysis'),
    t('pdf.ensaio.columns.methodology'),
    t('pdf.ensaio.columns.unit'),
    t('pdf.ensaio.columns.specification'),
  ];
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
  addFooter(doc, lang);
  doc.save('ensaio-' + (test.product || 'ensaio').replace(/\s+/g, '-') + '.pdf');
}

export async function generateCOAPDF(result, production, containers, recipe, options) {
  const opts = options || {};
  const { lang, t } = getPdfLabels(opts.locale);
  const { fmtDate, fmtNum } = makePdfFormatters(lang);
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
  doc.text(t('pdf.coa.title'), M, 22);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
  doc.text(t('pdf.coa.subtitle', { product: result.product || '', lot: result.lot || '' }), M, 29);
  setDraw(doc, BLUE_MID); doc.setLineWidth(0.6); doc.line(M, 33, PW - M, 33); doc.setLineWidth(0.2);
  let y = 42;
  y = addSectionTitle(doc, y, t('pdf.coa.sectionProduct'));
  const mfgDate = production && production.end_time ? fmtDate(production.end_time) : '-';
  let expDate = '-';
  if (production && production.end_time && recipe && recipe.validity_days) {
    const d = new Date(production.end_time);
    d.setDate(d.getDate() + Number(recipe.validity_days));
    expDate = fmtDate(d);
  }
  const massKg = production && production.mass ? fmtNum(production.mass, 3) + ' kg' : '-';
  y = addInfoGrid(doc, y, [
    [t('pdf.coa.fields.manufacturer'), 'OFFSHORE TANKS COMERCIO E SERVICOS EM UNIDADES DE CARGA LTDA', 2],
    [t('pdf.coa.fields.lot'), result.lot || '-'],
    [t('pdf.coa.fields.product'), result.product || '-'],
    [t('pdf.coa.fields.client'), result.client || '-'],
    [t('pdf.coa.fields.order'), (production && production.client_order) || '-'],
    [t('pdf.coa.fields.mfgDate'), mfgDate],
    [t('pdf.coa.fields.expiryDate'), expDate],
    [t('pdf.coa.fields.quantity'), massKg],
    [t('pdf.coa.fields.techResponsible'), 'Italo Giuseppe Cantisani CRQ III - 03213117'],
    [t('pdf.coa.fields.countryOfOrigin'), 'Brasil'],
    [t('pdf.coa.fields.coaObservations'), result.observations || t('pdf.coa.fields.noObservation'), 2],
  ], 2);
  y = addSectionTitle(doc, y, t('pdf.coa.sectionQuality'));
  const headers = [
    t('pdf.coa.columns.analysis'),
    t('pdf.coa.columns.methodology'),
    t('pdf.coa.columns.specification'),
    t('pdf.coa.columns.unit'),
    t('pdf.coa.columns.result'),
    t('pdf.coa.columns.final'),
  ];
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
  y = ensureSpace(doc, y, 14);
  const statuses = (result.results || []).map(function(r) { return r.status; });
  var finalStatus, finalColor;
  if (statuses.some(function(s) { return s === 'Reprovado'; })) { finalStatus = 'Reprovado'; finalColor = [153, 27, 27]; }
  else if (statuses.length && statuses.every(function(s) { return s === 'Aprovado'; })) { finalStatus = 'Aprovado'; finalColor = [22, 101, 52]; }
  else { finalStatus = result.status || '-'; finalColor = GRAY_LABEL; }
  y += 5;
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
  doc.text(t('pdf.coa.finalResult'), M, y);
  setColor(doc, finalColor);
  doc.text(String(finalStatus).toUpperCase(), PW - M, y, { align: 'right' });
  setColor(doc, BLACK);
  y += 6;
  doc.setFontSize(7); doc.setFont('helvetica', 'italic'); setColor(doc, GRAY_LABEL);
  const disclaimer = t('pdf.coa.disclaimer');
  const disclaimerLines = doc.splitTextToSize(disclaimer, CW);
  doc.text(disclaimerLines, M, y); y += disclaimerLines.length * 3.5 + 3;
  const footerLineY = PH - 13;
  const phraseCenterY = (y + 8 + footerLineY) / 2;
  doc.setFontSize(9); doc.setFont('helvetica', 'italic'); setColor(doc, GRAY_LABEL);
  doc.text(t('pdf.coa.electronicDoc'), PW / 2, phraseCenterY, { align: 'center' });
  addFooter(doc, lang);
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
        addPageTitle(doc, t('pdf.coa.samplePhoto', { lot: result.lot || '-' }), t('pdf.coa.samplePhotoSubtitle'));
        doc.addImage(correctedDataUrl, 'JPEG', imgX, 45, imgW, imgH);
        addFooter(doc, lang);
      }
    } catch (_e) {}
  }
  if (opts.returnBlob) {
    return doc.output('blob');
  }
  if (opts.viewInNewTab) {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } else {
    doc.save('COA ' + (result.lot || result.op_number || t('pdf.common.report')) + '.pdf');
  }
}

export function generateBoletaPDF(container, productions = [], recipes = []) {
  const { lang, t } = getPdfLabels();
  const { fmtDate, fmtNum } = makePdfFormatters(lang);
  const doc = new jsPDF({ orientation: 'landscape' });
  const PH_L = 210;
  const HALF = 297 / 2;
  const displayVolume = containerDisplayVolume(container, productions);
  const displayNetWeight = containerDisplayNetWeight(container, productions, recipes);
  const displayGrossWeight = containerDisplayGrossWeight(container, productions, recipes);

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
    doc.text(t('pdf.boleta.plateNumber'), bM + colW * 0.5, y + 5, { align: 'center' });
    doc.text(t('pdf.boleta.barrelNumber'), bM + colW * 1.5, y + 5, { align: 'center' });
    doc.text(t('pdf.boleta.date'), bM + colW * 2.5, y + 5, { align: 'center' });
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
    doc.text(String(container.container_number || '-'), bM + colW * 0.5, y + 16, { align: 'center' });
    doc.text(String(container.barril_number || '-'), bM + colW * 1.5, y + 16, { align: 'center' });
    doc.text(envaseDate, bM + colW * 2.5, y + 16, { align: 'center' });
    y += s1H + 4;
    const s2H = 26; const s2rowH = s2H / 2;
    doc.rect(bM, y, bW, s2H); doc.line(bM, y + s2rowH, bM + bW, y + s2rowH);
    const r1cy = y + s2rowH / 2; const r2cy = y + s2rowH + s2rowH / 2;
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
    doc.text(t('pdf.boleta.product'), bM + 3, r1cy - 2); doc.text(t('pdf.boleta.client'), bM + 3, r2cy - 2);
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
    doc.text(String(container.product || '-'), bM + bW / 2, r1cy + 2.5, { align: 'center' });
    doc.text(String(container.client || '-'), bM + bW / 2, r2cy + 2.5, { align: 'center' });
    y += s2H + 4;
    const s3H = 42;
    doc.rect(bM, y, bW, s3H); doc.line(bM + bW * 0.5, y, bM + bW * 0.5, y + s3H);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(doc, GRAY_LABEL);
    doc.text(t('pdf.boleta.seals'), bM + 2, y + 5);
    const seals = (container.seals || '').split(/[,\n]/).map(function(s) { return s.trim(); }).filter(Boolean);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(doc, BLACK);
    if (seals.length === 0) { doc.text('-', bM + 2, y + 12); }
    else { seals.slice(0, 6).forEach(function(s, i) { doc.text(s, bM + 2, y + 12 + i * 4.5); }); }
    const rightCellX = bM + bW * 0.5; const rightCellW = bW * 0.5;
    const rightCX = rightCellX + rightCellW / 2; const s3RowH = s3H / 3;
    const rightItems = [
      { label: t('pdf.boleta.sling'), value: String(container.sling || '-') },
      { label: t('pdf.boleta.gps'), value: String(container.gps || '-') },
      { label: t('pdf.boleta.minTest'), value: container.min_test_date ? fmtDate(container.min_test_date) : '-' },
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
    doc.text(t('pdf.boleta.responsible'), bM + 2, y + 5);
    setFill(doc, [245, 245, 245]); doc.rect(bM + 2, y + 8, bW * 0.38 - 4, 22, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
    doc.text(String(container.operator || '-'), bM + bW * 0.19, y + 22, { align: 'center' });
    const wCellX = bM + bW * 0.38; const wCellW = bW * 0.62; const wCX = wCellX + wCellW / 2; const wRowH = s4H / 3;
    const weightRows = [
      { label: t('pdf.boleta.tare'), value: fmtNum(container.tare, 3) + ' kg' },
      { label: t('pdf.boleta.netWeight'), value: fmtNum(displayNetWeight, 0) + ' kg' },
      { label: t('pdf.boleta.grossWeight'), value: fmtNum(displayGrossWeight, 0) + ' kg' },
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
    doc.text(t('pdf.boleta.packagedQty'), bM + 4, y + 8);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); setColor(doc, BLACK);
    doc.text(fmtNum(displayVolume, 0) + ' L', bM + bW - 4, y + 13, { align: 'right' });
  }

  drawSide(0);
  drawSide(HALF);
  doc.save((container.container_number || container.registration_id || 'vasilhame') + ' - ' + t('pdf.boleta.filename') + '.pdf');
}

export function generateStockPDF(item, consumption, movements) {
  const { lang, t } = getPdfLabels();
  const { fmtDate, fmtDateTime, fmtNum, fmtMoney } = makePdfFormatters(lang);
  const doc = new jsPDF();
  const title = ((item.entry_id || '') + ' - ' + (item.mp_name || '')).trim().replace(/^-\s*/, '');
  let y = addPageTitle(doc, title, t('pdf.stock.subtitle'));
  y = addInfoGrid(doc, y, [
    [t('pdf.fields.registrationId'), item.entry_id || '-'],
    [t('pdf.fields.entryDate'), fmtDate(item.entry_date)],
    [t('pdf.fields.code'), item.mp_code || '-'],
    [t('pdf.fields.name'), item.mp_name || '-'],
    [t('pdf.common.client'), item.client || '-'],
    [t('pdf.common.lot'), item.lot || '-'],
    [t('pdf.fields.supplier'), item.supplier || '-'],
    [t('pdf.fields.unit'), item.unit || '-'],
    [t('pdf.fields.manufactureDate'), fmtDate(item.manufacture_date)],
    [t('pdf.fields.expiryDate'), fmtDate(item.expiry_date)],
    [t('pdf.fields.initialStock'), fmtNum(item.initial_stock) + ' ' + (item.unit || '')],
    [t('pdf.fields.currentBalance'), fmtNum(item.current_stock) + ' ' + (item.unit || '')],
    [t('pdf.fields.unitPrice'), (item.unit_price || 0).toFixed(4)],
    [t('pdf.fields.totalCost'), fmtMoney((item.current_stock || 0) * (item.unit_price || 0))],
    [t('pdf.fields.packagingType'), item.packaging_type || '-'],
    [t('pdf.fields.packagingCapacityKg'), fmtNum(item.packaging_capacity, 3)],
    [t('pdf.fields.packagingQty'), fmtNum(item.packaging_quantity, 1)],
  ], 3);
  if (item.observations) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(doc, GRAY_LABEL);
    doc.text(t('pdf.common.observations'), M, y); y += 5; setColor(doc, BLACK);
    const lines = doc.splitTextToSize(item.observations, CW);
    doc.text(lines, M, y); y += lines.length * 5 + 6;
  }
  y = addSectionTitle(doc, y, t('pdf.stock.sectionOps'));
  if (!consumption || consumption.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.stock.noOps'), M, y);
  } else {
    const unit = item.unit || '';
    const headers = [
      t('pdf.stock.columns.op'),
      t('pdf.stock.columns.product'),
      t('pdf.stock.columns.date'),
      t('pdf.stock.columns.fiscalQty', { unit }),
      t('pdf.stock.columns.opQty'),
    ];
    const rows = consumption.map(function(c) {
      return [c.op_number || '-', (c.product || '-').substring(0, 30), fmtDate(c.date), fmtNum(c.qty_fiscal), fmtNum(c.qty_operational)];
    });
    const tFiscal = consumption.reduce(function(s, c) { return s + (c.qty_fiscal || 0); }, 0);
    const tOp = consumption.reduce(function(s, c) { return s + (c.qty_operational || 0); }, 0);
    y = addTable(doc, y, headers, rows, [25, 60, 25, 35, 37], [t('pdf.common.total'), '', '', fmtNum(tFiscal) + ' ' + unit, fmtNum(tOp) + ' kg']);
  }
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, t('pdf.stock.sectionMovements'));
  if (!movements || movements.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.stock.noMovements'), M, y);
  } else {
    const unit = item.unit || '';
    const mvHeaders = [
      t('pdf.stock.columns.date'),
      t('pdf.stock.columns.destination'),
      t('pdf.stock.columns.qty', { unit }),
      t('pdf.stock.columns.balanceBefore'),
      t('pdf.stock.columns.balanceAfter'),
      t('pdf.stock.columns.operator'),
    ];
    const mvRows = movements.map(function(m) {
      return [
        m.movement_date ? fmtDateTime(m.movement_date, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-',
        (m.destination || '-').substring(0, 28),
        '-' + fmtNum(m.quantity, 3),
        fmtNum(m.balance_before, 3),
        fmtNum(m.balance_after, 3),
        (m.operator || '-').substring(0, 18),
      ];
    });
    const totalMoved = movements.reduce(function(s, m) { return s + (m.quantity || 0); }, 0);
    y = addTable(doc, y, mvHeaders, mvRows, [30, 50, 22, 22, 22, 36], [t('pdf.common.total'), '', '-' + fmtNum(totalMoved, 3) + ' ' + unit, '', '', '']);
  }
  addFooter(doc, lang);
  doc.save('estoque-' + (item.entry_id || (item.mp_name || 'mp').replace(/\s+/g, '-')) + '.pdf');
}

export function generateMovimentacaoPDF(item, movement) {
  const { lang, t } = getPdfLabels();
  const { fmtDate, fmtDateTime, fmtNum } = makePdfFormatters(lang);
  const doc = new jsPDF();
  const unit = item.unit || movement.unit || '';
  const dateStr = movement.movement_date ? fmtDate(movement.movement_date) : t('pdf.common.noDate');
  let y = addPageTitle(doc, t('pdf.movement.title', { name: item.mp_name || '' }), t('pdf.movement.subtitle', { date: dateStr }));
  y = addSectionTitle(doc, y, t('pdf.movement.sectionItem'));
  y = addInfoGrid(doc, y, [
    [t('pdf.fields.registrationId'), item.entry_id || '-'],
    [t('pdf.fields.entryDate'), fmtDate(item.entry_date)],
    [t('pdf.fields.mpCode'), item.mp_code || '-'],
    [t('pdf.fields.name'), item.mp_name || '-'],
    [t('pdf.common.client'), item.client || '-'],
    [t('pdf.common.lot'), item.lot || '-'],
    [t('pdf.fields.supplier'), item.supplier || '-'],
    [t('pdf.fields.unit'), unit || '-'],
    [t('pdf.fields.manufactureDate'), fmtDate(item.manufacture_date)],
    [t('pdf.fields.expiryDate'), fmtDate(item.expiry_date)],
    [t('pdf.fields.packagingType'), item.packaging_type || '-'],
    [t('pdf.fields.packagingCapacity'), item.packaging_capacity ? (fmtNum(item.packaging_capacity, 3) + ' kg') : '-'],
    [t('pdf.fields.packagingQty'), fmtNum(item.packaging_quantity, 1)],
    [t('pdf.fields.initialStock'), fmtNum(item.initial_stock, 3) + ' ' + unit],
    [t('pdf.fields.currentBalance'), fmtNum(item.current_stock, 3) + ' ' + unit],
    [t('pdf.fields.unitPrice'), (item.unit_price || 0).toFixed(4)],
  ], 3);
  y = addSectionTitle(doc, y, t('pdf.movement.sectionMovement'));
  y = addInfoGrid(doc, y, [
    [t('pdf.fields.dateTime'), movement.movement_date ? fmtDateTime(movement.movement_date) : '-'],
    [t('pdf.fields.destination'), movement.destination || '-'],
    [t('pdf.common.operator'), movement.operator || '-'],
    [t('pdf.fields.movedQty', { unit }), '-' + fmtNum(movement.quantity, 3) + ' ' + unit],
    [t('pdf.fields.fiscalQty', { unit }), fmtNum(movement.quantity, 3) + ' ' + unit],
    [t('pdf.fields.balanceBefore', { unit }), fmtNum(movement.balance_before, 3) + ' ' + unit],
    [t('pdf.fields.balanceAfter', { unit }), fmtNum(movement.balance_after, 3) + ' ' + unit],
    [t('common.observations'), movement.observations || '-', 3],
  ], 3);
  addFooter(doc, lang);
  const safeName = (item.mp_name || 'mp').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  doc.save('movimentacao-' + safeName + '-' + dateStr.replace(/\//g, '-') + '.pdf');
}

export function generateTransferPDF(transfer, density, containers, recipeCode) {
  const { lang, t } = getPdfLabels();
  const { fmtDate, fmtNum } = makePdfFormatters(lang);
  const doc = new jsPDF();
  const dens = density || 0;
  const parseArrLocal = function(v) { return Array.isArray(v) ? v : (typeof v === 'string' ? (function() { try { return JSON.parse(v); } catch (e) { return []; } })() : []); };
  const _transfer = Object.assign({}, transfer, { origins: parseArrLocal(transfer.origins), destinations: parseArrLocal(transfer.destinations) });
  transfer = _transfer;
  var containerLot = {};
  (Array.isArray(containers) ? containers : []).forEach(function(c) { if (c.id && c.lot) containerLot[c.id] = c.lot; });
  var liveLot = function(o) { return (o.container_id && containerLot[o.container_id]) ? containerLot[o.container_id] : o.lot; };
  const hasExp = transfer.destinations.some(function(d) { return d.type === 'Expedição'; });
  const hasTrans = transfer.destinations.some(function(d) { return d.type === 'Transbordo'; });
  const titleType = hasExp && !hasTrans ? t('pdf.transfer.expedition') : t('pdf.transfer.transbordo');
  let y = addPageTitle(doc, t('pdf.transfer.title', { number: transfer.transfer_number || '-', title: titleType }), t('pdf.transfer.subtitle'));
  y = ensureSpace(doc, y, 50);
  y = addSectionTitle(doc, y, t('pdf.transfer.sectionGeneral'));
  y = addInfoGrid(doc, y, [
    [t('pdf.fields.registrationNumber'), transfer.transfer_number || '-'],
    [t('pdf.common.date'), fmtDate(transfer.date)],
    [t('pdf.fields.productCode'), recipeCode || '-'],
    [t('pdf.common.product'), transfer.product || '-'],
    [t('pdf.common.client'), transfer.client || '-'],
    [t('pdf.common.operator'), transfer.operator || '-'],
    [t('pdf.fields.densityPA'), fmtNum(dens, 4) + ' ' + t('pdf.common.densityUnit')],
    [t('common.observations'), transfer.observations || '-', 3],
  ], 3);
  y = ensureSpace(doc, y, 40);
  y = addSectionTitle(doc, y, t('pdf.transfer.sectionOrigins'));
  const origins = transfer.origins || [];
  if (origins.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.transfer.noOrigins'), M, y); y += 6;
  } else {
    const oHeaders = [
      t('pdf.transfer.columns.container'),
      t('pdf.transfer.columns.barrel'),
      t('pdf.transfer.columns.lot'),
      t('pdf.transfer.columns.withdrawnVolume'),
      t('pdf.transfer.columns.mass'),
      t('pdf.transfer.columns.remainingBalance'),
    ];
    const oRows = origins.map(function(o) { return [o.container_number || '-', o.barril_number || '-', liveLot(o) || '-', fmtNum(o.volume_used, 0), fmtNum((o.volume_used || 0) * dens, 0), fmtNum(o.remaining_stock, 0)]; });
    const tUsed = origins.reduce(function(s, o) { return s + (o.volume_used || 0); }, 0);
    const tMass = origins.reduce(function(s, o) { return s + (o.volume_used || 0) * dens; }, 0);
    const tRem = origins.reduce(function(s, o) { return s + (o.remaining_stock || 0); }, 0);
    y = addTable(doc, y, oHeaders, oRows, [32, 22, 33, 33, 28, 34], [t('pdf.common.total'), '', '', fmtNum(tUsed, 0) + ' L', fmtNum(tMass, 0) + ' kg', fmtNum(tRem, 0) + ' L']);
  }
  const dests = transfer.destinations || [];
  var lotTotals = {};
  origins.forEach(function(o) { var k = liveLot(o) || ''; lotTotals[k] = (lotTotals[k] || 0) + (parseFloat(o.volume_used) || 0); });
  var majorityLot = ''; var maxLotVol = -1;
  Object.keys(lotTotals).forEach(function(k) { if (lotTotals[k] > maxLotVol) { maxLotVol = lotTotals[k]; majorityLot = k; } });
  y = ensureSpace(doc, y, 35);
  y = addSectionTitle(doc, y, t('pdf.transfer.sectionDestinations'));
  if (dests.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.transfer.noDestinations'), M, y); y += 6;
  } else {
    const dHeaders = [
      t('pdf.transfer.columns.type'),
      t('pdf.transfer.columns.identification'),
      t('pdf.transfer.columns.volume'),
      t('pdf.transfer.columns.mass'),
      t('pdf.transfer.columns.packaging'),
    ];
    const dRows = dests.map(function(d) { return [d.type || '-', d.placa || d.barril || '-', fmtNum(d.volume, 0), fmtNum(d.mass, 0), d.packaging_type || '-']; });
    const dVolTotal = dests.reduce(function(s, d) { return s + (d.volume || 0); }, 0);
    const dMassTotal = dests.reduce(function(s, d) { return s + (d.mass || 0); }, 0);
    y = addTable(doc, y, dHeaders, dRows, [25, 45, 35, 35, 40], [t('pdf.common.total'), '', fmtNum(dVolTotal, 0) + ' L', fmtNum(dMassTotal, 0) + ' kg', '']);
  }
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, t('pdf.transfer.sectionLogistics'));
  dests.forEach(function(d) {
    y = ensureSpace(doc, y, 45);
    var fields = d.type === 'Transbordo' ? [
      [t('pdf.fields.type'), d.type || '-'],
      [t('pdf.fields.plateNumber'), d.placa || '-'],
      [t('pdf.fields.barrelNumber'), d.barril || '-'],
      [t('pdf.fields.volumeL'), fmtNum(d.volume, 0)],
      [t('pdf.fields.massKg'), fmtNum(d.mass, 0)],
      [t('pdf.fields.packagingTypeShort'), d.packaging_type || '-'],
      [t('pdf.boleta.seals'), d.seals || '-'],
      [t('pdf.fields.sling'), d.sling || '-'],
      [t('pdf.fields.gps'), d.gps || '-'],
      [t('pdf.fields.minTestDate'), d.min_test_date ? fmtDate(d.min_test_date) : '-'],
      [t('pdf.fields.tareKg'), fmtNum(d.tare, 0)],
    ] : [
      [t('pdf.fields.type'), d.type || '-'],
      [t('pdf.fields.plateNumber'), d.placa || '-'],
      [t('pdf.fields.driver'), d.driver || '-'],
      [t('pdf.fields.volumeL'), fmtNum(d.volume, 0)],
      [t('pdf.fields.massKg'), fmtNum(d.mass, 0)],
      [t('pdf.fields.netWeightKg'), fmtNum(d.net_weight, 0)],
      [t('pdf.fields.tareKg'), fmtNum(d.tare, 0)],
      [t('pdf.fields.grossWeightKg'), fmtNum(d.gross_weight, 0)],
      [t('pdf.boleta.seals'), d.seals || '-'],
      [t('pdf.fields.finalLot'), majorityLot || '-'],
    ];
    y = addInfoGrid(doc, y, fields, 3);
  });
  addFooter(doc, lang);
  doc.save(titleType + ' - ' + (transfer.transfer_number || t('pdf.common.report')) + '.pdf');
}

export function generateInventoryPDF(inventory) {
  const { lang, t } = getPdfLabels();
  const { fmtDateTime, fmtNum } = makePdfFormatters(lang);
  const doc = new jsPDF({ format: 'a4' });
  let y = addPageTitle(doc, t('pdf.inventory.title', { number: inventory.inventory_number || '' }), t('pdf.inventory.subtitle'));
  const clients = parseArr(inventory.clients).length ? parseArr(inventory.clients) : [inventory.clients || '-'];
  const products = parseArr(inventory.products).length ? parseArr(inventory.products) : [inventory.products || '-'];
  const lots = parseArr(inventory.lots).length ? parseArr(inventory.lots) : [inventory.lots || '-'];
  y = addInfoGrid(doc, y, [
    [t('pdf.fields.inventoryNumber'), inventory.inventory_number || '-'],
    [t('pdf.common.status'), inventory.status || '-'],
    [t('pdf.fields.clients'), clients.join(', ') || '-', 2],
    [t('pdf.fields.openingDate'), fmtDateTime(inventory.opening_date)],
    [t('pdf.fields.openedBy'), inventory.opened_by || '-'],
    [t('pdf.fields.startDate'), fmtDateTime(inventory.start_date)],
    [t('pdf.fields.startedBy'), inventory.started_by || '-'],
    [t('pdf.fields.closingDate'), fmtDateTime(inventory.closing_date)],
    [t('pdf.fields.closedBy'), inventory.closed_by || '-'],
    [t('pdf.fields.products'), products.join(', ') || '-', 2],
    [t('pdf.fields.lots'), lots.join(', ') || '-', 2],
  ], 2);
  y = addSectionTitle(doc, y, t('pdf.inventory.sectionItems'));
  const items = parseArr(inventory.items);
  if (items.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.inventory.noItems'), M, y); y += 8;
  } else {
    const hasPkg = items.some(function(it) { return it.packaging_type || it.packaging_capacity; });
    const hasPkgQty = hasPkg && items.some(function(it) {
      return (it.registered_quantity && it.registered_quantity > 0) || (it.physical_packages && it.physical_packages > 0);
    });

    let headers, widths, wrapCols, stockColIdx, physColIdx, diffColIdx, diffPctColIdx;
    if (hasPkgQty) {
      headers = [
        t('pdf.inventory.columns.product'),
        t('pdf.inventory.columns.client'),
        t('pdf.inventory.columns.lot'),
        t('pdf.inventory.columns.packaging'),
        t('pdf.inventory.columns.packagingQty'),
        t('pdf.inventory.columns.stock'),
        t('pdf.inventory.columns.physical'),
        t('pdf.inventory.columns.diff'),
        t('pdf.inventory.columns.diffPct'),
      ];
      widths = [30, 26, 18, 22, 14, 20, 20, 16, 16];
      wrapCols = [0, 1, 2, 3];
      stockColIdx = 5; physColIdx = 6; diffColIdx = 7; diffPctColIdx = 8;
    } else if (hasPkg) {
      headers = [
        t('pdf.inventory.columns.product'),
        t('pdf.inventory.columns.client'),
        t('pdf.inventory.columns.lot'),
        t('pdf.inventory.columns.packaging'),
        t('pdf.inventory.columns.stock'),
        t('pdf.inventory.columns.physical'),
        t('pdf.inventory.columns.diff'),
        t('pdf.inventory.columns.diffPct'),
      ];
      widths = [34, 28, 20, 24, 22, 22, 16, 16];
      wrapCols = [0, 1, 2, 3];
      stockColIdx = 4; physColIdx = 5; diffColIdx = 6; diffPctColIdx = 7;
    } else {
      headers = [
        t('pdf.inventory.columns.product'),
        t('pdf.inventory.columns.client'),
        t('pdf.inventory.columns.lot'),
        t('pdf.inventory.columns.stock'),
        t('pdf.inventory.columns.physical'),
        t('pdf.inventory.columns.diff'),
        t('pdf.inventory.columns.diffPct'),
      ];
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
      if (i === 0) totalsRow.push(t('pdf.common.total').toUpperCase());
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
      ? t('pdf.inventory.summarySurplus', { qty: fmtNum(totalDiff, 1), unit })
      : totalDiff < 0
      ? t('pdf.inventory.summaryShortage', { qty: fmtNum(totalDiff, 1), unit })
      : t('pdf.inventory.summaryMatch', { unit });
    setColor(doc, totalDiff > 0 ? [22, 101, 52] : totalDiff < 0 ? [153, 27, 27] : BLACK);
    doc.text(summaryText, M, y + 5);
    setColor(doc, BLACK);
  }
  addFooter(doc, lang);
  doc.save('inventario-' + (inventory.inventory_number || t('pdf.common.report')) + '.pdf');
}

export function generateVasilhamesReportPDF(containers, recipe) {
  const { lang, t } = getPdfLabels();
  const { fmtDateTime, fmtNum } = makePdfFormatters(lang);
  const doc = new jsPDF({ format: 'a4' });
  const product = (containers[0] && containers[0].product) || '-';
  const client = (containers[0] && containers[0].client) || '-';
  const productCode = (recipe && recipe.code) || '-';
  const totalVolume = containers.reduce(function(s, c) { return s + (c.volume || 0); }, 0);
  const totalMass = containers.reduce(function(s, c) { return s + (c.net_weight || 0); }, 0);
  const emissionDate = fmtDateTime(new Date());

  let y = addPageTitle(doc, product, t('pdf.vasilhames.subtitle'));
  y = addInfoGrid(doc, y, [
    [t('pdf.fields.productCodeShort'), productCode],
    [t('pdf.fields.productName'), product],
    [t('pdf.common.client'), client],
    [t('pdf.fields.containerCount'), String(containers.length)],
    [t('pdf.fields.totalVolume'), fmtNum(totalVolume, 0) + ' L'],
    [t('pdf.fields.totalMass'), fmtNum(totalMass, 0) + ' kg'],
    [t('pdf.fields.emissionDateTime'), emissionDate, 3],
  ], 3);

  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, t('pdf.vasilhames.sectionSelected'));
  const headers = [
    t('pdf.vasilhames.columns.plate'),
    t('pdf.vasilhames.columns.barrel'),
    t('pdf.vasilhames.columns.sling'),
    t('pdf.vasilhames.columns.lot'),
    t('pdf.vasilhames.columns.volume'),
    t('pdf.vasilhames.columns.mass'),
  ];
  const rows = containers.map(function(c) {
    return [c.container_number || '-', c.barril_number || '-', c.sling || '-', c.lot || '-', fmtNum(c.volume, 0), fmtNum(c.net_weight, 0)];
  });
  const widths = [30, 28, 30, 28, 26, 26];
  const totalsRow = ['', '', '', t('pdf.common.total').toUpperCase(), fmtNum(totalVolume, 0) + ' L', fmtNum(totalMass, 0) + ' kg'];
  y = addTable(doc, y, headers, rows, widths, totalsRow, [0, 1, 2, 3], { verticalLines: true });

  addFooter(doc, lang);
  const safeName = (product || 'vasilhames').replace(/\s+/g, '-').toLowerCase();
  doc.save('relatorio-vasilhames-' + safeName + '.pdf');
}

export function generateClientStockPDF(opts) {
  const { lang, t } = getPdfLabels();
  const { fmtDate, fmtNum } = makePdfFormatters(lang);
  const client = opts.client;
  const stocks = opts.stocks || [];
  const containers = opts.containers || [];
  const tanks = opts.tanks || [];
  const doc = new jsPDF();
  const allClientsLabel = t('pdf.common.allClients');
  const clientLabel = client === 'Todos os Clientes' ? allClientsLabel : client;
  let y = addPageTitle(doc, t('pdf.clientStock.title', { client: clientLabel }), t('pdf.clientStock.subtitle'));
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, t('pdf.clientStock.sectionSummary'));
  const totalMPVolume = stocks.reduce(function(s, i) { return s + (i.current_stock || 0); }, 0);
  const totalContainerVolume = containers.reduce(function(s, c) { return s + (c.volume || 0); }, 0);
  const totalContainerMass = containers.reduce(function(s, c) { return s + (c.net_weight || 0); }, 0);
  const totalTankVolume = tanks.reduce(function(s, t) { return s + (t.current_volume || 0); }, 0);
  y = addInfoGrid(doc, y, [
    [t('pdf.common.client'), clientLabel, 2],
    [t('pdf.fields.reportDate'), fmtDate(new Date().toISOString())],
    [t('pdf.fields.mpItemCount'), String(stocks.length)],
    [t('pdf.fields.containerTotal'), String(containers.length)],
    [t('pdf.fields.tankTotal'), String(tanks.length)],
    [t('pdf.fields.mpBalanceTotal'), fmtNum(totalMPVolume, 1)],
    [t('pdf.fields.containerVolumeTotal'), fmtNum(totalContainerVolume, 1) + ' L'],
    [t('pdf.fields.containerMassTotal'), fmtNum(totalContainerMass, 1) + ' kg'],
    [t('pdf.fields.tankVolumeTotal'), fmtNum(totalTankVolume, 1) + ' L'],
  ], 3);
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, t('pdf.clientStock.sectionMp'));
  if (stocks.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.clientStock.noMp'), M, y); y += 8;
  } else {
    const mpHeaders = [
      t('pdf.clientStock.columns.mpCode'),
      t('pdf.clientStock.columns.product'),
      t('pdf.clientStock.columns.lot'),
      t('pdf.clientStock.columns.initialBalance'),
      t('pdf.clientStock.columns.currentBalance'),
      t('pdf.clientStock.columns.unit'),
      t('pdf.clientStock.columns.expiry'),
    ];
    const mpRows = stocks.map(function(s) {
      return [(s.mp_code || '-').substring(0, 10), (s.mp_name || '-').substring(0, 24), (s.lot || '-').substring(0, 16), fmtNum(s.initial_stock, 1), fmtNum(s.current_stock, 1), s.unit || '-', fmtDate(s.expiry_date)];
    });
    y = addTable(doc, y, mpHeaders, mpRows, [22, 42, 30, 25, 25, 12, 26], null);
  }
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, t('pdf.clientStock.sectionContainers'));
  if (containers.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.clientStock.noContainers'), M, y); y += 8;
  } else {
    const cHeaders = [
      t('pdf.clientStock.columns.container'),
      t('pdf.clientStock.columns.barrel'),
      t('pdf.clientStock.columns.product'),
      t('pdf.clientStock.columns.lot'),
      t('pdf.clientStock.columns.type'),
      t('pdf.clientStock.columns.volume'),
      t('pdf.clientStock.columns.netWeight'),
    ];
    const cRows = containers.map(function(c) {
      return [(c.container_number || '-').substring(0, 16), (c.barril_number || '-').substring(0, 14), (c.product || '-').substring(0, 24), (c.lot || '-').substring(0, 16), (c.type || '-').substring(0, 18), fmtNum(c.volume, 1), fmtNum(c.net_weight, 1)];
    });
    const tVol = containers.reduce(function(s, c) { return s + (c.volume || 0); }, 0);
    const tNet = containers.reduce(function(s, c) { return s + (c.net_weight || 0); }, 0);
    y = addTable(doc, y, cHeaders, cRows, [26, 20, 40, 25, 25, 23, 23], [t('pdf.common.total'), '', '', '', '', fmtNum(tVol, 1) + ' L', fmtNum(tNet, 1) + ' kg']);
  }
  y = ensureSpace(doc, y, 30);
  y = addSectionTitle(doc, y, t('pdf.clientStock.sectionTanks'));
  if (tanks.length === 0) {
    doc.setFontSize(9); setColor(doc, GRAY_LABEL); doc.text(t('pdf.clientStock.noTanks'), M, y); y += 8;
  } else {
    const tHeaders = [
      t('pdf.clientStock.columns.tank'),
      t('pdf.clientStock.columns.product'),
      t('pdf.clientStock.columns.lot'),
      t('pdf.clientStock.columns.currentVolume'),
      t('pdf.clientStock.columns.occupancy'),
    ];
    const tRows = tanks.map(function(tk) {
      const vol = tk.current_volume || 0;
      const cap = tk.capacity || 26000;
      const pct = cap > 0 ? Math.min(100, (vol / cap) * 100) : 0;
      const prods = (tk.computed_products || []).join(', ') || (tk.product || '-');
      return [(tk.name || '-').substring(0, 20), prods.substring(0, 30), (tk.computed_lot || tk.lot || '-').substring(0, 16), fmtNum(vol, 1), pct.toFixed(1) + '%'];
    });
    const tVol = tanks.reduce(function(s, tk) { return s + (tk.current_volume || 0); }, 0);
    y = addTable(doc, y, tHeaders, tRows, [35, 55, 30, 35, 27], [t('pdf.common.total'), '', '', fmtNum(tVol, 1) + ' L', '']);
  }
  addFooter(doc, lang);
  doc.save('estoque-cliente-' + (clientLabel || t('pdf.common.report')).replace(/\s+/g, '-').toLowerCase() + '.pdf');
}
