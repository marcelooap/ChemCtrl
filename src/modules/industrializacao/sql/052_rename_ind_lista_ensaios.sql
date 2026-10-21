-- =============================================================================
-- 052_rename_ind_lista_ensaios.sql
-- Renomeia ind_lista_ensaios -> cadastro_analises_metodologia
-- (catálogo da Lista de Ensaios: nome, metodologia e unidade).
-- Idempotente. Dados, grants, RLS e a publication acompanham o OID.
-- Aplicar junto com o app que aponta QualityAnalysis para o nome novo
-- (fallback temporário: ind_lista_ensaios).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cadastro_analises_metodologia') IS NOT NULL
     AND to_regclass('public.ind_lista_ensaios') IS NOT NULL THEN
    RAISE EXCEPTION 'cadastro_analises_metodologia e ind_lista_ensaios existem ao mesmo tempo. Mantenha só a tabela com os dados.';
  END IF;

  IF to_regclass('public.cadastro_analises_metodologia') IS NULL
     AND to_regclass('public.ind_lista_ensaios') IS NOT NULL THEN
    ALTER TABLE public.ind_lista_ensaios RENAME TO cadastro_analises_metodologia;
  ELSIF to_regclass('public.cadastro_analises_metodologia') IS NULL THEN
    RAISE EXCEPTION '052: tabela ind_lista_ensaios nao encontrada';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ind_lista_ensaios_name_unique'
      AND conrelid = 'public.cadastro_analises_metodologia'::regclass
  ) THEN
    ALTER TABLE public.cadastro_analises_metodologia
      RENAME CONSTRAINT ind_lista_ensaios_name_unique
      TO cadastro_analises_metodologia_name_unique;
  ELSIF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quality_analyses_name_unique'
      AND conrelid = 'public.cadastro_analises_metodologia'::regclass
  ) THEN
    ALTER TABLE public.cadastro_analises_metodologia
      RENAME CONSTRAINT quality_analyses_name_unique
      TO cadastro_analises_metodologia_name_unique;
  END IF;

  IF to_regclass('public.idx_quality_analyses_name') IS NOT NULL
     AND to_regclass('public.idx_cadastro_analises_metodologia_name') IS NULL THEN
    ALTER INDEX public.idx_quality_analyses_name
      RENAME TO idx_cadastro_analises_metodologia_name;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_updated_date_ind_lista_ensaios'
      AND tgrelid = 'public.cadastro_analises_metodologia'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_ind_lista_ensaios
      ON public.cadastro_analises_metodologia
      RENAME TO update_updated_date_cadastro_analises_metodologia;
  ELSIF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_updated_date_quality_analyses'
      AND tgrelid = 'public.cadastro_analises_metodologia'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_quality_analyses
      ON public.cadastro_analises_metodologia
      RENAME TO update_updated_date_cadastro_analises_metodologia;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cadastro_analises_metodologia'
      AND policyname = 'allow_all_ind_lista_ensaios'
  ) THEN
    ALTER POLICY "allow_all_ind_lista_ensaios"
      ON public.cadastro_analises_metodologia
      RENAME TO "allow_all_cadastro_analises_metodologia";
  ELSIF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cadastro_analises_metodologia'
      AND policyname = 'quality_analyses_all'
  ) THEN
    ALTER POLICY "quality_analyses_all"
      ON public.cadastro_analises_metodologia
      RENAME TO "allow_all_cadastro_analises_metodologia";
  END IF;
END $$;

ALTER TABLE public.cadastro_analises_metodologia REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cadastro_analises_metodologia';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
