// Cache temporário em memória para consultas que mudam pouco (Clientes, Produtos/
// Receitas, Usuários, Configurações...). TTL configurável por entidade em
// rateLimitConfig.ts. Invalidação automática após qualquer escrita na mesma entidade.

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCached(key: string, value: unknown, ttlMs: number): void {
  if (ttlMs <= 0) return;
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Remove todas as entradas cujo key comece com `${prefix}:` (ex.: nome da entidade). */
export function invalidate(prefix: string): void {
  const withColon = `${prefix}:`;
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(withColon)) store.delete(key);
  }
}

/** Limpa todo o cache — usado no logout para não vazar dados entre sessões/usuários. */
export function clearAllCache(): void {
  store.clear();
}

export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (ttlMs > 0) {
    const cached = getCached<T>(key);
    if (cached !== undefined) return cached;
  }
  const value = await fn();
  if (ttlMs > 0) setCached(key, value, ttlMs);
  return value;
}
