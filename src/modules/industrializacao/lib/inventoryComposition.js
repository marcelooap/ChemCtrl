/**
 * Inventário (inventario) — 1 linha por produto.
 * Agrupa as linhas físicas num inventário virtual com `items[]`.
 * Antes da 058, cada inventário é uma linha e os produtos estão em `items` jsonb.
 * inventario_id se repete em todas as linhas do mesmo inventário.
 */
import { base44 } from '@industrializacao/api/base44Client';
import { callRPC } from '@industrializacao/api/rpcClient';
import { invalidate } from '@industrializacao/lib/queryCache';

export function parseItemsField(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Linha física pós-058. Objetos já agrupados trazem `_is_grouped`. */
export function isInventoryLine(row) {
  return Boolean(row && !row._is_grouped && row.inventario_id);
}

function numOrZero(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function textOrEmpty(value) {
  return value == null ? '' : String(value).trim();
}

function hasItemContent(row) {
  if (!row) return false;
  return Boolean(
    textOrEmpty(row.stock_id)
    || textOrEmpty(row.item)
    || textOrEmpty(row.product)
    || textOrEmpty(row.lot)
    || textOrEmpty(row.client),
  );
}

export function rowToInventoryItem(row) {
  const product = textOrEmpty(row.product || row.item);
  return {
    stock_id: textOrEmpty(row.stock_id),
    item: product,
    product,
    client: textOrEmpty(row.client),
    lot: textOrEmpty(row.lot),
    unit: textOrEmpty(row.unit) || 'kg',
    packaging_type: textOrEmpty(row.packaging_type),
    packaging_capacity: numOrZero(row.packaging_capacity),
    registered_stock: numOrZero(row.registered_stock),
    registered_quantity: numOrZero(row.registered_quantity),
    physical_packages: numOrZero(row.physical_packages),
    fractional_qty: numOrZero(row.fractional_qty),
    physical_total: numOrZero(row.physical_total),
    difference: numOrZero(row.difference),
    difference_pct: numOrZero(row.difference_pct),
    linha_ordem: row.linha_ordem != null ? Number(row.linha_ordem) : 1,
    line_id: row.id,
  };
}

const LINE_FIELDS = [
  'stock_id',
  'item',
  'product',
  'client',
  'lot',
  'unit',
  'packaging_type',
  'packaging_capacity',
  'registered_stock',
  'registered_quantity',
  'physical_packages',
  'fractional_qty',
  'physical_total',
  'difference',
  'difference_pct',
  'linha_ordem',
  'items',
];

function headerFromAnchor(anchor) {
  const header = { ...anchor };
  for (const field of LINE_FIELDS) delete header[field];
  return header;
}

/**
 * Agrupa linhas físicas (pós-058) ou devolve o legado (1 row = inventário, items jsonb).
 * `id` do objeto virtual é a linha âncora (linha_ordem 1).
 */
export function groupInventoryRows(rows) {
  const list = rows || [];
  if (!list.length) return [];

  if (!list.some(isInventoryLine)) {
    return list.map((row) => ({
      ...row,
      items: parseItemsField(row.items),
    }));
  }

  const result = [];
  const groups = new Map();
  for (const row of list) {
    if (!isInventoryLine(row)) {
      result.push({
        ...row,
        items: parseItemsField(row.items),
      });
      continue;
    }
    const key = String(row.inventario_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const [, lines] of groups) {
    const sorted = [...lines].sort(
      (a, b) => (Number(a.linha_ordem) || 0) - (Number(b.linha_ordem) || 0),
    );
    const anchor = sorted[0];
    const fromColumns = sorted.filter(hasItemContent).map(rowToInventoryItem);
    const items = fromColumns.length
      ? fromColumns
      : parseItemsField(anchor.items);

    result.push({
      ...headerFromAnchor(anchor),
      id: anchor.id,
      inventario_id: anchor.inventario_id,
      items,
      _line_ids: sorted.map((line) => line.id),
      _is_grouped: true,
    });
  }

  result.sort((a, b) => {
    const ta = new Date(a.created_date || 0).getTime();
    const tb = new Date(b.created_date || 0).getTime();
    return tb - ta;
  });
  return result;
}

function uniqueTexts(values) {
  const out = [];
  for (const value of values) {
    const text = textOrEmpty(value);
    if (!text || text === 'TODOS' || out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

function lotsOf(item) {
  if (Array.isArray(item?.lots) && item.lots.length) {
    return uniqueTexts(item.lots);
  }
  const lot = item?.lot;
  if (Array.isArray(lot)) return uniqueTexts(lot);
  if (typeof lot === 'string' && lot.trim().startsWith('[')) {
    const parsed = parseItemsField(lot);
    if (parsed.length) return uniqueTexts(parsed);
  }
  const one = textOrEmpty(lot);
  return one ? [one] : [];
}

/** Valores únicos de cliente, produto ou lote (ordem estável). */
export function inventoryScopeValues(inv, field) {
  const items = Array.isArray(inv?.items) ? inv.items : parseItemsField(inv?.items);
  const fromLines = uniqueTexts(items.map((item) => {
    if (field === 'products') return item?.product || item?.item;
    if (field === 'lots') return item?.lot;
    return item?.client;
  }));
  if (fromLines.length) return fromLines;

  const raw = inv?.[field];
  if (raw == null || raw === '') return [];
  if (raw === 'TODOS') return ['TODOS'];
  if (Array.isArray(raw)) return uniqueTexts(raw);
  const parsed = parseItemsField(raw);
  if (parsed.length) return uniqueTexts(parsed);
  const one = textOrEmpty(raw);
  return one ? [one] : [];
}

/** Texto da tela: junta os valores das linhas. A célula no banco guarda só um. */
export function inventoryScopeText(inv, field) {
  const values = inventoryScopeValues(inv, field);
  if (!values.length) return '';
  return values.join(', ');
}

export function normalizeInventoryItems(items) {
  const flat = [];
  for (const item of items || []) {
    const product = textOrEmpty(item?.product || item?.item);
    const row = {
      stock_id: textOrEmpty(item?.stock_id),
      item: product,
      product,
      client: textOrEmpty(item?.client),
      unit: textOrEmpty(item?.unit) || 'kg',
      packaging_type: textOrEmpty(item?.packaging_type),
      packaging_capacity: numOrZero(item?.packaging_capacity),
      registered_stock: numOrZero(item?.registered_stock),
      registered_quantity: numOrZero(item?.registered_quantity),
      physical_packages: numOrZero(item?.physical_packages),
      fractional_qty: numOrZero(item?.fractional_qty),
      physical_total: numOrZero(item?.physical_total),
      difference: numOrZero(item?.difference),
      difference_pct: numOrZero(item?.difference_pct),
    };
    const lots = lotsOf(item);
    if (!lots.length) flat.push({ ...row, lot: '' });
    else lots.forEach((lot) => flat.push({ ...row, lot }));
  }
  return flat.filter((item) => item.stock_id || item.product || item.lot || item.client);
}

/**
 * Grava o inventário inteiro (cabeçalho repetido + uma linha por produto).
 * @param {'create'|'replace'} mode
 */
export async function salvarInventario({
  inventarioId = null,
  header,
  items,
  mode = 'replace',
}) {
  const saved = await callRPC('inventario_salvar', {
    p_inventario_id: inventarioId,
    p_header: header && typeof header === 'object' ? header : {},
    p_items: normalizeInventoryItems(items),
    p_mode: mode,
  });
  invalidate('Inventory');
  return saved;
}

export function isInventarioSalvarRpcMissing(err) {
  const msg = String(err?.message || err?.body || err || '');
  return (
    err?.status === 404
    || /PGRST202|Could not find the function|inventario_salvar/i.test(msg)
  );
}

async function loadGroupedByInventarioId(inventarioId) {
  const rows = await base44.entities.Inventory.filter({ inventario_id: inventarioId }, null, 5000) || [];
  if (!rows.length) return null;
  const grouped = groupInventoryRows(rows);
  return grouped.find((entry) => (
    String(entry.inventario_id) === String(inventarioId) || String(entry.id) === String(inventarioId)
  )) || grouped[0] || null;
}

/** Carrega o inventário da rota: todas as linhas do inventario_id, ou o JSON legado. */
export async function loadInventoryDocument(id) {
  if (!id) return null;
  try {
    const grouped = await loadGroupedByInventarioId(id);
    if (grouped) return grouped;
  } catch {
    // Coluna inventario_id ainda não existe (SQL 058 não aplicada).
  }
  try {
    const one = await base44.entities.Inventory.get(id);
    if (!one) return null;
    if (one.inventario_id && String(one.inventario_id) !== String(id)) {
      try {
        const byGroup = await loadGroupedByInventarioId(one.inventario_id);
        if (byGroup) return byGroup;
      } catch {
        // segue com a linha encontrada
      }
    }
    return groupInventoryRows([one])[0] || null;
  } catch {
    return null;
  }
}
