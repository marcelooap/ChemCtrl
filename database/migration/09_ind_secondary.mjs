/**
 * 09 — IND secondary: movimentos_mp, transferencias_ind, programacao_demanda
 * Uso: node database/migration/09_ind_secondary.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';
import { buildIdMap, loadMap } from './lib/id-map.mjs';
import { transformIndRow } from './lib/remap.mjs';

async function main() {
  console.log('=== 09 ind secondary ===');
  const { source, target } = getClients();

  // movimentos_mp (ind_retornos_perdas) — FK stock_id → estoque_mp
  {
    const rows = await fetchAllRows(source, 'ind_retornos_perdas');
    console.log(`origem ind_retornos_perdas: ${rows.length}`);
    const idMap = buildIdMap(
      'movimentos_mp',
      rows.map((r) => r.id)
    );
    const estoqueMap = loadMap('estoque_mp');
    const mapped = rows.map((row) =>
      transformIndRow(row, {
        idMap,
        context: 'movimentos_mp',
        fks: [{ map: estoqueMap, fields: ['stock_id'], required: false }],
      })
    );
    await upsertBatch(target, 'movimentos_mp', mapped, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  // transferencias_ind (ind_transbordo_ind)
  {
    const rows = await fetchAllRows(source, 'ind_transbordo_ind');
    console.log(`origem ind_transbordo_ind: ${rows.length}`);
    const idMap = buildIdMap(
      'transferencias_ind',
      rows.map((r) => r.id)
    );
    const mapped = rows.map((row) =>
      transformIndRow(row, { idMap, context: 'transferencias_ind' })
    );
    await upsertBatch(target, 'transferencias_ind', mapped, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  // programacao_demanda — FK order_id → pedidos
  {
    const rows = await fetchAllRows(source, 'ind_programacao_demanda');
    console.log(`origem ind_programacao_demanda: ${rows.length}`);
    const idMap = buildIdMap(
      'programacao_demanda',
      rows.map((r) => r.id)
    );
    const pedidosMap = loadMap('pedidos');
    const mapped = rows.map((row) =>
      transformIndRow(row, {
        idMap,
        context: 'programacao_demanda',
        fks: [{ map: pedidosMap, fields: ['order_id'], required: false }],
      })
    );
    await upsertBatch(target, 'programacao_demanda', mapped, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  console.log('09 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
