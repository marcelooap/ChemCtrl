-- =============================================================================
-- 057_rename_ind_lista_inventario.sql
-- Renomeia ind_lista_inventario -> inventario.
-- Idempotente. Dados, grants, RLS e a publication acompanham o OID.
-- Aplicar junto com o app que aponta Inventory para o nome novo
-- (fallback temporário: ind_lista_inventario).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.inventario') IS NOT NULL
     AND to_regclass('public.ind_lista_inventario') IS NOT NULL THEN
    RAISE EXCEPTION 'inventario e ind_lista_inventario existem ao mesmo tempo. Mantenha só a tabela com os dados.';
  END IF;

  IF to_regclass('public.inventario') IS NULL
     AND to_regclass('public.ind_lista_inventario') IS NOT NULL THEN
    ALTER TABLE public.ind_lista_inventario RENAME TO inventario;
  ELSIF to_regclass('public.inventario') IS NULL THEN
    RAISE EXCEPTION '057: tabela ind_lista_inventario nao encontrada';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_ind_lista_inventario_status') IS NOT NULL
     AND to_regclass('public.idx_inventario_status') IS NULL THEN
    ALTER INDEX public.idx_ind_lista_inventario_status
      RENAME TO idx_inventario_status;
  ELSIF to_regclass('public.idx_inventories_status') IS NOT NULL
     AND to_regclass('public.idx_inventario_status') IS NULL THEN
    ALTER INDEX public.idx_inventories_status
      RENAME TO idx_inventario_status;
  END IF;

  IF to_regclass('public.idx_ind_lista_inventario_inventory_number') IS NOT NULL
     AND to_regclass('public.idx_inventario_inventory_number') IS NULL THEN
    ALTER INDEX public.idx_ind_lista_inventario_inventory_number
      RENAME TO idx_inventario_inventory_number;
  ELSIF to_regclass('public.idx_inventories_inventory_number') IS NOT NULL
     AND to_regclass('public.idx_inventario_inventory_number') IS NULL THEN
    ALTER INDEX public.idx_inventories_inventory_number
      RENAME TO idx_inventario_inventory_number;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_ind_lista_inventario'
      AND tgrelid = 'public.inventario'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_ind_lista_inventario ON public.inventario
      RENAME TO update_updated_date_inventario;
  ELSIF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_inventories'
      AND tgrelid = 'public.inventario'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_inventories ON public.inventario
      RENAME TO update_updated_date_inventario;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventario'
      AND policyname = 'allow_all_ind_lista_inventario'
  ) THEN
    ALTER POLICY "allow_all_ind_lista_inventario" ON public.inventario
      RENAME TO "allow_all_inventario";
  ELSIF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventario'
      AND policyname = 'allow_all_inventories'
  ) THEN
    ALTER POLICY "allow_all_inventories" ON public.inventario
      RENAME TO "allow_all_inventario";
  END IF;
END $$;

ALTER TABLE public.inventario REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.inventario';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
