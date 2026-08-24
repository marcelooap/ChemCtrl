/**
 * 00 — Preflight: conexões, counts origem, tabelas destino.
 * Uso: node database/migration/00_preflight.mjs
 */
import { getClients } from './lib/client.mjs';
import { countRows } from './lib/paginate.mjs';
import { saveJson } from './lib/id-map.mjs';
import { COUNT_PAIRS, EXPECTED_TARGET_TABLES } from './lib/catalog.mjs';

async function safeCount(sb, table, label) {
  try {
    const n = await countRows(sb, table);
    return { table, count: n, ok: true };
  } catch (err) {
    console.warn(`  WARN ${label}.${table}: ${err.message}`);
    return { table, count: null, ok: false, error: err.message };
  }
}

async function main() {
  console.log('=== 00 preflight ===');
  const { source, target, env } = getClients();
  console.log(`source: ${env.sourceUrl}`);
  console.log(`target: ${env.targetUrl}`);

  // Smoke: uma query simples em cada lado
  const { error: srcErr } = await source.from('perfis').select('id').limit(1);
  if (srcErr) {
    console.error('Falha ao ler source (perfis):', srcErr.message);
    process.exit(2);
  }
  const { error: tgtErr } = await target.from('modulos').select('codigo').limit(1);
  if (tgtErr) {
    console.error('Falha ao ler target (modulos):', tgtErr.message);
    console.error('Confirme que o DDL 01–10 foi aplicado no novo projeto.');
    process.exit(2);
  }

  console.log('\nContagens origem (ANTES):');
  const before = {};
  for (const { source: srcTable, target: tgtTable } of COUNT_PAIRS) {
    const r = await safeCount(source, srcTable, 'source');
    before[tgtTable] = {
      source_table: srcTable,
      count: r.count,
      ok: r.ok,
      error: r.error || null,
    };
    const mark = r.ok ? String(r.count).padStart(6) : '  FAIL';
    console.log(`  ${mark}  ${srcTable} → ${tgtTable}`);
  }

  console.log('\nVerificando tabelas no target:');
  const missing = [];
  for (const table of EXPECTED_TARGET_TABLES) {
    const r = await safeCount(target, table, 'target');
    if (!r.ok) {
      missing.push(table);
      console.log(`  MISSING  ${table}`);
    }
  }

  if (missing.length) {
    console.error(
      `\nTarget incompleto: ${missing.length} tabela(s) ausente(s). ` +
        `Execute database/new-schema/01…10 antes da migração.`
    );
    process.exit(2);
  }

  console.log(`  OK — ${EXPECTED_TARGET_TABLES.length} tabelas acessíveis`);

  const snapshot = {
    generated_at: new Date().toISOString(),
    source_url: env.sourceUrl,
    target_url: env.targetUrl,
    before,
  };
  saveJson('preflight_counts', snapshot);
  console.log('\nSalvo: id_maps/preflight_counts.json');
  console.log('Preflight OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
