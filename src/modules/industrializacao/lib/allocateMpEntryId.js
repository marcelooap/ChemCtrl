/**
 * Alocação de ID de registro do Estoque de MP (entry_id) via sequence.
 */
import { callRPC } from '@industrializacao/api/rpcClient';

const MP_RE = /^MP(\d+)$/i;

export function parseMpEntryNumber(entryId) {
  const m = String(entryId || '').match(MP_RE);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

export function formatMpEntryId(n) {
  return `MP${String(Math.max(1, n)).padStart(3, '0')}`;
}

export function nextMpEntryIdFromList(stocks = []) {
  const used = new Set();
  let max = 0;
  for (const row of stocks) {
    const raw = String(row?.entry_id || '').trim().toUpperCase();
    if (!raw) continue;
    used.add(raw);
    const n = parseMpEntryNumber(raw);
    if (n > max) max = n;
  }
  let next = max + 1;
  while (used.has(formatMpEntryId(next).toUpperCase())) {
    next += 1;
  }
  return formatMpEntryId(next);
}

export function compareMpEntryIdDesc(a, b) {
  const na = parseMpEntryNumber(a?.entry_id);
  const nb = parseMpEntryNumber(b?.entry_id);
  if (na !== nb) return nb - na;
  const da = new Date(a?.created_date || 0).getTime();
  const db = new Date(b?.created_date || 0).getTime();
  return db - da;
}

export function allocateMpEntryIdsFromList(stocks = [], count = 1) {
  const qty = Math.max(1, Number(count) || 1);
  const first = nextMpEntryIdFromList(stocks);
  const start = parseMpEntryNumber(first);
  return Array.from({ length: qty }, (_, i) => formatMpEntryId(start + i));
}

/**
 * Aloca N entry_ids via RPC (sequence). Fallback local se RPC indisponível.
 */
export async function allocateMpEntryIds(
  RawMaterialStockEntity,
  count = 1,
  { pageSize = 2000 } = {}
) {
  const qty = Math.max(1, Number(count) || 1);

  try {
    const fromRpc = await callRPC('allocate_mp_entry_id', { p_count: qty });
    if (Array.isArray(fromRpc) && fromRpc.length > 0) {
      return fromRpc.map(String);
    }
  } catch {
    // fallback
  }

  if (!RawMaterialStockEntity?.list) {
    throw new Error('RawMaterialStock indisponível para alocar ID');
  }
  const rows = await RawMaterialStockEntity.list('-created_date', pageSize);
  return allocateMpEntryIdsFromList(rows || [], qty);
}
