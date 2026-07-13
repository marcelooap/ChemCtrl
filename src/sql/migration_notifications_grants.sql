-- ============================================================================
-- CHEMCTRL — GRANTS DE NOTIFICAÇÕES (complemento)
-- Execute se migration_notifications.sql já foi aplicada antes dos GRANTs.
-- Idempotente — pode reexecutar sem problemas.
--
-- DEPENDÊNCIA: requer funções de sessão (get_current_session, etc.) e tabelas
-- notifications/notification_reads. Se ainda não existirem, execute antes:
--   1. migration_security_audit.sql (recomendado, login + RLS completo)
--   2. OU migration_notifications.sql (inclui pré-requisitos mínimos de sessão)
-- ============================================================================

GRANT SELECT ON notifications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_reads TO anon;

GRANT EXECUTE ON FUNCTION current_user_id() TO anon;
GRANT EXECUTE ON FUNCTION can_view_notification(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION create_notification(
  text, text, notification_type, notification_priority,
  text, text, text, text, text, text, text, text, text
) TO anon;
GRANT EXECUTE ON FUNCTION mark_notification_read(text) TO anon;
GRANT EXECUTE ON FUNCTION mark_all_notifications_read() TO anon;
GRANT EXECUTE ON FUNCTION get_unread_notification_count() TO anon;

-- Realtime (se ainda não aplicado)
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.notification_reads REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_reads;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
