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

const OP_NUMBER_CONFLICT =
  /23505|duplicate key value|uq_ind_lista_producoes_op_number/i;

/** Identifica violação do índice único de op_number vinda do PostgREST. */
export function isOpNumberConflict(error) {
  return OP_NUMBER_CONFLICT.test(String(error?.message || ''));
}

function normalizeRpcOpNumber(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && value.allocate_op_number) {
    return String(value.allocate_op_number).trim();
  }
  return '';
}

async function isOpNumberTaken(ProductionEntity, candidate) {
  if (!ProductionEntity?.filter) return false;
  const rows = await ProductionEntity.filter({ op_number: candidate }, '-created_date', 1)
    .catch(() => []);
  return (rows || []).length > 0;
}

/**
 * Aloca OP via RPC atômica (sequence). Fallback: lista + retry com unique index.
 *
 * A sequence do banco pode ficar atrás dos dados (import/restore), fazendo a
 * RPC devolver um número já usado. Por isso o candidato é conferido antes de
 * ser devolvido, em vez de confiar cegamente na sequence.
 *
 * @param {{ list: Function, filter?: Function }} ProductionEntity
 */
export async function allocateUniqueOpNumber(
  ProductionEntity,
  { pageSize = 1000, attempts = 5, rpcAttempts = 25 } = {}
) {
  for (let i = 0; i < rpcAttempts; i += 1) {
    let candidate = '';
    try {
      candidate = normalizeRpcOpNumber(await callRPC('allocate_op_number', {}));
    } catch {
      break; // RPC ainda não aplicada — fallback abaixo
    }
    if (!candidate) break;
    if (!(await isOpNumberTaken(ProductionEntity, candidate))) return candidate;
  }

  if (!ProductionEntity?.list) {
    throw new Error('Production entity indisponível para alocar OP');
  }

  for (let i = 0; i < attempts; i += 1) {
    const rows = await ProductionEntity.list('-created_date', pageSize);
    const candidate = nextOpNumberFromList(rows || []);

    if (!ProductionEntity.filter) return candidate;
    if (!(await isOpNumberTaken(ProductionEntity, candidate))) return candidate;
  }

  throw new Error('Não foi possível alocar um número de OP único. Tente novamente.');
}

/**
 * Cria a produção realocando o número da OP caso outro usuário tenha gravado
 * o mesmo número entre a alocação e o insert (corrida real, não erro de dados).
 *
 * @param {{ list: Function, filter?: Function, create: Function }} ProductionEntity
 * @param {(opNumber: string) => object} buildData monta o payload a partir da OP
 * @returns {Promise<{ record: object, opNumber: string }>}
 */
export async function createProductionWithUniqueOp(
  ProductionEntity,
  buildData,
  { attempts = 3, pageSize = 1000 } = {}
) {
  let lastError;

  for (let i = 0; i < attempts; i += 1) {
    const opNumber = await allocateUniqueOpNumber(ProductionEntity, { pageSize });
    try {
      const record = await ProductionEntity.create(buildData(opNumber));
      return { record, opNumber };
    } catch (err) {
      if (!isOpNumberConflict(err)) throw err;
      lastError = err;
    }
  }

  throw lastError;
}
