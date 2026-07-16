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

/**
 * Deriva volumes e status do pedido a partir das OPs vinculadas.
 * volume_produced = soma apenas de OPs Finalizado (Cancelado e em andamento não contam).
 */
export function deriveOrderFromProductions(order, productions) {
  const orderId = String(order.id);
  const linkedOPs = (productions || []).filter(
    (p) => p.order_id != null && String(p.order_id) === orderId,
  );
  const openOPs = linkedOPs.filter((p) => !['Finalizado', 'Cancelado'].includes(p.status));
  const finishedOPs = linkedOPs.filter((p) => p.status === 'Finalizado');
  const opProduced = finishedOPs.reduce((s, p) => s + toNum(p.volume), 0);
  const volumeOrdered = toNum(order.volume_ordered);

  let totalProduced;
  let volumePending;

  if (linkedOPs.length > 0) {
    // Com OPs visíveis, confiar na soma de Finalizado — evita volume_produced
    // obsoleto no DB após cancelamento forçar Finalizado indevidamente.
    totalProduced = opProduced;
    volumePending = Math.max(0, volumeOrdered - totalProduced);
  } else {
    totalProduced = toNum(order.volume_produced);
    const dbPending = order.volume_pending == null || order.volume_pending === ''
      ? null
      : toNum(order.volume_pending);
    volumePending = dbPending != null
      ? Math.max(0, dbPending)
      : Math.max(0, volumeOrdered - totalProduced);
  }

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
  };
}

/**
 * Recarrega as OPs do pedido e persiste status/volumes derivados.
 * Usar após cancelar OP (ou rejeição CQ) para manter o pedido consistente.
 */
export async function syncOrderFromProductions(orderId, entities) {
  if (!orderId || !entities?.Order || !entities?.Production) return null;

  const order = await entities.Order.get(orderId);
  if (!order) return null;

  const productions = await entities.Production.filter({ order_id: orderId }, '-created_date', 200);
  const derived = deriveOrderFromProductions(order, productions);

  await entities.Order.update(orderId, {
    status: derived.status,
    volume_produced: derived.volume_produced,
    volume_pending: derived.volume_pending,
  });

  return derived;
}
