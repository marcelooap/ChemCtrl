import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/**
 * Normaliza texto para busca: minúsculas e sem espaços.
 * Ex.: "OEGU 921086-0" e "OEGU921086-0" passam a ser equivalentes.
 */
export function normalizeSearchKey(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '');
}

/** Retorna true se `haystack` contém `query`, ignorando maiúsculas e espaços. */
export function matchesSearchText(haystack, query) {
  const q = normalizeSearchKey(query);
  if (!q) return true;
  return normalizeSearchKey(haystack).includes(q);
}

export const isIframe = window.self !== window.top;
