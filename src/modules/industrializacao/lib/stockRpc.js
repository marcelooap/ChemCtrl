/**
 * Helpers atômicos de estoque MP via RPC (Onda 1).
 * Preferir sempre estes em vez de read-modify-write no cliente.
 */
import { callRPC } from '@industrializacao/api/rpcClient';

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
  return callRPC('deduct_raw_material_stock', {
    p_stock_id: String(stockId),
    p_qty: n,
  });
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
  return callRPC('restore_raw_material_stock', {
    p_stock_id: String(stockId),
    p_qty: n,
  });
}

/**
 * @param {Array<{ stock_id: string, qty: number }>} items
 */
export async function deductStockBatch(items = []) {
  const payload = (items || [])
    .filter((i) => i?.stock_id && Number(i.qty) > 0)
    .map((i) => ({ stock_id: String(i.stock_id), qty: Number(i.qty) }));
  if (payload.length === 0) return [];
  return callRPC('deduct_raw_material_stock_batch', { p_items: payload });
}
