/**
 * Instrumentação leve de performance (DevTools Performance / console).
 * Ativa logs detalhados com `localStorage.setItem('chemctrl:perf', '1')`.
 */

const PERF_FLAG = 'chemctrl:perf';

export function isPerfLoggingEnabled() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PERF_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} [detail]
 */
export function perfMark(name, detail) {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(name, detail ? { detail } : undefined);
    }
  } catch {
    /* ignore */
  }
  if (isPerfLoggingEnabled() && detail) {
    console.info(`[perf] mark ${name}`, detail);
  }
}

/**
 * @param {string} name measure name
 * @param {string} startMark
 * @param {string} [endMark]
 * @returns {number | null} duration ms
 */
export function perfMeasure(name, startMark, endMark) {
  try {
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') {
      return null;
    }
    const end = endMark || `${name}-end`;
    if (!endMark) {
      performance.mark(end);
    }
    const entry = performance.measure(name, startMark, end);
    const duration = entry?.duration ?? null;
    if (isPerfLoggingEnabled()) {
      console.info(
        `[perf] ${name}: ${duration != null ? `${duration.toFixed(1)}ms` : 'n/a'}`
      );
    }
    return duration;
  } catch {
    return null;
  }
}

/**
 * Envolve um carregamento de tela e reporta duração.
 * @template T
 * @param {string} screenId ex.: 'saida', 'vasilhames', 'producoes'
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withScreenLoadPerf(screenId, fn) {
  const start = `screen:${screenId}:load-start`;
  const end = `screen:${screenId}:load-end`;
  const measureName = `screen:${screenId}:load`;
  perfMark(start, { screenId, t: Date.now() });
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    return await fn();
  } finally {
    perfMark(end, { screenId, t: Date.now() });
    const duration = perfMeasure(measureName, start, end);
    const fallback =
      duration == null
        ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
        : duration;
    if (isPerfLoggingEnabled()) {
      console.info(`[perf] ${screenId} load ${Number(fallback).toFixed(1)}ms`);
    }
  }
}
