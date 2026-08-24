-- ============================================================================
-- ChemCtrl v2 — Validação lógica pós-DDL (rodar no NOVO banco)
-- ============================================================================

-- Contagem de tabelas public
SELECT COUNT(*) AS total_tabelas
FROM pg_tables WHERE schemaname = 'public';

-- Tabelas esperadas (amostra crítica)
SELECT t AS tabela_esperada,
       to_regclass('public.' || t) IS NOT NULL AS existe
FROM unnest(ARRAY[
  'modulos','usuarios','sessions','perfis','perfil_permissoes','perfil_modulos',
  'permissoes','usuario_permissoes','rate_limit_attempts','rate_limit_logs',
  'clientes','operadores','etiqueta_configs',
  'produtos','entradas','estoque','transbordos','vasilhames','saidas',
  'transbordo_validacoes','agendamentos_carregamento',
  'receitas','pedidos','producoes','estoque_mp','movimentos_mp',
  'vasilhames_producao','composicao_vasilhame_producao',
  'cq_resultados','checklist_producao','validacoes_mp'
]) AS t
ORDER BY 1;

-- Confirmado: tabela morta NÃO existe
SELECT to_regclass('public.t_composicao_cargas') IS NULL AS composicao_cargas_ausente,
       to_regclass('public.composicao_cargas') IS NULL AS composicao_cargas_sem_prefixo_ausente;

-- FKs de producoes / cq / checklist / movimentos
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS references_table,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN (
    'producoes','cq_resultados','checklist_producao',
    'movimentos_mp','composicao_vasilhame_producao','vasilhames_producao',
    'programacao_demanda','perfil_modulos'
  )
ORDER BY 1, 2;

-- RPCs críticas
SELECT proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'login_user','validate_session','destroy_session','update_user_language',
    'list_profiles','get_user_permissions','replace_user_permissions',
    'submit_operational_checklist','get_public_produto_info','get_public_lot_info',
    'fn_set_updated_at','fn_estoque_assign_codigo'
  )
ORDER BY 1;

-- Seeds
SELECT 'modulos' AS t, COUNT(*) FROM modulos
UNION ALL SELECT 'perfis', COUNT(*) FROM perfis
UNION ALL SELECT 'permissoes', COUNT(*) FROM permissoes
UNION ALL SELECT 'operadores', COUNT(*) FROM operadores;

-- Realtime
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY 1;
