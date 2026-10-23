import { queryClientInstance } from '@/lib/query-client';
import { entities } from '@transbordo/services/entities';
import { hydrateEstoqueTankFields } from '@transbordo/services/estoqueProdutos';

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

async function fetchWorkspace() {
  // As 4 listas em paralelo: o estoque é hidratado com os vasilhames em memória
  // (antes esperava a lista de vasilhames terminar para só então ser buscado).
  const [vasilhames, transbordos, saidas, estoqueRaw] = await Promise.all([
    entities.vasilhames.list('-created_date'),
    entities.transbordos.list(),
    entities.saidas.list(),
    entities.estoque.list(null, { skipTankHydration: true }),
  ]);
  const tanksById = new Map(
    (vasilhames || []).filter((v) => v?.id).map((v) => [v.id, v])
  );
  const estoque = hydrateEstoqueTankFields(estoqueRaw || [], tanksById);

  /** @type {TransbordoWorkspaceData} */
  return {
    transbordos: transbordos || [],
    estoque,
    saidas: saidas || [],
    vasilhames: vasilhames || [],
  };
}

/**
 * Carrega listas centrais do Transbordo reutilizando vasilhames entre estoque e pátio.
 * Cache curto evita refetch ao navegar entre telas do módulo.
 */
export async function loadTransbordoWorkspaceLists({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.data && now < cache.expiresAt) {
    return cache.data;
  }
  if (cache.promise) {
    // Já existe uma busca em andamento (mesmo com `force`): reaproveita em vez
    // de disparar uma segunda rodada idêntica de queries.
    return cache.promise;
  }

  const request = fetchWorkspace()
    .then((data) => {
      cache.data = data;
      cache.expiresAt = Date.now() + CACHE_TTL_MS;
      return data;
    })
    .catch((err) => {
      cache.data = null;
      cache.expiresAt = 0;
      throw err;
    })
    .finally(() => {
      // Só limpa se ainda for a busca corrente (uma invalidação pode ter
      // iniciado outra enquanto esta terminava).
      if (cache.promise === request) cache.promise = null;
    });

  cache.promise = request;
  return request;
}

/**
 * Último snapshot conhecido (mesmo que expirado), sem disparar rede.
 * Permite pintar a tela imediatamente e revalidar em segundo plano.
 * @returns {TransbordoWorkspaceData | null}
 */
export function peekTransbordoWorkspaceLists() {
  return cache.data;
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
