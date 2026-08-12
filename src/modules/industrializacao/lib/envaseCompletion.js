import { syncOrderFromProductions } from '@industrializacao/lib/orderProductionStatus';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isTransferOpNumber = (opNumber) =>
  Boolean(opNumber && String(opNumber).startsWith('TB'));

export const isEnvaseContainerForProduction = (container, production) => {
  if (!production?.id || !container) return false;
  if (isTransferOpNumber(container.op_number)) return false;
  if (!container.production_id) return false;
  return String(container.production_id) === String(production.id);
};

export const isEnvaseOriginForProduction = (origin, production) => {
  if (!production?.id || !origin) return false;
  if (isTransferOpNumber(origin.op_number)) return false;
  if (!origin.production_id) return false;
  return String(origin.production_id) === String(production.id);
};

export const productionHasRegisteredEnvase = (production, containers = [], origins = []) => {
  if (!production) return false;
  if ((containers || []).some((c) => isEnvaseContainerForProduction(c, production))) return true;
  if ((origins || []).some((o) => isEnvaseOriginForProduction(o, production))) return true;
  return false;
};

export async function loadEnvaseEvidence(entities, production) {
  const empty = { containers: [], origins: [] };
  if (!production?.id || !entities?.Container) return empty;

  // Sempre amarra ao id da produção — nunca busque só por op_number
  // (o rótulo OP### pode se repetir em dados legados).
  let containers = await entities.Container.filter(
    { production_id: production.id },
    '-created_date',
    200,
  ).catch(() => []);
  containers = (containers || []).filter((c) => isEnvaseContainerForProduction(c, production));

  let origins = [];
  if (entities.ContainerOrigin) {
    origins = await entities.ContainerOrigin.filter(
      { production_id: production.id },
      '-created_date',
      200,
    ).catch(() => []);
    origins = (origins || []).filter((o) => isEnvaseOriginForProduction(o, production));
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
 * Corrige OPs em Envase que já possuem vasilhame/composição da MESMA produção.
 * Sempre amarra por production_id — op_number pode se repetir entre OPs distintas.
 * Não usa a RPC legada (que filtrava só por op_number e podia finalizar a OP errada).
 */
export async function reconcileStuckEnvaseProductions(entities) {
  if (!entities?.Production || !entities?.Container) return 0;

  try {
    const stuck = await entities.Production.filter({ status: 'Envase' }, '-created_date', 200).catch(() => []);
    let finalized = 0;
    for (const production of stuck || []) {
      const evidence = await loadEnvaseEvidence(entities, production);
      if (!productionHasRegisteredEnvase(production, evidence.containers, evidence.origins)) {
        continue;
      }
      await finalizeProductionAfterEnvase(entities, production, {
        packagingType: evidence.containers[0]?.type || production.packaging_type,
      });
      finalized += 1;
    }
    return finalized;
  } catch (err) {
    console.warn('Falha ao reconciliar OPs envasadas:', err);
    return 0;
  }
}
