-- ============================================================================
-- ChemCtrl — AUDITORIA estoque_produtos (SOMENTE LEITURA)
-- ============================================================================
-- Executar no SQL Editor do Supabase ou via:
--   $env:DATABASE_URL='...'; node scripts/audit-estoque-produtos-pg.mjs
-- NÃO altera dados.
-- ============================================================================

-- 1. Preflight cutover 065
SELECT
  to_regclass('public.estoque_produtos') IS NOT NULL AS has_estoque_produtos,
  to_regclass('public.t_estoque') IS NOT NULL AS has_t_estoque,
  to_regclass('public.t_entradas') IS NOT NULL AS has_t_entradas,
  to_regclass('public.estoque_mp') IS NOT NULL AS has_estoque_mp,
  to_regclass('public._entrada_id_map') IS NOT NULL AS has_entrada_id_map;

-- 2. Colunas
SELECT column_name, data_type, udt_name, is_nullable, column_default,
       character_maximum_length, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'estoque_produtos'
ORDER BY ordinal_position;

-- 3. Constraints
SELECT con.conname, con.contype, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public' AND rel.relname = 'estoque_produtos'
ORDER BY con.conname;

-- 4. Índices + uso
SELECT i.relname AS index_name, pg_get_indexdef(i.oid) AS def,
       pg_size_pretty(pg_relation_size(i.oid)) AS size,
       COALESCE(s.idx_scan, 0) AS idx_scan
FROM pg_class t
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_index x ON x.indrelid = t.oid
JOIN pg_class i ON i.oid = x.indexrelid
LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
WHERE n.nspname = 'public' AND t.relname = 'estoque_produtos'
ORDER BY i.relname;

-- 5. Triggers / policies
SELECT tgname, pg_get_triggerdef(oid) AS def
FROM pg_trigger
WHERE tgrelid = 'public.estoque_produtos'::regclass AND NOT tgisinternal;

SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
WHERE polrelid = 'public.estoque_produtos'::regclass;

-- 6. Tamanhos
SELECT
  pg_size_pretty(pg_total_relation_size('public.estoque_produtos')) AS total,
  pg_size_pretty(pg_relation_size('public.estoque_produtos')) AS heap,
  pg_size_pretty(pg_indexes_size('public.estoque_produtos')) AS indexes,
  (SELECT count(*) FROM public.estoque_produtos) AS row_count;

-- 7. Contagem por origem
SELECT origem, count(*) AS n
FROM public.estoque_produtos
GROUP BY origem
ORDER BY origem;

-- 8. Redundâncias candidatas
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
FROM public.estoque_produtos;

-- 9. Valores de status
SELECT status, count(*) AS n
FROM public.estoque_produtos
WHERE status IS NOT NULL AND btrim(status) <> ''
GROUP BY status
ORDER BY n DESC;

-- 10. Espaço médio das candidatas
SELECT
  avg(pg_column_size(mp_code)) AS avg_mp_code,
  avg(pg_column_size(legacy_mp_id)) AS avg_legacy_mp_id,
  sum(pg_column_size(mp_code)) AS sum_mp_code,
  sum(pg_column_size(legacy_mp_id)) AS sum_legacy_mp_id
FROM public.estoque_produtos;

-- 11. Funções que referenciam a tabela
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ILIKE '%estoque_produtos%'
ORDER BY p.proname;

-- 12. Checksum de integridade
SELECT count(*) AS n,
       md5(string_agg(id::text || '|' || coalesce(id_entrada,'') || '|' || coalesce(saldo_atual::text,''), '' ORDER BY id)) AS checksum
FROM public.estoque_produtos;
