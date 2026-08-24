/**
 * 02 — Shared masters: clientes, operadores, etiqueta_configs
 * Uso: node database/migration/02_shared.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';

async function copy(source, target, fromTable, toTable) {
  const rows = await fetchAllRows(source, fromTable);
  console.log(`origem ${fromTable}: ${rows.length}`);
  await upsertBatch(target, toTable, rows, {
    onConflict: 'id',
    ignoreDuplicates: true,
  });
}

async function main() {
  console.log('=== 02 shared ===');
  const { source, target } = getClients();

  await copy(source, target, 't_clientes', 'clientes');
  await copy(source, target, 't_operadores', 'operadores');
  await copy(source, target, 't_etiqueta_configs', 'etiqueta_configs');

  console.log('02 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
