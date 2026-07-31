/**
 * Converte a quantidade do lote para a unidade operacional do estoque.
 *
 * - Embalado: usa a quantidade informada (sem densidade — costuma ser null).
 * - Granel em L/gal: converte por densidade; se densidade ausente, mantém o valor informado
 *   (evita zerar saldo).
 */
export const loteToKg = (lote) => {
  const lQtd = parseFloat(lote?.quantidade) || 0;
  if (lQtd <= 0) return 0;

  // Embalado: total já vem no campo quantidade (ex.: L ou kg do bloco)
  if (lote?.embalado) {
    return Math.round(lQtd);
  }

  const lDens =
    parseFloat(String(lote?.densidade || "0").replace(",", ".")) || 0;

  switch (lote?.unidade_medida) {
    case "L":
      return lDens > 0 ? Math.round(lQtd * lDens) : Math.round(lQtd);
    case "lb":
      return Math.round(lQtd * 0.453592);
    case "gal":
      return lDens > 0
        ? Math.round(lQtd * 3.78541 * lDens)
        : Math.round(lQtd * 3.78541);
    default:
      return Math.round(lQtd);
  }
};

/**
 * Volume operacional em litros a partir do lote declarado.
 * Para L/gal, preserva o valor informado (não faz round-trip via kg).
 */
export const loteToLitros = (lote) => {
  const lQtd = parseFloat(String(lote?.quantidade ?? "0").replace(",", ".")) || 0;
  if (lQtd <= 0) return 0;

  const lDens =
    parseFloat(String(lote?.densidade || "0").replace(",", ".")) || 0;

  switch (lote?.unidade_medida) {
    case "L":
      return Math.round(lQtd);
    case "gal":
      return Math.round(lQtd * 3.78541);
    case "kg":
      return lDens > 0 ? Math.round(lQtd / lDens) : 0;
    case "lb": {
      const kg = Math.round(lQtd * 0.453592);
      return lDens > 0 ? Math.round(kg / lDens) : 0;
    }
    default:
      return Math.round(lQtd);
  }
};

/**
 * Converte saldo de estoque (kg) → litros operacionais.
 * Se o lote original foi lançado em L/gal, usa o volume declarado (ou
 * proporcional ao saldo) para evitar perda de 1 L no round-trip L→kg→L.
 *
 * @param {number} saldoKg
 * @param {number} densidade
 * @param {object} [estoqueItem] — registro com `quantidade` e `lotes[]`
 */
export const saldoKgToLitros = (saldoKg, densidade, estoqueItem) => {
  const saldo = Number(saldoKg) || 0;
  if (saldo <= 0) return 0;

  const lote = estoqueItem?.lotes?.[0];
  const um = lote?.unidade_medida;
  if (lote && (um === "L" || um === "gal")) {
    const declaredL = loteToLitros(lote);
    const originalKg =
      (Number(estoqueItem?.quantidade) || 0) > 0
        ? Math.round(Number(estoqueItem.quantidade))
        : loteToKg(lote);
    if (declaredL > 0 && originalKg > 0) {
      // Saldo integral → volume declarado exato (ex.: 42.000 L)
      if (Math.abs(saldo - originalKg) < 0.5) return declaredL;
      return Math.round((declaredL * saldo) / originalKg);
    }
  }

  const dens = Number(densidade) || 0;
  return dens > 0 ? Math.round(saldo / dens) : Math.round(saldo);
};

/** Unidade a gravar no estoque a partir do lote. */
export const loteUnidadeEstoque = (lote) => {
  if (lote?.embalado) {
    return lote.unidade_medida || "kg";
  }
  return "kg";
};
