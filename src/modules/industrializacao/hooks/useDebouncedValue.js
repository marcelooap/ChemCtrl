import { useDebouncedValue as useSharedDebouncedValue } from '@shared/hooks/useDebouncedValue';
import { SEARCH_DEBOUNCE_MS } from '@industrializacao/lib/rateLimitConfig';

/**
 * Compat Ind: default delay = SEARCH_DEBOUNCE_MS do rateLimitConfig.
 */
export function useDebouncedValue(value, delayMs = SEARCH_DEBOUNCE_MS) {
  return useSharedDebouncedValue(value, delayMs);
}
