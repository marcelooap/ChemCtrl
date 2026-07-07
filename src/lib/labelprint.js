// Gera e imprime etiqueta de vasilhame (105mm x 50mm) para impressora Zebra
// Layout: fundo branco, texto preto — com coluna de QR Code (SVG) para rastreabilidade pública

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';

const RESP_TECNICO = 'Italo Giuseppe Cantisani CRQ III – 03213117';

function calcValidity(fabDateStr, validityDays) {
  if (!fabDateStr) return '—';
  const d = new Date(fabDateStr);
  if (isNaN(d.getTime())) return '—';
  if (validityDays && validityDays > 0) {
    d.setDate(d.getDate() + Number(validityDays));
  }
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function makeQrElement(publicUrl) {
  return React.createElement(QRCodeSVG, {
    value: publicUrl, size: 200, level: 'M',
    bgColor: '#ffffff', fgColor: '#000000',
  });
}

// Abordagem 1: renderToStaticMarkup — síncrono, não precisa de DOM
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

// Abordagem 2: flushSync + createRoot — força commit síncrono do SVG no DOM
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

async function buildQrSvgMarkup(publicToken) {
  if (!publicToken) return '';
  const publicUrl = `${window.location.origin}/consulta/${publicToken}`;
  // Tenta renderToStaticMarkup primeiro; se falhar, usa flushSync
  let markup = await tryServerRender(publicUrl);
  if (!markup) markup = tryFlushSync(publicUrl);
  return markup;
}

export const printContainerLabel = async (container, validityDays, publicToken) => {
  if (!container) return;

  // Abre a janela SINCRONAMENTE (dentro do gesto do usuário) para evitar bloqueio de pop-up
  const win = window.open('', '_blank', 'width=420,height=300');
  if (!win) { alert('Permita pop-ups para imprimir a etiqueta.'); return; }

  // Mensagem de carregamento enquanto gera o QR Code
  win.document.write('<!DOCTYPE html><html><body style="font-family:Arial;padding:20px;color:#666;">Gerando etiqueta...</body></html>');
  win.document.close();

  // Gera o QR Code SVG
  const qrSvgMarkup = await buildQrSvgMarkup(publicToken);

  const opNum = container.op_number || '—';
  const product = container.product || '—';
  const lot = container.lot || '—';
  const placa = container.container_number || '';
  const barril = container.barril_number || '';
  const embalagem = barril ? `${placa} (${barril})` : placa || '—';
  const fabDateStr = container.created_date;
  const fabDate = fabDateStr
    ? new Date(fabDateStr).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—';
  const valDate = calcValidity(fabDateStr, validityDays);
  const netWeight = (container.net_weight || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });
  const grossWeight = (container.gross_weight || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });

  const qrColumnHtml = publicToken ? (qrSvgMarkup ? `
    <div class="qr-col">
      <div class="ref">Ref: ${opNum}</div>
      <div class="qr-code">${qrSvgMarkup}</div>
      <div class="qr-hint">LEIA PARA DETALHES DO LOTE</div>
    </div>` : `
    <div class="qr-col">
      <div class="ref">Ref: ${opNum}</div>
      <div class="qr-code"><span style="font-size:5pt;color:#999;">ERRO QR</span></div>
      <div class="qr-hint">LEIA PARA DETALHES DO LOTE</div>
    </div>`) : `
    <div class="qr-col">
      <div class="ref">Ref: ${opNum}</div>
      <div class="qr-code"><span style="font-size:5pt;color:#999;text-align:center;">TOKEN<br/>INDISPONÍVEL</span></div>
      <div class="qr-hint">LEIA PARA DETALHES DO LOTE</div>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Etiqueta ${opNum}</title>
<style>
  @page { size: 105mm 50mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', Arial, sans-serif; }
  html, body { margin: 0; padding: 0; width: 105mm; height: 50mm; }
  .label {
    width: 105mm; height: 50mm;
    background: #FFFFFF; color: #000000;
    padding: 1mm 4.5mm;
    display: flex; flex-direction: column;
    justify-content: center;
    border: 1px solid #000;
  }
  .top-section { display: flex; flex: 1; }
  .left-col { flex: 1; display: flex; flex-direction: column; padding-right: 2.5mm; }
  .product { font-size: 16pt; font-weight: 800; line-height: 1.05; }
  .data-block { display: flex; gap: 2mm; margin-top: 1.5mm; flex: 1; }
  .icon-col { display: flex; align-items: flex-start; padding-top: 0.5mm; }
  .icon-col svg { width: 7mm; height: 7mm; }
  .fields { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
  .field-row { display: flex; align-items: baseline; font-size: 8.5pt; line-height: 1.25; }
  .field-row .lbl { font-weight: 800; text-transform: uppercase; min-width: 24mm; }
  .field-row .sep { margin: 0 0.8mm; }
  .field-row .val { font-weight: 700; }
  .qr-col {
    width: 28mm;
    display: flex; flex-direction: column; align-items: center;
    border-left: 0.5px solid #000;
    padding: 0.5mm 0 0.5mm 2.5mm;
  }
  .ref { font-size: 9pt; font-weight: 700; align-self: flex-start; }
  .qr-code { flex: 1; display: flex; align-items: center; justify-content: center; }
  .qr-code svg { width: 20mm; height: 20mm; }
  .qr-hint { font-size: 5.5pt; font-weight: 700; text-transform: uppercase; text-align: center; line-height: 1.1; }
  .weight-table { width: 100%; border-collapse: collapse; }
  .weight-table td { border: 0.5px solid #000; padding: 1mm 1.5mm; font-size: 7.5pt; }
  .wt-title { font-weight: 800; text-transform: uppercase; text-align: center; vertical-align: middle; width: 30%; }
  .wt-label { font-weight: 700; text-transform: uppercase; width: 35%; }
  .wt-value { font-weight: 800; text-align: right; width: 35%; }
  .footer { font-size: 9pt; font-weight: 800; text-transform: uppercase; display: flex; align-items: baseline; }
  .footer .sep { margin: 0 0.8mm; }
  .footer .emb { font-size: 10pt; font-weight: 800; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="label">
  <div class="top-section">
    <div class="left-col">
      <div class="product">${product}</div>
      <div class="data-block">
        <div class="icon-col">
          <svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2">
            <path d="M9 2c-1 3-4 5-4 9a7 7 0 0 0 14 0c0-4-3-6-4-9"/>
            <path d="M9 11a3 3 0 0 0 6 0"/>
          </svg>
        </div>
        <div class="fields">
          <div class="field-row"><span class="lbl">LOTE</span><span class="sep">•</span><span class="val">${lot}</span></div>
          <div class="field-row"><span class="lbl">FABRICAÇÃO</span><span class="sep">•</span><span class="val">${fabDate}</span></div>
          <div class="field-row"><span class="lbl">VALIDADE</span><span class="sep">•</span><span class="val">${valDate}</span></div>
          <div class="field-row"><span class="lbl">RESP. TÉCNICO</span><span class="sep">•</span><span class="val">${RESP_TECNICO}</span></div>
        </div>
      </div>
    </div>
    ${qrColumnHtml}
  </div>
  <table class="weight-table">
    <tr>
      <td class="wt-title" rowspan="2">MASSA</td>
      <td class="wt-label">P. LÍQUIDO</td>
      <td class="wt-value">${netWeight} kg</td>
    </tr>
    <tr>
      <td class="wt-label">P. BRUTO</td>
      <td class="wt-value">${grossWeight} kg</td>
    </tr>
  </table>
  <div class="footer"><span>EMBALAGEM</span><span class="sep">•</span><span class="emb">${embalagem}</span></div>
</div>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); setTimeout(() => win.close(), 500); }, 300);
};
