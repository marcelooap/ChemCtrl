// Gera e imprime etiqueta (105mm x 50mm) para impressora Zebra
// Layout configurável por cliente (Painel → Configurações → Etiquetas).
// Sem config salva, usa o layout histórico (não quebra etiquetas existentes).

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import i18n from '@/i18n';
import { fmtNumber, toDateInputValue } from '@/i18n/formatters';
import {
  formatEtiquetaDate,
  extractDateFormat,
  extractOrientation,
  getVerticalEtiquetaLayout,
  partitionEtiquetaCampos,
  resolveEtiquetaPrintConfig,
  resolveResponsavelTecnico,
} from '@transbordo/lib/etiquetaConfig';
import { formatLabelEmbalagem } from '@industrializacao/lib/packagingTypes';

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

function getLabelLabels(locale) {
  const lang = locale || i18n.language || 'pt-BR';
  const t = (key, opts) => i18n.t(key, { ...opts, lng: lang });
  return { lang, t };
}

/** Soma dias em calendário (Y-M-D), evitando deslocamento por timezone/UTC midnight. */
function addCalendarDays(dateValue, days) {
  const ymd = toDateInputValue(dateValue);
  if (!ymd) return null;
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const local = new Date(y, m - 1, d);
  local.setDate(local.getDate() + n);
  return local;
}

function calcValidityDate(fabDateStr, validityDays) {
  if (!fabDateStr) return null;
  return addCalendarDays(fabDateStr, validityDays);
}

export { calcValidityDate };

function makeQrElement(publicUrl) {
  return React.createElement(QRCodeSVG, {
    value: publicUrl, size: 200, level: 'M',
    bgColor: '#ffffff', fgColor: '#000000',
  });
}

async function tryServerRender(publicUrl) {
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const markup = renderToStaticMarkup(makeQrElement(publicUrl));
    if (markup && markup.includes('<path')) {
      return markup.replace(/width="\d+"/, '').replace(/height="\d+"/, '');
    }
  } catch (_e) {}
  return '';
}

function tryFlushSync(publicUrl) {
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(container);
  try {
    const root = createRoot(container);
    flushSync(() => { root.render(makeQrElement(publicUrl)); });
    const svg = container.querySelector('svg');
    if (!svg) return '';
    const markup = svg.outerHTML;
    if (markup && markup.includes('<path')) {
      return markup.replace(/width="\d+"/, '').replace(/height="\d+"/, '');
    }
  } catch (_e) {}
  return '';
}

async function buildQrSvgMarkup(publicToken, consultaPath = '/consulta') {
  if (!publicToken) return '';
  const baseUrl = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/+$/, '');
  const prefix = consultaPath.startsWith('/') ? consultaPath : `/${consultaPath}`;
  const publicUrl = `${baseUrl}${prefix}/${publicToken}`;
  let markup = await tryServerRender(publicUrl);
  if (!markup) markup = tryFlushSync(publicUrl);
  return markup;
}

function dataRowLabel(key, t) {
  switch (key) {
    case 'id': return t('pdf.label.ref');
    case 'lote': return t('pdf.label.lot');
    case 'fabricacao': return t('pdf.label.manufacture');
    case 'validade': return t('pdf.label.expiry');
    case 'cliente': return t('pdf.label.client');
    case 'volume': return t('pdf.label.volume');
    case 'responsavel_tecnico': return t('pdf.label.technicalManager');
    default: return key;
  }
}

