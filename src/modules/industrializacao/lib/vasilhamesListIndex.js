import { parseArr, effectiveOriginsOfContainer } from '@industrializacao/lib/containerOrigins';
import {
  isComplementPending,
  isContainerFractional,
  productionOfContainer,
  containerDisplayVolume,
} from '@industrializacao/lib/fractionalSupply';
import { createTransferRelationLookup } from '@industrializacao/lib/containerTransferIndex';

export function buildProductionMaps(productions = []) {
  const byId = new Map();
  const byOp = new Map();
  for (const p of productions) {
    if (p?.id) byId.set(p.id, p);
    if (p?.op_number) byOp.set(p.op_number, p);
  }
  const resolve = (container) => {
    if (!container) return null;
    if (container.production_id) return byId.get(container.production_id) || null;
    if (container.op_number) return byOp.get(container.op_number) || null;
    return null;
  };
  return { byId, byOp, resolve };
}

/** Mapa container_id → metadados de linha (1 passagem). */
export function buildContainerRowIndex({
  containers = [],
  productions = [],
  transfers = [],
  containerOrigins = [],
}) {
  const transferLookup = createTransferRelationLookup(transfers);
  const { resolve: productionOf } = buildProductionMaps(productions);
  const meta = new Map();

  for (const c of containers) {
    if (!c?.id) continue;
    const prod = productionOf(c) || productionOfContainer(c, productions);
    const origins = effectiveOriginsOfContainer(containerOrigins, c);
    meta.set(c.id, {
      production: prod,
      transferRel: transferLookup(c),
      extraOriginCount: Math.max(0, origins.length - 1),
      displayVolume: containerDisplayVolume(c, productions),
      showFractionalBadge: isContainerFractional(c, prod, transfers),
    });
  }

  return meta;
}

/** IDs de container fracionados por transbordo (busca por palavra-chave). */
export function buildFractionalTransferContainerIds(transfers = []) {
  const ids = new Set();
  for (const tr of transfers) {
    for (const o of parseArr(tr.origins)) {
      if (!o?.container_id) continue;
      const remaining = parseFloat(o.remaining_stock);
      if (!Number.isNaN(remaining) && remaining > 0.001) {
        ids.add(o.container_id);
        continue;
      }
      if ((parseFloat(o.volume_used) || 0) > 0.001) {
        ids.add(o.container_id);
      }
    }
  }
  return ids;
}

export function containerMatchesFractionalKeyword(
  container,
  production,
  transfers,
  fractionalTransferIds,
) {
  if (!container || container.status !== 'No Pátio') return false;
  if (container.is_fractional) return true;
  if (fractionalTransferIds.has(container.id)) {
    const vol = parseFloat(container.volume) || 0;
    if (vol > 0.001) return true;
  }
  if (!isComplementPending(production)) return false;
  const op = (production?.op_number || '').trim();
  const containerOp = (container?.op_number || '').trim();
  return Boolean(op && containerOp === op);
}
