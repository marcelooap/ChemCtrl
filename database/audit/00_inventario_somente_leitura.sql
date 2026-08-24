-- ============================================================================
-- ChemCtrl — INVENTÁRIO REAL DO BANCO ATUAL (SOMENTE LEITURA)
-- ============================================================================
-- Executar no SQL Editor do projeto Supabase ATUAL (fonte de verdade).
-- NÃO altera estrutura, dados ou permissões.
-- ============================================================================

-- 1.1.a — Tabelas do schema public
SELECT tablename, tableowner, hasindexes, hastriggers, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 1.1.b — Contagens estimadas
SELECT
  relname AS tabela,
  n_live_tup AS registros_estimados
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

-- Contagens exatas (mais lento; preferir em horário de baixa carga)
-- SELECT 'ind_lista_usuarios' AS tabela, COUNT(*) AS total FROM ind_lista_usuarios
-- UNION ALL SELECT 't_clientes', COUNT(*) FROM t_clientes
-- ... (descomentar e completar conforme necessidade)

-- 1.1.c — Colunas
SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  c.character_maximum_length
FROM information_schema.columns c
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;

-- 1.1.d — Índices
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 1.1.e — Foreign keys
SELECT
  tc.table_name AS tabela_origem,
  kcu.column_name AS coluna_fk,
  ccu.table_name AS tabela_destino,
  ccu.column_name AS coluna_destino,
  rc.delete_rule AS on_delete,
  rc.update_rule AS on_update,
  tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- 1.1.f — Policies RLS
SELECT tablename, policyname, roles, cmd, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 1.1.g — Triggers
SELECT
  trigger_name,
  event_object_table AS tabela,
  event_manipulation AS evento,
  action_timing AS timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 1.1.h — Functions / RPCs
SELECT
  p.proname AS nome,
  pg_get_function_arguments(p.oid) AS argumentos,
  pg_get_function_result(p.oid) AS retorno,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
ORDER BY p.proname;

-- 1.1.i — Realtime publication
SELECT * FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- 1.1.j — Sequences
SELECT sequence_name, data_type, start_value, increment, minimum_value, maximum_value
FROM information_schema.sequences
WHERE sequence_schema = 'public'
ORDER BY sequence_name;

-- Extra: CHECK constraints
SELECT
  tc.table_name,
  tc.constraint_name,
  cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON cc.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'CHECK'
ORDER BY tc.table_name, tc.constraint_name;

-- Extra: UNIQUE constraints
SELECT
  tc.table_name,
  tc.constraint_name,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS colunas
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
  AND kcu.table_schema = tc.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'UNIQUE'
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name;

-- Extra: modulo_origem distribution (compatibilidade chemflow vs transbordo)
SELECT modulo_origem, COUNT(*) AS total
FROM t_saidas
GROUP BY modulo_origem
ORDER BY total DESC;
