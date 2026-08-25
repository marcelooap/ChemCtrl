import {
  CHECK_ANSWER,
  checksForKind,
  normalizeCheckValue,
} from '@painel/lib/carregamentoChecklistConfig';

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

function formatDateSafe(value, language = 'pt-BR') {
  if (!value) return '—';
  const raw = String(value);
  const date = raw.includes('T') ? new Date(raw) : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(language || 'pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function answerLabel(answer, t) {
  if (answer === CHECK_ANSWER.APROVADO) {
    return t('painel.comercial.agendamentos.checklist.answers.aprovado');
  }
  if (answer === CHECK_ANSWER.REPROVADO) {
    return t('painel.comercial.agendamentos.checklist.answers.reprovado');
  }
  if (answer === CHECK_ANSWER.NAO_SE_APLICA) {
    return t('painel.comercial.agendamentos.checklist.answers.naoSeAplica');
  }
  return '—';
}

/**
 * Impressão A4 retrato do checklist de um item (conferência + fotos).
 */
export function printChecklistItemA4({
  item,
  saida,
  fotoUrls = [],
  t,
  language = 'pt-BR',
} = {}) {
  if (!item) return;

  const title = t
    ? t('painel.logistica.carregamentos.checklistPrintTitle', {
        saida: saida?.codigo || item.saida_codigo || '',
        item: item.label || item.produto || '',
      })
    : `Checklist — ${saida?.codigo || ''} — ${item.label || ''}`;

  const checkDefs = checksForKind(item.kind);
  const sections = [...new Set(checkDefs.map((c) => c.section))];

  const checksHtml = sections
    .map((section) => {
      const sectionLabel = t
        ? t(`painel.comercial.agendamentos.checklist.sections.${section}`, {
            defaultValue: section,
          })
        : section;
      const rows = checkDefs
        .filter((c) => c.section === section)
        .map((c) => {
          const answer = normalizeCheckValue(item.checks?.[c.key]);
          return `<tr>
            <td>${escapeHtml(t ? t(c.labelKey) : c.key)}</td>
            <td class="ans ans-${escapeHtml(answer || 'vazio')}">${escapeHtml(
              answerLabel(answer, t || ((k) => k))
            )}</td>
          </tr>`;
        })
        .join('');
      return `<h3>${escapeHtml(sectionLabel)}</h3>
        <table><thead><tr><th>Verificação</th><th>Resultado</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    })
    .join('');

  const lacres =
    Array.isArray(item.lacres) && item.lacres.length
      ? `<div class="block"><h3>${escapeHtml(
          t
            ? t('painel.comercial.agendamentos.checklist.sections.lacres')
            : 'Lacres'
        )}</h3>
        <p class="chips">${item.lacres
          .map((l) => `<span>${escapeHtml(l.numero)}</span>`)
          .join('')}</p></div>`
      : '';

  const fotosHtml =
    (fotoUrls || []).length > 0
      ? `<div class="block"><h3>${escapeHtml(
          t
            ? t('painel.comercial.agendamentos.checklist.sections.fotos')
            : 'Fotos'
        )}</h3>
        <div class="fotos">${fotoUrls
          .map((url) => `<img src="${escapeHtml(url)}" alt="foto" />`)
          .join('')}</div></div>`
      : `<div class="block"><h3>${escapeHtml(
          t
            ? t('painel.comercial.agendamentos.checklist.sections.fotos')
            : 'Fotos'
        )}</h3><p class="muted">${escapeHtml(
          t
            ? t('painel.logistica.carregamentos.checklistNoPhotos')
            : 'Sem fotos'
        )}</p></div>`;

  const conferido =
    item.conferido_em
      ? `<p class="muted">${escapeHtml(
          t
            ? t('painel.comercial.agendamentos.checklist.itemValidatedAt', {
                date: new Date(item.conferido_em).toLocaleString(language || 'pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                operador: item.conferido_por_nome || '—',
              })
            : ''
        )}</p>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(language || 'pt-BR')}">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, Arial, sans-serif; color: #111827; margin: 0; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; margin: 16px 0 8px; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0 16px; }
  .meta div { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
  .meta p { margin: 0; font-size: 10px; color: #6b7280; text-transform: uppercase; }
  .meta strong { display: block; margin-top: 2px; font-size: 13px; color: #111827; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #e5e7eb; padding: 7px 9px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; color: #6b7280; }
  td.ans { font-weight: 700; white-space: nowrap; width: 28%; }
  td.ans-aprovado { color: #047857; }
  td.ans-reprovado { color: #b91c1c; }
  td.ans-nao_se_aplica { color: #475569; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
  .chips span { border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px 8px; font-family: ui-monospace, monospace; font-weight: 600; }
  .fotos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .fotos img { width: 100%; height: 140px; object-fit: cover; border: 1px solid #e5e7eb; border-radius: 8px; }
  .muted { color: #6b7280; margin: 8px 0 0; }
  .badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
  .badge-aprovado { background: #d1fae5; color: #065f46; }
  .badge-reprovado { background: #fee2e2; color: #991b1b; }
  .badge-em_conferencia { background: #fef3c7; color: #92400e; }
  .badge-pendente { background: #f3f4f6; color: #4b5563; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>
    <span class="badge badge-${escapeHtml(item.status || 'pendente')}">${escapeHtml(
      t
        ? t(
            `painel.comercial.agendamentos.checklist.status.${
              {
                aprovado: 'aprovado',
                reprovado: 'reprovado',
                em_conferencia: 'emConferencia',
                pendente: 'pendente',
              }[item.status] || 'pendente'
            }`
          )
        : item.status || ''
    )}</span>
  </p>
  <div class="meta">
    <div><p>${escapeHtml(t ? t('painel.comercial.agendamentos.checklist.fields.produto') : 'Produto')}</p><strong>${escapeHtml(item.produto || '—')}</strong></div>
    <div><p>${escapeHtml(t ? t('painel.comercial.agendamentos.checklist.fields.tipo') : 'Tipo')}</p><strong>${escapeHtml(item.tipo_label || '—')}</strong></div>
    <div><p>${escapeHtml(t ? t('painel.comercial.agendamentos.checklist.fields.lote') : 'Lote')}</p><strong>${escapeHtml(item.lote || '—')}</strong></div>
    <div><p>${escapeHtml(t ? t('painel.comercial.agendamentos.checklist.fields.quantidade') : 'Qtd')}</p><strong>${escapeHtml(item.quantidade || '—')}</strong></div>
    <div><p>${escapeHtml(t ? t('painel.comercial.agendamentos.checklist.fields.fabricacao') : 'Fabricação')}</p><strong>${escapeHtml(formatDateSafe(item.data_fabricacao, language))}</strong></div>
    <div><p>${escapeHtml(t ? t('painel.comercial.agendamentos.checklist.fields.validade') : 'Validade')}</p><strong>${escapeHtml(formatDateSafe(item.data_validade, language))}</strong></div>
  </div>
  ${lacres}
  ${checksHtml}
  ${fotosHtml}
  ${conferido}
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    window.alert(
      t?.('painel.comercial.agendamentos.printBlocked') ||
        'Permita pop-ups para imprimir.'
    );
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  win.focus();
  setTimeout(() => {
    win.print();
    setTimeout(() => win.close(), 400);
  }, 350);
}
