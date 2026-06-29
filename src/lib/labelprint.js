// Gera e imprime etiqueta de vasilhame (105mm x 50mm) para impressora Zebra
// Layout: fundo branco, texto preto — baseado no modelo de referência

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

export const printContainerLabel = (container, validityDays) => {
  if (!container) return;

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

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Etiqueta ${opNum}</title>
<style>
  @page { size: 105mm 50mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', Arial, sans-serif; }
  .label {
    width: 105mm; height: 50mm;
    background: #FFFFFF; color: #000000;
    padding: 1.5mm 4.5mm;
    display: flex; flex-direction: column;
    border: 1px solid #000;
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start; }
  .product { font-size: 14pt; font-weight: 800; line-height: 1.05; }
  .ref { font-size: 8pt; font-weight: 700; }
  .data-block { display: flex; gap: 2mm; margin-top: 0.5mm; flex: 1; }
  .icon-col { display: flex; align-items: center; }
  .icon-col svg { width: 6mm; height: 6mm; }
  .fields { flex: 1; display: flex; flex-direction: column; justify-content: space-around; }
  .field-row { display: flex; align-items: baseline; font-size: 7.5pt; line-height: 1.15; }
  .field-row .lbl { font-weight: 800; text-transform: uppercase; min-width: 22mm; }
  .field-row .sep { margin: 0 0.8mm; }
  .field-row .val { font-weight: 700; }
  .weight-table { width: 100%; border-collapse: collapse; margin-top: 0.3mm; }
  .weight-table td { border: 0.5px solid #000; padding: 0.8mm 1.5mm; font-size: 6.5pt; }
  .wt-title { font-weight: 800; text-transform: uppercase; text-align: center; vertical-align: middle; width: 30%; }
  .wt-label { font-weight: 700; text-transform: uppercase; width: 35%; }
  .wt-value { font-weight: 800; text-align: right; width: 35%; }
  .footer { margin-top: 0.3mm; font-size: 8pt; font-weight: 800; text-transform: uppercase; display: flex; align-items: baseline; }
  .footer .sep { margin: 0 0.8mm; }
  .footer .emb { font-size: 9pt; font-weight: 800; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="label">
  <div class="header">
    <div class="product">${product}</div>
    <div class="ref">Ref: ${opNum}</div>
  </div>
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

  const win = window.open('', '_blank', 'width=420,height=250');
  if (!win) { alert('Permita pop-ups para imprimir a etiqueta.'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); setTimeout(() => win.close(), 500); }, 300);
};
