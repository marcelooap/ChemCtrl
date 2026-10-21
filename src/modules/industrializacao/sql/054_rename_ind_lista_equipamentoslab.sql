-- =============================================================================
-- 054_rename_ind_lista_equipamentoslab.sql
-- Renomeia ind_lista_equipamentoslab -> cadastro_equipamentolab.
-- Idempotente. Dados, grants, RLS e a publication acompanham o OID.
-- Recria get_public_equipment_info, que guarda o nome da tabela no corpo.
-- Aplicar junto com o app que aponta LabEquipment para o nome novo
-- (fallback temporário: ind_lista_equipamentoslab).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cadastro_equipamentolab') IS NOT NULL
     AND to_regclass('public.ind_lista_equipamentoslab') IS NOT NULL THEN
    RAISE EXCEPTION 'cadastro_equipamentolab e ind_lista_equipamentoslab existem ao mesmo tempo. Mantenha só a tabela com os dados.';
  END IF;

  IF to_regclass('public.cadastro_equipamentolab') IS NULL
     AND to_regclass('public.ind_lista_equipamentoslab') IS NOT NULL THEN
    ALTER TABLE public.ind_lista_equipamentoslab RENAME TO cadastro_equipamentolab;
  ELSIF to_regclass('public.cadastro_equipamentolab') IS NULL THEN
    RAISE EXCEPTION '054: tabela ind_lista_equipamentoslab nao encontrada';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.uq_ind_lista_equipamentoslab_public_token') IS NOT NULL
     AND to_regclass('public.uq_cadastro_equipamentolab_public_token') IS NULL THEN
    ALTER INDEX public.uq_ind_lista_equipamentoslab_public_token
      RENAME TO uq_cadastro_equipamentolab_public_token;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_ind_lista_equipamentoslab'
      AND tgrelid = 'public.cadastro_equipamentolab'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_ind_lista_equipamentoslab
      ON public.cadastro_equipamentolab
      RENAME TO update_updated_date_cadastro_equipamentolab;
  ELSIF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_lab_equipments'
      AND tgrelid = 'public.cadastro_equipamentolab'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_lab_equipments
      ON public.cadastro_equipamentolab
      RENAME TO update_updated_date_cadastro_equipamentolab;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cadastro_equipamentolab'
      AND policyname = 'allow_all_ind_lista_equipamentoslab'
  ) THEN
    ALTER POLICY "allow_all_ind_lista_equipamentoslab"
      ON public.cadastro_equipamentolab
      RENAME TO "allow_all_cadastro_equipamentolab";
  ELSIF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cadastro_equipamentolab'
      AND policyname = 'lab_equipments_all'
  ) THEN
    ALTER POLICY "lab_equipments_all"
      ON public.cadastro_equipamentolab
      RENAME TO "allow_all_cadastro_equipamentolab";
  END IF;
END $$;

CREATE OR REPLACE FUNCTION get_public_equipment_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row cadastro_equipamentolab%ROWTYPE;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  PERFORM enforce_public_rate_limit('get_public_equipment_info');

  BEGIN
    PERFORM set_config('row_security', 'off', true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  SELECT * INTO v_row
  FROM cadastro_equipamentolab
  WHERE public_token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'kind', 'equipment',
    'name', v_row.name,
    'type', v_row.type,
    'manufacturer', v_row.manufacturer,
    'model', v_row.model,
    'serial_number', v_row.serial_number,
    'patrimony_number', v_row.patrimony_number,
    'location', v_row.location,
    'responsible', v_row.responsible,
    'lab_responsible', v_row.lab_responsible,
    'certificate_number', v_row.certificate_number,
    'last_calibration_date', v_row.last_calibration_date,
    'next_calibration_date', v_row.next_calibration_date,
    'calibration_company', v_row.calibration_company,
    'calibration_responsible', v_row.calibration_responsible,
    'observations', v_row.observations,
    'certificate_url', NULLIF(btrim(v_row.certificate_url), ''),
    'calibration_history', COALESCE(v_row.calibration_history, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_equipment_info(text) TO anon, authenticated;

ALTER TABLE public.cadastro_equipamentolab REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cadastro_equipamentolab';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
