import { queryClientInstance } from '@/lib/query-client';
import { entities } from '@transbordo/services/entities';

const CACHE_TTL_MS = 45_000;

/** @type {{ data: TransbordoWorkspaceData | null, expiresAt: number, promise: Promise<any> | null }} */
const cache = {
  data: null,
  expiresAt: 0,
  promise: null,
};

/**
 * @typedef {Object} TransbordoWorkspaceData
 * @property {Array} transbordos
 * @property {Array} estoque
 * @property {Array} saidas
 * @property {Array} vasilhames
 */

/**
 * Carrega listas centrais do Transbordo reutilizando vasilhames entre estoque e pátio.
 * Cache curto evita refetch ao navegar entre telas do módulo.
 */
export async function loadTransbordoWorkspaceLists({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.data && now < cache.expiresAt) {
    return cache.data;
  }
  if (!force && cache.promise) {
    return cache.promise;
  }

  cache.promise = (async () => {
    const [vasilhames, transbordos, saidas] = await Promise.all([
      entities.vasilhames.list('-created_date'),
      entities.transbordos.list(),
      entities.saidas.list(),
    ]);
    const tanksById = new Map(
      (vasilhames || []).filter((v) => v?.id).map((v) => [v.id, v])
    );
    const estoque = await entities.estoque.list(null, {
      tanksById,
      skipTankHydration: !tanksById.size,
    });

    /** @type {TransbordoWorkspaceData} */
    const data = {
      transbordos: transbordos || [],
      estoque: estoque || [],
      saidas: saidas || [],
      vasilhames,
    };
    cache.data = data;
    cache.expiresAt = Date.now() + CACHE_TTL_MS;
    return data;
  })()
    .catch((err) => {
      cache.data = null;
      cache.expiresAt = 0;
      throw err;
    })
    .finally(() => {
      cache.promise = null;
    });

  return cache.promise;
}

/** Invalida cache após gravações (create/update/delete). */
export function invalidateTransbordoWorkspaceCache() {
  cache.data = null;
  cache.expiresAt = 0;
  cache.promise = null;
  queryClientInstance.invalidateQueries({
    queryKey: TRANSBORDO_WORKSPACE_QUERY_KEY,
  });
}

export const TRANSBORDO_WORKSPACE_QUERY_KEY = ['transbordo', 'workspace'];
