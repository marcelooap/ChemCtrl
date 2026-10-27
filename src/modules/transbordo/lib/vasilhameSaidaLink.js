import { entities } from "@transbordo/services/entities";
import { sameTanqueIdentity } from "@transbordo/lib/vasilhameComposicao";

const TIPO_CONVENCIONAL = "convencional";

function isItemConvencional(item) {
  return item?.tipo === TIPO_CONVENCIONAL;
}

/**
 * Vasilhame que a linha da saída deve movimentar.
 * O id gravado na saída deixa de existir quando o transbordo é regravado
 * (os tanques são recriados). Nesse caso a placa/barril localiza o registro atual.
 */
export function resolveVasilhameDaSaida(
  item,
  vasilhames = [],
  { preferPatio = true } = {}
) {
  if (!isItemConvencional(item)) return null;
  const list = vasilhames || [];
  const id = String(item?.vasilhame_id || "").trim();
  if (id) {
    const byId = list.find((row) => String(row?.id) === id);
    if (byId) return byId;
  }

  const placa = item?.vasilhame_placa;
  const barril = item?.vasilhame_barril;
  if (!String(placa || "").trim() && !String(barril || "").trim()) return null;

  const matches = list.filter((row) =>
    sameTanqueIdentity(row?.placa, row?.barril, placa, barril)
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const wanted = preferPatio ? "No Pátio" : "Expedido";
  const preferred = matches.filter(
    (row) => (row.status || "No Pátio") === wanted
  );
  const pool = preferred.length > 0 ? preferred : matches;
  if (pool.length === 1) return pool[0];

  return [...pool].sort((a, b) => {
    const ta = new Date(a.updated_at || a.created_at || 0).getTime();
    const tb = new Date(b.updated_at || b.created_at || 0).getTime();
    return tb - ta;
  })[0];
}

/** Troca o id obsoleto da saída pelo vasilhame que está no pátio. */
export function alignSaidaItensVasilhames(
  itens = [],
  vasilhames = [],
  { preferPatio = true } = {}
) {
  return (itens || []).map((item) => {
    const resolved = resolveVasilhameDaSaida(item, vasilhames, { preferPatio });
    if (!resolved) return item;
    if (String(resolved.id) === String(item.vasilhame_id || "")) return item;
    return {
      ...item,
      vasilhame_id: resolved.id,
      vasilhame_placa: resolved.placa || item.vasilhame_placa || "",
      vasilhame_barril: resolved.barril ?? item.vasilhame_barril ?? "",
    };
  });
}

export function saidaItemSemVasilhame(item, vasilhames = [], options = {}) {
  if (!isItemConvencional(item)) return false;
  if (!item?.vasilhame_id && !item?.vasilhame_placa && !item?.vasilhame_barril) {
    return false;
  }
  return !resolveVasilhameDaSaida(item, vasilhames, options);
}

/**
 * Após recriar ou unificar vasilhames, aponta as saídas para o id que permaneceu.
 * `replacements`: [{ from, to }]
 */
export async function relinkSaidasVasilhameIds(replacements = []) {
  const map = new Map();
  for (const entry of replacements) {
    const from = String(entry?.from || "").trim();
    const to = String(entry?.to || "").trim();
    if (!from || !to || from === to) continue;
    map.set(from, to);
  }
  if (map.size === 0) return 0;

  const saidas = await entities.saidas.list();
  const updates = [];
  for (const saida of saidas || []) {
    let changed = false;
    const itens = (saida.itens || []).map((item) => {
      const next = map.get(String(item?.vasilhame_id || ""));
      if (!next) return item;
      changed = true;
      return { ...item, vasilhame_id: next };
    });
    if (changed) updates.push({ id: saida.id, itens });
  }
  if (updates.length === 0) return 0;
  await entities.saidas.bulkUpdate(updates);
  return updates.length;
}
