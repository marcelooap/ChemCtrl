import { printContainerLabel } from '@industrializacao/lib/labelprint';
import { loadContainerLoteDatasMap } from '@industrializacao/lib/containerLoteDatas';
import {
  isUnitPackagingLike,
  labelRequiresManualVolume,
  stripAggregatedQtyPrefix,
  suggestLabelVolumePlaceholder,
} from '@industrializacao/lib/packagingTypes';
import { entities } from '@transbordo/services/entities';
import { formatMass, formatVolume, parseDensidade } from '@transbordo/lib/format';
import { getDominantLote, resolveVasilhameLoteDatas } from '@transbordo/lib/vasilhameComposicao';
import { resolveProdutoPublicToken } from '@transbordo/lib/ensureProdutoPublicToken';
import {
  buildPlacaEmbalagens,
  getQuantidadeEmbalagensFromVasilhame,
  getVolumePorEmbalagemFromVasilhame,
  isDestinoEmbalagemUnitaria,
  isVasilhameLegadoEmbalado,
  labelTipoEmbalagem,
} from '@transbordo/lib/tiposEmbalagem';
import {
  TIPO_CONVENCIONAL,
  TIPO_EMBALADO,
  TIPO_IND_RETORNO_MP,
  TIPO_IND_VASILHAME,
  formatSaidaItemEmbalagem,
  formatSaidaItemLote,
  isTanqueVazioItem,
  resolveSaidaItemLote,
  tipoItemLabel,
  aggregateUnitarioSaidaItens,
} from '@transbordo/lib/saidaOrigem';
import { isValidadeIndeterminada } from '@transbordo/lib/entradaForm';

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const AGUARDANDO_TRANSPORTE = 'Aguardando informação';
const REPORT_COL_COUNT = 10;
const UNIT_PACKAGING_DESC = /bombona|tambor|ibc|one\s*way/i;

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

