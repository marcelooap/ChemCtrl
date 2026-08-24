/**
 * 04 — Transbordo ops: entradas, estoque, transbordos, vasilhames, filtracoes, material_reservas
 * Uso: node database/migration/04_transbordo_ops.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';

const TABLES = [
  ['t_entradas', 'entradas'],
  ['t_estoque', 'estoque'],
  ['t_transbordos', 'transbordos'],
  ['t_vasilhames', 'vasilhames'],
  ['t_filtracoes', 'filtracoes'],
  ['t_material_reservas', 'material_reservas'],
];

async function main() {
  console.log('=== 04 transbordo ops ===');
  const { source, target } = getClients();

  for (const [from, to] of TABLES) {
    const rows = await fetchAllRows(source, from);
    console.log(`origem ${from}: ${rows.length}`);
    await upsertBatch(target, to, rows, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  console.log('04 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
