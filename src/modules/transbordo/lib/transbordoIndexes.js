/**
 * Índices derivados (por id, placa/barril, transbordo) para listas de
 * transbordos e vasilhames.
 *
 * Memoizados pela identidade do array: enquanto a tela reutilizar a mesma
 * referência (estado React / cache do workspace), o índice é construído
 * uma única vez e reaproveitado por todos os cálculos de saldo.
 * Transforma varreduras O(T) / O(V) por linha em lookups O(1).
 */

/** Chave normalizada placa||barril (mesmo formato usado em estoqueSaldo). */
export function placaBarrilKey(placa, barril) {
  return `${String(placa || "").trim().toUpperCase()}||${String(barril || "")
    .trim()
    .toUpperCase()}`;
}

export const EMPTY_PLACA_KEY = "||";

const EMPTY_TRANSBORDO_INDEX = Object.freeze({
  byId: new Map(),
  byCodigo: new Map(),
  byDestinoPlacaKey: new Map(),
  byOrigemEstoqueId: new Map(),
  order: new Map(),
});

const EMPTY_VASILHAME_INDEX = Object.freeze({
  byId: new Map(),
  byPlacaKey: new Map(),
  byTransbordoId: new Map(),
});

/** @type {WeakMap<Array, typeof EMPTY_TRANSBORDO_INDEX>} */
const transbordoIndexCache = new WeakMap();
/** @type {WeakMap<Array, typeof EMPTY_VASILHAME_INDEX>} */
const vasilhameIndexCache = new WeakMap();

/** Acrescenta preservando a ordem da lista; evita duplicar o mesmo item consecutivo. */
function pushOrdered(map, key, value) {
  const list = map.get(key);
  if (!list) {
    map.set(key, [value]);
    return;
  }
  if (list[list.length - 1] !== value) list.push(value);
}

/**
 * Id de estoque lastreável na origem do OP.
 * Origem tanka usa entrada_id = isotanque — nunca promover a estoque_id.
 * (Espelha resolveEstoqueIdFromOrigemTransbordo sem import circular.)
 */
function origemEstoqueIdKey(origem) {
  if (!origem) return null;
  if (origem.estoque_id != null && String(origem.estoque_id).trim() !== "") {
    return String(origem.estoque_id);
  }
  if ((origem.tipo_origem || "") === "tanka") return null;
  if (origem.entrada_id != null && String(origem.entrada_id).trim() !== "") {
    return String(origem.entrada_id);
  }
  return null;
}

function buildTransbordoIndex(transbordos) {
  const byId = new Map();
  const byCodigo = new Map();
  const byDestinoPlacaKey = new Map();
  const byOrigemEstoqueId = new Map();
  const order = new Map();

  transbordos.forEach((t, position) => {
    if (!t?.id) return;
    if (!byId.has(t.id)) byId.set(t.id, t);
    order.set(t, position);
    if (t.codigo_transbordo) pushOrdered(byCodigo, t.codigo_transbordo, t);
    for (const d of t.destinos || []) {
      const key = placaBarrilKey(d?.placa || d?.tanka_codigo, d?.barril);
      if (key === EMPTY_PLACA_KEY) continue;
      pushOrdered(byDestinoPlacaKey, key, t);
    }
    for (const o of t.origens || []) {
      const estoqueKey = origemEstoqueIdKey(o);
      if (estoqueKey) pushOrdered(byOrigemEstoqueId, estoqueKey, t);
    }
  });

  return { byId, byCodigo, byDestinoPlacaKey, byOrigemEstoqueId, order };
}

function buildVasilhameIndex(vasilhames) {
  const byId = new Map();
  const byPlacaKey = new Map();
  const byTransbordoId = new Map();

  for (const v of vasilhames) {
    if (!v) continue;
    if (v.id != null && !byId.has(v.id)) byId.set(v.id, v);
    pushOrdered(byPlacaKey, placaBarrilKey(v.placa, v.barril), v);
    if (v.transbordo_id) pushOrdered(byTransbordoId, v.transbordo_id, v);
  }

  return { byId, byPlacaKey, byTransbordoId };
}

/** Índice de transbordos (por id, código OP e placa/barril de destino). */
export function getTransbordoIndex(transbordos) {
  if (!Array.isArray(transbordos) || transbordos.length === 0) {
    return EMPTY_TRANSBORDO_INDEX;
  }
  let index = transbordoIndexCache.get(transbordos);
  if (!index) {
    index = buildTransbordoIndex(transbordos);
    transbordoIndexCache.set(transbordos, index);
  }
  return index;
}

/** Índice de vasilhames (por id, placa/barril e transbordo de origem). */
export function getVasilhameIndex(vasilhames) {
  if (!Array.isArray(vasilhames) || vasilhames.length === 0) {
    return EMPTY_VASILHAME_INDEX;
  }
  let index = vasilhameIndexCache.get(vasilhames);
  if (!index) {
    index = buildVasilhameIndex(vasilhames);
    vasilhameIndexCache.set(vasilhames, index);
  }
  return index;
}
