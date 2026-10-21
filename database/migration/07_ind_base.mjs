/**
 * 07 — IND base (sem FK entre si): receitas, pedidos, ensaios, etc.
 * Nomes de origem = entityTableMap reais.
 * Uso: node database/migration/07_ind_base.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';
import { buildIdMap } from './lib/id-map.mjs';
import { pickColumns, transformIndRow } from './lib/remap.mjs';

const INVENTARIO_COLUMNS = [
  'id',
  'created_at',
  'updated_at',
  'created_by_id',
  'inventory_number',
  'opening_date',
  'start_date',
  'closing_date',
  'opened_by',
  'started_by',
  'closed_by',
  'clients',
  'products',
  'lots',
  'status',
  'items',
];

function hasInventoryItem(line) {
  return Boolean(
    String(line?.stock_id || '').trim()
    || String(line?.item || '').trim()
    || String(line?.product || '').trim()
    || String(line?.lot || '').trim()
    || String(line?.client || '').trim()
  );
}

/** Pós-058 a origem tem 1 linha por produto. O schema v2 ainda guarda items jsonb. */
function collapseInventarios(rows) {
  const legacy = [];
  const groups = new Map();
  for (const row of rows) {
    if (row?.inventario_id == null || row.inventario_id === '') {
      legacy.push(row);
      continue;
    }
    const key = String(row.inventario_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const collapsed = [];
  for (const lines of groups.values()) {
    const sorted = [...lines].sort(
      (a, b) => (Number(a.linha_ordem) || 0) - (Number(b.linha_ordem) || 0),
    );
    const anchor = sorted[0];
    const distinct = (pick) => {
      const values = [];
      for (const line of sorted) {
        const value = String(pick(line) || '').trim();
        if (!value || values.includes(value)) continue;
        values.push(value);
      }
      return values;
    };
    const clientList = distinct((line) => line.client);
    const productList = distinct((line) => line.product || line.item);
    const lotList = distinct((line) => line.lot);
    const items = sorted.filter(hasInventoryItem).map((line) => ({
      stock_id: line.stock_id || '',
      client: line.client || '',
      product: line.product || line.item || '',
      lot: line.lot || '',
      unit: line.unit || 'kg',
      packaging_type: line.packaging_type || '',
      packaging_capacity: line.packaging_capacity ?? 0,
      registered_stock: line.registered_stock ?? 0,
      registered_quantity: line.registered_quantity ?? 0,
      physical_packages: line.physical_packages ?? 0,
      fractional_qty: line.fractional_qty ?? 0,
      physical_total: line.physical_total ?? 0,
      difference: line.difference ?? 0,
      difference_pct: line.difference_pct ?? 0,
    }));
    collapsed.push({
      ...anchor,
      clients: clientList.length ? JSON.stringify(clientList) : anchor.clients,
      products: productList.length ? JSON.stringify(productList) : anchor.products,
      lots: lotList.length ? JSON.stringify(lotList) : anchor.lots,
      items: items.length ? items : (anchor.items ?? []),
    });
  }
  return [...collapsed, ...legacy];
}

/** [source, target, mapName] */
const TABLES = [
  ['receitas', 'receitas', 'receitas'],
  ['cadastro_pedidos_ind', 'pedidos', 'pedidos'],
  ['cadastro_analises_metodologia', 'ensaios', 'ensaios'],
  ['ind_cq_esp_tec', 'cq_especificacoes', 'cq_especificacoes'],
  ['cadastro_equipamentolab', 'equipamentos_lab', 'equipamentos_lab'],
  ['estoque_mp', 'estoque_mp', 'estoque_mp'],
  ['ind_cadastro_tanka', 'tanques_ind', 'tanques_ind'],
  ['inventario', 'inventarios_mp', 'inventarios_mp'],
];

async function migrateOne(source, target, from, to, mapName) {
  const fetched = await fetchAllRows(source, from);
  const rows = from === 'inventario' ? collapseInventarios(fetched) : fetched;
  if (from === 'inventario') {
    console.log(`origem inventario: ${fetched.length} linha(s) -> ${rows.length} inventario(s)`);
  } else {
    console.log(`origem ${from}: ${rows.length}`);
  }
  const idMap = buildIdMap(
    mapName,
    rows.map((r) => r.id)
  );
  const mapped = rows.map((row) =>
    transformIndRow(row, { idMap, context: to })
  );
  const payload = from === 'inventario'
    ? mapped.map((row) => pickColumns(row, INVENTARIO_COLUMNS))
    : mapped;
  await upsertBatch(target, to, payload, {
    onConflict: 'id',
    ignoreDuplicates: true,
  });
}

async function main() {
  console.log('=== 07 ind base ===');
  const { source, target } = getClients();

  for (const [from, to, mapName] of TABLES) {
    await migrateOne(source, target, from, to, mapName);
  }

  console.log('07 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
