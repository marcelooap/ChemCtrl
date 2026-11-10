/**
 * Motor de apuração de faturamento — materiais embalados.
 *
 * - Movimentação entrada: qtd_paletes × tarifa (se data ∈ período)
 * - Movimentação saída: ceil(embalagens / capacidade) × tarifa (só carregamento concluído)
 * - Armazenagem saída: paletes expedidos × dias até o carregamento (clipados ao período)
 * - Armazenagem estoque: saldo remanescente × dias no período (origem "estoque")
 * - Granel/vasilhame excluídos
 *
 * Anti-duplicidade: paletes que saíram cobram armazenagem na linha de saída;
 * paletes remanescentes cobram apenas na linha de estoque (nunca na entrada).
 */
import { resolveTipoRecebimentoEstoque } from '@transbordo/lib/tipoRecebimento';
import { formatEstoqueCodigo } from '@transbordo/lib/estoqueCodigo';
import { rateToNumber, resolveTarifaForDate } from '@painel/lib/faturamentoTarifas';

export const ORIGEM_ENTRADA = 'entrada';
export const ORIGEM_SAIDA = 'saida';
export const ORIGEM_ESTOQUE = 'estoque';

export const PENDENCIA = Object.freeze({
  QTD_PALETES: 'qtd_paletes',
  LOCAL: 'local_armazenagem',
  CAPACIDADE: 'qtd_embalagem_por_palete',
  EMBALAGENS: 'quantidade_embalagens',
  OVERSHIP: 'paletes_excedem_entrada',
  ESTOQUE: 'estoque_nao_encontrado',
});

export function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents) {
  return (Number(cents) || 0) / 100;
}

export function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function diffDays(isoA, isoB) {
  const a = toIsoDate(isoA);
  const b = toIsoDate(isoB);
  if (!a || !b) return 0;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86400000);
}

export function addDays(iso, days) {
  const d = toIsoDate(iso);
  if (!d) return null;
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day + Number(days || 0)));
  return dt.toISOString().slice(0, 10);
}

/** Início inclusivo, fim exclusivo. */
export function countStorageDays(startInclusive, endExclusive) {
  const start = toIsoDate(startInclusive);
  const end = toIsoDate(endExclusive);
  if (!start || !end) return 0;
  return Math.max(0, diffDays(start, end));
}

export function calcPaletesSaida(embalagens, capacidade) {
  const emb = Number(embalagens);
  const cap = Number(capacidade);
  if (!Number.isFinite(emb) || emb <= 0) return null;
  if (!Number.isFinite(cap) || cap <= 0) return null;
  return Math.ceil(emb / cap);
}

function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a >= b ? a : b;
}

function minDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a <= b ? a : b;
}

