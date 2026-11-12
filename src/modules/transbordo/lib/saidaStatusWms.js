import { estoqueIdsFromSaidaItem } from "@painel/lib/saidaEmbaladoLotes";
import {
  resolveEstoqueIdsFromSaidaConvencional,
} from "@transbordo/lib/estoqueSaldo";
import {
  TIPO_CONVENCIONAL,
  TIPO_EMBALADO,
} from "@transbordo/lib/saidaOrigem";

const WMS_ALERT_TITLE =
  "Status WMS pendente (NOK) — produto ainda não lançado; emissão de NF bloqueada";

/** Evento disparado ao alterar Status WMS no Estoque (para a Saída atualizar o alerta). */
export const ESTOQUE_STATUS_WMS_EVENT = "chemctrl:estoque-status-wms";

function sameId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/** Aplica patch de status_wms em uma lista de estoque (imutável). */
export function applyEstoqueStatusWmsPatch(estoque, id, statusWms) {
  if (!Array.isArray(estoque) || id == null) return estoque;
  let changed = false;
  const next = estoque.map((row) => {
    if (!sameId(row?.id, id)) return row;
    if (!!row.status_wms === !!statusWms) return row;
    changed = true;
    return { ...row, status_wms: !!statusWms };
  });
  return changed ? next : estoque;
}

function isTipoEmbaladoOuVasilhame(item) {
  const tipo = item?.tipo;
  return (
    tipo === TIPO_EMBALADO ||
    tipo === "embalado" ||
    tipo === TIPO_CONVENCIONAL ||
    tipo === "convencional"
  );
}

/**
 * Ids de estoque (entrada no estoque em transbordo) ligados a um item de saída
 * embalado ou vasilhame (convencional).
 */
export function resolveEstoqueIdsForSaidaItemWms(
  item,
  { vasilhames = [], transbordos = [], estoque = [] } = {}
) {
  if (!isTipoEmbaladoOuVasilhame(item)) return [];

  if (item.tipo === TIPO_EMBALADO || item.tipo === "embalado") {
    return estoqueIdsFromSaidaItem(item);
  }

  return resolveEstoqueIdsFromSaidaConvencional(
    [item],
    vasilhames,
    transbordos,
    estoque
  );
}

/**
 * True quando algum estoque de origem do item está com Status WMS = NOK.
 * Sem vínculo resolvido, não sinaliza (evita falso positivo).
 */
export function isSaidaItemWmsNok(
  item,
  { vasilhames = [], transbordos = [], estoque = [] } = {}
) {
  const ids = resolveEstoqueIdsForSaidaItemWms(item, {
    vasilhames,
    transbordos,
    estoque,
  });
  if (ids.length === 0) return false;

  return ids.some((id) => {
    const row = (estoque || []).find((e) => sameId(e?.id, id));
    if (!row) return false;
    return !row.status_wms;
  });
}

/** True se a saída tem ao menos um item embalado/vasilhame com WMS NOK. */
export function saidaTemItemWmsNok(
  saida,
  { vasilhames = [], transbordos = [], estoque = [] } = {}
) {
  return (saida?.itens || []).some((item) =>
    isSaidaItemWmsNok(item, { vasilhames, transbordos, estoque })
  );
}

export { WMS_ALERT_TITLE };