function labelCss(orientation = 'horizontal', copies = 1) {
  const vertical = orientation === 'vertical';
  const pageW = vertical ? '50mm' : '105mm';
  const pageH = vertical ? '105mm' : '50mm';
  const multi = copies > 1;
  return `
  @page { size: ${pageW} ${pageH}; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', Arial, sans-serif; }
  html, body { margin: 0; padding: 0; width: ${pageW}; ${multi ? '' : `height: ${pageH};`} }
  .label {
    width: ${pageW}; height: ${pageH};
    background: #FFFFFF; color: #000000;
    padding: ${vertical ? '1.8mm 2mm' : '1.2mm 3.5mm'};
    display: flex; flex-direction: column;
    justify-content: flex-start;
    border: 1px solid #000;
    overflow: hidden;
    ${multi ? 'page-break-after: always; break-after: page;' : ''}
  }
  ${multi ? '.label:last-child { page-break-after: auto; break-after: auto; }' : ''}
  .label.vertical { justify-content: stretch; }
  .top-section { display: flex; flex: 1; min-height: 0; overflow: hidden; }
  .left-col { flex: 1; display: flex; flex-direction: column; padding-right: 2mm; min-width: 0; overflow: hidden; }
  .product { font-size: ${vertical ? '11pt' : '13pt'}; font-weight: 800; line-height: 1.05; flex-shrink: 0; }
  .label.dense .product { font-size: 11.5pt; }
  .label.vertical .product {
    font-size: 13.5pt;
    text-align: center;
    line-height: 1.12;
    margin-bottom: 1mm;
    padding-bottom: 1.2mm;
    border-bottom: 0.5px solid #000;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .label.vertical .vertical-body {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.6mm;
  }
  .data-block { display: flex; gap: 1.5mm; margin-top: 0.8mm; flex: 1; min-height: 0; overflow: hidden; }
  .icon-col { display: flex; align-items: flex-start; padding-top: 0.3mm; }
  .icon-col svg { width: 5.5mm; height: 5.5mm; }
  .fields { flex: 1; display: flex; gap: 2mm; min-width: 0; overflow: hidden; }
  .fields-left, .fields-right { display: flex; flex-direction: column; justify-content: flex-start; gap: 0.4mm; min-width: 0; }
  .fields-left { flex: 1; }
  .fields-right { width: 34%; flex-shrink: 0; gap: 1.2mm; }
  .field-row { display: flex; align-items: baseline; font-size: 7.5pt; line-height: 1.15; min-width: 0; }
  .field-row .lbl { font-weight: 800; text-transform: uppercase; flex-shrink: 0; }
  .field-row .sep { margin: 0 0.6mm; flex-shrink: 0; }
  .field-row .val { font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .field-row.wrap .val { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-overflow: ellipsis; }
  .fields-right .field-row { flex-direction: column; align-items: flex-start; gap: 0.15mm; }
  .fields-right .sep { display: none; }
  .fields-right .lbl { font-size: 6pt; }
  .fields-right .val { font-size: 8pt; white-space: nowrap; }
  .qr-col {
    width: 26mm;
    display: flex; flex-direction: column; align-items: center;
    border-left: 0.5px solid #000;
    padding: 0.3mm 0 0.3mm 2mm;
    flex-shrink: 0;
  }
  .label.vertical .qr-col {
    width: 100%;
    border-left: none;
    padding: 0.6mm 0;
    flex-shrink: 0;
  }
  .label.vertical .fields {
    flex: 1 1 auto;
    width: 100%;
    flex-direction: column;
    justify-content: space-evenly;
    gap: 0.5mm;
    margin-top: 0;
    overflow: visible;
  }
  .label.vertical .fields-weights {
    flex: 0 0 auto;
    width: 100%;
    gap: 1mm;
  }
  .label.vertical .field-row {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    width: 100%;
    gap: 0.8mm;
    font-size: 9.5pt;
    line-height: 1.22;
  }
  .label.vertical .field-row .lbl { flex-shrink: 0; }
  .label.vertical .field-row .sep { flex-shrink: 0; margin: 0; }
  .label.vertical .field-row .val,
  .label.vertical .field-row.wrap .val {
    flex: 1 1 auto;
    min-width: 0;
    width: auto;
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
    display: block;
    -webkit-line-clamp: unset;
    -webkit-box-orient: unset;
    word-break: break-word;
    overflow-wrap: anywhere;
    font-size: 9.5pt;
    line-height: 1.22;
  }
  .ref { font-size: 8pt; font-weight: 700; align-self: flex-start; }
  .qr-code { flex: 1; display: flex; align-items: center; justify-content: center; }
  .qr-code svg { width: 18mm; height: 18mm; }
  .label.vertical .qr-code { flex: 0 0 auto; }
  .label.vertical .qr-code svg { width: 20mm; height: 20mm; }
  .qr-hint { font-size: 5pt; font-weight: 700; text-transform: uppercase; text-align: center; line-height: 1.1; }
  .label.vertical .qr-hint { font-size: 5.5pt; }
  .weight-table { width: 100%; border-collapse: collapse; margin-top: 0.5mm; flex-shrink: 0; }
  .label.vertical .weight-table { margin-top: 0.8mm; }
  .weight-table td { border: 0.5px solid #000; padding: 0.5mm 1.2mm; font-size: 7pt; }
  .wt-title { font-weight: 800; text-transform: uppercase; text-align: center; vertical-align: middle; width: 30%; }
  .wt-label { font-weight: 700; text-transform: uppercase; width: 35%; }
  .wt-value { font-weight: 800; text-align: right; width: 35%; }
  .footer { font-size: 8pt; font-weight: 800; text-transform: uppercase; display: flex; align-items: baseline; margin-top: 0.4mm; flex-shrink: 0; min-width: 0; }
  .label.vertical .footer {
    margin-top: 0;
    width: 100%;
    align-items: flex-start;
    font-size: 9.5pt;
  }
  .footer .sep { margin: 0 0.6mm; }
  .footer .emb { font-size: 9pt; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label.vertical .footer .emb {
    font-size: 9.5pt;
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
    flex: 1;
    min-width: 0;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .label.ind .field-row { font-size: 9pt; line-height: 1.18; flex-shrink: 0; }
  .label.ind .fields-left {
    justify-content: space-between;
    gap: 0;
    padding-bottom: 0.4mm;
  }
  .label.ind .data-block { margin-top: 0.7mm; overflow: hidden; }
  .label.ind .product { font-size: 13pt; }
  .label.ind.dense .product { font-size: 12pt; }
  .label.ind .weight-table { margin-top: 0.9mm; }
  .label.ind .weight-table td { font-size: 7.5pt; padding: 0.55mm 1.2mm; }
  .label.ind .footer { font-size: 8.5pt; margin-top: 0.45mm; }
  .label.ind .footer .emb { font-size: 9.5pt; }
  .label.ind.vertical .field-row,
  .label.ind.vertical .field-row .val { font-size: 11.5pt; line-height: 1.3; }
  .label.ind.vertical .fields { gap: 1.4mm; }
  .label.ind.vertical .product { font-size: 14.5pt; }
  .label.ind.vertical .footer,
  .label.ind.vertical .footer .emb { font-size: 11pt; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }`;
}

