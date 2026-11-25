/**
 * Formatação e arredondamento numérico do ChemFlow (padrão PT-BR).
 *
 * Volumes operacionais: até 3 casas. Inteiros continuam sem decimal (19.849);
 * frações da entrada são preservadas (19.848,5).
 * Massas operacionais: até 3 casas (alinha com a quantidade da entrada),
 * milhar com "." e decimal ",".
 * Densidade / valores com decimal: milhar "." e decimal ",".
 * Fracionamentos inteiros: distributeInteger / distributeByWeights garantem
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

/**
 * Volume operacional em litros: até 3 casas decimais.
 * Inteiros permanecem inteiros; 19.848,5 não vira 19.849.
 */
export function roundVolume(v) {
  const n = parseNumero(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

/** Qtd. de embalagens (permite fração, ex.: 2,126 IBC). */
export function qtdEmbalagensFromVolume(total, volumePorEmbalagem) {
  const t = roundVolume(total);
  const per = roundVolume(volumePorEmbalagem);
  if (!(t > 0) || !(per > 0)) return 0;
  return roundVolume(t / per);
}

/**
 * Massa operacional em kg: até 3 casas (ex.: 16.193,35).
 * Inteiros permanecem inteiros; não trunca a fração da entrada.
 */
export function roundMass(v) {
  return roundQuantidade(v);
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

/** Residual típico de volume×densidade; acima disso não é só arredondamento. */
export const TOLERANCIA_ALINHAMENTO_MASSA_KG = 1;

/**
 * Ajusta `massa` dos itens para somar exatamente `quantidadeKg`.
 * Só age quando a diferença é residual de arredondamento (vol × dens).
 * O último item com massa absorve o residual (preserva as demais linhas).
 */
export function alignDestinosMassaToQuantidade(destinos = [], quantidadeKg) {
  const target = roundMass(quantidadeKg);
  if (!(target > 0) || !Array.isArray(destinos) || destinos.length === 0) {
    return destinos;
  }

  const sum = roundMass(
    destinos.reduce((s, d) => s + (Number(d.massa) || 0), 0)
  );
  if (!(sum > 0)) return destinos;

  const delta = roundMass(sum - target);
  if (Math.abs(delta) > TOLERANCIA_ALINHAMENTO_MASSA_KG + 1e-9) {
    return destinos;
  }
  if (Math.abs(delta) <= 1e-9) return destinos;

  let lastIdx = destinos.length - 1;
  for (let i = destinos.length - 1; i >= 0; i -= 1) {
    if ((Number(destinos[i].massa) || 0) > 0) {
      lastIdx = i;
      break;
    }
  }

  return destinos.map((d, i) => {
    if (i !== lastIdx) return d;
    return { ...d, massa: roundMass((Number(d.massa) || 0) - delta) };
  });
}

/**
 * Preserva massa operacional informada (ex.: peso líquido fora da margem)
 * quando o desvio vs L×densidade é só residual de arredondamento.
 */
export function resolveMassaOperacionalKg({
  volumeL = 0,
  densidade,
  massaInformada = 0,
} = {}) {
  const dens = parseDensidade(densidade);
  const fromVol = dens > 0 ? roundMass(Number(volumeL) * dens) : 0;
  const provided = roundMass(massaInformada);
  if (
    provided > 0 &&
    dens > 0 &&
    Math.abs(fromVol - provided) <= TOLERANCIA_ALINHAMENTO_MASSA_KG + 1e-9
  ) {
    return provided;
  }
  if (dens > 0 && fromVol > 0) return fromVol;
  return provided;
}

/**
 * Peso líquido de entradas granel fora da margem ligadas às origens.
 * Deduplica pela entrada-pai (multi-lote não soma o mesmo ticket N vezes).
 */
export function resolvePesoLiquidoForaMargemDasOrigens(
  origens = [],
  entradas = []
) {
  if (!Array.isArray(origens) || origens.length === 0) return 0;
  if (!Array.isArray(entradas) || entradas.length === 0) return 0;

  const byId = new Map();
  for (const e of entradas) {
    if (e?.id != null && e.id !== "") byId.set(String(e.id), e);
  }

  const seenParent = new Set();
  let total = 0;
  let found = false;

  for (const o of origens) {
    const oid = o?.entrada_id != null ? String(o.entrada_id) : "";
    if (!oid) continue;

    let ent = byId.get(oid) || null;
    if (!ent) {
      ent =
        entradas.find(
          (e) => e?.entrada_id != null && String(e.entrada_id) === oid
        ) || null;
    }
    if (!ent) continue;
    if (String(ent.granel_margem || "").trim().toLowerCase() !== "fora") {
      continue;
    }

    const parentKey = String(ent.entrada_id || ent.id || oid);
    if (seenParent.has(parentKey)) continue;
    seenParent.add(parentKey);

    const pl = Number(ent.granel_peso_liquido);
    if (!(Number.isFinite(pl) && pl > 0)) continue;
    total = roundMass(total + pl);
    found = true;
  }

  return found ? total : 0;
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

/**
 * Volume em litros. Inteiro sem casas (19.849); com fração, até 3 casas
 * sem zeros à direita (19.848,5).
 */
export function formatVolume(v, opts = {}) {
  return formatQuantidade(v, opts);
}

/**
 * Quantidade informada na entrada: até 3 casas decimais.
 * Inteiros continuam sem casas (8.250). Frações preservam o que foi digitado (5.499,298).
 */
export function roundQuantidade(v) {
  const n = parseNumero(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

export function formatQuantidade(v, opts = {}) {
  const empty = opts.empty ?? "0";
  if (v == null || v === "") return empty;
  const n = roundQuantidade(v);
  if (!Number.isFinite(n)) return empty;
  const hasFraction = Math.abs(n - Math.trunc(n)) > 1e-9;
  if (!hasFraction) return formatNum(n, 0, { empty });
  const text = formatNum(n, 3, { empty });
  return text.replace(/,(\d*?)0+$/, (_, digits) => (digits ? `,${digits}` : ""));
}

/** Massa em kg — até 3 casas PT-BR (16.193,35), inteiro sem casas (16.193). */
export function formatMass(v, opts = {}) {
  return formatQuantidade(v, opts);
}

/** Densidade — até 4 casas decimais PT-BR (ex.: 0,7900). */
export function formatDensidade(v, opts = {}) {
  const decimals = opts.decimals ?? 4;
  return formatNum(v, decimals, { empty: opts.empty ?? "-" });
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

function isMassaInteira(kg) {
  const n = Number(kg);
  if (!Number.isFinite(n)) return false;
  return Math.abs(n - Math.round(n)) < 1e-6;
}

/**
 * kg → litros operacionais.
 * Massa inteira (39.040 kg) vira litro inteiro (33.948 L), no mesmo
 * critério do volume pré-preenchido no transbordo. Esse litro só é
 * aceito se a massa correspondente não passar do kg informado.
 * Massa com fração mantém até 3 casas.
 */
export function litrosFromMassaKg(kg, densidade) {
  const massa = Number(kg) || 0;
  if (!(massa > 0)) return 0;
  const dens = parseDensidade(densidade);
  if (!(dens > 0)) return roundQuantidade(massa);

  const litros = massa / dens;
  if (!isMassaInteira(massa)) return roundQuantidade(litros);

  const massaAlvo = Math.round(massa);
  let litrosInt = Math.round(litros);
  if (litrosInt > 0 && roundMass(litrosInt * dens) > massaAlvo) {
    litrosInt -= 1;
  }
  return Math.max(0, litrosInt);
}

/**
 * Inverso operacional de litrosFromMassaKg.
 * Recupera a massa do saldo (ex.: 1.000 kg @ 1,09 → 917 L → 1.000 kg)
 * em vez do residual L×densidade (999,53 kg).
 *
 * @param {number} litros
 * @param {number|string} densidade
 * @param {number} [massaPreferida] — saldo/massa de origem, quando conhecida
 */
export function massaKgFromLitrosOperacionais(
  litros,
  densidade,
  massaPreferida = 0
) {
  const vol = roundVolume(litros);
  const dens = parseDensidade(densidade);
  if (!(vol > 0)) return 0;
  if (!(dens > 0)) return roundMass(vol);

  const preferida = roundMass(massaPreferida);
  if (preferida > 0) {
    const maxL = roundVolume(litrosFromMassaKg(preferida, dens));
    // Tolerância de 0,5 L: residual L×dens pode divergir 1 ml do litro operacional.
    if (maxL > 0 && Math.abs(vol - maxL) <= 0.5) {
      // Saque integral do saldo: preserva a massa informada (IBC 1.000 kg).
      if (isMassaInteira(preferida)) return Math.round(preferida);
      // Preferida já é residual L×dens (ex.: 999,53): recupera inteiro canônico.
      // Só aceita quando Math.round(residual) === massa inteira (999,53→1000),
      // evitando promover parciais (364,06↛365).
      const recoveredFull = findMassaInteiraParaLitros(Math.round(vol), dens);
      if (recoveredFull > 0 && recoveredFull === Math.round(preferida)) {
        return recoveredFull;
      }
      return preferida;
    }
    if (maxL > 0 && vol < maxL - 0.5) {
      // Saque parcial: proporcional ao saldo (partes somam o saldo).
      return roundMass((vol / maxL) * preferida);
    }
  }

  const naive = roundMass(vol * dens);
  if (Math.abs(vol - Math.round(vol)) < 1e-9) {
    const recovered = findMassaInteiraParaLitros(Math.round(vol), dens);
    // Somente o subshoot clássico: L×dens arredonda para a massa inteira de origem.
    // 917 L → 999,53 → 1.000 kg; 334 L → 364,06 permanece (não vira 365).
    if (
      recovered > 0 &&
      recovered === Math.round(naive) &&
      Math.abs(recovered - naive) <= TOLERANCIA_ALINHAMENTO_MASSA_KG + 1e-9
    ) {
      return recovered;
    }
  }
  return naive;
}

/** Massa inteira M tal que litrosFromMassaKg(M, dens) === litrosInt. */
function findMassaInteiraParaLitros(litrosInt, dens) {
  const L = Math.round(Number(litrosInt) || 0);
  if (!(L > 0) || !(dens > 0)) return 0;
  const approx = L * dens;
  const start = Math.max(1, Math.floor(approx) - 1);
  const end = Math.ceil(approx) + 2;
  let best = 0;
  for (let m = start; m <= end; m += 1) {
    if (litrosFromMassaKg(m, dens) !== L) continue;
    if (
      !best ||
      Math.abs(m - approx) < Math.abs(best - approx) ||
      (Math.abs(m - approx) === Math.abs(best - approx) && m > best)
    ) {
      best = m;
    }
  }
  return best;
}

/**
 * Par volume (L) e massa (kg) operacionais, derivando o faltante pela densidade.
 */
export function resolveVolumeMassaOperacional({
  volume = 0,
  massa = 0,
  densidade,
} = {}) {
  let vol = roundVolume(volume);
  let kg = roundMass(massa);
  const dens = parseDensidade(densidade);
  if (dens > 0) {
    if (vol <= 0 && kg > 0) {
      vol = roundVolume(litrosFromMassaKg(kg, dens));
    } else if (kg <= 0 && vol > 0) {
      kg = massaKgFromLitrosOperacionais(vol, dens);
    } else if (vol > 0 && kg > 0) {
      // Recupera residual L×dens (999,53→1.000) quando o par veio corrompido.
      kg = massaKgFromLitrosOperacionais(vol, dens, kg);
    }
  }
  return { volume: vol, massa: kg };
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
    const totalL = litrosFromMassaKg(totalKg, firstDens);
    const weights = lotes.map((l) => Number(l.quantidade_kg) || 0);
    return distributeByWeights(totalL, weights);
  }

  return lotes.map((l) => {
    const dens = parseDensidade(l.densidade) || 0;
    const kg = Number(l.quantidade_kg) || 0;
    return dens > 0 ? litrosFromMassaKg(kg, dens) : roundQuantidade(kg);
  });
}
