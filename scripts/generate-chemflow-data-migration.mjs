/**
 * Unificação de bancos — gera a migration de DADOS do ChemFlow.
 *
 * Lê todas as linhas das tabelas do Supabase Projeto B (ChemFlow, banco de
 * origem) e gera um arquivo SQL com INSERTs prontos para rodar no Supabase
 * do ChemBlend (Projeto A, banco de destino), preservando ids, timestamps e
 * campos jsonb. A ordem das tabelas respeita as foreign keys.
 *
 * As credenciais de ORIGEM ficam fixas aqui de propósito: após a unificação,
 * o .env passa a apontar para o banco do ChemBlend e este script continua
 * lendo do banco antigo (fonte da migração).
 *
 * Uso: node scripts/generate-chemflow-data-migration.mjs
 * Saída: src/modules/chemblend/sql/migration_chemflow_unification_data.sql
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Origem: Supabase Projeto B (ChemFlow legado). Anon key pública (RLS aberto).
const SOURCE_URL = 'https://putkyadaefivnqyinbnz.supabase.co';
const SOURCE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1dGt5YWRhZWZpdm5xeWluYm56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDkzNjksImV4cCI6MjEwMDQ4NTM2OX0.yGWib87SJjZoAzQWjeEsoXN_hT2bVecDtPMU9TEhMVY';

// Ordem respeitando as FKs (pais antes dos filhos).
const TABLES = [
  'clientes',
  'produtos',
  'isotanques',
  'descontaminacoes',
  'entradas',
  'estoque',
  'transbordos',
  'vasilhames',
  'saidas',
  'elementos_filtrantes',
  'filtracoes',
];

const PAGE_SIZE = 1000;
const ROWS_PER_INSERT = 50;

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return String(value);
  }
  if (typeof value === 'object') {
    // jsonb (arrays/objetos) — PostgREST devolve já parseado.
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  // text / uuid / date / timestamptz
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function fetchAllRows(sb, table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function buildInserts(table, rows) {
  if (rows.length === 0) {
    return `-- ${table}: nenhum registro na origem.\n`;
  }
  const columns = Object.keys(rows[0]);
  const colList = columns.map((c) => `"${c}"`).join(', ');
  const chunks = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const batch = rows.slice(i, i + ROWS_PER_INSERT);
    const values = batch
      .map((row) => `  (${columns.map((c) => sqlLiteral(row[c])).join(', ')})`)
      .join(',\n');
    chunks.push(
      `insert into ${table} (${colList})\nvalues\n${values}\non conflict (id) do nothing;`
    );
  }
  return `-- ${table}: ${rows.length} registro(s)\n${chunks.join('\n\n')}\n`;
}

async function main() {
  const sb = createClient(SOURCE_URL, SOURCE_ANON_KEY);
  const sections = [];
  let total = 0;

  for (const table of TABLES) {
    const rows = await fetchAllRows(sb, table);
    total += rows.length;
    console.log(`${table.padEnd(22)} ${rows.length} registro(s)`);
    sections.push(buildInserts(table, rows));
  }

  const header = `-- ============================================================================
-- ChemCtrl — Unificação de bancos: ChemFlow -> ChemBlend (Projeto A)
-- ============================================================================
-- PARTE 2/2 — DADOS (gerado automaticamente)
--
-- Gerado por scripts/generate-chemflow-data-migration.mjs em ${new Date().toISOString()}
-- Origem: ${SOURCE_URL} (Supabase Projeto B — ChemFlow legado)
-- Total: ${total} registro(s) em ${TABLES.length} tabela(s)
--
-- EXECUTAR NO SQL EDITOR DO PROJETO CHEMBLEND, APÓS
-- migration_chemflow_unification.sql (schema).
--
-- Idempotente: reexecuções ignoram registros já migrados (on conflict do nothing).
-- Ids, timestamps e campos jsonb são preservados 1:1.
-- ============================================================================

begin;

`;

  const sql = header + sections.join('\n') + '\ncommit;\n';
  const outPath = resolve(
    process.cwd(),
    'src/modules/chemblend/sql/migration_chemflow_unification_data.sql'
  );
  writeFileSync(outPath, sql, 'utf8');
  console.log(`\nOK: ${outPath} (${total} registros)`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