function localRateKey(local) {
  const v = String(local || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (v === 'tenda') return 'armazenagem_tenda';
  if (v === 'patio') return 'armazenagem_patio';
  return null;
}

/** Local cadastrado no estoque (sem default — ausente fica em branco + pendência). */
function resolveLocalArmazenagem(lote) {
  const raw =
    lote?.local_armazenagem ||
    lote?.lotes?.[0]?.local_armazenagem ||
    null;
  return localRateKey(raw) ? raw : null;
}

/** Embalagens da entrada (direto ou inferido por saldo/peso). */
function resolveQuantidadeEmbalagens(lote) {
  const direct = Number(
    lote?.quantidade_embalagens ?? lote?.lotes?.[0]?.quantidade_embalagens
  );
  if (Number.isFinite(direct) && direct > 0) return direct;

  const peso = Number(lote?.peso_liquido ?? lote?.lotes?.[0]?.peso_liquido);
  const saldoInicial = Number(lote?.saldo_inicial ?? lote?.quantidade) || 0;
  if (Number.isFinite(peso) && peso > 0 && saldoInicial > 0) {
    const n = saldoInicial / peso;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Quantidade de paletes da entrada (com fallbacks). */
function resolveQtdPaletesEntrada(lote, capMap) {
  const direct = Number(lote?.qtd_paletes ?? lote?.lotes?.[0]?.qtd_paletes);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const emb = resolveQuantidadeEmbalagens(lote);
  const cap =
    capacidadeForItem(lote, capMap) ||
    capacidadeForItem(lote?.lotes?.[0], capMap);
  if (Number.isFinite(emb) && emb > 0 && cap != null) {
    return calcPaletesSaida(emb, cap);
  }
  // Sem capacidade no cadastro: assume 1 embalagem por palete (legado).
  if (Number.isFinite(emb) && emb > 0) {
    return Math.ceil(emb);
  }
  return null;
}

/**
 * Limita o remanescente ao saldo operacional atual (pátio/estoque).
 * Cobre baixas que não passaram por saída embalada (ex.: transbordo).
 */
function capPaletesBySaldoAtual(lote, qtdPaletesEntrada, remaining) {
  const saldoInicial = Number(lote?.saldo_inicial ?? lote?.quantidade) || 0;
  const saldoAtual = Number(lote?.saldo_atual ?? lote?.saldo_final) || 0;
  if (saldoAtual <= 0) return 0;
  if (!(qtdPaletesEntrada > 0)) return Math.max(0, remaining);
  if (!(saldoInicial > 0)) return Math.max(0, remaining);
  const bySaldo = qtdPaletesEntrada * (saldoAtual / saldoInicial);
  return Math.max(0, Math.min(Number(remaining) || 0, bySaldo));
}

function isEmbaladoEstoque(item) {
  return resolveTipoRecebimentoEstoque(item) === 'embalado';
}

function unique(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

/**
 * Produto exato (sem arredondar). Arredonda só no valor final via toCents.
 */
function moneyExact(paletes, days, dailyRate) {
  if (!paletes || !days) return 0;
  const rate = rateToNumber(dailyRate) ?? 0;
  return Number(paletes) * Number(days) * rate;
}

export function calcArmazenagemCents({
  paletes,
  startInclusive,
  endExclusive,
  local,
  tarifas,
  periodFrom,
  periodTo,
}) {
  const rateKey = localRateKey(local);
  if (!rateKey || !paletes) {
    return {
      cents: 0,
      days: 0,
      pending: rateKey ? null : PENDENCIA.LOCAL,
      segments: [],
    };
  }

  const periodStart = toIsoDate(periodFrom);
  const periodEndExclusive = addDays(toIsoDate(periodTo), 1);
  const segStart = maxDate(toIsoDate(startInclusive), periodStart);
  const segEnd = minDate(toIsoDate(endExclusive), periodEndExclusive);

  if (!segStart || !segEnd || segStart >= segEnd) {
    return { cents: 0, days: 0, pending: null, segments: [] };
  }

  const cuts = new Set([segStart, segEnd]);
  for (const t of tarifas || []) {
    const v = toIsoDate(t.vigencia_inicio);
    if (v && v > segStart && v < segEnd) cuts.add(v);
  }
  const points = [...cuts].sort();

  let exactTotal = 0;
  let days = 0;
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const d = countStorageDays(a, b);
    if (d <= 0) continue;
    const tarifa = resolveTarifaForDate(tarifas, a);
    const daily = tarifa?.[rateKey];
    const partExact = moneyExact(paletes, d, daily);
    exactTotal += partExact;
    days += d;
    segments.push({
      from: a,
      // Fim exclusivo interno (para cálculo). Exibição usa toInclusive.
      toExclusive: b,
      toInclusive: addDays(b, -1),
      days: d,
      paletes,
      dailyRate: daily,
      // Exibição do segmento; o total da linha arredonda o somatório exato.
      cents: toCents(partExact),
      local,
    });
  }

  return { cents: toCents(exactTotal), days, pending: null, segments };
}

function produtoCapacidadeMap(produtos) {
  const map = new Map();
  for (const p of produtos || []) {
    if (!p) continue;
    const cap = Number(p.qtd_embalagem_por_palete);
    const value = Number.isFinite(cap) && cap > 0 ? cap : null;
    if (value == null) continue;
    if (p.id) map.set(String(p.id), value);
    const cod = String(p.codigo || p.produto_codigo || '')
      .trim()
      .toUpperCase();
    if (cod) map.set(`cod:${cod}`, value);
  }
  return map;
}

function capacidadeForItem(item, capMap) {
  if (!item || !capMap) return null;
  if (item.produto_id && capMap.has(String(item.produto_id))) {
    return capMap.get(String(item.produto_id));
  }
  const cod = String(item.produto_codigo || item.codigo || '')
    .trim()
    .toUpperCase();
  if (cod && capMap.has(`cod:${cod}`)) return capMap.get(`cod:${cod}`);
  return null;
}

export function buildCarregamentoBySaidaId(agendamentos) {
  const map = new Map();
  for (const row of agendamentos || []) {
    if (!row || row.status !== 'concluido' || !row.saida_id) continue;
    const data =
      toIsoDate(row.data_carregamento) ||
      toIsoDate(row.data) ||
      toIsoDate(row.updated_at);
    if (!data) continue;
    const key = String(row.saida_id);
    const prev = map.get(key);
    if (!prev || data > prev.data_carregamento) {
      map.set(key, {
        data_carregamento: data,
        agendamento_id: row.id,
        hora_carregamento: row.hora_carregamento || null,
      });
    }
  }
  return map;
}

export function collectSaidaEmbaladoEvents(saidas, carregamentoBySaida, capMap) {
  const events = [];
  for (const saida of saidas || []) {
    if (!saida?.id) continue;
    const carreg = carregamentoBySaida.get(String(saida.id));
    if (!carreg) continue;

    (saida.itens || []).forEach((item, index) => {
      if (!item || item.tipo !== 'embalado' || !item.entrada_id) return;

      const embalagens = Number(item.quantidade_embalagens);
      const capacidade = capacidadeForItem(item, capMap);
      const pendencias = [];

      if (!Number.isFinite(embalagens) || embalagens <= 0) {
        pendencias.push(PENDENCIA.EMBALAGENS);
      }
      if (capacidade == null) {
        pendencias.push(PENDENCIA.CAPACIDADE);
      }

      const paletes =
        pendencias.length === 0 ? calcPaletesSaida(embalagens, capacidade) : null;

      events.push({
        saida,
        item,
        itemIndex: index,
        estoqueId: String(item.entrada_id),
        data_carregamento: carreg.data_carregamento,
        embalagens: Number.isFinite(embalagens) ? embalagens : null,
        capacidade,
        paletes,
        pendencias,
      });
    });
  }

  events.sort((a, b) => {
    const d = String(a.data_carregamento).localeCompare(String(b.data_carregamento));
    if (d !== 0) return d;
    return String(a.saida?.codigo || a.saida?.id).localeCompare(
      String(b.saida?.codigo || b.saida?.id)
    );
  });

  return events;
}

function buildSaidaRowBase(ev, lote, local) {
  const item = ev.item || {};
  const saida = ev.saida || {};
  return {
    key: `saida:${saida.id}:${ev.itemIndex}`,
    origem: ORIGEM_SAIDA,
    id: resolveDisplayId(saida.codigo, saida.numero, saida.codigo_saida),
    idInterno: saida.id,
    data: ev.data_carregamento,
    codigo: item.produto_codigo || lote?.produto_codigo || '',
    produto: item.produto_nome || lote?.produto_nome || '',
    lote: item.lote || lote?.lote || '',
    clienteId: saida.cliente_id || lote?.cliente_id || null,
    cliente: saida.cliente_nome || lote?.cliente_nome || '',
    local: local || lote?.local_armazenagem || null,
    paletes: ev.paletes,
    paletesMovimentacao: null,
    movimentacaoCents: null,
    armazenagemCents: 0,
    armazenagemDays: 0,
    armazenagemSegments: [],
    valorUnitarioMov: null,
    valorDiario: null,
    embalagens: ev.embalagens,
    capacidade: ev.capacidade,
    pendencias: [...(ev.pendencias || [])],
    detail: {
      tipo: ORIGEM_SAIDA,
      saida,
      item,
      estoque: lote,
      dataCarregamento: ev.data_carregamento,
      embalagens: ev.embalagens,
      capacidade: ev.capacidade,
      paletes: ev.paletes,
    },
  };
}

function finalizeRow(row) {
  const mov = row.movimentacaoCents;
  const armRaw = row.armazenagemCents;
  const arm = armRaw && armRaw > 0 ? armRaw : null;
  const total = (mov != null ? mov : 0) + (arm != null ? arm : 0);
  const hasAny = mov != null || arm != null;

  return {
    ...row,
    armazenagemCents: arm,
    armazenagemDays: arm ? row.armazenagemDays : null,
    movimentacao: mov != null ? fromCents(mov) : null,
    armazenagem: arm != null ? fromCents(arm) : null,
    total: hasAny ? fromCents(total) : null,
    totalCents: total,
  };
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );
}

/**
 * ID curto para exibição na tabela (nunca UUID técnico).
 * Preferência: codigo_estoque → entrada_codigo → outros códigos curtos.
 */
export function resolveDisplayId(...candidates) {
  for (const raw of candidates) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s || s === '—' || isUuidLike(s)) continue;
    return s;
  }
  return '—';
}

