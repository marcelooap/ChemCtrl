/**
 * Alocação de número de OP único (nunca reutiliza rótulos existentes).
 */

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

/**
 * Calcula o próximo número livre a partir de uma lista de produções.
 * @param {Array<{ op_number?: string }>} productions
 * @returns {string} ex.: "OP123"
 */
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
 * Busca produções e devolve um op_number garantidamente livre.
 * Em corrida rara, tenta de novo até 5 vezes.
 * @param {{ list: Function, filter?: Function }} ProductionEntity
 */
export async function allocateUniqueOpNumber(ProductionEntity, { pageSize = 1000, attempts = 5 } = {}) {
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
