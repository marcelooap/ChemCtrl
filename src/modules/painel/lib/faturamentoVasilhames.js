/**
 * Motor de apuração de faturamento — vasilhames (armazenagem por capacidade nominal).
 *
 * Contagem de dias: início inclusivo, fim exclusivo (mesmo padrão de embalados).
 * Valor = dias × tarifa diária da capacidade nominal (não do volume atual).
 *
 * Capacidade nominal — prioridade:
 * 1. Cadastro confirmado (t_vasilhames_capacidade_nominal.confirmada)
 * 2. Histórico válido do próprio tanque / campo operacional confiável
 * 3. Definição manual (pendência amarela até o usuário informar)
 *
 * Limitação conhecida: não há ledger dia-a-dia de quantidades parciais.
 * A cobrança é pela permanência do tanque (saldo > 0) com tarifa da capacidade
 * nominal — alinhado aos exemplos do produto (500 L remanescentes cobram a
 * tarifa do tanque 1.500 L / 5.000 L).
 */
import {
  TIPOS_NAO_VASILHAME,
  isDestinoEmbalagemUnitaria,
  isVasilhameLegadoEmbalado,
} from '@transbordo/lib/tiposEmbalagem';
import { sameTanqueIdentity } from '@transbordo/lib/vasilhameComposicao';
import {
  collectConvencionalItemsForVasilhame,
  resolveVasilhameExpedidoDisplay,
} from '@transbordo/lib/vasilhamePatio';
import {
  addDays,
  countStorageDays,
  toCents,
  toIsoDate,
  fromCents,
} from '@painel/lib/faturamentoEmbalados';
import { rateToNumber } from '@painel/lib/faturamentoTarifas';
import { resolveTarifaVasilhameForDate } from '@painel/lib/faturamentoTarifasVasilhames';
import {
  CAPACIDADES_NOMINAIS_PADRAO,
  ORIGEM_CAPACIDADE,
  buildTankIdentityKey,
  findCapacidadeForTank,
  isCapacidadeConhecida,
  roundLiters,
  snapCapacidadeConhecida,
} from '@painel/lib/vasilhamesCapacidadeNominal';

export const STATUS_NO_PATIO = 'No Pátio';
export const STATUS_EXPEDIDO = 'Expedido';

export const CAPACIDADE_ORIGEM = Object.freeze({
  CADASTRADA: 'cadastrada',
  HISTORICO: 'historico',
  MANUAL: 'manual',
  NAO_IDENTIFICADA: 'nao_identificada',
});

export const PENDENCIA_VASILHAME = Object.freeze({
  CAPACIDADE: 'capacidade_nao_identificada',
});

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

function normText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function isVasilhameFaturavel(tank) {
  if (!tank) return false;
  const tipo = tank.tipo || 'Vasilhame';
  if (TIPOS_NAO_VASILHAME.has(tipo)) return false;
  if (isDestinoEmbalagemUnitaria(tipo)) return false;
  if (isVasilhameLegadoEmbalado(tipo)) return false;
  return tipo === 'Vasilhame' || !tipo;
}

export function resolveDataEnvase(tank) {
  return (
    toIsoDate(tank?.data_envase) ||
    toIsoDate(tank?.data) ||
    toIsoDate(tank?.created_at) ||
    toIsoDate(tank?.created_date)
  );
}

export function resolveDataSaida(tank) {
  return toIsoDate(tank?.data_saida) || toIsoDate(tank?.departure_date) || null;
}

export function resolveStatus(tank) {
  const status = String(tank?.status || STATUS_NO_PATIO).trim();
  const volume = Number(tank?.volume) || 0;
  if (status === STATUS_EXPEDIDO || volume <= 0) return STATUS_EXPEDIDO;
  return STATUS_NO_PATIO;
}

function moneyExact(days, dailyRate) {
  if (!days) return 0;
  const rate = rateToNumber(dailyRate) ?? 0;
  return Number(days) * rate;
}

/**
 * Segmenta o intervalo de armazenagem pelas vigências da capacidade.
 */
function clippedStayDays(startInclusive, endExclusive, periodFrom, periodTo) {
  const periodStart = toIsoDate(periodFrom);
  const periodEndExclusive = addDays(toIsoDate(periodTo), 1);
  const segStart = maxDate(toIsoDate(startInclusive), periodStart);
  const segEnd = minDate(toIsoDate(endExclusive), periodEndExclusive);
  if (!segStart || !segEnd || segStart >= segEnd) {
    return { segStart: null, segEnd: null, days: 0 };
  }
  return {
    segStart,
    segEnd,
    days: countStorageDays(segStart, segEnd),
  };
}

