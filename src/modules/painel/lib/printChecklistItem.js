import {
  CHECK_ANSWER,
  checksForKind,
  normalizeCheckValue,
} from '@painel/lib/carregamentoChecklistConfig';

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const FOTOS_POR_PAGINA = 2;

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

function chunkArray(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

/**
 * Impressão A4 retrato do checklist de um item (conferência + fotos).
 * Página 1: dados e verificações. Fotos a partir da página 2, 2 por folha.
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

  const fotosLabel = t
    ? t('painel.comercial.agendamentos.checklist.sections.fotos')
    : 'Fotos';

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

  const urls = (fotoUrls || []).filter(Boolean);
  const totalFotoPages = Math.ceil(urls.length / FOTOS_POR_PAGINA) || 0;
  const fotoPages =
    urls.length > 0
      ? chunkArray(urls, FOTOS_POR_PAGINA)
          .map((pair, pageIndex) => {
            const imgs = pair
              .map(
                (url, i) =>
                  `<figure class="foto-slot">
                    <img src="${escapeHtml(url)}" alt="foto ${pageIndex * FOTOS_POR_PAGINA + i + 1}" />
                  </figure>`
              )
              .join('');
            const pageLabel =
              totalFotoPages > 1 ? ` (${pageIndex + 1}/${totalFotoPages})` : '';
            return `<section class="foto-page">
              <h3>${escapeHtml(fotosLabel)}${escapeHtml(pageLabel)}</h3>
              <div class="fotos-page">${imgs}</div>
            </section>`;
          })
          .join('')
      : '';

  const fotosHintOnFirstPage =
    urls.length > 0
      ? `<p class="muted fotos-hint">${escapeHtml(fotosLabel)}: ${urls.length} — ${escapeHtml(
          t
            ? t('painel.logistica.carregamentos.checklistFotosNextPages')
            : 'ver páginas seguintes'
        )}</p>`
      : `<div class="block"><h3>${escapeHtml(fotosLabel)}</h3><p class="muted">${escapeHtml(
          t
            ? t('painel.logistica.carregamentos.checklistNoPhotos')
            : 'Sem fotos'
        )}</p></div>`;

  const statusKey =
    {
      aprovado: 'aprovado',
      reprovado: 'reprovado',
      em_conferencia: 'emConferencia',
      pendente: 'pendente',
    }[item.status] || 'pendente';
  const statusText = t
    ? t(`painel.comercial.agendamentos.checklist.status.${statusKey}`)
    : item.status || '';

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(language || 'pt-BR')}">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
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
  .muted { color: #6b7280; margin: 8px 0 0; }
  .fotos-hint { margin-top: 16px; }
  .badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
  .badge-aprovado { background: #d1fae5; color: #065f46; }
  .badge-reprovado { background: #fee2e2; color: #991b1b; }
  .badge-em_conferencia { background: #fef3c7; color: #92400e; }
  .badge-pendente { background: #f3f4f6; color: #4b5563; }

  /* Fotos: sempre a partir da 2ª página, 2 por folha */
  .foto-page {
    page-break-before: always;
    break-before: page;
    height: calc(297mm - 24mm);
    display: flex;
    flex-direction: column;
  }
  .foto-page h3 { margin-top: 0; flex: 0 0 auto; }
  .fotos-page {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 10mm;
    min-height: 0;
  }
  .foto-slot {
    flex: 1 1 0;
    margin: 0;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
    background: #f9fafb;
    padding: 4mm;
  }
  .foto-slot img {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
  }
</style>
</head>
<body>
  <section class="page-checklist">
    <h1>${escapeHtml(title)}</h1>
    <p>
      <span class="badge badge-${escapeHtml(item.status || 'pendente')}">${escapeHtml(statusText)}</span>
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
    ${conferido}
    ${fotosHintOnFirstPage}
  </section>
  ${fotoPages}
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

  const imgs = [...win.document.images];
  const waitImages = Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );

  waitImages.then(() => {
    setTimeout(() => {
      win.print();
      setTimeout(() => win.close(), 400);
    }, 200);
  });
}