function qrColumnHtml({ publicToken, qrSvgMarkup, refId, showId, qrHint, t }) {
  const refLine = showId
    ? `<div class="ref">${t('pdf.label.ref')}: ${escapeHtml(refId)}</div>`
    : '';
  if (publicToken && qrSvgMarkup) {
    return `<div class="qr-col">${refLine}<div class="qr-code">${qrSvgMarkup}</div><div class="qr-hint">${qrHint}</div></div>`;
  }
  if (publicToken) {
    return `<div class="qr-col">${refLine}<div class="qr-code"><span style="font-size:5pt;color:#999;">${t('pdf.label.qrError')}</span></div><div class="qr-hint">${qrHint}</div></div>`;
  }
  return `<div class="qr-col">${refLine}<div class="qr-code"><span style="font-size:5pt;color:#999;text-align:center;">${t('pdf.label.tokenUnavailable').replace(' ', '<br/>')}</span></div><div class="qr-hint">${qrHint}</div></div>`;
}

async function buildConfiguredLabelBody({
  product,
  refId,
  lot,
  client,
  fabDate,
  valDate,
  netWeight,
  grossWeight,
  volume,
  embalagem,
  publicToken,
  qrHint,
  campos,
  t,
  responsavelTecnico,
  orientation = 'horizontal',
  consultaPath = '/consulta',
  contexto = 'industrializacao',
}) {
  const vertical = orientation === 'vertical';
  const layout = partitionEtiquetaCampos(campos);
  const verticalLayout = vertical ? getVerticalEtiquetaLayout(campos) : null;
  const qrSvgMarkup = (vertical ? verticalLayout.showQr : layout.showQr)
    ? await buildQrSvgMarkup(publicToken, consultaPath)
    : '';

  const dataValues = {
    id: refId,
    lote: lot,
    fabricacao: fabDate,
    validade: valDate,
    cliente: client,
    volume,
    responsavel_tecnico: responsavelTecnico || '—',
  };

  const wrapKeys = new Set(['responsavel_tecnico', 'cliente']);
  const fieldRowHtml = (row, { forceWrap = false } = {}) => {
    const val = dataValues[row.key] ?? '—';
    const wrap = forceWrap || wrapKeys.has(row.key) ? ' wrap' : '';
    return `<div class="field-row${wrap}"><span class="lbl">${dataRowLabel(row.key, t)}</span><span class="sep">•</span><span class="val">${escapeHtml(val)}</span></div>`;
  };

  const dataLayout = layout.dataLayout || { mode: 'stack', left: layout.dataRows || [], right: [] };
  const split = dataLayout.mode === 'split' && dataLayout.right.length > 0;

  let fieldRows;
  if (vertical) {
    fieldRows = verticalLayout.dataRows.map((row) => fieldRowHtml(row, { forceWrap: true })).join('');
  } else {
    const leftHtml = dataLayout.left.map(fieldRowHtml).join('');
    const rightHtml = split ? dataLayout.right.map(fieldRowHtml).join('') : '';
    fieldRows = split
      ? `<div class="fields-left">${leftHtml}</div><div class="fields-right">${rightHtml}</div>`
      : `<div class="fields-left">${leftHtml}</div>`;
  }

  const productHtml = (vertical ? verticalLayout.showNome : layout.showNome)
    ? `<div class="product">${escapeHtml(product)}</div>`
    : '';

  const dense = split || dataLayout.left.length >= 4;
  const flaskIcon = fieldRows && !dense && !vertical
    ? `<div class="icon-col">
          <svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2">
            <path d="M9 2c-1 3-4 5-4 9a7 7 0 0 0 14 0c0-4-3-6-4-9"/>
            <path d="M9 11a3 3 0 0 0 6 0"/>
          </svg>
        </div>`
    : '';

  const qrHtml = (vertical ? verticalLayout.showQr : layout.showQr)
    ? qrColumnHtml({
        publicToken,
        qrSvgMarkup,
        refId,
        showId: vertical ? false : layout.showId,
        qrHint,
        t,
      })
    : '';

  const activeWeights = vertical ? verticalLayout.weights : layout.weights;
  const weightRows = vertical
    ? ''
    : activeWeights
        .map((w, i) => {
          const isBruto = w.key === 'peso_bruto';
          const titleCell =
            i === 0
              ? `<td class="wt-title" rowspan="${activeWeights.length}">${t('pdf.label.mass')}</td>`
              : '';
          return `<tr>${titleCell}<td class="wt-label">${isBruto ? t('pdf.label.grossWeight') : t('pdf.label.netWeight')}</td><td class="wt-value">${isBruto ? grossWeight : netWeight} kg</td></tr>`;
        })
        .join('');

  const weightTable = weightRows
    ? `<table class="weight-table">${weightRows}</table>`
    : '';

  const verticalWeightRows = vertical
    ? activeWeights
        .map((w) => {
          const isBruto = w.key === 'peso_bruto';
          const label = isBruto ? t('pdf.label.grossWeight') : t('pdf.label.netWeight');
          const val = `${isBruto ? grossWeight : netWeight} kg`;
          return `<div class="field-row wrap"><span class="lbl">${label}</span><span class="sep">•</span><span class="val">${escapeHtml(val)}</span></div>`;
        })
        .join('')
    : '';

  const footer = (vertical ? verticalLayout.showEmbalagem : layout.showEmbalagem)
    ? `<div class="footer"><span>${t('pdf.label.packaging')}</span><span class="sep">•</span><span class="emb">${escapeHtml(embalagem)}</span></div>`
    : '';

  const labelClass = `label${dense ? ' dense' : ''}${vertical ? ' vertical' : ''}${contexto !== 'convencional' ? ' ind' : ''}`;
  return vertical
    ? `<div class="${labelClass}">
  ${productHtml}
  <div class="vertical-body">
    <div class="fields">${fieldRows}</div>
    ${qrHtml}
    ${(verticalWeightRows || footer) ? `<div class="fields fields-weights">${verticalWeightRows}${footer}</div>` : ''}
  </div>
</div>`
    : `<div class="${labelClass}">
  <div class="top-section">
    <div class="left-col">
      ${productHtml}
      <div class="data-block">
        ${flaskIcon}
        <div class="fields">${fieldRows}</div>
      </div>
    </div>
    ${qrHtml}
  </div>
  ${weightTable}
  ${footer}
</div>`;
}

