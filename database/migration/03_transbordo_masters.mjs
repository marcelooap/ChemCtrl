/**
 * 03 — Transbordo masters: produtos, isotanques, descontaminacoes, elementos_filtrantes
 * Uso: node database/migration/03_transbordo_masters.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';

const TABLES = [
  ['t_produtos', 'produtos'],
  ['t_isotanques', 'isotanques'],
  ['t_descontaminacoes', 'descontaminacoes'],
  ['t_elementos_filtrantes', 'elementos_filtrantes'],
];

async function main() {
  console.log('=== 03 transbordo masters ===');
  const { source, target } = getClients();

  for (const [from, to] of TABLES) {
    const rows = await fetchAllRows(source, from);
    console.log(`origem ${from}: ${rows.length}`);
    await upsertBatch(target, to, rows, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  console.log('03 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