/** ID de linha de estoque/entrada embalado. */
export function resolveEstoqueDisplayId(lote) {
  const estoqueCodigo = formatEstoqueCodigo(lote?.codigo_estoque);
  return resolveDisplayId(
    estoqueCodigo !== '—' ? estoqueCodigo : null,
    lote?.entrada_codigo,
    lote?.id_entrada,
    lote?.codigo,
    lote?.lotes?.[0]?.entrada_codigo
  );
}

function loteMatchesClienteFilter(lote, clienteId, clienteNome) {
  const idFilter = String(clienteId || '').trim();
  const nomeFilter = String(clienteNome || '')
    .trim()
    .toLowerCase();
  if (!idFilter && !nomeFilter) return true;
  const rowNome = String(lote?.cliente_nome || '')
    .trim()
    .toLowerCase();
  if (nomeFilter) return rowNome === nomeFilter;
  return String(lote?.cliente_id || '') === idFilter;
}

function loteMatchesSearch(lote, search) {
  const q = String(search || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  const hay = [
    lote?.produto_codigo,
    lote?.produto_nome,
    lote?.lote,
    lote?.cliente_nome,
    lote?.entrada_codigo,
    lote?.id_entrada,
    lote?.id,
    formatEstoqueCodigo(lote?.codigo_estoque),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function ensureSaidaRow(map, list, ev, lote, local) {
  const rowKey = `${String(ev.saida.id)}::${ev.itemIndex}`;
  let row = map.get(rowKey);
  if (!row) {
    row = buildSaidaRowBase(ev, lote, local);
    map.set(rowKey, row);
    list.push(row);
  }
  return row;
}

function applySaidaMovimentacao(row, ev, tarifas, from, to) {
  const exitDate = ev.data_carregamento;
  if (!(exitDate >= from && exitDate <= to)) return;
  if (row.movimentacaoCents != null) return;

  const blocked =
    ev.pendencias.includes(PENDENCIA.CAPACIDADE) ||
    ev.pendencias.includes(PENDENCIA.EMBALAGENS) ||
    ev.paletes == null;

  if (blocked) {
    row.pendencias = unique([...(row.pendencias || []), ...(ev.pendencias || [])]);
    return;
  }

  const unit = resolveTarifaForDate(tarifas, exitDate).movimentacao_palete;
  row.movimentacaoCents = toCents(ev.paletes * (rateToNumber(unit) ?? 0));
  row.paletesMovimentacao = ev.paletes;
  row.valorUnitarioMov = unit;
}

/**
 * Apura faturamento do período.
 */
export function apurarFaturamentoEmbalados({
  estoqueItems = [],
  saidas = [],
  agendamentosConcluidos = [],
  produtos = [],
  tarifas = [],
  periodFrom,
  periodTo,
  clienteId = '',
  clienteNome = '',
  search = '',
} = {}) {
  const from = toIsoDate(periodFrom);
  const to = toIsoDate(periodTo);
  if (!from || !to || from > to) {
    return {
      rows: [],
      totals: {
        movEntradaCents: 0,
        movSaidaCents: 0,
        armazenagemCents: 0,
        totalCents: 0,
        pendencias: 0,
      },
      error: 'period_invalid',
    };
  }

  const capMap = produtoCapacidadeMap(produtos);
  const carregamentoBySaida = buildCarregamentoBySaidaId(agendamentosConcluidos);
  const saidaEvents = collectSaidaEmbaladoEvents(saidas, carregamentoBySaida, capMap);

  const eventsByEstoque = new Map();
  for (const ev of saidaEvents) {
    const list = eventsByEstoque.get(ev.estoqueId) || [];
    list.push(ev);
    eventsByEstoque.set(ev.estoqueId, list);
  }

  const estoqueById = new Map();
  for (const item of estoqueItems || []) {
    if (item?.id) estoqueById.set(String(item.id), item);
  }

  const entradaRows = [];
  const estoqueRows = [];
  const saidaRows = [];
  const saidaRowByKey = new Map();
  const processedSaidaKeys = new Set();

  const embalados = (estoqueItems || []).filter(isEmbaladoEstoque);

  for (const lote of embalados) {
    const estoqueId = String(lote.id || '');
    if (!estoqueId) continue;

    const dataEntrada = toIsoDate(lote.data) || toIsoDate(lote.created_at);
    const qtdPaletes = resolveQtdPaletesEntrada(lote, capMap);
    const local = resolveLocalArmazenagem(lote);
    const displayId = resolveEstoqueDisplayId(lote);

    const missingLocal = !localRateKey(local);
    const pendenciasEntrada = [];
    if (qtdPaletes == null) pendenciasEntrada.push(PENDENCIA.QTD_PALETES);
    if (missingLocal) pendenciasEntrada.push(PENDENCIA.LOCAL);

    const loteEvents = eventsByEstoque.get(estoqueId) || [];
    let remaining = qtdPaletes || 0;
    const saidasComposicao = [];
    let paletesSaidaTotal = 0;
    /** Saídas até o fim do período (reduzem saldo “no momento” da apuração). */
    let paletesSaidaAteFimPeriodo = 0;

    let estoqueArmazenagemCents = 0;
    let estoqueArmazenagemDays = 0;
    let estoqueArmazenagemDetail = [];

    // Ledger de saldo: exige paletes + data. Local só é necessário para cobrar armazenagem.
    const canTrackSaldo = qtdPaletes != null && Boolean(dataEntrada);
    const canBillStorage = canTrackSaldo && !missingLocal;

    if (canTrackSaldo) {
      for (const ev of loteEvents) {
        const exitDate = toIsoDate(ev.data_carregamento);
        const requested = Number(ev.paletes) || 0;
        // Saídas após o período ainda estavam em estoque durante a apuração.
        const exitInOrBeforePeriod = Boolean(exitDate && exitDate <= to);
        const exitInPeriod = Boolean(exitDate && exitDate >= from && exitDate <= to);
        const consumed = exitInOrBeforePeriod ? Math.min(remaining, requested) : 0;

        if (exitInOrBeforePeriod && requested > remaining) {
          ev.pendencias = unique([...(ev.pendencias || []), PENDENCIA.OVERSHIP]);
        }

        if (exitInOrBeforePeriod && consumed > 0) {
          paletesSaidaAteFimPeriodo += consumed;
          saidasComposicao.push({
            data: exitDate,
            paletes: consumed,
            saidaId: ev.saida?.codigo || ev.saida?.id || null,
            embalagens: ev.embalagens,
            noPeriodo: exitInPeriod,
          });
          remaining = Math.max(0, remaining - consumed);
        }

        if (exitInPeriod) {
          const row = ensureSaidaRow(saidaRowByKey, saidaRows, ev, lote, local);
          processedSaidaKeys.add(`${String(ev.saida.id)}::${ev.itemIndex}`);
          applySaidaMovimentacao(row, ev, tarifas, from, to);
          row.pendencias = unique([
            ...(row.pendencias || []),
            ...(ev.pendencias || []),
            ...(missingLocal ? [PENDENCIA.LOCAL] : []),
          ]);

          if (consumed > 0 && canBillStorage) {
            paletesSaidaTotal += consumed;

            // Armazenagem dos paletes expedidos no período (linha de saída).
            const store = calcArmazenagemCents({
              paletes: consumed,
              startInclusive: dataEntrada,
              endExclusive: exitDate,
              local,
              tarifas,
              periodFrom: from,
              periodTo: to,
            });
            if (store.cents) {
              row.armazenagemCents = (row.armazenagemCents || 0) + store.cents;
              row.armazenagemDays = (row.armazenagemDays || 0) + store.days;
              row.armazenagemSegments = [
                ...(row.armazenagemSegments || []),
                ...store.segments,
              ];
              if (!row.valorDiario && store.segments[0]) {
                row.valorDiario = store.segments[0].dailyRate;
              }
            }
          } else if (consumed > 0) {
            paletesSaidaTotal += consumed;
          }
        }
      }

      // Remanescentes no período — INCLUI entrada anterior ao filtro.
      remaining = capPaletesBySaldoAtual(lote, qtdPaletes, remaining);
      const presenteNoPeriodo = Boolean(dataEntrada && dataEntrada <= to);
      if (remaining > 0 && presenteNoPeriodo && canBillStorage) {
        const store = calcArmazenagemCents({
          paletes: remaining,
          startInclusive: dataEntrada,
          endExclusive: addDays(to, 1),
          local,
          tarifas,
          periodFrom: from,
          periodTo: to,
        });
        estoqueArmazenagemCents = store.cents;
        estoqueArmazenagemDays = store.days;
        estoqueArmazenagemDetail = store.segments;
      }
    } else {
      // Sem saldo rastreável: ainda gera linhas de saída (movimentação) no período.
      for (const ev of loteEvents) {
        const exitDate = toIsoDate(ev.data_carregamento);
        if (!(exitDate && exitDate >= from && exitDate <= to)) continue;
        const row = ensureSaidaRow(saidaRowByKey, saidaRows, ev, lote, local);
        processedSaidaKeys.add(`${String(ev.saida.id)}::${ev.itemIndex}`);
        applySaidaMovimentacao(row, ev, tarifas, from, to);
        row.pendencias = unique([
          ...(row.pendencias || []),
          ...(ev.pendencias || []),
          ...pendenciasEntrada,
        ]);
      }
    }

    const entryInPeriod = Boolean(dataEntrada && dataEntrada >= from && dataEntrada <= to);
    const movEntradaCents =
      entryInPeriod && qtdPaletes != null
        ? toCents(
            qtdPaletes *
              (rateToNumber(
                resolveTarifaForDate(tarifas, dataEntrada).movimentacao_palete
              ) ?? 0)
          )
        : null;

    const hasMov = movEntradaCents != null && movEntradaCents > 0;
    const hasEstoqueArm = estoqueArmazenagemCents > 0;
    const presenteNoPeriodo = Boolean(dataEntrada && dataEntrada <= to);
    // Sem local: ainda lista o remanescente com advertência (sem cobrar armazenagem).
    const hasEstoquePendenteLocal =
      canTrackSaldo &&
      missingLocal &&
      presenteNoPeriodo &&
      remaining > 0;
    const matchesLoteFilters =
      loteMatchesClienteFilter(lote, clienteId, clienteNome) &&
      loteMatchesSearch(lote, search);

    // Entrada: somente movimentação (e pendências). Sem armazenagem remanescente.
    // Continua filtrada pela data de entrada ∈ período.
    if (entryInPeriod && (hasMov || pendenciasEntrada.length > 0)) {
      entradaRows.push({
        key: `entrada:${estoqueId}`,
        origem: ORIGEM_ENTRADA,
        id: displayId,
        idInterno: estoqueId,
        data: dataEntrada,
        codigo: lote.produto_codigo || '',
        produto: lote.produto_nome || '',
        lote: lote.lote || '',
        clienteId: lote.cliente_id || null,
        cliente: lote.cliente_nome || '',
        local: local || null,
        paletes: qtdPaletes,
        movimentacaoCents: hasMov ? movEntradaCents : null,
        armazenagemCents: null,
        armazenagemDays: null,
        armazenagemSegments: [],
        valorUnitarioMov: hasMov
          ? resolveTarifaForDate(tarifas, dataEntrada).movimentacao_palete
          : null,
        valorDiario: null,
        quantidadeRecebida: lote.quantidade ?? lote.saldo_inicial ?? null,
        pendencias: pendenciasEntrada,
        detail: {
          tipo: ORIGEM_ENTRADA,
          estoque: lote,
          qtdPaletes,
          dataEntrada,
        },
      });
    }

    // Estoque: NÃO filtra pela data de entrada.
    // Com local: cobra armazenagem. Sem local: lista com local em branco + advertência.
    if ((hasEstoqueArm || hasEstoquePendenteLocal) && matchesLoteFilters) {
      const rateKey = localRateKey(local);
      const refDate = maxDate(dataEntrada, from) || from;
      const pendenciasEstoque = missingLocal ? [PENDENCIA.LOCAL] : [];
      estoqueRows.push({
        key: `estoque:${estoqueId}`,
        origem: ORIGEM_ESTOQUE,
        id: displayId,
        idInterno: estoqueId,
        // Data de referência da apuração (não a data de entrada).
        data: to,
        codigo: lote.produto_codigo || '',
        produto: lote.produto_nome || '',
        lote: lote.lote || '',
        clienteId: lote.cliente_id || null,
        cliente: lote.cliente_nome || '',
        local: local || null,
        paletes: remaining,
        movimentacaoCents: null,
        armazenagemCents: hasEstoqueArm ? estoqueArmazenagemCents : null,
        armazenagemDays: hasEstoqueArm ? estoqueArmazenagemDays : null,
        armazenagemSegments: hasEstoqueArm ? estoqueArmazenagemDetail : [],
        valorUnitarioMov: null,
        valorDiario: rateKey
          ? resolveTarifaForDate(tarifas, refDate)?.[rateKey]
          : null,
        pendencias: pendenciasEstoque,
        detail: {
          tipo: ORIGEM_ESTOQUE,
          estoque: lote,
          dataEntrada,
          periodFrom: from,
          periodTo: to,
          qtdPaletesEntrada: qtdPaletes,
          paletesSaida: paletesSaidaAteFimPeriodo,
          paletesRemanescentes: remaining,
          saidas: saidasComposicao,
          armazenagemSegments: hasEstoqueArm ? estoqueArmazenagemDetail : [],
        },
      });
    }
  }

  // Saídas sem estoque correspondente (somente se a data de carregamento ∈ período).
  for (const ev of saidaEvents) {
    const rowKey = `${String(ev.saida.id)}::${ev.itemIndex}`;
    if (processedSaidaKeys.has(rowKey)) continue;
    const exitDate = ev.data_carregamento;
    if (!(exitDate >= from && exitDate <= to)) continue;

    const lote = estoqueById.get(ev.estoqueId) || null;
    const row = ensureSaidaRow(saidaRowByKey, saidaRows, ev, lote, lote?.local_armazenagem);
    applySaidaMovimentacao(row, ev, tarifas, from, to);
    row.pendencias = unique([
      ...(row.pendencias || []),
      ...(ev.pendencias || []),
      PENDENCIA.ESTOQUE,
    ]);
  }

  const saidaRowsNoPeriodo = saidaRows.filter((row) => {
    if (!row.data || row.data < from || row.data > to) return false;
    const hasMov = row.movimentacaoCents != null && row.movimentacaoCents > 0;
    const hasArm = (row.armazenagemCents || 0) > 0;
    const hasPendencia = (row.pendencias || []).length > 0;
    return hasMov || hasArm || hasPendencia;
  });

  let rows = [...entradaRows, ...saidaRowsNoPeriodo, ...estoqueRows].map(finalizeRow);

  // Entrada/Saída: data do evento ∈ período.
  // Estoque: já foi gerado pelo saldo presente no período (entrada pode ser anterior).
  rows = rows.filter((r) => {
    if (r.origem === ORIGEM_ESTOQUE) return true;
    const d = String(r.data || '').slice(0, 10);
    return d >= from && d <= to;
  });

  const clienteFilter = String(clienteId || '').trim();
  const clienteNomeKey = String(clienteNome || '')
    .trim()
    .toLowerCase();
  const q = String(search || '').trim().toLowerCase();
  if (clienteFilter || clienteNomeKey) {
    rows = rows.filter((r) => {
      const rowNome = String(r.cliente || '')
        .trim()
        .toLowerCase();
      // Nome tem prioridade: evita misturar clientes duplicados no cadastro.
      if (clienteNomeKey) return rowNome === clienteNomeKey;
      return String(r.clienteId || '') === clienteFilter;
    });
  }
  if (q) {
    rows = rows.filter((r) => {
      const hay = [r.codigo, r.produto, r.lote, r.cliente, r.id, r.idInterno]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  rows.sort((a, b) => {
    const d = String(b.data || '').localeCompare(String(a.data || ''));
    if (d !== 0) return d;
    const origemOrder = { entrada: 0, saida: 1, estoque: 2 };
    const oa = origemOrder[a.origem] ?? 9;
    const ob = origemOrder[b.origem] ?? 9;
    if (oa !== ob) return oa - ob;
    return String(a.id).localeCompare(String(b.id));
  });

  const totals = {
    movEntradaCents: 0,
    movSaidaCents: 0,
    armazenagemCents: 0,
    totalCents: 0,
    pendencias: 0,
  };

  for (const r of rows) {
    if (r.pendencias?.length) totals.pendencias += 1;
    if (r.origem === ORIGEM_ENTRADA && r.movimentacaoCents) {
      totals.movEntradaCents += r.movimentacaoCents;
    }
    if (r.origem === ORIGEM_SAIDA && r.movimentacaoCents) {
      totals.movSaidaCents += r.movimentacaoCents;
    }
    // Armazenagem de saída + estoque remanescente (sem duplicidade).
    if (r.armazenagemCents) totals.armazenagemCents += r.armazenagemCents;
  }
  totals.totalCents =
    totals.movEntradaCents + totals.movSaidaCents + totals.armazenagemCents;

  return { rows, totals, error: null };
}

export const __test__ = {
  calcPaletesSaida,
  countStorageDays,
  toCents,
  fromCents,
  calcArmazenagemCents,
  diffDays,
  addDays,
  localRateKey,
};