/**
 * Volume para exibição/faturamento.
 * Em expedidos o cadastro zera `volume`; recupera da saída/composição.
 */
export function resolveVolumeFaturamento(tank, saidas = []) {
  const current = Number(tank?.volume) || 0;
  if (current > 0) return roundLiters(current) ?? current;

  const linked = collectConvencionalItemsForVasilhame(saidas, tank?.id);
  // Amplia match por placa/barril quando o id da saída ficou defasado
  const linkedExtra = [];
  if (linked.length === 0 && (tank?.placa || tank?.barril)) {
    for (const saida of saidas || []) {
      for (const item of saida?.itens || []) {
        if (!item) continue;
        const same =
          (item.vasilhame_id && item.vasilhame_id === tank.id) ||
          sameTanqueIdentity(
            item.vasilhame_placa || item.placa,
            item.vasilhame_barril || item.barril,
            tank.placa,
            tank.barril
          );
        if (same) linkedExtra.push({ saida, item });
      }
    }
  }
  const linkedItems = linked.length > 0 ? linked : linkedExtra;

  const restored = resolveVasilhameExpedidoDisplay(tank, { linkedItems });
  const restoredVol = Number(restored?.volume) || 0;
  if (restoredVol > 0) return roundLiters(restoredVol) ?? restoredVol;

  let fromSaida = 0;
  for (const row of linkedItems) {
    const item = row?.item || row;
    fromSaida += Number(item?.volume_solicitado) || 0;
  }
  if (fromSaida > 0) return roundLiters(fromSaida) ?? fromSaida;

  const fromComp = (tank?.composicao || []).reduce(
    (s, c) => s + (Number(c?.quantidade_l) || 0),
    0
  );
  if (fromComp > 0) return roundLiters(fromComp) ?? fromComp;

  return 0;
}

/** ID operacional exibido nas telas de Vasilhames (Transbordo/Industrialização). */
export function resolveCodigoTanque(tank) {
  return (
    String(tank?.codigo || '').trim() ||
    String(tank?.container_number || '').trim() ||
    String(tank?.numero || '').trim() ||
    String(tank?.id || '').slice(0, 8)
  );
}

export function calcArmazenagemVasilhameCents({
  capacidadeLitros,
  startInclusive,
  endExclusive,
  tarifas,
  periodFrom,
  periodTo,
}) {
  const { segStart, segEnd, days: clippedDays } = clippedStayDays(
    startInclusive,
    endExclusive,
    periodFrom,
    periodTo
  );

  const capacidade = snapCapacidadeConhecida(capacidadeLitros) ?? roundLiters(capacidadeLitros);
  if (capacidade == null) {
    return {
      cents: 0,
      days: clippedDays,
      pending: PENDENCIA_VASILHAME.CAPACIDADE,
      segments: [],
    };
  }

  if (!segStart || !segEnd) {
    return { cents: 0, days: 0, pending: null, segments: [] };
  }

  const relevant = (tarifas || []).filter(
    (t) => Math.abs(Number(t.capacidade_litros) - Number(capacidade)) < 0.5
  );

  const cuts = new Set([segStart, segEnd]);
  for (const t of relevant) {
    const v = toIsoDate(t.vigencia_inicio);
    if (v && v > segStart && v < segEnd) cuts.add(v);
    const fim = toIsoDate(t.vigencia_fim);
    if (fim) {
      const afterFim = addDays(fim, 1);
      if (afterFim && afterFim > segStart && afterFim < segEnd) cuts.add(afterFim);
    }
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
    const tarifa = resolveTarifaVasilhameForDate(tarifas, capacidade, a);
    if (!tarifa) continue;
    const daily = tarifa.tarifa_diaria;
    const partExact = moneyExact(d, daily);
    exactTotal += partExact;
    days += d;
    segments.push({
      from: a,
      toExclusive: b,
      toInclusive: addDays(b, -1),
      days: d,
      capacidade_litros: capacidade,
      dailyRate: daily,
      vigencia_inicio: tarifa.vigencia_inicio,
      vigencia_fim: tarifa.vigencia_fim || null,
      cents: toCents(partExact),
      exact: partExact,
    });
  }

  return {
    cents: toCents(exactTotal),
    days,
    pending: days > 0 && segments.length === 0 ? PENDENCIA_VASILHAME.CAPACIDADE : null,
    segments,
  };
}

