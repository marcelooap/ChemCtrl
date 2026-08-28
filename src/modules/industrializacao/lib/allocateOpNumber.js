/**
 * Alocação de número de OP único via sequence no PostgreSQL.
 * Fallback local apenas se a RPC ainda não estiver aplicada.
 */
import { callRPC } from '@industrializacao/api/rpcClient';

const OP_RE = /^OP(\d+)$/i;

export function parseOpNumber(opNumber) {
  const m = String(opNumber || '').match(OP_RE);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

export function formatOpNumber(n) {
  return `OP${String(Math.max(1, n)).padStart(2, '0')}`;
}

export function nextOpNumberFromList(productions = []) {
  const used = new Set();
  let max = 0;
  for (const p of productions) {
    const raw = String(p?.op_number || '').trim().toUpperCase();
    if (!raw || raw.startsWith('TB')) continue;
    used.add(raw);
    const n = parseOpNumber(raw);
    if (n > max) max = n;
  }
  let next = max + 1;
  while (used.has(formatOpNumber(next).toUpperCase()) || used.has(`OP${next}`)) {
    next += 1;
  }
  return formatOpNumber(next);
}

/**
 * Aloca OP via RPC atômica (sequence). Fallback: lista + retry com unique index.
 * @param {{ list: Function, filter?: Function }} ProductionEntity
 */
export async function allocateUniqueOpNumber(ProductionEntity, { pageSize = 1000, attempts = 5 } = {}) {
  try {
    const fromRpc = await callRPC('allocate_op_number', {});
    if (typeof fromRpc === 'string' && fromRpc.trim()) {
      return fromRpc.trim();
    }
    if (fromRpc && typeof fromRpc === 'object' && fromRpc.allocate_op_number) {
      return String(fromRpc.allocate_op_number).trim();
    }
  } catch {
    // RPC ainda não aplicada — fallback abaixo
  }

  if (!ProductionEntity?.list) {
    throw new Error('Production entity indisponível para alocar OP');
  }

  for (let i = 0; i < attempts; i += 1) {
    const rows = await ProductionEntity.list('-created_date', pageSize);
    const candidate = nextOpNumberFromList(rows || []);

    if (ProductionEntity.filter) {
      const clash = await ProductionEntity.filter({ op_number: candidate }, '-created_date', 1).catch(() => []);
      if ((clash || []).length === 0) return candidate;
      continue;
    }
    return candidate;
  }

  throw new Error('Não foi possível alocar um número de OP único. Tente novamente.');
}