function openLabelWindow(vertical, t) {
  const win = window.open('', '_blank', vertical ? 'width=280,height=520' : 'width=420,height=300');
  if (!win) {
    alert(t('pdf.label.popupBlocked'));
    return null;
  }
  win.document.write(`<!DOCTYPE html><html><body style="font-family:Arial;padding:20px;color:#666;">${t('pdf.label.loading')}</body></html>`);
  win.document.close();
  return win;
}

function printLabelPages({ title, lang, t, orientation, pages, win: existingWin }) {
  const vertical = orientation === 'vertical';
  const labelCount = Math.max(1, pages.length);
  const win = existingWin || openLabelWindow(vertical, t);
  if (!win) return;

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>${labelCss(orientation, labelCount)}</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); setTimeout(() => win.close(), 500); }, 300);
}

async function printConfiguredLabel(params) {
  const { lang, t, title, orientation = 'horizontal', copies = 1 } = params;
  const win = openLabelWindow(orientation === 'vertical', t);
  if (!win) return;
  try {
    const bodyHtml = await buildConfiguredLabelBody(params);
    const labelCount = Math.max(1, Math.round(Number(copies) || 1));
    printLabelPages({
      title,
      lang,
      t,
      orientation,
      pages: Array.from({ length: labelCount }, () => bodyHtml),
      win,
    });
  } catch (err) {
    win.close();
    throw err;
  }
}