function parseReportDate(d) {
  if (!d) return null;
  const raw = String(d);
  const date = raw.includes('T') ? new Date(raw) : new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Dias restantes até a validade (negativo se já vencido). */
function formatDiasParaVencer(validade, { indeterminada = false } = {}) {
  if (indeterminada) return '-';
  const expiry = parseReportDate(validade);
  if (!expiry) return '—';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return String(Math.round((expiry.getTime() - today.getTime()) / 86_400_000));
}

function formatValidadeRelatorio(validade, { indeterminada = false } = {}) {
  if (indeterminada) return 'Indeterminado';
  return formatDate(validade);
}

function resolveTipoEmbalagemRelatorio(item, vasilhame) {
  return (
    vasilhame?.tipo ||
    vasilhame?.type ||
    item?.tipo_embalagem ||
    item?.container_type ||
    ''
  );
}

function resolvePlacaRelatorio(item, vasilhame) {
  return String(
    item?.vasilhame_placa ||
      vasilhame?.placa ||
      vasilhame?.container_number ||
      ''
  ).trim();
}

/** Bombona / tambor / IBC envasado (aparece em Vasilhames, mas conta como embalado). */
function isEmbalagemUnitariaNoRelatorio(item, vasilhame) {
  if (!item || isTanqueVazioItem(item)) return false;
  if (item.tipo === TIPO_EMBALADO || item.tipo === TIPO_IND_RETORNO_MP) {
    return false;
  }
  const tipo = resolveTipoEmbalagemRelatorio(item, vasilhame);
  const placa = resolvePlacaRelatorio(item, vasilhame);
  return (
    isDestinoEmbalagemUnitaria(tipo) ||
    isVasilhameLegadoEmbalado(tipo) ||
    isUnitPackagingLike(tipo, placa)
  );
}

function tipoItemLabelRelatorio(item, vasilhame) {
  if (isEmbalagemUnitariaNoRelatorio(item, vasilhame)) return 'Embalado';
  return tipoItemLabel(item);
}

/** Descrição da embalagem unitária (ex.: "Bombonas de 200 L"), sem quantidade. */
function formatDescricaoEmbalagemUnitaria(item, vasilhame) {
  const placa = resolvePlacaRelatorio(item, vasilhame);
  const fromPlaca = stripAggregatedQtyPrefix(placa);
  if (fromPlaca && UNIT_PACKAGING_DESC.test(fromPlaca)) {
    return fromPlaca;
  }

  const tipo = resolveTipoEmbalagemRelatorio(item, vasilhame);
  if (tipo) {
    const fromTipo = stripAggregatedQtyPrefix(buildPlacaEmbalagens(1, tipo));
    if (fromTipo) return fromTipo;
    return labelTipoEmbalagem(tipo) || tipo;
  }

  return fromPlaca || '—';
}

/**
 * Coluna Informações do relatório de saída (agendamento):
 * - Vasilhame (tanque): N placa (n barril)
 * - Embalado original: "-"
 * - Bombona/tambor/IBC envasado: descrição (ex.: Bombonas de 200 L)
 */
function formatRelatorioInformacoes(item, vasilhame) {
  if (item?.tipo === TIPO_EMBALADO || item?.tipo === TIPO_IND_RETORNO_MP) {
    return '-';
  }
  if (isEmbalagemUnitariaNoRelatorio(item, vasilhame)) {
    return formatDescricaoEmbalagemUnitaria(item, vasilhame);
  }
  return formatSaidaItemEmbalagem(item, { vasilhame });
}

function formatQtdItem(n, unidade) {
  const u = String(unidade || 'kg').toLowerCase().trim();
  const isVol = u === 'l' || u === 'lt' || u === 'litro' || u === 'litros';
  return `${isVol ? formatVolume(n) : formatMass(n)} ${unidade || 'kg'}`;
}

export function formatQtdEmbalagens(item) {
  if (item?.tipo === TIPO_CONVENCIONAL || item?.tipo === TIPO_IND_VASILHAME) {
    const stored = Number(item.quantidade_embalagens);
    if (Number.isFinite(stored) && stored > 0) {
      const rounded = Math.round(stored * 100) / 100;
      if (Number.isInteger(rounded)) return String(rounded).padStart(2, '0');
      return rounded.toLocaleString('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
    }
    const fromPlaca = String(item.vasilhame_placa || '').match(/^(\d+)\s*x\s*/i);
    if (fromPlaca) return String(parseInt(fromPlaca[1], 10) || 1).padStart(2, '0');
    return '01';
  }
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

function findById(mapOrList, id) {
  if (!id) return null;
  const key = String(id);
  if (mapOrList instanceof Map) return mapOrList.get(key) || null;
  return (mapOrList || []).find((row) => String(row?.id) === key) || null;
}

function resolveVasilhameForReport(item, vasilhameById) {
  const byId = findById(vasilhameById, item?.vasilhame_id);
  if (byId) return byId;
  const placa = String(item?.vasilhame_placa || '').trim().toUpperCase();
  if (!placa || !(vasilhameById instanceof Map)) return null;
  for (const row of vasilhameById.values()) {
    if (String(row?.placa || '').trim().toUpperCase() === placa) return row;
  }
  return null;
}

/**
 * Fabricação/validade do produto/lote — mesmas fontes do checklist de carregamento.
 */
function resolveItemReportDates(
  item,
  { vasilhame, estoqueById, transbordos = [], container = null } = {}
) {
  if (isTanqueVazioItem(item)) {
    return {
      data_fabricacao: null,
      data_validade: null,
      validade_indeterminada: false,
    };
  }

  const estoque =
    findById(estoqueById, item?.entrada_id) ||
    findById(estoqueById, item?.stock_id) ||
    null;

  const indeterminadaFromSources = (...sources) =>
    sources.some((s) => isValidadeIndeterminada(s));

  if (container) {
    const indeterminada = indeterminadaFromSources(container, item, estoque);
    return {
      data_fabricacao:
        container.data_fabricacao ||
        item?.data_fabricacao ||
        estoque?.data_fabricacao ||
        null,
      data_validade: indeterminada
        ? null
        : container.data_validade ||
          item?.data_validade ||
          estoque?.data_validade ||
          null,
      validade_indeterminada: indeterminada,
    };
  }

  let fabricacao = item?.data_fabricacao || estoque?.data_fabricacao || null;
  let validade = item?.data_validade || estoque?.data_validade || null;
  let indeterminada = indeterminadaFromSources(item, estoque);

  if (vasilhame) {
    const datas = resolveVasilhameLoteDatas(vasilhame, estoqueById, {
      transbordos,
    });
    if (datas.data_fabricacao || datas.data_validade) {
      return {
        data_fabricacao: datas.data_fabricacao || fabricacao || null,
        data_validade: indeterminada
          ? null
          : datas.data_validade || validade || null,
        validade_indeterminada: indeterminada,
      };
    }

    const composicao = Array.isArray(vasilhame.composicao)
      ? vasilhame.composicao
      : [];
    for (const c of composicao) {
      const row =
        findById(estoqueById, c?.estoque_id) ||
        findById(estoqueById, c?.entrada_id);
      if (!row) continue;
      if (!indeterminada && isValidadeIndeterminada(row)) indeterminada = true;
      if (!fabricacao && row.data_fabricacao) fabricacao = row.data_fabricacao;
      if (!validade && row.data_validade) validade = row.data_validade;
      if (fabricacao && (validade || indeterminada)) break;
    }
  }

  return {
    data_fabricacao: fabricacao || null,
    data_validade: indeterminada ? null : validade || null,
    validade_indeterminada: indeterminada,
  };
}

function transporteField(value) {
  const text = String(value || '').trim();
  return text || AGUARDANDO_TRANSPORTE;
}

/**
 * Abre o diálogo de impressão do navegador com o conteúdo da saída (visão de agendamento).
 */
export async function printSaidaAgendamento(
  saida,
  {
    t,
    vasilhames = [],
    entradas = [],
    transbordos = [],
    agendamento = null,
    containersById = null,
  } = {}
) {
  if (!saida) return;

  const codigo = saida.codigo || '';
  const title = t
    ? t('painel.comercial.agendamentos.relatorioSaidaTitle', { codigo })
    : `Relatório de Saída ${codigo}`.trim();
  const statusLabel =
    saida.status === 'enviado_fiscal' || saida.enviado_ao_fiscal
      ? 'Validado'
      : 'Pendente';
  const itens = aggregateUnitarioSaidaItens(saida.itens || [], {
    vasilhames,
    containersById,
  });
  const blocked = t?.('painel.comercial.agendamentos.printBlocked');
  const vasilhameById = new Map(
    (vasilhames || []).map((v) => [String(v.id), v])
  );
  const estoqueById = new Map(
    (entradas || []).map((row) => [String(row.id), row])
  );

  const containerIds = [
    ...new Set(
      itens.map((item) => item?.container_id).filter(Boolean).map(String)
    ),
  ];
  let containerDatas = containersById instanceof Map ? containersById : new Map();
  if (containerIds.length > 0) {
    const missing = containerIds.filter((id) => {
      const row = containerDatas.get(id);
      return !(row?.data_fabricacao || row?.data_validade);
    });
    if (missing.length > 0) {
      try {
        const loaded = await loadContainerLoteDatasMap(missing);
        containerDatas = new Map(containerDatas);
        loaded.forEach((value, key) => containerDatas.set(key, value));
      } catch (err) {
        console.error(
          '[Relatório Saída] Falha ao resolver datas dos containers:',
          err
        );
      }
    }
  }

  const rows =
    itens.length === 0
      ? `<tr><td colspan="${REPORT_COL_COUNT}" class="empty">Nenhum produto nesta saída.</td></tr>`
      : itens
          .map((item) => {
            const vasilhame = resolveVasilhameForReport(item, vasilhameById);
            const container = findById(containerDatas, item?.container_id);
            const embalagemSource = vasilhame || container;
            const datas = resolveItemReportDates(item, {
              vasilhame,
              estoqueById,
              transbordos,
              container,
            });
            return `
      <tr>
        <td class="code">${escapeHtml(saida.codigo || item.produto_codigo || '—')}</td>
        <td class="produto">${escapeHtml(item.produto_nome || '—')}</td>
        <td class="tipo">${escapeHtml(tipoItemLabelRelatorio(item, embalagemSource))}</td>
        <td class="info">${escapeHtml(formatRelatorioInformacoes(item, embalagemSource))}</td>
        <td class="lote">${escapeHtml(formatSaidaItemLote(item, { vasilhame: embalagemSource }))}</td>
        <td class="date">${escapeHtml(formatDate(datas.data_fabricacao))}</td>
        <td class="date">${escapeHtml(
          formatValidadeRelatorio(datas.data_validade, {
            indeterminada: datas.validade_indeterminada,
          })
        )}</td>
        <td class="num dias">${escapeHtml(
          formatDiasParaVencer(datas.data_validade, {
            indeterminada: datas.validade_indeterminada,
          })
        )}</td>
        <td class="num solicitado">${escapeHtml(qtdSolicitada(item))}</td>
        <td class="num emb">${escapeHtml(formatQtdEmbalagens(item))}</td>
      </tr>`;
          })
          .join('');

  const transportadora = transporteField(agendamento?.transportadora);
  const motorista = transporteField(agendamento?.motorista);
  const placa = transporteField(agendamento?.placa);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  /*
   * Margem em duas camadas (igual a4-document.css):
   * @page cobre a área não imprimível da impressora; padding do .sheet
   * protege se o diálogo de impressão sobrescrever @page.
   */
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body {
    height: 100%;
    width: 100%;
    margin: 0;
    padding: 0;
    overflow: visible;
  }
  body {
    font-family: Inter, Arial, sans-serif;
    color: #111827;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .sheet {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 0px);
    width: 100%;
    max-width: 100%;
    padding: 4mm;
    overflow: visible;
  }
  .sheet-body { flex: 1 0 auto; min-width: 0; overflow: visible; }
  h1 {
    font-size: 15px;
    margin: 0 0 10px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .meta { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
  .meta p { margin: 0; font-size: 9px; color: #6b7280; }
  .meta strong {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    color: #111827;
    overflow-wrap: anywhere;
  }
  .transporte {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 12px;
    padding: 6px 8px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #f9fafb;
  }
  .transporte p { margin: 0; font-size: 9px; color: #6b7280; }
  .transporte strong {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    color: #111827;
    overflow-wrap: anywhere;
  }
  table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 10px;
  }
  th, td {
    border: 1px solid #e5e7eb;
    padding: 7px 6px;
    text-align: left;
    vertical-align: middle;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.35;
  }
  th {
    background: #f3f4f6;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    color: #6b7280;
    line-height: 1.3;
    hyphens: auto;
    padding: 8px 6px;
  }
  /* Larguras somam 100% — prioriza Código e Qtd. emb. nas bordas. */
  th.col-code, td.code { width: 6%; }
  th.col-produto, td.produto { width: 18%; }
  th.col-tipo, td.tipo { width: 7%; }
  th.col-info, td.info { width: 12%; }
  th.col-lote, td.lote { width: 9%; }
  th.col-date, td.date { width: 8%; }
  th.col-dias, td.dias { width: 7%; }
  th.col-solicitado, td.solicitado { width: 10%; }
  th.col-emb, td.emb { width: 15%; }
  td.code {
    color: #1d4ed8;
    font-weight: 600;
    white-space: nowrap;
    overflow: visible;
  }
  td.tipo, td.num, td.date, td.dias { white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.dias, td.solicitado, td.emb { text-align: right; }
  th.col-dias, th.col-solicitado, th.col-emb { text-align: right; }
  td.empty { text-align: center; color: #6b7280; padding: 20px; }
  .footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; font-size: 10px; color: #6b7280; }
  .notes { margin-bottom: 10px; font-size: 10px; overflow-wrap: anywhere; }
  .notes span { display: block; font-size: 9px; color: #6b7280; }
  .signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    margin-top: auto;
    padding-top: 24px;
    padding-bottom: 2mm;
    page-break-inside: avoid;
    flex-shrink: 0;
  }
  .signatures .line {
    border-top: 1px solid #111827;
    padding-top: 8px;
    text-align: center;
    font-size: 12px;
    color: #374151;
  }
  @media print {
    html, body {
      height: 100%;
      width: 100%;
      margin: 0;
      padding: 0;
      overflow: visible;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      min-height: 100%;
      display: flex;
      flex-direction: column;
    }
    .sheet {
      /* A4 landscape (210mm) − margens @page (8mm×2): preenche a folha
         para empurrar assinaturas ao rodapé sem cortar conteúdo longo. */
      min-height: calc(210mm - 16mm);
      padding: 3mm;
      overflow: visible;
      display: flex;
      flex-direction: column;
    }
    .sheet-body { flex: 1 1 auto; }
    .signatures {
      margin-top: auto;
      padding-top: 20px;
      padding-bottom: 0;
    }
  }
</style>
</head>
<body>
  <div class="sheet">
  <div class="sheet-body">
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <div><p>Cliente</p><strong>${escapeHtml(saida.cliente_nome || '—')}</strong></div>
    <div><p>Destino</p><strong>${escapeHtml(saida.destino || '—')}</strong></div>
    <div><p>Data da Solicitação</p><strong>${escapeHtml(formatDate(saida.data_solicitacao))}</strong></div>
    <div><p>Data Programada</p><strong>${escapeHtml(formatDate(saida.data_programada))}</strong></div>
    <div><p>Validação</p><strong>${escapeHtml(statusLabel)}</strong></div>
  </div>
  <div class="transporte">
    <div><p>Transportadora</p><strong>${escapeHtml(transportadora)}</strong></div>
    <div><p>Motorista</p><strong>${escapeHtml(motorista)}</strong></div>
    <div><p>Placa</p><strong>${escapeHtml(placa)}</strong></div>
  </div>
  ${
    saida.observacoes
      ? `<div class="notes"><span>Observações</span>${escapeHtml(saida.observacoes)}</div>`
      : ''
  }
  <table>
    <thead>
      <tr>
        <th class="col-code">Código</th>
        <th class="col-produto">Produto</th>
        <th class="col-tipo">Tipo</th>
        <th class="col-info">Informações</th>
        <th class="col-lote">Lote</th>
        <th class="col-date">Fabricação</th>
        <th class="col-date">Validade</th>
        <th class="col-dias">Dias p/&nbsp;venc.</th>
        <th class="col-solicitado">Solicitado</th>
        <th class="col-emb">Qtd.&nbsp;embalagens</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <span>${String(itens.length).padStart(2, '0')} ${itens.length === 1 ? 'produto' : 'produtos'}</span>
    <span>Qtd. total: <strong>${escapeHtml(formatMass(saida.quantidade_total))} kg</strong></span>
  </div>
  </div>
  <div class="signatures">
    <div class="line">Operador</div>
    <div class="line">Conferente</div>
  </div>
  </div>
</body>
</html>`;

  openPrintWindow(html, title, blocked);
}

export function resolveVasilhameForItem(item, vasilhames = []) {
  if (item?.vasilhame_id) {
    const byId = (vasilhames || []).find(
      (v) => String(v.id) === String(item.vasilhame_id),
    );
    if (byId) return byId;
  }
  const placa = String(item?.vasilhame_placa || '').trim().toUpperCase();
  if (!placa) return null;
  return (
    (vasilhames || []).find(
      (v) => String(v.placa || '').trim().toUpperCase() === placa,
    ) || null
  );
}

/**
 * Fabricação/validade do lote do vasilhame: o que foi editado no vasilhame
 * vale; o que faltar vem das datas da entrada (estoque) de origem.
 */
async function loadVasilhameLoteDatas(vasilhame) {
  const doVasilhame = resolveVasilhameLoteDatas(vasilhame);
  if (!vasilhame || (doVasilhame.data_fabricacao && doVasilhame.data_validade)) {
    return doVasilhame;
  }
  try {
    const [estoque, transbordos] = await Promise.all([
      entities.estoque.list(),
      entities.transbordos.list(),
    ]);
    const estoqueById = new Map((estoque || []).map((row) => [row.id, row]));
    return resolveVasilhameLoteDatas(vasilhame, estoqueById, { transbordos });
  } catch (err) {
    console.error('[Etiqueta] Falha ao resolver datas do lote:', err);
    return doVasilhame;
  }
}

function resolveUnitVolumeForLabel(vasilhame, item) {
  const fromVasilhame = getVolumePorEmbalagemFromVasilhame(vasilhame);
  if (fromVasilhame > 0) return Math.round(fromVasilhame);

  const type = vasilhame?.tipo || item?.tipo_embalagem || '';
  const fromType = suggestLabelVolumePlaceholder(type);
  if (fromType > 0) return Math.round(fromType);

  const plate = stripAggregatedQtyPrefix(
    item?.vasilhame_placa || vasilhame?.placa || '',
  );
  const fromPlate = suggestLabelVolumePlaceholder(plate);
  return fromPlate > 0 ? Math.round(fromPlate) : 0;
}

/**
 * Monta o contexto do PrintContainerLabelDialog para item convencional
 * (mesmo modal da tela de Vasilhames / Transbordo).
 */
export async function loadConvencionalLabelContext(item, saida, vasilhames = []) {
  const vasilhame = resolveVasilhameForItem(item, vasilhames);
  const loteDatas = await loadVasilhameLoteDatas(vasilhame);
  const plate = item?.vasilhame_placa || vasilhame?.placa || '';
  const type = vasilhame?.tipo || item?.tipo_embalagem || '';
  const unitVol = resolveUnitVolumeForLabel(vasilhame, item);
  const isUnit = labelRequiresManualVolume({
    type,
    tipo: type,
    container_number: plate,
    placa: plate,
  });

  const tankVol =
    Number(vasilhame?.volume) ||
    Number(item?.volume_disponivel) ||
    Number(item?.volume_solicitado) ||
    0;

  const container = {
    id: vasilhame?.id || item?.vasilhame_id || `saida-${saida?.id || 'x'}-${plate || item?.produto_id || 'item'}`,
    product: item?.produto_nome || vasilhame?.produto_nome || '—',
    lot: resolveSaidaItemLote(item, { vasilhame, preferVasilhame: true }) || '—',
    client: saida?.cliente_nome || vasilhame?.cliente_nome || item?.cliente_nome,
    op_number: saida?.codigo || vasilhame?.codigo || '—',
    container_number: plate,
    barril_number: item?.vasilhame_barril || vasilhame?.barril || '',
    type,
    volume: tankVol,
    volume_por_embalagem: unitVol || 0,
    tare: vasilhame?.tara || 0,
    net_weight: vasilhame?.peso_liquido || item?.peso_liquido || 0,
    gross_weight: vasilhame?.peso_bruto || 0,
    composicao: vasilhame?.composicao,
    quantidade_embalagens:
      vasilhame?.quantidade_embalagens || item?.quantidade_embalagens,
    created_date: vasilhame?.created_at || saida?.data_programada,
  };

  const dens =
    parseDensidade(vasilhame?.densidade) ||
    parseDensidade(item?.densidade) ||
    0;

  const initialVolume = isUnit
    ? (unitVol > 0 ? unitVol : '')
    : (tankVol > 0 ? Math.round(tankVol) : '');

  const produtoId = item?.produto_id || vasilhame?.produto_id;
  const produtoCodigo = item?.produto_codigo || vasilhame?.produto_codigo;
  const produtoNome = item?.produto_nome || vasilhame?.produto_nome;

  return {
    contexto: 'convencional',
    container,
    initialVolume,
    density: dens > 0 ? dens : undefined,
    clienteId: saida?.cliente_id || vasilhame?.cliente_id,
    clienteNome: saida?.cliente_nome || vasilhame?.cliente_nome || item?.cliente_nome,
    manufactureDate: loteDatas.data_fabricacao || null,
    expiryDate: loteDatas.data_validade || undefined,
    resolvePublicToken: () =>
      resolveProdutoPublicToken({
        produtoId,
        codigo: produtoCodigo,
        nome: produtoNome,
      }).catch(() => null),
  };
}

export async function printEtiquetaConvencional(item, saida, vasilhames = []) {
  const ctx = await loadConvencionalLabelContext(item, saida, vasilhames);
  const publicToken = await ctx.resolvePublicToken();
  const volume =
    Number(ctx.initialVolume) > 0
      ? Number(ctx.initialVolume)
      : Number(ctx.container.volume) || 0;

  await printContainerLabel(ctx.container, null, publicToken, {
    manufactureDate: ctx.manufactureDate,
    expiryDate: ctx.expiryDate,
    volume,
    clienteNome: ctx.clienteNome,
    clienteId: ctx.clienteId,
    contexto: 'convencional',
    packageQty: getQuantidadeEmbalagensFromVasilhame({
      ...ctx.container,
      tipo: ctx.container.type,
      placa: ctx.container.container_number,
    }) || undefined,
  });
}

export async function printEtiquetaVasilhame(vasilhame) {
  if (!vasilhame) return;

  const loteDatas = await loadVasilhameLoteDatas(vasilhame);
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
    manufactureDate: loteDatas.data_fabricacao || null,
    expiryDate: loteDatas.data_validade || undefined,
    volume: vasilhame.volume,
    clienteNome: vasilhame.cliente_nome,
    clienteId: vasilhame.cliente_id,
    contexto: 'convencional',
    packageQty: getQuantidadeEmbalagensFromVasilhame(vasilhame) || undefined,
  });
}
