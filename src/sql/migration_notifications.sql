-- ============================================================================
-- CHEMCTRL — SISTEMA DE NOTIFICAÇÕES INTERNAS
-- Execute no: Supabase Dashboard → SQL Editor → New Query
--
-- PRÉ-REQUISITO RECOMENDADO: migration_security_audit.sql (login, senhas, RLS completo)
-- A seção 0 abaixo garante apenas o mínimo de sessão para notificações funcionarem
-- mesmo se migration_security_audit.sql ainda não foi aplicado.
-- ============================================================================

-- ============================================================================
-- 0. PRÉ-REQUISITOS DE SESSÃO (mínimo para notificações)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sessions (
  session_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL,
  nome_completo text,
  usuario text,
  nivel_acesso text,
  tipo text DEFAULT 'interno',
  cliente text,
  cargo text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  last_activity timestamptz DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_direct_access_sessions" ON sessions;
CREATE POLICY "no_direct_access_sessions" ON sessions
  FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION get_current_session()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(s.*) FROM sessions s
  WHERE s.session_id = NULLIF(current_setting('request.header.x-session-id', true), '')
  AND s.expires_at > now()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION is_internal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((get_current_session() ->> 'tipo') = 'interno', false)
$$;

CREATE OR REPLACE FUNCTION current_user_nivel()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_current_session() ->> 'nivel_acesso'
$$;

CREATE OR REPLACE FUNCTION current_user_cliente()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_current_session() ->> 'cliente'
$$;

GRANT EXECUTE ON FUNCTION get_current_session() TO anon;
GRANT EXECUTE ON FUNCTION is_internal_user() TO anon;
GRANT EXECUTE ON FUNCTION current_user_nivel() TO anon;
GRANT EXECUTE ON FUNCTION current_user_cliente() TO anon;

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('info', 'success', 'warning', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_priority AS ENUM ('low', 'normal', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. TABELAS
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title         text NOT NULL,
  message       text NOT NULL,
  type          notification_type NOT NULL DEFAULT 'info',
  priority      notification_priority NOT NULL DEFAULT 'normal',
  event         text NOT NULL,
  entity_type   text,
  entity_id     text,
  related_op    text,
  related_table text,
  action_url    text,
  client        text NOT NULL,
  target_role   text,
  target_user   text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_reads (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  notification_id text NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  read_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, user_id)
);

-- ============================================================================
-- 3. ÍNDICES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_client ON notifications (client);
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON notifications (target_role);
CREATE INDEX IF NOT EXISTS idx_notifications_target_user ON notifications (target_user);
CREATE INDEX IF NOT EXISTS idx_notifications_event ON notifications (event);
CREATE INDEX IF NOT EXISTS idx_notifications_client_created ON notifications (client, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads (user_id, notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_notification ON notification_reads (notification_id);

-- ============================================================================
-- 4. REALTIME
-- ============================================================================
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

-- ============================================================================
-- 5. HELPER — ID do usuário atual
-- ============================================================================
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_current_session() ->> 'user_id'
$$;

-- ============================================================================
-- 6. VISIBILIDADE DE NOTIFICAÇÕES
-- ============================================================================
CREATE OR REPLACE FUNCTION can_view_notification(
  p_client text,
  p_target_role text,
  p_target_user text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN p_target_user IS NOT NULL AND p_target_user != '' THEN
        p_target_user = current_user_id()
      WHEN p_target_role IS NOT NULL AND p_target_role != '' THEN
        is_internal_user() AND current_user_nivel() = p_target_role
      WHEN is_internal_user() THEN
        true
      ELSE
        p_client = current_user_cliente()
    END
$$;

-- ============================================================================
-- 7. RLS
-- ============================================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select" ON notifications;
DROP POLICY IF EXISTS "notifications_insert" ON notifications;
DROP POLICY IF EXISTS "notifications_update" ON notifications;
DROP POLICY IF EXISTS "notifications_delete" ON notifications;

CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (
  can_view_notification(client, target_role, target_user)
);

CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (false);
CREATE POLICY "notifications_update" ON notifications FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY "notifications_delete" ON notifications FOR DELETE USING (false);

DROP POLICY IF EXISTS "notification_reads_select" ON notification_reads;
DROP POLICY IF EXISTS "notification_reads_insert" ON notification_reads;
DROP POLICY IF EXISTS "notification_reads_update" ON notification_reads;
DROP POLICY IF EXISTS "notification_reads_delete" ON notification_reads;

CREATE POLICY "notification_reads_select" ON notification_reads FOR SELECT USING (
  user_id = current_user_id()
);

CREATE POLICY "notification_reads_insert" ON notification_reads FOR INSERT WITH CHECK (
  user_id = current_user_id()
);

CREATE POLICY "notification_reads_update" ON notification_reads FOR UPDATE USING (
  user_id = current_user_id()
) WITH CHECK (
  user_id = current_user_id()
);

CREATE POLICY "notification_reads_delete" ON notification_reads FOR DELETE USING (
  user_id = current_user_id()
);

-- ============================================================================
-- 8. RPC — Criar notificação (único ponto de INSERT)
-- ============================================================================
CREATE OR REPLACE FUNCTION create_notification(
  p_title         text,
  p_message       text,
  p_type          notification_type DEFAULT 'info',
  p_priority      notification_priority DEFAULT 'normal',
  p_event         text DEFAULT '',
  p_entity_type   text DEFAULT NULL,
  p_entity_id     text DEFAULT NULL,
  p_related_op    text DEFAULT NULL,
  p_related_table text DEFAULT NULL,
  p_action_url    text DEFAULT NULL,
  p_client        text DEFAULT '',
  p_target_role   text DEFAULT NULL,
  p_target_user   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
  v_id text;
BEGIN
  v_session := get_current_session();
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sessão inválida ou expirada.');
  END IF;

  IF p_client IS NULL OR p_client = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'client é obrigatório.');
  END IF;

  INSERT INTO notifications (
    title, message, type, priority, event,
    entity_type, entity_id, related_op, related_table, action_url,
    client, target_role, target_user, created_by
  ) VALUES (
    p_title, p_message, p_type, p_priority, p_event,
    p_entity_type, p_entity_id, p_related_op, p_related_table, p_action_url,
    p_client, p_target_role, p_target_user,
    v_session ->> 'user_id'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- ============================================================================
-- 9. RPC — Marcar notificação como lida
-- ============================================================================
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id text;
  v_notif notifications%ROWTYPE;
BEGIN
  v_user_id := current_user_id();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sessão inválida.');
  END IF;

  SELECT * INTO v_notif FROM notifications WHERE id = p_notification_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Notificação não encontrada.');
  END IF;

  IF NOT can_view_notification(v_notif.client, v_notif.target_role, v_notif.target_user) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão.');
  END IF;

  INSERT INTO notification_reads (notification_id, user_id)
  VALUES (p_notification_id, v_user_id)
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 10. RPC — Marcar todas como lidas
-- ============================================================================
CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id text;
  v_count int;
BEGIN
  v_user_id := current_user_id();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sessão inválida.');
  END IF;

  INSERT INTO notification_reads (notification_id, user_id)
  SELECT n.id, v_user_id
  FROM notifications n
  WHERE can_view_notification(n.client, n.target_role, n.target_user)
    AND NOT EXISTS (
      SELECT 1 FROM notification_reads nr
      WHERE nr.notification_id = n.id AND nr.user_id = v_user_id
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'marked', v_count);
END;
$$;

-- ============================================================================
-- 11. RPC — Contagem de não lidas
-- ============================================================================
CREATE OR REPLACE FUNCTION get_unread_notification_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM notifications n
  WHERE can_view_notification(n.client, n.target_role, n.target_user)
    AND NOT EXISTS (
      SELECT 1 FROM notification_reads nr
      WHERE nr.notification_id = n.id
        AND nr.user_id = current_user_id()
    )
$$;

-- ============================================================================
-- 12. PERMISSÕES — PostgREST (role anon)
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
