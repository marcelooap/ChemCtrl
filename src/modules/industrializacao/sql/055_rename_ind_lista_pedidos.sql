-- =============================================================================
-- 055_rename_ind_lista_pedidos.sql
-- Renomeia ind_lista_pedidos -> cadastro_pedidos_ind.
-- Idempotente. Dados, grants, RLS, triggers e a publication acompanham o OID.
-- O trigger de client_order continua na tabela e atualiza ind_lista_producoes.
-- Aplicar junto com o app que aponta Order para o nome novo
-- (fallback temporário: ind_lista_pedidos).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cadastro_pedidos_ind') IS NOT NULL
     AND to_regclass('public.ind_lista_pedidos') IS NOT NULL THEN
    RAISE EXCEPTION 'cadastro_pedidos_ind e ind_lista_pedidos existem ao mesmo tempo. Mantenha só a tabela com os dados.';
  END IF;

  IF to_regclass('public.cadastro_pedidos_ind') IS NULL
     AND to_regclass('public.ind_lista_pedidos') IS NOT NULL THEN
    ALTER TABLE public.ind_lista_pedidos RENAME TO cadastro_pedidos_ind;
  ELSIF to_regclass('public.cadastro_pedidos_ind') IS NULL THEN
    RAISE EXCEPTION '055: tabela ind_lista_pedidos nao encontrada';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_ind_lista_pedidos_status') IS NOT NULL
     AND to_regclass('public.idx_cadastro_pedidos_ind_status') IS NULL THEN
    ALTER INDEX public.idx_ind_lista_pedidos_status
      RENAME TO idx_cadastro_pedidos_ind_status;
  END IF;

  IF to_regclass('public.idx_ind_lista_pedidos_client') IS NOT NULL
     AND to_regclass('public.idx_cadastro_pedidos_ind_client') IS NULL THEN
    ALTER INDEX public.idx_ind_lista_pedidos_client
      RENAME TO idx_cadastro_pedidos_ind_client;
  END IF;

  IF to_regclass('public.idx_ind_lista_pedidos_created') IS NOT NULL
     AND to_regclass('public.idx_cadastro_pedidos_ind_created') IS NULL THEN
    ALTER INDEX public.idx_ind_lista_pedidos_created
      RENAME TO idx_cadastro_pedidos_ind_created;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_ind_lista_pedidos'
      AND tgrelid = 'public.cadastro_pedidos_ind'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_ind_lista_pedidos
      ON public.cadastro_pedidos_ind
      RENAME TO update_updated_date_cadastro_pedidos_ind;
  ELSIF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_orders'
      AND tgrelid = 'public.cadastro_pedidos_ind'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_orders
      ON public.cadastro_pedidos_ind
      RENAME TO update_updated_date_cadastro_pedidos_ind;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cadastro_pedidos_ind'
      AND policyname = 'allow_all_ind_lista_pedidos'
  ) THEN
    ALTER POLICY "allow_all_ind_lista_pedidos"
      ON public.cadastro_pedidos_ind
      RENAME TO "allow_all_cadastro_pedidos_ind";
  END IF;
END $$;

ALTER TABLE public.cadastro_pedidos_ind REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cadastro_pedidos_ind';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
