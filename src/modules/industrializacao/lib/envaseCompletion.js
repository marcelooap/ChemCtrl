import { syncOrderFromProductions } from '@industrializacao/lib/orderProductionStatus';
import { callRPC } from '@industrializacao/api/rpcClient';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isTransferOpNumber = (opNumber) =>
  Boolean(opNumber && String(opNumber).startsWith('TB'));

export const isEnvaseContainerForProduction = (container, production) => {
  if (!production || !container) return false;
  const op = production.op_number;
  if (!op || isTransferOpNumber(container.op_number)) return false;
  return container.op_number === op;
};

export const isEnvaseOriginForProduction = (origin, production) => {
  if (!production || !origin) return false;
  const op = production.op_number;
  if (op && origin.op_number === op && !isTransferOpNumber(origin.op_number)) return true;
  if (production.id && origin.production_id && String(origin.production_id) === String(production.id)) {
    return !isTransferOpNumber(origin.op_number);
  }
  return false;
};

export const productionHasRegisteredEnvase = (production, containers = [], origins = []) => {
  if (!production) return false;
  if ((containers || []).some((c) => isEnvaseContainerForProduction(c, production))) return true;
  if ((origins || []).some((o) => isEnvaseOriginForProduction(o, production))) return true;
  return false;
};

export async function loadEnvaseEvidence(entities, production) {
  const empty = { containers: [], origins: [] };
  if (!production || !entities?.Container) return empty;

  let containers = [];
  if (production.op_number) {
    containers = await entities.Container.filter(
      { op_number: production.op_number },
      '-created_date',
      200,
    ).catch(() => []);
  }
  containers = (containers || []).filter((c) => isEnvaseContainerForProduction(c, production));

  let origins = [];
  if (entities.ContainerOrigin) {
    const seen = new Set();
    const merge = (rows) => {
      for (const row of rows || []) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        origins.push(row);
      }
    };
    if (production.op_number) {
      merge(await entities.ContainerOrigin.filter(
        { op_number: production.op_number },
        '-created_date',
        200,
      ).catch(() => []));
    }
    if (production.id) {
      merge(await entities.ContainerOrigin.filter(
        { production_id: production.id },
        '-created_date',
        200,
      ).catch(() => []));
    }
    origins = origins.filter((o) => isEnvaseOriginForProduction(o, production));
  }

  return { containers, origins };
}

async function withRetry(fn, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(400 * (i + 1));
    }
  }
  throw lastError;
}

export async function finalizeProductionAfterEnvase(entities, production, {
  operatorName,
  packagingType,
} = {}) {
  if (!production?.id || !entities?.Production) return null;

  const payload = {
    status: 'Finalizado',
    end_time: new Date().toISOString(),
  };
  if (packagingType) payload.packaging_type = packagingType;
  if (operatorName) payload.operator = operatorName;

  const updated = await withRetry(() => entities.Production.update(production.id, payload));

  if (production.order_id) {
    try {
      await syncOrderFromProductions(production.order_id, entities);
    } catch (err) {
      console.warn('Falha ao sincronizar pedido após envase:', err);
    }
  }

  return updated;
}

/**
 * Corrige OPs em Envase que já possuem vasilhame/composição registrados.
 * No-op se a RPC ainda não existir no banco.
 */
export async function reconcileStuckEnvaseProductions() {
  try {
    const result = await callRPC('reconcile_stuck_envase_productions');
    const count = Number(result?.finalized_count || 0);
    return Number.isFinite(count) ? count : 0;
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (err?.status === 404 || msg.includes('404') || msg.includes('PGRST202') || msg.includes('Could not find the function')) {
      return 0;
    }
    console.warn('Falha ao reconciliar OPs envasadas:', err);
    return 0;
  }
}
