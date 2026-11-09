/**
 * Helpers atômicos de estoque MP via RPC (Onda 1).
 * Preferir sempre estes em vez de read-modify-write no cliente.
 *
 * Após cada ajuste, invalida o cache e emite entityEvents para que
 * useRealtimeEntity (Nova Produção, Estoque, etc.) reflita o saldo
 * imediatamente — RPCs não passam pelo client CRUD que já emite esses eventos.
 */
import { callRPC } from '@industrializacao/api/rpcClient';
import { invalidate } from '@industrializacao/lib/queryCache';
import { emitEntityChange } from '@industrializacao/lib/entityEvents';

const STOCK_ENTITY = 'RawMaterialStock';

/**
 * Propaga o saldo pós-RPC para a UI local (mesmo dispositivo).
 * @param {object|null} result retorno de adjust/deduct/restore
 */
function notifyStockAdjusted(result) {
  if (!result?.id) return;
  const balanceAfter = Number(result.balance_after);
  if (!Number.isFinite(balanceAfter)) return;

  invalidate(STOCK_ENTITY);
  emitEntityChange(STOCK_ENTITY, {
    eventType: 'UPDATE',
    new: {
      id: String(result.id),
      current_stock: balanceAfter,
      ...(result.entry_id != null ? { entry_id: result.entry_id } : {}),
    },
    old: null,
  });
}

/**
 * @param {Array<object>|object|null} results
 */
function notifyStockAdjustedMany(results) {
  const list = Array.isArray(results) ? results : results ? [results] : [];
  if (list.length === 0) return;
  // Uma invalidação; vários UPDATEs locais (evita N× REFRESH/refetch).
  invalidate(STOCK_ENTITY);
  for (const result of list) {
    if (!result?.id) continue;
    const balanceAfter = Number(result.balance_after);
    if (!Number.isFinite(balanceAfter)) continue;
    emitEntityChange(STOCK_ENTITY, {
      eventType: 'UPDATE',
      new: {
        id: String(result.id),
        current_stock: balanceAfter,
        ...(result.entry_id != null ? { entry_id: result.entry_id } : {}),
      },
      old: null,
    });
  }
}

/**
 * @param {string} stockId
 * @param {number} qty quantidade positiva a debitar
 * @returns {Promise<{ id: string, balance_before: number, balance_after: number, delta: number }>}
 */
export async function deductStock(stockId, qty) {
  const n = Number(qty);
  if (!stockId || !(n > 0)) {
    throw new Error('deductStock: stockId e qty positivos são obrigatórios');
  }
  const result = await callRPC('deduct_raw_material_stock', {
    p_stock_id: String(stockId),
    p_qty: n,
  });
  notifyStockAdjusted(result);
  return result;
}

/**
 * @param {string} stockId
 * @param {number} qty quantidade positiva a restaurar
 */
export async function restoreStock(stockId, qty) {
  const n = Number(qty);
  if (!stockId || !(n > 0)) {
    throw new Error('restoreStock: stockId e qty positivos são obrigatórios');
  }
  const result = await callRPC('restore_raw_material_stock', {
    p_stock_id: String(stockId),
    p_qty: n,
  });
  notifyStockAdjusted(result);
  return result;
}

/**
 * @param {Array<{ stock_id: string, qty: number }>} items
 */
export async function deductStockBatch(items = []) {
  const payload = (items || [])
    .filter((i) => i?.stock_id && Number(i.qty) > 0)
    .map((i) => ({ stock_id: String(i.stock_id), qty: Number(i.qty) }));
  if (payload.length === 0) return [];
  const results = await callRPC('deduct_raw_material_stock_batch', { p_items: payload });
  notifyStockAdjustedMany(results);
  return results;
}
