import { printContainerLabel } from '@industrializacao/lib/labelprint';
import { formatMass, formatVolume } from '@transbordo/lib/format';
import { getDominantLote } from '@transbordo/lib/vasilhameComposicao';
import { resolveProdutoPublicToken } from '@transbordo/lib/ensureProdutoPublicToken';
import { getQuantidadeEmbalagensFromVasilhame } from '@transbordo/lib/tiposEmbalagem';
import {
  TIPO_CONVENCIONAL,
  TIPO_EMBALADO,
  TIPO_IND_RETORNO_MP,
  TIPO_IND_VASILHAME,
  formatSaidaItemInformacoes,
  tipoItemLabel,
} from '@transbordo/lib/saidaOrigem';

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

function formatDate(d) {
  if (!d) return '—';
  const raw = String(d);
  const date = raw.includes('T') ? new Date(raw) : new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}

function formatQtdItem(n, unidade) {
  const u = String(unidade || 'kg').toLowerCase().trim();
  const isVol = u === 'l' || u === 'lt' || u === 'litro' || u === 'litros';
  return `${isVol ? formatVolume(n) : formatMass(n)} ${unidade || 'kg'}`;
}

export function formatQtdEmbalagens(item) {
  if (item?.tipo === TIPO_CONVENCIONAL) return '01';
  if (item?.tipo !== TIPO_EMBALADO) return '—';

  const stored = Number(item.quantidade_embalagens);
  const peso = Number(item.peso_liquido_embalagem);
  const qtd = Number(item.quantidade_solicitada);
  const value =
    Number.isFinite(stored) && stored > 0
      ? stored
      : peso > 0 && qtd > 0
        ? qtd / peso
        : NaN;

  if (!Number.isFinite(value) || value <= 0) return '—';
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded).padStart(2, '0');
  return rounded.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function qtdSolicitada(item) {
  if (item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME) {
    return `${formatVolume(item.volume_solicitado)} L`;
  }
  return formatQtdItem(item.quantidade_solicitada, item.unidade);
}

function openPrintWindow(html, title, blockedMessage) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    window.alert(blockedMessage || 'Permita pop-ups para imprimir.');
    return null;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  win.focus();
  setTimeout(() => {
    win.print();
    setTimeout(() => win.close(), 400);
  }, 250);
  return win;
}

/**
 * Abre o diálogo de impressão do navegador com o conteúdo da saída (visão de agendamento).
 */
