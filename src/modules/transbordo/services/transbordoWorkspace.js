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

/**
 * Atualiza um registro de estoque no snapshot em memória (ex.: Status WMS).
 * Evita que a tela de Saída continue alertando NOK após marcar OK no Estoque,
 * enquanto o TTL do cache ainda estiver válido.
 */
export function patchTransbordoWorkspaceEstoque(id, patch) {
  if (id == null || !patch || typeof patch !== "object") {
    queryClientInstance.invalidateQueries({
      queryKey: TRANSBORDO_WORKSPACE_QUERY_KEY,
    });
    return;
  }
  if (cache.data?.estoque) {
    const idStr = String(id);
    cache.data = {
      ...cache.data,
      estoque: cache.data.estoque.map((row) =>
        String(row?.id) === idStr ? { ...row, ...patch } : row
      ),
    };
  }
  queryClientInstance.invalidateQueries({
    queryKey: TRANSBORDO_WORKSPACE_QUERY_KEY,
  });
}

/**
 * Atualiza/insere uma saída no snapshot do workspace (ex.: Pedido Cliente).
 * Evita listagem stale por até o TTL de 45s após salvar no formulário.
 */
export function patchTransbordoWorkspaceSaida(saida) {
  if (!saida?.id) {
    queryClientInstance.invalidateQueries({
      queryKey: TRANSBORDO_WORKSPACE_QUERY_KEY,
    });
    return;
  }
  const idStr = String(saida.id);
  if (cache.data?.saidas) {
    const idx = cache.data.saidas.findIndex((row) => String(row?.id) === idStr);
    const nextSaidas = [...cache.data.saidas];
    if (idx === -1) {
      nextSaidas.unshift(saida);
    } else {
      nextSaidas[idx] = { ...nextSaidas[idx], ...saida };
    }
    cache.data = {
      ...cache.data,
      saidas: nextSaidas,
    };
    // Renova TTL para a listagem reaproveitar o patch ao remontar.
    cache.expiresAt = Date.now() + CACHE_TTL_MS;
  }
  queryClientInstance.invalidateQueries({
    queryKey: TRANSBORDO_WORKSPACE_QUERY_KEY,
  });
}

export const TRANSBORDO_WORKSPACE_QUERY_KEY = ['transbordo', 'workspace'];
