/**
 * Formatação e arredondamento numérico do ChemFlow (padrão PT-BR).
 *
 * Volumes e massas operacionais: inteiros (sem casas decimais), milhar com ".".
 * Densidade / valores com decimal: milhar "." e decimal ",".
 * Fracionamentos: distributeInteger / distributeByWeights garantem
 * que a soma das partes = total de entrada (método do maior resto).
 */

/** Converte string PT-BR ou EN para número. */
export function parseNumero(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let s = String(value).trim();
  if (!s || s === "-") return 0;
  // "1.234,56" → 1234.56 | "1,234.56" → 1234.56 | "1234.56" → 1234.56
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseDensidade(d) {
  return parseNumero(d);
}

/** Arredonda para litros/kg inteiros (sem casas decimais). */
export function roundVolume(v) {
  return Math.round(parseNumero(v));
}

/** Alias semântico para massas operacionais. */
export function roundMass(v) {
  return Math.round(parseNumero(v));
}

/**
 * Distribui `total` (inteiro) em `n` partes inteiras com soma === total.
 * Método do maior resto (largest remainder).
 */
export function distributeInteger(total, n) {
  const N = Math.max(0, Math.floor(n));
  if (N <= 0) return [];
  const T = Math.round(total);
  if (N === 1) return [T];
  const base = Math.floor(T / N);
  let resto = T - base * N;
  const parts = Array.from({ length: N }, () => base);
  for (let i = 0; i < resto; i++) parts[i] += 1;
  return parts;
}

/**
 * Distribui `total` proporcionalmente aos pesos, resultado inteiro, soma === total.
 */
export function distributeByWeights(total, weights = []) {
  const T = Math.round(total);
  if (!weights.length) return [];
  const sumW = weights.reduce((a, b) => a + (Number(b) || 0), 0);
  if (sumW <= 0) {
    return distributeInteger(T, weights.length);
  }
  const raw = weights.map((w) => ((Number(w) || 0) / sumW) * T);
  const floored = raw.map((x) => Math.floor(x));
  let left = T - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - floored[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...floored];
  for (let k = 0; k < left; k++) {
    result[order[k].i] += 1;
  }
  return result;
}

/**
 * Formata número no padrão PT-BR.
 * @param {number|string} v
 * @param {number} decimals — casas decimais (0 = inteiro com milhar)
 * @param {{ empty?: string }} [opts]
 */
export function formatNum(v, decimals = 0, opts = {}) {
  const empty = opts.empty ?? "0";
  if (v == null || v === "" || (typeof v === "number" && Number.isNaN(v))) {
    return empty;
  }
  const n = typeof v === "number" ? v : parseNumero(v);
  if (!Number.isFinite(n)) return empty;
  const rounded =
    decimals <= 0 ? Math.round(n) : Math.round(n * 10 ** decimals) / 10 ** decimals;
  return rounded.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals > 0 ? decimals : 0,
    maximumFractionDigits: decimals,
  });
}

/** Volume em litros — sempre inteiro PT-BR (ex.: 16.737). */
export function formatVolume(v, opts = {}) {
  return formatNum(v, 0, { empty: opts.empty ?? "0" });
}

/** Massa em kg — sempre inteiro PT-BR. */
export function formatMass(v, opts = {}) {
  return formatNum(v, 0, { empty: opts.empty ?? "0" });
}

/** Densidade — até 3 casas decimais PT-BR (ex.: 0,858). */
export function formatDensidade(v, opts = {}) {
  return formatNum(v, 3, { empty: opts.empty ?? "-" });
}

/** Percentual PT-BR (ex.: 12,5). */
export function formatPercent(v, decimals = 1, opts = {}) {
  return formatNum(v, decimals, { empty: opts.empty ?? "0" });
}

/** Moeda BRL. */
export function formatCurrency(v) {
  const n = parseNumero(v);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Converte quantidade de estoque (kg) → litros inteiros, preservando
 * o total quando há vários lotes (soma das partes = total).
 *
 * @param {Array<{ quantidade_kg: number, densidade?: number|string }>} lotes
 * @returns {number[]} litros inteiros por lote
 */
export function kgLotesToLitrosInteiros(lotes = []) {
  if (!lotes.length) return [];
  const densidades = lotes.map((l) => parseDensidade(l.densidade) || 0);
  // Se todas as densidades iguais e > 0, converter kg→L e distribuir o total
  const firstDens = densidades[0];
  const sameDens =
    firstDens > 0 && densidades.every((d) => Math.abs(d - firstDens) < 1e-9);

  if (sameDens) {
    const totalKg = lotes.reduce((s, l) => s + (Number(l.quantidade_kg) || 0), 0);
    const totalL = roundVolume(totalKg / firstDens);
    const weights = lotes.map((l) => Number(l.quantidade_kg) || 0);
    return distributeByWeights(totalL, weights);
  }

  // Densidades distintas: arredonda cada um; ajusta o último para não
  // introduzir erro sistemático quando só há 1 densidade efetiva.
  return lotes.map((l) => {
    const dens = parseDensidade(l.densidade) || 0;
    const kg = Number(l.quantidade_kg) || 0;
    return dens > 0 ? roundVolume(kg / dens) : roundVolume(kg);
  });
}
