/**
 * 05 — Cross-module: saidas, leituras, transbordo_validacoes, agendamentos
 * Uso: node database/migration/05_cross_module.mjs
 *
 * Nota: sequences (numero) são resetadas em 12_validate / SQL pós-migração.
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';

const TABLES = [
  ['t_saidas', 'saidas'],
  ['t_saida_leituras', 'saida_leituras'],
  ['t_transbordo_validacoes', 'transbordo_validacoes'],
  ['t_agendamentos_carregamento', 'agendamentos_carregamento'],
  ['t_validacao_leituras', 'validacao_leituras'],
];

async function main() {
  console.log('=== 05 cross-module ===');
  const { source, target } = getClients();

  for (const [from, to] of TABLES) {
    let rows;
    try {
      rows = await fetchAllRows(source, from);
    } catch (err) {
      console.warn(`  SKIP ${from}: ${err.message}`);
      continue;
    }
    console.log(`origem ${from}: ${rows.length}`);
    await upsertBatch(target, to, rows, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  console.log('05 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
