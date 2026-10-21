/**
 * Full SQL audit against DATABASE_URL (session env only — never logged).
 * Usage: $env:DATABASE_URL='postgresql://...'; node scripts/audit-estoque-produtos-pg.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set in this session.');
  process.exit(2);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

async function q(sql, params) {
  const res = await client.query(sql, params);
  return res.rows;
}

async function main() {
  await client.connect();
  const out = {};

  out.preflight = {
    estoque_produtos: await q(`SELECT to_regclass('public.estoque_produtos') IS NOT NULL AS exists`),
    t_estoque: await q(`SELECT to_regclass('public.t_estoque') IS NOT NULL AS exists`),
    t_entradas: await q(`SELECT to_regclass('public.t_entradas') IS NOT NULL AS exists`),
    estoque_mp: await q(`SELECT to_regclass('public.estoque_mp') IS NOT NULL AS exists`),
    entrada_id_map: await q(`SELECT to_regclass('public._entrada_id_map') IS NOT NULL AS exists`),
  };

  out.columns = await q(`
    SELECT column_name, data_type, udt_name, is_nullable, column_default,
           character_maximum_length, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estoque_produtos'
    ORDER BY ordinal_position
  `);

  out.constraints = await q(`
    SELECT con.conname, con.contype, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public' AND rel.relname = 'estoque_produtos'
    ORDER BY con.conname
  `);

  out.indexes = await q(`
    SELECT i.relname AS index_name, pg_get_indexdef(i.oid) AS def,
           pg_size_pretty(pg_relation_size(i.oid)) AS size,
           COALESCE(s.idx_scan, 0) AS idx_scan
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index x ON x.indrelid = t.oid
    JOIN pg_class i ON i.oid = x.indexrelid
    LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
    WHERE n.nspname = 'public' AND t.relname = 'estoque_produtos'
    ORDER BY i.relname
  `);

  out.triggers = await q(`
    SELECT tgname, pg_get_triggerdef(oid) AS def
    FROM pg_trigger
    WHERE tgrelid = 'public.estoque_produtos'::regclass AND NOT tgisinternal
  `);

  out.policies = await q(`
    SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
           pg_get_expr(polwithcheck, polrelid) AS with_check
    FROM pg_policy
    WHERE polrelid = 'public.estoque_produtos'::regclass
  `);

  out.sizes = await q(`
    SELECT
      pg_size_pretty(pg_total_relation_size('public.estoque_produtos')) AS total,
      pg_size_pretty(pg_relation_size('public.estoque_produtos')) AS heap,
      pg_size_pretty(pg_indexes_size('public.estoque_produtos')) AS indexes,
      (SELECT count(*) FROM public.estoque_produtos) AS row_count
  `);

  out.by_origem = await q(`
    SELECT origem, count(*)::bigint AS n
    FROM public.estoque_produtos
    GROUP BY origem
    ORDER BY origem
  `);

  out.redundancy = await q(`
    SELECT
      count(*) FILTER (WHERE origem = 'MATERIA_PRIMA' AND mp_code IS NOT DISTINCT FROM produto_codigo) AS mp_code_same,
      count(*) FILTER (WHERE origem = 'MATERIA_PRIMA' AND mp_code IS DISTINCT FROM produto_codigo
        AND NOT (mp_code IS NULL AND produto_codigo IS NULL)) AS mp_code_diff,
      count(*) FILTER (WHERE origem = 'MATERIA_PRIMA' AND mp_code IS NOT NULL AND produto_codigo IS NULL) AS mp_code_only,
      count(*) FILTER (WHERE origem = 'MATERIA_PRIMA' AND mp_code IS NULL AND produto_codigo IS NOT NULL) AS produto_only,
      count(*) FILTER (WHERE legacy_mp_id IS NOT NULL) AS legacy_mp_id_filled,
      count(*) FILTER (
        WHERE legacy_mp_id IS NOT NULL
          AND legacy_mp_id_text IS NOT NULL
          AND legacy_mp_id::text = legacy_mp_id_text
      ) AS legacy_mp_id_matches_text,
      count(*) FILTER (
        WHERE legacy_mp_id IS NOT NULL
          AND legacy_mp_id_text IS NOT NULL
          AND legacy_mp_id::text IS DISTINCT FROM legacy_mp_id_text
      ) AS legacy_mp_id_mismatch,
      count(*) FILTER (WHERE origem = 'ARMAZENAGEM' AND initial_stock IS NOT DISTINCT FROM quantidade) AS initial_eq_arm,
      count(*) FILTER (WHERE origem = 'ARMAZENAGEM' AND initial_stock IS DISTINCT FROM quantidade) AS initial_diff_arm,
      count(*) FILTER (WHERE origem = 'MATERIA_PRIMA' AND initial_stock IS NOT DISTINCT FROM quantidade) AS initial_eq_mp,
      count(*) FILTER (WHERE origem = 'MATERIA_PRIMA' AND initial_stock IS DISTINCT FROM quantidade) AS initial_diff_mp,
      count(*) FILTER (
        WHERE densidade IS NOT NULL AND btrim(densidade) <> ''
          AND densidade !~ '^-?[0-9]+([.][0-9]+)?$'
      ) AS densidade_non_numeric,
      count(*) FILTER (WHERE status IS NOT NULL AND btrim(status) <> '') AS status_filled,
      count(*) FILTER (WHERE legacy_entrada_codigo IS NOT NULL AND btrim(legacy_entrada_codigo) <> '') AS legacy_entrada_codigo_filled,
      count(*) FILTER (WHERE legacy_mp_entry_id IS NOT NULL AND btrim(legacy_mp_entry_id) <> '') AS legacy_mp_entry_id_filled
    FROM public.estoque_produtos
  `);

  out.status_values = await q(`
    SELECT status, count(*)::bigint AS n
    FROM public.estoque_produtos
    WHERE status IS NOT NULL AND btrim(status) <> ''
    GROUP BY status
    ORDER BY n DESC
  `);

  out.column_sizes = await q(`
    SELECT
      avg(pg_column_size(mp_code))::numeric(12,2) AS avg_mp_code,
      avg(pg_column_size(legacy_mp_id))::numeric(12,2) AS avg_legacy_mp_id,
      avg(pg_column_size(legacy_entrada_codigo))::numeric(12,2) AS avg_legacy_entrada_codigo,
      avg(pg_column_size(legacy_mp_entry_id))::numeric(12,2) AS avg_legacy_mp_entry_id,
      avg(pg_column_size(status))::numeric(12,2) AS avg_status,
      sum(pg_column_size(mp_code))::bigint AS sum_mp_code,
      sum(pg_column_size(legacy_mp_id))::bigint AS sum_legacy_mp_id
    FROM public.estoque_produtos
  `);

  out.functions = await q(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_functiondef(p.oid) ILIKE '%estoque_produtos%'
    ORDER BY p.proname
  `);

  out.checksum = await q(`
    SELECT count(*)::bigint AS n,
           md5(string_agg(id::text || '|' || coalesce(id_entrada,'') || '|' || coalesce(saldo_atual::text,''), '' ORDER BY id)) AS checksum
    FROM public.estoque_produtos
  `);

  const outPath = path.join(root, 'database', 'backups', 'audit-estoque-produtos-pg.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({
    wrote: outPath,
    preflight: out.preflight,
    sizes: out.sizes,
    by_origem: out.by_origem,
    redundancy: out.redundancy,
    status_values: out.status_values,
    column_sizes: out.column_sizes,
    index_count: out.indexes.length,
    function_count: out.functions.length,
    checksum: out.checksum,
  }, null, 2));

  await client.end();
}

main().catch(async (e) => {
  console.error(e.message || e);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
});