function collectKnownVolumesFromTankHistory(tank, allVasilhames, saidas) {
  const candidates = [];
  const placa = tank?.placa;
  const barril = tank?.barril;
  const tankCreated = resolveDataEnvase(tank);

  for (const other of allVasilhames || []) {
    if (!other || other.id === tank?.id) continue;
    if (!sameTanqueIdentity(other.placa, other.barril, placa, barril)) continue;

    const otherEnvase = resolveDataEnvase(other);
    // Só histórico anterior ao ciclo atual
    if (tankCreated && otherEnvase && otherEnvase > tankCreated) continue;

    const capField = snapCapacidadeConhecida(other.capacidade);
    if (capField != null) candidates.push({ value: capField, source: 'cadastro_historico' });

    const vol = snapCapacidadeConhecida(other.volume);
    if (vol != null) candidates.push({ value: vol, source: 'volume_ciclo_anterior' });
  }

  for (const saida of saidas || []) {
    const itens = Array.isArray(saida?.itens) ? saida.itens : [];

    for (const item of itens) {
      if (!item) continue;
      const itemPlaca = item.vasilhame_placa || item.placa;
      const itemBarril = item.vasilhame_barril || item.barril;
      const sameId =
        (item.vasilhame_id && item.vasilhame_id === tank?.id) ||
        sameTanqueIdentity(itemPlaca, itemBarril, placa, barril);
      if (!sameId) continue;

      // Volume disponível / solicitado da própria saída do ciclo atual ou anterior
      const disponivel = snapCapacidadeConhecida(item.volume_disponivel);
      const solicitadoSnap = snapCapacidadeConhecida(item.volume_solicitado);
      const solicitado = Number(item.volume_solicitado);

      if (
        disponivel != null &&
        Number.isFinite(solicitado) &&
        Math.abs(solicitado - Number(item.volume_disponivel)) < 1
      ) {
        candidates.push({ value: disponivel, source: 'saida_integral' });
      } else if (disponivel != null) {
        candidates.push({ value: disponivel, source: 'saida_volume_disponivel' });
      } else if (solicitadoSnap != null) {
        candidates.push({ value: solicitadoSnap, source: 'saida_volume_solicitado' });
      }
    }
  }

  return candidates;
}

/**
 * Identifica capacidade nominal sem inventar a partir do volume parcial atual.
 */