async function prepareContainerLabelJob(container, validityDays, publicToken, options) {
  if (!container) return null;

  const { lang, t } = getLabelLabels(options?.locale);
  const weightFmt = (n) => fmtNumber(Math.round(Number(n) || 0), { minimumFractionDigits: 0, maximumFractionDigits: 0 }, lang);

  const copies = Math.max(1, Math.round(Number(options?.copies) || 1));
  const volumeRaw = options?.volume ?? container.volume;
  const netWeight = options?.netWeight ?? container.net_weight ?? 0;
  const grossWeight = options?.grossWeight ?? container.gross_weight ?? 0;
  const embalagem = options?.embalagem || formatLabelEmbalagem(container);

  const opNum = container.op_number || '—';
  const fabDateStr = options?.manufactureDate || container.created_date;
  const volume =
    volumeRaw != null && Number(volumeRaw) > 0
      ? `${fmtNumber(volumeRaw, { maximumFractionDigits: 0 }, lang)} L`
      : '—';

  const clienteNome = options?.clienteNome || container.client || container.cliente_nome;
  const printConfig = options?.campos
    ? {
        campos: options.campos,
        dateFormat: options.dateFormat || extractDateFormat({ campos: options.campos }),
        orientation: options.orientation || extractOrientation({ campos: options.campos }),
      }
    : await resolveEtiquetaPrintConfig({
        clienteId: options?.clienteId,
        clienteNome,
        contexto: options?.contexto || 'industrializacao',
      });
  const campos = printConfig.campos;
  const dateFormat = printConfig.dateFormat;
  const fabDate = formatEtiquetaDate(fabDateStr, dateFormat, lang);
  const valDate = formatEtiquetaDate(
    options?.expiryDate || calcValidityDate(fabDateStr, validityDays),
    dateFormat,
    lang
  );
  const responsavelTecnico =
    options?.responsavelTecnico ??
    (await resolveResponsavelTecnico({
      clienteId: options?.clienteId,
      clienteNome,
    }));

  const labelParams = {
    title: t('pdf.label.title', { op: opNum }),
    product: container.product || '—',
    refId: opNum,
    lot: container.lot || '—',
    client: clienteNome || '—',
    fabDate,
    valDate,
    netWeight: weightFmt(netWeight || 0),
    grossWeight: weightFmt(grossWeight || 0),
    volume,
    embalagem,
    publicToken,
    qrHint: t('pdf.label.qrHint'),
    campos,
    lang,
    t,
    responsavelTecnico,
    orientation: printConfig.orientation || 'horizontal',
    consultaPath: options?.contexto === 'convencional' ? '/consulta-produto' : '/consulta',
    contexto: options?.contexto || 'industrializacao',
    copies,
  };

  const bodyHtml = await buildConfiguredLabelBody(labelParams);
  return {
    lang,
    t,
    title: labelParams.title,
    orientation: labelParams.orientation,
    pages: Array.from({ length: copies }, () => bodyHtml),
  };
}

