/**
 * 10 — IND final: vasilhames_producao, composicao, checklist, cq_resultados, validacoes_mp
 * Também remapeia validacao_leituras.validacao_id (módulo industrializacao).
 * Uso: node database/migration/10_ind_final.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';
import { buildIdMap, loadMap } from './lib/id-map.mjs';
import { transformIndRow } from './lib/remap.mjs';

async function main() {
  console.log('=== 10 ind final ===');
  const { source, target } = getClients();

  const producoesMap = loadMap('producoes');
  const receitasMap = loadMap('receitas');

  // vasilhames_producao
  {
    const rows = await fetchAllRows(source, 'ind_lista_vasilhames');
    console.log(`origem ind_lista_vasilhames: ${rows.length}`);
    const idMap = buildIdMap(
      'vasilhames_producao',
      rows.map((r) => r.id)
    );
    const mapped = rows.map((row) =>
      transformIndRow(row, {
        idMap,
        context: 'vasilhames_producao',
        fks: [
          { map: producoesMap, fields: ['production_id'], required: false },
        ],
      })
    );
    await upsertBatch(target, 'vasilhames_producao', mapped, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  const vasilhamesMap = loadMap('vasilhames_producao');

  // composicao_vasilhame_producao
  {
    const rows = await fetchAllRows(source, 'ind_composicao_vasilhame');
    console.log(`origem ind_composicao_vasilhame: ${rows.length}`);
    const idMap = buildIdMap(
      'composicao_vasilhame_producao',
      rows.map((r) => r.id)
    );
    const mapped = rows.map((row) =>
      transformIndRow(row, {
        idMap,
        context: 'composicao_vasilhame_producao',
        fks: [
          { map: vasilhamesMap, fields: ['container_id'], required: false },
          { map: producoesMap, fields: ['production_id'], required: false },
        ],
      })
    );
    // container_id é NOT NULL — filtrar órfãos que não remapearam
    const valid = mapped.filter((r) => r.container_id);
    const dropped = mapped.length - valid.length;
    if (dropped) {
      console.warn(
        `  WARN composicao: ${dropped} linha(s) sem container_id (órfãos) — omitidas`
      );
    }
    await upsertBatch(target, 'composicao_vasilhame_producao', valid, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  // checklist_producao
  {
    const rows = await fetchAllRows(source, 'ind_checklist_op');
    console.log(`origem ind_checklist_op: ${rows.length}`);
    const idMap = buildIdMap(
      'checklist_producao',
      rows.map((r) => r.id)
    );
    const mapped = rows.map((row) =>
      transformIndRow(row, {
        idMap,
        context: 'checklist_producao',
        fks: [
          { map: producoesMap, fields: ['production_id'], required: false },
          { map: receitasMap, fields: ['recipe_id'], required: false },
        ],
      })
    );
    const valid = mapped.filter((r) => r.production_id);
    const dropped = mapped.length - valid.length;
    if (dropped) {
      console.warn(
        `  WARN checklist: ${dropped} linha(s) sem production_id — omitidas`
      );
    }
    await upsertBatch(target, 'checklist_producao', valid, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  // cq_resultados
  {
    const rows = await fetchAllRows(source, 'ind_cq_resultados');
    console.log(`origem ind_cq_resultados: ${rows.length}`);
    const idMap = buildIdMap(
      'cq_resultados',
      rows.map((r) => r.id)
    );
    const mapped = rows.map((row) =>
      transformIndRow(row, {
        idMap,
        context: 'cq_resultados',
        fks: [
          { map: producoesMap, fields: ['production_id'], required: false },
        ],
      })
    );
    const valid = mapped.filter((r) => r.production_id);
    const dropped = mapped.length - valid.length;
    if (dropped) {
      console.warn(
        `  WARN cq_resultados: ${dropped} linha(s) sem production_id — omitidas`
      );
    }
    await upsertBatch(target, 'cq_resultados', valid, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  // validacoes_mp
  {
    const rows = await fetchAllRows(source, 'ind_validacoes');
    console.log(`origem ind_validacoes: ${rows.length}`);
    const idMap = buildIdMap(
      'validacoes_mp',
      rows.map((r) => r.id)
    );
    const mapped = rows.map((row) =>
      transformIndRow(row, {
        idMap,
        context: 'validacoes_mp',
        // transbordo_id / entrada_id permanecem text (refs UUID do domínio TB)
      })
    );
    await upsertBatch(target, 'validacoes_mp', mapped, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }

  // Remap validacao_leituras.validacao_id para IDs novos de validacoes_mp
  // (leituras de transbordo_validacoes já usam UUID estável — sem mudança)
  {
    const validacoesMap = loadMap('validacoes_mp');
    let leituras;
    try {
      leituras = await fetchAllRows(target, 'validacao_leituras');
    } catch {
      leituras = [];
    }
    const toUpdate = [];
    for (const row of leituras) {
      if (row.modulo !== 'industrializacao') continue;
      const oldId = row.validacao_id != null ? String(row.validacao_id) : '';
      const newId = validacoesMap[oldId];
      if (newId && newId !== oldId) {
        toUpdate.push({ ...row, validacao_id: newId });
      }
    }
    if (toUpdate.length) {
      console.log(
        `  remapeando ${toUpdate.length} validacao_leituras (industrializacao)`
      );
      await upsertBatch(target, 'validacao_leituras', toUpdate, {
        onConflict: 'id',
        ignoreDuplicates: false,
      });
    } else {
      console.log('  validacao_leituras: nenhum remap industrializacao');
    }
  }

  console.log('10 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
