/** Incrementa o último segmento numérico (ex.: 1.00.20 → 1.00.21). */
export function incrementAppVersion(version: string): string {
  const trimmed = (version || '').trim();
  if (!trimmed) return '1.0.1';

  const parts = trimmed.split('.');
  const lastIdx = parts.length - 1;
  const lastPart = parts[lastIdx];
  const width = lastPart.length;
  const next = (parseInt(lastPart, 10) || 0) + 1;
  parts[lastIdx] = String(next).padStart(width, '0');
  return parts.join('.');
}

/** Retorna positivo se a > b, negativo se a < b, zero se iguais. */
export function compareAppVersions(a: string, b: string): number {
  const partsA = (a || '0').trim().split('.').map((p) => parseInt(p, 10) || 0);
  const partsB = (b || '0').trim().split('.').map((p) => parseInt(p, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/**
 * Versão a exibir no modal de atualização.
 * Usa apenas a versão publicada em version.json (sobe só com `npm run release`).
 * Nunca inventa +1 em push/build de sistema com a mesma versão.
 */
export function resolveNextVersion(current: string, remote: string | null): string {
  if (remote) return remote;
  return current;
}
