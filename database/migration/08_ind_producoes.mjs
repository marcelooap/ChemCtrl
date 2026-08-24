/**
 * 08 — Produções: remap recipe_id + order_id
 * Uso: node database/migration/08_ind_producoes.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';
import { buildIdMap, loadMap } from './lib/id-map.mjs';
import { transformIndRow } from './lib/remap.mjs';

async function main() {
  console.log('=== 08 producoes ===');
  const { source, target } = getClients();

  const rows = await fetchAllRows(source, 'ind_lista_producoes');
  console.log(`origem ind_lista_producoes: ${rows.length}`);

  const idMap = buildIdMap(
    'producoes',
    rows.map((r) => r.id)
  );
  const receitasMap = loadMap('receitas');
  const pedidosMap = loadMap('pedidos');

  if (!Object.keys(receitasMap).length && rows.some((r) => r.recipe_id)) {
    console.warn('  WARN: mapa receitas vazio — rode 07_ind_base.mjs antes');
  }

  const mapped = rows.map((row) =>
    transformIndRow(row, {
      idMap,
      context: 'producoes',
      fks: [
        { map: receitasMap, fields: ['recipe_id'], required: false },
        { map: pedidosMap, fields: ['order_id'], required: false },
      ],
    })
  );

  await upsertBatch(target, 'producoes', mapped, {
    onConflict: 'id',
    ignoreDuplicates: true,
  });

  console.log('08 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