export const printContainerLabel = async (container, validityDays, publicToken, options) => {
  const { t } = getLabelLabels(options?.locale);
  const win = openLabelWindow(false, t);
  if (!win) return;
  try {
    const job = await prepareContainerLabelJob(container, validityDays, publicToken, options);
    if (!job) {
      win.close();
      return;
    }
    printLabelPages({ ...job, win });
  } catch (err) {
    win.close();
    throw err;
  }
};

/** Etiqueta de estoque de MP (105mm × 50mm, ou 50mm × 105mm na vertical) */
export const printRawMaterialLabel = async (stockItem, publicToken, options) => {
  if (!stockItem) return;

  const { lang, t } = getLabelLabels(options?.locale);
  const numFmt = (n) => fmtNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, lang);

  const refId = stockItem.entry_id || '—';
  const volumeRaw = stockItem.volume ?? options?.volume;
  const volume =
    volumeRaw != null && Number(volumeRaw) > 0
      ? `${fmtNumber(volumeRaw, { maximumFractionDigits: 0 }, lang)} L`
      : '—';

  const clienteNome = options?.clienteNome || stockItem.client;
  const printConfig = options?.campos
    ? {
        campos: options.campos,
        dateFormat: options.dateFormat || extractDateFormat({ campos: options.campos }),
        orientation: options.orientation || extractOrientation({ campos: options.campos }),
      }
    : await resolveEtiquetaPrintConfig({
        clienteId: options?.clienteId,
        clienteNome,
        contexto: options?.contexto || 'industrializacao',
      });
  const campos = printConfig.campos;
  const dateFormat = printConfig.dateFormat;
  const fabDate = formatEtiquetaDate(stockItem.manufacture_date, dateFormat, lang);
  const valDate = formatEtiquetaDate(stockItem.expiry_date, dateFormat, lang);
  const responsavelTecnico =
    options?.responsavelTecnico ??
    (await resolveResponsavelTecnico({
      clienteId: options?.clienteId,
      clienteNome,
    }));

  await printConfiguredLabel({
    title: t('pdf.label.titleMp', { ref: refId }),
    product: stockItem.mp_name || '—',
    refId,
    lot: stockItem.lot || '—',
    client: clienteNome || '—',
    fabDate,
    valDate,
    netWeight: numFmt(stockItem.packaging_capacity || stockItem.net_weight || 0),
    grossWeight: numFmt(stockItem.gross_weight || 0),
    volume,
    embalagem: stockItem.packaging_type || '—',
    publicToken,
    qrHint: t('pdf.label.qrHintMp'),
    campos,
    lang,
    t,
    responsavelTecnico,
    orientation: printConfig.orientation || 'horizontal',
  });
};
