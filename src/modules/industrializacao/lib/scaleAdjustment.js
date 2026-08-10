/** Default industrial scale resolution in kg (weighs in 2 kg steps). */
export const DEFAULT_SCALE_RESOLUTION_KG = 2;

/**
 * Rounds a weight to the nearest multiple of the scale resolution.
 * Visual aid only — does not change OP / stock quantities.
 *
 * @param {number} valor Quantity in kg
 * @param {number} [resolucao=2] Scale resolution in kg (e.g. 1, 2, 5, 10)
 * @returns {number|null} Adjusted quantity, or null when input is invalid
 */
export function ajustarParaBalanca(valor, resolucao = DEFAULT_SCALE_RESOLUTION_KG) {
  const qty = Number(valor);
  const step = Number(resolucao);
  if (!Number.isFinite(qty) || !Number.isFinite(step) || step <= 0) return null;
  return Math.round(qty / step) * step;
}

/**
 * Whether the scale-adjusted hint should be shown for the given quantity.
 * Quantities below the scale resolution are left as-is (no badge).
 *
 * @param {number} valor Quantity in kg
 * @param {number} [resolucao=2] Scale resolution in kg
 * @returns {boolean}
 */
export function deveExibirAjusteBalanca(valor, resolucao = DEFAULT_SCALE_RESOLUTION_KG) {
  const qty = Number(valor);
  const step = Number(resolucao);
  if (!Number.isFinite(qty) || !Number.isFinite(step) || step <= 0) return false;
  return qty >= step;
}
