/**
 * Update condicional com conflito otimista (Onda 2).
 */
import { callRPC } from '@industrializacao/api/rpcClient';

/**
 * @returns {Promise<{ ok: boolean, conflict?: boolean, row?: object, message?: string }>}
 */
export async function optimisticUpdateEstoqueMp({
  id,
  expectedUpdatedAt,
  currentStock,
  lot,
  statusWms,
}) {
  return callRPC('optimistic_update_estoque_mp', {
    p_id: String(id),
    p_expected_updated: expectedUpdatedAt,
    p_current_stock: currentStock ?? null,
    p_lot: lot ?? null,
    p_status_wms: statusWms ?? null,
  });
}

export class OptimisticConflictError extends Error {
  constructor(message = 'Registro alterado por outro usuário') {
    super(message);
    this.name = 'OptimisticConflictError';
    this.conflict = true;
  }
}

export function assertOptimisticOk(result) {
  if (result?.conflict || result?.ok === false) {
    throw new OptimisticConflictError(result?.message || 'Conflito de atualização');
  }
  return result;
}
