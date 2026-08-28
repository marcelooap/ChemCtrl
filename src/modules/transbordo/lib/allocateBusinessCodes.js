/**
 * Alocação atômica de códigos de negócio do Transbordo via RPC/sequence.
 */
import { callRPC } from '@industrializacao/api/rpcClient';

async function callAllocate(fn, params = {}) {
  const result = await callRPC(fn, params);
  if (typeof result === 'string' && result.trim()) return result.trim();
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') {
    const first = Object.values(result)[0];
    if (typeof first === 'string') return first.trim();
    if (Array.isArray(first)) return first;
  }
  return result;
}

export async function allocateTransbordoCodigo(fallbackList = []) {
  try {
    const code = await callAllocate('allocate_transbordo_codigo');
    if (typeof code === 'string' && code) return code;
  } catch {
    // fallback
  }
  const existing = (fallbackList || [])
    .map((t) => t.codigo_transbordo)
    .filter(Boolean)
    .map((c) => parseInt(String(c).replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const max = existing.length > 0 ? Math.max(...existing) : 0;
  return `T${String(max + 1).padStart(3, '0')}`;
}

export async function allocateEntradaCodigo(fallbackCount = 0) {
  try {
    const code = await callAllocate('allocate_entrada_codigo');
    if (typeof code === 'string' && code) return code;
  } catch {
    // fallback
  }
  return `E${String((Number(fallbackCount) || 0) + 1).padStart(3, '0')}`;
}

export async function allocateSaidaCodigo(fallbackList = []) {
  try {
    const code = await callAllocate('allocate_saida_codigo');
    if (typeof code === 'string' && code) return code;
  } catch {
    // fallback
  }
  const existing = (fallbackList || [])
    .map((s) => s.codigo || s.codigo_saida)
    .filter(Boolean)
    .map((c) => parseInt(String(c).replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const max = existing.length > 0 ? Math.max(...existing) : 0;
  return `S${String(max + 1).padStart(3, '0')}`;
}

export async function allocateFiltroCodigos(quantidade, fallbackExistentes = []) {
  const qtd = Math.max(0, Math.round(Number(quantidade) || 0));
  if (qtd === 0) return [];
  try {
    const codes = await callAllocate('allocate_filtro_codigos', { p_count: qtd });
    if (Array.isArray(codes) && codes.length > 0) return codes.map(String);
  } catch {
    // fallback
  }
  const nums = (fallbackExistentes || [])
    .map((e) => e.codigo)
    .filter(Boolean)
    .map((c) => parseInt(String(c).replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  let max = nums.length > 0 ? Math.max(...nums) : 0;
  const codigos = [];
  for (let i = 0; i < qtd; i++) {
    max += 1;
    codigos.push(`F${String(max).padStart(3, '0')}`);
  }
  return codigos;
}

export async function allocateTbNumber(fallbackCount = 0) {
  try {
    const code = await callAllocate('allocate_tb_number');
    if (typeof code === 'string' && code) return code;
  } catch {
    // fallback
  }
  return `TB${String((Number(fallbackCount) || 0) + 1).padStart(2, '0')}`;
}
