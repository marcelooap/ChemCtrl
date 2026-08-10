export const TIPOS_RECEBIMENTO = [
  { value: "granel", label: "Granel" },
  { value: "embalado", label: "Embalado" },
  { value: "vasilhame", label: "Vasilhame" },
];

/** Resolve tipo de recebimento com fallback para entradas legadas (só `embalado`). */
export function resolveTipoRecebimento(lote) {
  if (
    lote?.tipo_recebimento === "embalado" ||
    lote?.tipo_recebimento === "vasilhame" ||
    lote?.tipo_recebimento === "granel"
  ) {
    return lote.tipo_recebimento;
  }
  return lote?.embalado ? "embalado" : "granel";
}
