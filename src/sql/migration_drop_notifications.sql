-- ============================================================
-- MIGRAÇÃO: Remover funcionalidade de notificações in-app
-- ============================================================
-- Execute no SQL Editor do Supabase após o deploy do frontend
-- que remove o módulo de notificações.
--
-- Remove: tabelas, RPCs, trigger, enums, publication Realtime
-- e a permissão notifications.view dos perfis.
-- ============================================================

-- 1. Remover da publication Realtime (ignora se não existir)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.notification_realtime_signals;
EXCEPTION WHEN undefined_object OR undefined_table OR OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.notifications;
EXCEPTION WHEN undefined_object OR undefined_table OR OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.notification_reads;
EXCEPTION WHEN undefined_object OR undefined_table OR OTHERS THEN NULL;
END $$;

-- 2. Trigger (se a tabela ainda existir)
DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_notification_realtime_signal ON public.notifications;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 3. RPCs / funções (por nome — independente da assinatura)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_notification',
        'mark_notification_read',
        'mark_all_notifications_read',
        'get_unread_notification_count',
        'can_view_notification',
        'emit_notification_realtime_signal'
      )
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- 4. Tabelas (ordem por FK)
DROP TABLE IF EXISTS public.notification_realtime_signals CASCADE;
DROP TABLE IF EXISTS public.notification_reads CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;

-- 5. Enums
DROP TYPE IF EXISTS public.notification_type CASCADE;
DROP TYPE IF EXISTS public.notification_priority CASCADE;

-- 6. Remover permissão do catálogo RBAC nos perfis existentes
DELETE FROM public.perfil_permissoes
WHERE permission_key = 'notifications.view';

SELECT pg_notify('pgrst', 'reload schema');