export function printSaidaAgendamento(saida, { t, vasilhames = [] } = {}) {
  if (!saida) return;

  const codigo = saida.codigo || '';
  const title = t
    ? t('painel.comercial.agendamentos.relatorioSaidaTitle', { codigo })
    : `Relatório de Saída ${codigo}`.trim();
  const statusLabel =
    saida.status === 'enviado_fiscal' || saida.enviado_ao_fiscal
      ? 'Validado'
      : 'Pendente';
  const itens = saida.itens || [];
  const blocked = t?.('painel.comercial.agendamentos.printBlocked');
  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));

  const rows =
    itens.length === 0
      ? `<tr><td colspan="6" class="empty">Nenhum produto nesta saída.</td></tr>`
      : itens
          .map((item) => {
            const vasilhame = item.vasilhame_id
              ? vasilhameById.get(item.vasilhame_id)
              : null;
            return `
      <tr>
        <td class="code">${escapeHtml(saida.codigo || item.produto_codigo || '—')}</td>
        <td>${escapeHtml(item.produto_nome || '—')}</td>
        <td>${escapeHtml(tipoItemLabel(item))}</td>
        <td>${escapeHtml(
          formatSaidaItemInformacoes(item, {
            vasilhame,
            includeLote: true,
            context: 'agendamento',
          })
        )}</td>
        <td class="num">${escapeHtml(qtdSolicitada(item))}</td>
        <td class="num">${escapeHtml(formatQtdEmbalagens(item))}</td>
      </tr>`;
          })
          .join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, Arial, sans-serif; color: #111827; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
  .meta p { margin: 0; font-size: 11px; color: #6b7280; }
  .meta strong { display: block; margin-top: 2px; font-size: 13px; color: #111827; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  td.code { color: #1d4ed8; font-weight: 600; white-space: nowrap; }
  td.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.empty { text-align: center; color: #6b7280; padding: 24px; }
  .footer { display: flex; justify-content: space-between; margin-top: 12px; font-size: 12px; color: #6b7280; }
  .notes { margin-bottom: 14px; font-size: 12px; }
  .notes span { display: block; font-size: 11px; color: #6b7280; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <div><p>Cliente</p><strong>${escapeHtml(saida.cliente_nome || '—')}</strong></div>
    <div><p>Data da Solicitação</p><strong>${escapeHtml(formatDate(saida.data_solicitacao))}</strong></div>
    <div><p>Data Programada</p><strong>${escapeHtml(formatDate(saida.data_programada))}</strong></div>
    <div><p>Validação</p><strong>${escapeHtml(statusLabel)}</strong></div>
  </div>
  ${
    saida.observacoes
      ? `<div class="notes"><span>Observações</span>${escapeHtml(saida.observacoes)}</div>`
      : ''
  }
  <table>
    <thead>
      <tr>
        <th>Código</th>
        <th>Produto</th>
        <th>Tipo</th>
        <th>Informações</th>
        <th>Qtd. Solicitada</th>
        <th>Qtd. de embalagens</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <span>${String(itens.length).padStart(2, '0')} ${itens.length === 1 ? 'produto' : 'produtos'}</span>
    <span>Qtd. total: <strong>${escapeHtml(formatMass(saida.quantidade_total))} kg</strong></span>
  </div>
</body>
</html>`;

  openPrintWindow(html, title, blocked);
}

export function resolveVasilhameForItem(item, vasilhames = []) {
  if (!item?.vasilhame_id) return null;
  return (
    (vasilhames || []).find((v) => String(v.id) === String(item.vasilhame_id)) ||
    null
  );
}

export async function printEtiquetaConvencional(item, saida, vasilhames = []) {
  const vasilhame = resolveVasilhameForItem(item, vasilhames);
  const container = {
    op_number: saida?.codigo || vasilhame?.codigo || '—',
    product: item?.produto_nome || vasilhame?.produto_nome || '—',
    lot: item?.lote || vasilhame?.lote || '—',
    container_number: item?.vasilhame_placa || vasilhame?.placa || '',
    barril_number: item?.vasilhame_barril || vasilhame?.barril || '',
    type: vasilhame?.tipo || '',
    tare: vasilhame?.tara || 0,
    volume: vasilhame?.volume,
    net_weight: vasilhame?.peso_liquido || item?.peso_liquido || 0,
    gross_weight: vasilhame?.peso_bruto || 0,
    composicao: vasilhame?.composicao,
    quantidade_embalagens: vasilhame?.quantidade_embalagens,
    created_date: vasilhame?.created_at || saida?.data_programada,
  };

  const publicToken = await resolveProdutoPublicToken({
    produtoId: item?.produto_id || vasilhame?.produto_id,
    codigo: item?.produto_codigo || vasilhame?.produto_codigo,
    nome: item?.produto_nome || vasilhame?.produto_nome,
  }).catch(() => null);

  await printContainerLabel(container, null, publicToken, {
    manufactureDate: vasilhame?.created_at || saida?.data_programada,
    volume: vasilhame?.volume,
    clienteNome: saida?.cliente_nome || vasilhame?.cliente_nome || item?.cliente_nome,
    clienteId: saida?.cliente_id || vasilhame?.cliente_id,
    contexto: 'convencional',
    packageQty: getQuantidadeEmbalagensFromVasilhame(vasilhame) || undefined,
  });
}

export async function printEtiquetaVasilhame(vasilhame) {
  if (!vasilhame) return;

  const lot =
    String(vasilhame.lote || '').trim() ||
    getDominantLote(vasilhame.composicao) ||
    '—';

  const container = {
    op_number: vasilhame.codigo || '—',
    product: vasilhame.produto_nome || '—',
    lot,
    container_number: vasilhame.placa || '',
    barril_number: vasilhame.barril || '',
    type: vasilhame.tipo || '',
    tare: vasilhame.tara || 0,
    volume: vasilhame.volume,
    net_weight: vasilhame.peso_liquido || 0,
    gross_weight: vasilhame.peso_bruto || 0,
    composicao: vasilhame.composicao,
    quantidade_embalagens: vasilhame.quantidade_embalagens,
    created_date: vasilhame.created_at || vasilhame.created_date,
  };

  const publicToken = await resolveProdutoPublicToken({
    produtoId: vasilhame.produto_id,
    codigo: vasilhame.produto_codigo,
    nome: vasilhame.produto_nome,
  }).catch(() => null);

  await printContainerLabel(container, null, publicToken, {
    manufactureDate: vasilhame.created_at || vasilhame.created_date,
    volume: vasilhame.volume,
    clienteNome: vasilhame.cliente_nome,
    clienteId: vasilhame.cliente_id,
    contexto: 'convencional',
    packageQty: getQuantidadeEmbalagensFromVasilhame(vasilhame) || undefined,
  });
}
