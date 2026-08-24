/**
 * 07 — IND base (sem FK entre si): receitas, pedidos, ensaios, etc.
 * Nomes de origem = entityTableMap reais.
 * Uso: node database/migration/07_ind_base.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';
import { buildIdMap } from './lib/id-map.mjs';
import { transformIndRow } from './lib/remap.mjs';

/** [source, target, mapName] */
const TABLES = [
  ['ind_lista_receitas', 'receitas', 'receitas'],
  ['ind_lista_pedidos', 'pedidos', 'pedidos'],
  ['ind_lista_ensaios', 'ensaios', 'ensaios'],
  ['ind_cq_esp_tec', 'cq_especificacoes', 'cq_especificacoes'],
  ['ind_lista_equipamentoslab', 'equipamentos_lab', 'equipamentos_lab'],
  ['ind_estoque_mp', 'estoque_mp', 'estoque_mp'],
  ['ind_cadastro_tanka', 'tanques_ind', 'tanques_ind'],
  ['ind_lista_inventario', 'inventarios_mp', 'inventarios_mp'],
];

async function migrateOne(source, target, from, to, mapName) {
  const rows = await fetchAllRows(source, from);
  console.log(`origem ${from}: ${rows.length}`);
  const idMap = buildIdMap(
    mapName,
    rows.map((r) => r.id)
  );
  const mapped = rows.map((row) =>
    transformIndRow(row, { idMap, context: to })
  );
  await upsertBatch(target, to, mapped, {
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
