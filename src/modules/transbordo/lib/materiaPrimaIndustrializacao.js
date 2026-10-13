const IND_MP_GRUPO_PREFIX = "INDMP:";

export function entradaByIdMap(entradas) {
  const map = new Map();
  for (const entrada of entradas || []) {
    if (entrada?.id != null) map.set(String(entrada.id), entrada);
  }
  return map;
}

/**
 * Espelho de ind_estoque_mp em t_estoque.
 * Pertence ao módulo Industrialização e não deve aparecer nas telas de estoque do Transbordo.
 */
export function isMateriaPrimaIndustrializacao(item, entrada) {
  if (item?.origem === "industrializacao" || entrada?.origem === "industrializacao") {
    return true;
  }
  if (
    String(item?.grupo_entrada || "").startsWith(IND_MP_GRUPO_PREFIX) ||
    String(entrada?.grupo_entrada || "").startsWith(IND_MP_GRUPO_PREFIX)
  ) {
    return true;
  }
  const lotes = [
    ...(Array.isArray(item?.lotes) ? item.lotes : []),
    ...(Array.isArray(entrada?.lotes) ? entrada.lotes : []),
  ];
  return lotes.some((lote) => lote?.ind_mp_id);
}
