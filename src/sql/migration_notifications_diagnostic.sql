-- ============================================================================
-- CHEMCTRL — DIAGNÓSTICO DE NOTIFICAÇÕES
-- Execute no Supabase SQL Editor para verificar pré-requisitos e estado.
-- ============================================================================

-- 1. Funções de sessão
SELECT 'session_functions' AS check_group, proname AS name
FROM pg_proc
WHERE proname IN (
  'get_current_session',
  'is_internal_user',
  'current_user_nivel',
  'current_user_cliente'
)
ORDER BY proname;

-- 2. Tabela sessions
SELECT 'sessions_table' AS check_group, tablename AS name
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'sessions';

-- 3. Tabelas de notificação
SELECT 'notification_tables' AS check_group, tablename AS name
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'notification_reads')
ORDER BY tablename;

-- 4. RPCs de notificação
SELECT 'notification_rpcs' AS check_group, proname AS name
FROM pg_proc
WHERE proname IN (
  'create_notification',
  'mark_notification_read',
  'mark_all_notifications_read',
  'get_unread_notification_count',
  'current_user_id',
  'can_view_notification'
)
ORDER BY proname;

-- 5. Realtime
SELECT 'realtime' AS check_group, tablename AS name
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('notifications', 'notification_reads', 'notification_realtime_signals')
ORDER BY tablename;

-- 5b. Trigger de sinal
SELECT 'notification_triggers' AS check_group, tgname AS name
FROM pg_trigger
WHERE tgname = 'trg_notification_realtime_signal';

-- 6. Contagem de notificações
SELECT 'notification_count' AS check_group, COUNT(*)::text AS name
FROM notifications;

-- 6b. Contagem de sinais
SELECT 'signal_count' AS check_group, COUNT(*)::text AS name
FROM notification_realtime_signals;
