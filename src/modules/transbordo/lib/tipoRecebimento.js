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

/** Tipo de recebimento a partir do registro de estoque (coluna ou lote embutido). */
export function resolveTipoRecebimentoEstoque(estoqueItem) {
  return resolveTipoRecebimento({
    embalado: estoqueItem?.embalado || estoqueItem?.lotes?.[0]?.embalado,
    tipo_recebimento:
      estoqueItem?.tipo_recebimento ||
      estoqueItem?.lotes?.[0]?.tipo_recebimento,
  });
}

export function getTipoRecebimentoLabel(tipo) {
  switch (tipo) {
    case "embalado":
      return "Embalado";
    case "vasilhame":
      return "Vasilhame";
    case "granel":
    default:
      return "Granel";
  }
}

/** Classes do badge na listagem/detalhe de estoque. */
export function getTipoRecebimentoBadgeClass(tipo) {
  switch (tipo) {
    case "embalado":
      return "bg-orange-200 text-orange-800";
    case "vasilhame":
      return "bg-purple-100 text-purple-800";
    case "granel":
    default:
      return "bg-sky-100 text-sky-800";
  }
}
