/**
 * 12 — Validação: ANTES × DEPOIS + órfãos de FKs no target
 * Uso: node database/migration/12_validate.mjs
 */
import { getClients } from './lib/client.mjs';
import { countRows, fetchAllRows } from './lib/paginate.mjs';
import { loadJson } from './lib/id-map.mjs';
import { COUNT_PAIRS } from './lib/catalog.mjs';

async function safeCount(sb, table) {
  try {
    return { count: await countRows(sb, table), ok: true };
  } catch (err) {
    return { count: null, ok: false, error: err.message };
  }
}

/**
 * Conta órfãos: rows onde fk não é null e não existe em parent.id
 */
async function orphanCount(target, childTable, fk, parentTable) {
  const [children, parents] = await Promise.all([
    fetchAllRows(target, childTable, { select: `id,${fk}` }),
    fetchAllRows(target, parentTable, { select: 'id' }),
  ]);
  const parentIds = new Set(parents.map((p) => String(p.id)));
  let orphans = 0;
  for (const c of children) {
    if (c[fk] == null || c[fk] === '') continue;
    if (!parentIds.has(String(c[fk]))) orphans += 1;
  }
  return orphans;
}

async function main() {
  console.log('=== 12 validate ===');
  const { source, target } = getClients();
  const preflight = loadJson('preflight_counts');
  if (!preflight?.before) {
    console.warn(
      'WARN: id_maps/preflight_counts.json ausente — rode 00_preflight.mjs'
    );
  }

  let mismatches = 0;
  console.log('\nANTES × DEPOIS:');
  console.log(
    '  ' +
      'target'.padEnd(32) +
      'antes'.padStart(8) +
      'depois'.padStart(8) +
      '  status'
  );

  for (const { source: srcTable, target: tgtTable } of COUNT_PAIRS) {
    const beforeInfo = preflight?.before?.[tgtTable];
    let before = beforeInfo?.count;
    if (before == null && beforeInfo?.ok !== false) {
      const r = await safeCount(source, srcTable);
      before = r.count;
    }

    const afterR = await safeCount(target, tgtTable);
    const after = afterR.count;

    // Seeds podem aumentar operadores/perfis no target
    const seedTables = new Set(['operadores', 'perfis', 'perfil_permissoes']);
    let status = 'OK';
    if (!afterR.ok) {
      status = 'FAIL target';
      mismatches += 1;
    } else if (before == null) {
      status = 'SKIP (sem antes)';
    } else if (seedTables.has(tgtTable)) {
      if (after < before) {
        status = 'FAIL (target < source)';
        mismatches += 1;
      } else {
        status = after === before ? 'OK' : 'OK (seeds+)';
      }
    } else if (after !== before) {
      // Tabelas com filtro de órfãos podem ter menos linhas
      const dropAllowed = new Set([
        'composicao_vasilhame_producao',
        'checklist_producao',
        'cq_resultados',
        'usuario_permissoes',
      ]);
      if (dropAllowed.has(tgtTable) && after <= before) {
        status = `WARN (${before - after} omitidos)`;
      } else {
        status = 'MISMATCH';
        mismatches += 1;
      }
    }

    console.log(
      '  ' +
        tgtTable.padEnd(32) +
        String(before ?? '—').padStart(8) +
        String(after ?? '—').padStart(8) +
        '  ' +
        status
    );
  }

  console.log('\nÓrfãos (FKs novas):');
  const orphanChecks = [
    ['producoes', 'recipe_id', 'receitas'],
    ['producoes', 'order_id', 'pedidos'],
    ['cq_resultados', 'production_id', 'producoes'],
    ['checklist_producao', 'production_id', 'producoes'],
    ['checklist_producao', 'recipe_id', 'receitas'],
    ['vasilhames_producao', 'production_id', 'producoes'],
    ['composicao_vasilhame_producao', 'container_id', 'vasilhames_producao'],
    ['composicao_vasilhame_producao', 'production_id', 'producoes'],
    ['movimentos_mp', 'stock_id', 'estoque_mp'],
    ['programacao_demanda', 'order_id', 'pedidos'],
    ['usuario_permissoes', 'usuario_id', 'usuarios'],
    ['produtos', 'cliente_id', 'clientes'],
    ['estoque', 'entrada_id', 'entradas'],
    ['agendamentos_carregamento', 'saida_id', 'saidas'],
  ];

  let orphanTotal = 0;
  for (const [child, fk, parent] of orphanChecks) {
    try {
      const n = await orphanCount(target, child, fk, parent);
      const mark = n === 0 ? 'OK' : 'ORPHAN';
      if (n > 0) orphanTotal += n;
      console.log(`  ${mark.padEnd(7)} ${child}.${fk} → ${parent}: ${n}`);
    } catch (err) {
      console.log(`  FAIL    ${child}.${fk}: ${err.message}`);
      mismatches += 1;
    }
  }

  console.log('\n---');
  console.log(
    'Pós-migração: execute database/migration/13_reset_sequences.sql no SQL Editor do target.'
  );

  if (mismatches > 0 || orphanTotal > 0) {
    console.error(
      `\nValidação FALHOU: mismatches=${mismatches}, orphans=${orphanTotal}`
    );
    process.exit(1);
  }

  console.log('\nValidação OK — counts e FKs consistentes.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
