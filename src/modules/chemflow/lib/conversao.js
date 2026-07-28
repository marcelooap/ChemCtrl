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

/** Unidade a gravar no estoque a partir do lote. */
export const loteUnidadeEstoque = (lote) => {
  if (lote?.embalado) {
    return lote.unidade_medida || "kg";
  }
  return "kg";
};
