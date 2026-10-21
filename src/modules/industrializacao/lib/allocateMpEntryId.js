/**
 * Alocação do identificador de recebimento.
 * Com estoque unificado, um recebimento inteiro compartilha um E1, E2, E3…
 * gerado no banco.
 */
import { callRPC } from '@industrializacao/api/rpcClient';
const MP_RE = /^MP(\d+)$/i;
const ENTRADA_RE = /^E(\d+)$/i;

export function parseMpEntryNumber(entryId) {
  const entrada = String(entryId || '').trim().match(ENTRADA_RE);
  if (entrada) {
    const n = parseInt(entrada[1], 10);
    return Number.isFinite(n) ? n : 0;
  }
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
 * Aloca N entry_ids ainda não usados em estoque_mp.
 *
 * A sequence `ind_mp_entry_id_seq` fica atrás quando o estoque grava MP###
 * pelo maior código já carregado. Usar o nextval nesse caso repete um
 * entry_id e estoura uq_estoque_mp_entry_id.
 */
async function estoqueUnificado() {
  return true;
}

export async function allocateSharedEntradaId() {
  const code = await callRPC('next_entrada_id');
  const id = String(code || '').trim().toUpperCase();
  if (!/^E[1-9]\d*$/.test(id)) {
    throw new Error('Não foi possível gerar o id_entrada.');
  }
  return id;
}

export async function allocateMpEntryIds(
  RawMaterialStockEntity,
  count = 1,
  { pageSize = 5000, offset = 0 } = {}
) {
  const qty = Math.max(1, Number(count) || 1);
  const skip = Math.max(0, Number(offset) || 0);
  if (await estoqueUnificado()) {
    const shared = await allocateSharedEntradaId();
    return Array.from({ length: qty }, () => shared);
  }
  if (!RawMaterialStockEntity?.list) {
    throw new Error('RawMaterialStock indisponível para alocar ID');
  }
  const rows = await RawMaterialStockEntity.list('-created_date', pageSize);
  const ids = allocateMpEntryIdsFromList(rows || [], qty + skip);
  return ids.slice(skip);
}