export function identifyCapacidadeNominal({
  tank,
  allVasilhames = [],
  saidas = [],
  registryMap = new Map(),
  knownCapacidades = CAPACIDADES_NOMINAIS_PADRAO,
  volumeResolvido = null,
} = {}) {
  const registry = findCapacidadeForTank(registryMap, tank?.placa, tank?.barril);
  if (registry?.confirmada && registry.capacidade_litros != null) {
    return {
      capacidade_litros: Number(registry.capacidade_litros),
      origem: CAPACIDADE_ORIGEM.CADASTRADA,
      origemDetalhe:
        registry.origem === ORIGEM_CAPACIDADE.MANUAL
          ? CAPACIDADE_ORIGEM.MANUAL
          : CAPACIDADE_ORIGEM.CADASTRADA,
      confirmada: true,
      registry,
    };
  }

  if (registry && !registry.confirmada && registry.capacidade_litros != null) {
    // Registro histórico persistido (não confirmado) — usa, mas não bloqueia override
    return {
      capacidade_litros: Number(registry.capacidade_litros),
      origem: CAPACIDADE_ORIGEM.HISTORICO,
      origemDetalhe: CAPACIDADE_ORIGEM.HISTORICO,
      confirmada: false,
      registry,
    };
  }

  // Volume efetivo (pátio ou restaurado da expedição) — nunca inventa capacidade
  // a partir de saldo parcial fracionado.
  const volumeAtual =
    roundLiters(volumeResolvido) ??
    roundLiters(tank?.volume);

  // Campo operacional do próprio tanque: só aceita se for capacidade conhecida
  // e não for mera cópia do volume parcial atual.
  const capField = snapCapacidadeConhecida(tank?.capacidade, knownCapacidades);
  if (capField != null) {
    const isPartialCopy =
      volumeAtual != null &&
      Math.abs(volumeAtual - capField) >= 0.5 &&
      Math.abs(Number(tank?.capacidade) - volumeAtual) < 0.5;
    if (!isPartialCopy) {
      // Se capacidade == volume e volume é conhecido → tanque cheio (ok)
      // Se capacidade > volume → capacidade cadastral (ok)
      if (
        volumeAtual == null ||
        Math.abs(capField - volumeAtual) < 0.5 ||
        capField > volumeAtual + 0.5
      ) {
        return {
          capacidade_litros: capField,
          origem: CAPACIDADE_ORIGEM.CADASTRADA,
          origemDetalhe: CAPACIDADE_ORIGEM.CADASTRADA,
          confirmada: false,
          registry: null,
        };
      }
    }
  }

  // Volume efetivo exatamente igual a uma capacidade conhecida → tanque cheio
  const volSnap = snapCapacidadeConhecida(volumeAtual, knownCapacidades);
  if (volSnap != null) {
    return {
      capacidade_litros: volSnap,
      origem: CAPACIDADE_ORIGEM.HISTORICO,
      origemDetalhe: 'volume_atual_cheio',
      confirmada: false,
      registry: null,
    };
  }

  const history = collectKnownVolumesFromTankHistory(tank, allVasilhames, saidas);
  if (history.length > 0) {
    // Preferência: última saída integral; depois maior capacidade conhecida observada
    const bySaida = [...history].reverse().find((h) => h.source === 'saida_integral');
    const picked =
      bySaida ||
      history.reduce((best, cur) =>
        !best || Number(cur.value) > Number(best.value) ? cur : best
      );
    if (picked?.value != null) {
      return {
        capacidade_litros: Number(picked.value),
        origem: CAPACIDADE_ORIGEM.HISTORICO,
        origemDetalhe: picked.source,
        confirmada: false,
        registry: null,
      };
    }
  }

  return {
    capacidade_litros: null,
    origem: CAPACIDADE_ORIGEM.NAO_IDENTIFICADA,
    origemDetalhe: null,
    confirmada: false,
    registry: null,
  };
}

function matchesCliente(tank, clienteId, clienteNome) {
  if (!clienteId && !clienteNome) return true;
  if (clienteId && String(tank?.cliente_id || '') === String(clienteId)) return true;
  if (clienteNome) {
    const nome = normText(tank?.cliente_nome || tank?.cliente);
    if (nome && nome === normText(clienteNome)) return true;
  }
  return false;
}

function matchesSearch(tank, search) {
  const q = normText(search);
  if (!q) return true;
  const hay = [
    tank?.id,
    tank?.codigo,
    resolveCodigoTanque(tank),
    tank?.placa,
    tank?.barril,
    tank?.produto_codigo,
    tank?.produto_nome,
    tank?.produto,
    tank?.cliente_nome,
    tank?.cliente,
    tank?.lote,
  ]
    .map(normText)
    .join(' ');
  return hay.includes(q);
}

function intersectsPeriod(stayStart, stayEndExclusive, periodFrom, periodTo) {
  const periodStart = toIsoDate(periodFrom);
  const periodEndExclusive = addDays(toIsoDate(periodTo), 1);
  if (!periodStart || !periodEndExclusive || !stayStart) return false;
  const end = stayEndExclusive || periodEndExclusive;
  return stayStart < periodEndExclusive && end > periodStart;
}

/**
 * Apura linhas de faturamento de vasilhames para o período.
 */
