import { entities as chemflowEntities } from '@transbordo/services/entities';

const TTL_MS = 90_000;

let cache = { rows: null, expiresAt: 0, promise: null };

/** Lista de saídas ChemFlow compartilhada (evita refetch completo ao abrir cada vasilhame). */
export async function loadChemflowSaidasCached({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.rows && now < cache.expiresAt) {
    return cache.rows;
  }
  if (!force && cache.promise) return cache.promise;

  cache.promise = chemflowEntities.saidas
    .list('-created_date')
    .then((rows) => {
      cache.rows = rows || [];
      cache.expiresAt = Date.now() + TTL_MS;
      return cache.rows;
    })
    .catch((err) => {
      cache.rows = null;
      cache.expiresAt = 0;
      throw err;
    })
    .finally(() => {
      cache.promise = null;
    });

  return cache.promise;
}

export function invalidateChemflowSaidasCache() {
  cache = { rows: null, expiresAt: 0, promise: null };
}
