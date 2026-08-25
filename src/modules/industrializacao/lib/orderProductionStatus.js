/** Tolerância em litros para fechar pedido (float / arredondamento de UI). */
export const VOLUME_EPS = 0.05;

export const toNum = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Pedido atendido: volume pendente ≈ 0 ou produzido ≥ pedido. */
export const isOrderFullyProduced = (volumeOrdered, volumeProduced, volumePending) => {
  const ordered = toNum(volumeOrdered);
  if (ordered <= 0) return false;
  const produced = toNum(volumeProduced);
  const pending = toNum(volumePending);
  return pending <= VOLUME_EPS || produced >= ordered - VOLUME_EPS;
};

/** Extrai YYYY-MM-DD de date-only / ISO UTC midnight / Date. */
const toCalendarYmd = (value) => {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return dateOnly[0];
    const utcMidnight = value.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ]00:00:00(?:\.\d+)?(?:Z|[+-]00:00)?$/i
    );
    if (utcMidnight) return `${utcMidnight[1]}-${utcMidnight[2]}-${utcMidnight[3]}`;
    const beforeT = value.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(beforeT)) return beforeT;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  if (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Data prevista já passou (ignora status — útil para destaque visual da data). */
export const isPastExpectedDate = (order, now = new Date()) => {
  if (!order?.expected_date) return false;
  const expected = toCalendarYmd(order.expected_date);
  const [y, m, d] = expected.split('-').map(Number);
  if (!y || !m || !d) return false;
  const endOfExpected = new Date(y, m - 1, d, 23, 59, 59, 999);
  return endOfExpected < now;
};

/**
 * Dias até a data prevista de atendimento (calendário local).
 * Positivo = falta X dias; 0 = hoje; negativo = atraso em dias.
 * Retorna null se não houver data válida.
 */
export const getDaysUntilExpected = (order, now = new Date()) => {
  if (!order?.expected_date) return null;
  const expected = toCalendarYmd(order.expected_date);
  const [y, m, d] = expected.split('-').map(Number);
  if (!y || !m || !d) return null;
  const expectedDay = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expectedDay.getTime() - today.getTime()) / 86_400_000);
};

/**
 * Pedido atrasado para exibição de status.
 * Com OP aberta (Em produção) nunca é Atrasado — status operacional prevalece.
 */
export const isOrderLate = (order, now = new Date()) => {
  if (!order) return false;
  if (order.status === 'Em produção') return false;
  if (order.status === 'Finalizado') return false;
  if (isOrderFullyProduced(order.volume_ordered, order.volume_produced, order.volume_pending)) {
    return false;
  }
  if (toNum(order.volume_pending) <= VOLUME_EPS) return false;
  return isPastExpectedDate(order, now);
};

/**
 * Status exibido na UI (Atrasado é só display; nunca grava no DB).
 * Prioridade: Finalizado > Em produção > Atrasado > status derivado.
 */
export const getOrderDisplayStatus = (order, now = new Date()) => {
  if (!order) return 'Pendente';
  if (isOrderFullyProduced(order.volume_ordered, order.volume_produced, order.volume_pending)) {
    return 'Finalizado';
  }
  if (order.status === 'Finalizado') return 'Finalizado';
  if (order.status === 'Em produção') return 'Em produção';
  if (isOrderLate(order, now)) return 'Atrasado';
  return order.status || 'Pendente';
};

/**
 * Deriva volumes e status do pedido a partir das OPs vinculadas.
 * volume_produced = soma de OPs Finalizado + OPs Cancelado por CQ Reprovado
 *   (já foram produzidas; rejeição de qualidade não reabre o pedido).
 * volume_in_production = soma das OPs abertas (não Finalizado/Cancelado).
 */