export function apurarFaturamentoVasilhames({
  vasilhames = [],
  saidas = [],
  capacidadesConfirmadas = [],
  tarifas = [],
  periodFrom,
  periodTo,
  clienteId = '',
  clienteNome = '',
  statusFilter = '',
  search = '',
  knownCapacidades = CAPACIDADES_NOMINAIS_PADRAO,
} = {}) {
  const registryMap = capacidadesConfirmadas instanceof Map
    ? capacidadesConfirmadas
    : (() => {
        const map = new Map();
        for (const row of capacidadesConfirmadas || []) {
          const key = row?.identity_key || buildTankIdentityKey(row?.placa, row?.barril);
          if (key) map.set(key, row);
        }
        return map;
      })();

  const statusFiltro = String(statusFilter || '').trim();

  const rows = [];
  let armazenagemCents = 0;
  let pendencias = 0;

  for (const tank of vasilhames || []) {
    if (!isVasilhameFaturavel(tank)) continue;
    if (!matchesCliente(tank, clienteId, clienteNome)) continue;
    if (!matchesSearch(tank, search)) continue;

    const dataEnvase = resolveDataEnvase(tank);
    if (!dataEnvase) continue;

    const status = resolveStatus(tank);
    if (statusFiltro && status !== statusFiltro) continue;

    const dataSaida = status === STATUS_EXPEDIDO ? resolveDataSaida(tank) : null;
    const stayEndExclusive =
      status === STATUS_EXPEDIDO && dataSaida
        ? dataSaida
        : addDays(toIsoDate(periodTo), 1);

    if (!intersectsPeriod(dataEnvase, stayEndExclusive, periodFrom, periodTo)) {
      continue;
    }

    // Expedido sem data de saída confiável: não inventa dia
    if (status === STATUS_EXPEDIDO && !dataSaida) continue;

    const volumeCadastro = Number(tank.volume) || 0;
    const volumeExibido = resolveVolumeFaturamento(tank, saidas) || 0;
    // No pátio sem volume efetivo não entra; expedido com volume restaurado entra
    if (status === STATUS_NO_PATIO && volumeExibido <= 0 && volumeCadastro <= 0) continue;

    const capInfo = identifyCapacidadeNominal({
      tank,
      allVasilhames: vasilhames,
      saidas,
      registryMap,
      knownCapacidades,
      volumeResolvido: volumeExibido,
    });

    const pendenciaList = [];
    if (capInfo.origem === CAPACIDADE_ORIGEM.NAO_IDENTIFICADA) {
      pendenciaList.push(PENDENCIA_VASILHAME.CAPACIDADE);
    }

    const calc = calcArmazenagemVasilhameCents({
      capacidadeLitros: capInfo.capacidade_litros,
      startInclusive: dataEnvase,
      endExclusive: stayEndExclusive,
      tarifas,
      periodFrom,
      periodTo,
    });

    if (calc.pending && !pendenciaList.includes(calc.pending)) {
      pendenciaList.push(calc.pending);
    }

    if (pendenciaList.length) pendencias += 1;
    armazenagemCents += calc.cents || 0;

    const codigoProduto =
      tank.produto_codigo ||
      tank.codigo_produto ||
      '';
    const codigoTanque = resolveCodigoTanque(tank);

    rows.push({
      key: `vasilhame:${tank.id}`,
      id: codigoTanque,
      registroId: tank.id,
      data: dataEnvase,
      dataEnvase,
      dataSaida: dataSaida || null,
      status,
      placa: tank.placa || '',
      barril: tank.barril || '',
      codigo: codigoProduto,
      produto: tank.produto_nome || tank.produto || '',
      clienteId: tank.cliente_id || null,
      cliente: tank.cliente_nome || tank.cliente || '',
      loteVolume: volumeExibido,
      volumeAtual: volumeExibido,
      capacidadeNominal: capInfo.capacidade_litros,
      capacidadeOrigem: capInfo.origem,
      capacidadeOrigemDetalhe: capInfo.origemDetalhe,
      capacidadeConfirmada: Boolean(capInfo.confirmada),
      origemRegistro: tank.origem || (tank.transbordo_id ? 'transbordo' : 'manual'),
      diasPatio: calc.days,
      armazenagemCents: calc.cents,
      armazenagem: fromCents(calc.cents),
      armazenagemSegments: calc.segments,
      totalCents: calc.cents,
      total: fromCents(calc.cents),
      pendencias: pendenciaList,
      detail: {
        tankId: tank.id,
        codigoTanque,
        identityKey: buildTankIdentityKey(tank.placa, tank.barril),
        fracionado: Boolean(tank.fracionado),
        tarifaSegments: calc.segments,
        formula:
          capInfo.capacidade_litros != null
            ? `${calc.days} × tarifa(capacidade ${capInfo.capacidade_litros} L)`
            : null,
        periodFrom: toIsoDate(periodFrom),
        periodTo: toIsoDate(periodTo),
        stayStart: dataEnvase,
        stayEndExclusive,
      },
    });
  }

  rows.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  return {
    rows,
    totals: {
      armazenagemCents,
      totalCents: armazenagemCents,
      pendencias,
      quantidade: rows.length,
    },
  };
}

export { isCapacidadeConhecida, fromCents, toCents, toIsoDate, addDays, countStorageDays };
