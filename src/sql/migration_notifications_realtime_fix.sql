-- ============================================================================
-- CHEMCTRL — FIX REALTIME DE NOTIFICAÇÕES (auth interna + RLS)
-- Execute no: Supabase Dashboard → SQL Editor
--
-- CAUSA RAIZ:
-- O Supabase Realtime NÃO propaga o header `x-session-id` na avaliação RLS
-- de postgres_changes. Como `can_view_notification()` depende de
-- `get_current_session()` → `request.header.x-session-id`, os eventos
-- INSERT em `notifications` nunca chegam ao frontend (mesmo com canal SUBSCRIBED).
--
-- REST (SELECT/RPC) continua funcionando normalmente com o header.
--
-- SOLUÇÃO (invalidate-and-fetch):
-- Tabela de sinais com SELECT aberto (apenas IDs opacos) + trigger após INSERT.
-- Frontend recebe o sinal via Realtime e recarrega notificações via REST/RPC
-- (onde o RLS de sessão funciona). Conteúdo sensível permanece protegido.
--
-- Idempotente.
-- ============================================================================

-- 1. Tabela de sinais (payload mínimo — sem title/message)
CREATE TABLE IF NOT EXISTS notification_realtime_signals (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  notification_id text NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_signals_created
  ON notification_realtime_signals (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_signals_notif
  ON notification_realtime_signals (notification_id);

-- 2. RLS — SELECT liberado apenas nesta tabela de sinais (IDs opacos).
--    WRITE bloqueado para o role anon (apenas trigger SECURITY DEFINER grava).
ALTER TABLE notification_realtime_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_signals_select" ON notification_realtime_signals;
DROP POLICY IF EXISTS "notification_signals_insert" ON notification_realtime_signals;
DROP POLICY IF EXISTS "notification_signals_update" ON notification_realtime_signals;
DROP POLICY IF EXISTS "notification_signals_delete" ON notification_realtime_signals;

CREATE POLICY "notification_signals_select" ON notification_realtime_signals
  FOR SELECT USING (true);

CREATE POLICY "notification_signals_insert" ON notification_realtime_signals
  FOR INSERT WITH CHECK (false);

CREATE POLICY "notification_signals_update" ON notification_realtime_signals
  FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "notification_signals_delete" ON notification_realtime_signals
  FOR DELETE USING (false);

-- 3. Trigger — emite sinal após cada notificação criada
CREATE OR REPLACE FUNCTION emit_notification_realtime_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notification_realtime_signals (notification_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_realtime_signal ON notifications;
CREATE TRIGGER trg_notification_realtime_signal
  AFTER INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION emit_notification_realtime_signal();

-- 4. Realtime publication
ALTER TABLE public.notification_realtime_signals REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_realtime_signals;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Grants
GRANT SELECT ON notification_realtime_signals TO anon;
GRANT EXECUTE ON FUNCTION emit_notification_realtime_signal() TO anon;

-- 6. Retrofills: sinais para notificações recentes sem sinal (últimas 48h)
INSERT INTO notification_realtime_signals (notification_id)
SELECT n.id
FROM notifications n
WHERE n.created_at > now() - interval '48 hours'
  AND NOT EXISTS (
    SELECT 1 FROM notification_realtime_signals s
    WHERE s.notification_id = n.id
  );

-- 7. Limpeza automática de sinais antigos (> 7 dias) — reduz ruído
DELETE FROM notification_realtime_signals
WHERE created_at < now() - interval '7 days';

-- 8. Confirmação
SELECT 'notification_realtime_signals' AS table_name,
       COUNT(*)::text AS signal_count
FROM notification_realtime_signals;

SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'notification_realtime_signals';