export function deriveOrderFromProductions(order, productions) {
  const orderId = String(order.id);
  const linkedOPs = (productions || []).filter(
    (p) => p.order_id != null && String(p.order_id) === orderId,
  );
  const openOPs = linkedOPs.filter((p) => !['Finalizado', 'Cancelado'].includes(p.status));
  // Conta Finalizado e também Cancelado por CQ Reprovado (produção já ocorreu).
  const producedOPs = linkedOPs.filter(
    (p) =>
      p.status === 'Finalizado' ||
      (p.status === 'Cancelado' && p.qc_status === 'Reprovado'),
  );
  const opProduced = producedOPs.reduce((s, p) => s + toNum(p.volume), 0);
  const volumeInProduction = openOPs.reduce((s, p) => s + toNum(p.volume), 0);
  const volumeOrdered = toNum(order.volume_ordered);

  let totalProduced;
  let volumePending;

  if (linkedOPs.length > 0) {
    // Com OPs visíveis, confiar na soma produzida — evita volume_produced
    // obsoleto no DB após cancelamento forçar Finalizado indevidamente.
    totalProduced = opProduced;
  } else {
    totalProduced = toNum(order.volume_produced);
  }
  // Sempre recalcular a partir do volume pedido — volume_pending no DB pode
  // ficar obsoleto quando volume_ordered é editado sem OPs vinculadas.
  volumePending = Math.max(0, volumeOrdered - totalProduced);

  const fullyProduced = isOrderFullyProduced(volumeOrdered, totalProduced, volumePending);

  // Em produção = somente com OP aberta (em andamento). Volume parcial
  // já produzido sem OP aberta permanece Pendente até nova OP ou Finalizado.
  let status;
  if (fullyProduced) {
    status = 'Finalizado';
  } else if (openOPs.length > 0) {
    status = 'Em produção';
  } else {
    status = 'Pendente';
  }

  return {
    status,
    volume_produced: totalProduced,
    volume_pending: volumePending,
    // Soma das OPs abertas — só UI, não persiste no pedido.
    volume_in_production: volumeInProduction,
  };
}

/** Volume ainda não alocado em OP aberta (pendente menos o que já está em produção). */
export function getOrderAllocatableVolume(order) {
  return Math.max(0, toNum(order?.volume_pending) - toNum(order?.volume_in_production));
}

/**
 * Pedido elegível para programar: ainda tem volume pendente na industrialização
 * (mesmo critério da lista de Pedidos). Não exige saldo após OP aberta —
 * programação é planejamento, não apontamento de produção.
 */
export function isOrderOpenForProgramming(order) {
  if (!order) return false;
  if (isOrderFullyProduced(order.volume_ordered, order.volume_produced, order.volume_pending)) {
    return false;
  }
  if (toNum(order.volume_pending) <= VOLUME_EPS) return false;
  if (order.status === 'Finalizado' || order.status === 'Cancelado') return false;
  return true;
}

export function isOrderEligibleForProgramming(order) {
  return isOrderOpenForProgramming(order);
}

/**
 * Recarrega as OPs do pedido e persiste status/volumes derivados.
 * Usar após cancelar OP ou após salvar CQ (reprovado não cancela a OP).
 */
export async function syncOrderFromProductions(orderId, entities) {
  if (!orderId || !entities?.Order || !entities?.Production) return null;

  const order = await entities.Order.get(orderId);
  if (!order) return null;

  let productions = await entities.Production.filter({ order_id: orderId }, '-created_date', 200);

  // Legado: CQ reprovado não deve deixar OP Cancelado — corrige para Finalizado.
  let healed = false;
  for (const p of productions || []) {
    if (p.status === 'Cancelado' && p.qc_status === 'Reprovado') {
      await entities.Production.update(p.id, { status: 'Finalizado' });
      healed = true;
    }
  }
  if (healed) {
    productions = await entities.Production.filter({ order_id: orderId }, '-created_date', 200);
  }

  const derived = deriveOrderFromProductions(order, productions);

  await entities.Order.update(orderId, {
    status: derived.status,
    volume_produced: derived.volume_produced,
    volume_pending: derived.volume_pending,
  });

  return derived;
}
