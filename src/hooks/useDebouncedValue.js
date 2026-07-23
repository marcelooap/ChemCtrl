import { useEffect, useState } from 'react';
import { SEARCH_DEBOUNCE_MS } from '@/lib/rateLimitConfig';

/**
 * Retorna uma versão "atrasada" de `value`, atualizada somente depois de
 * `delayMs` sem novas mudanças. O input que exibe `value` continua 100%
 * responsivo — apenas o valor usado para filtrar/consultar é debounced.
 */
export function useDebouncedValue(value, delayMs = SEARCH_DEBOUNCE_MS) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
