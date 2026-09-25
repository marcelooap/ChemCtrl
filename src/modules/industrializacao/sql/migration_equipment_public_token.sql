-- Token público da etiqueta de equipamento de laboratório.
-- QR → /consulta-equipamento/:token
-- Execute no SQL Editor do Supabase.

ALTER TABLE ind_lista_equipamentoslab
  ADD COLUMN IF NOT EXISTS public_token text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ind_lista_equipamentoslab_public_token
  ON ind_lista_equipamentoslab (public_token)
  WHERE public_token IS NOT NULL;

CREATE OR REPLACE FUNCTION get_public_equipment_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row ind_lista_equipamentoslab%ROWTYPE;
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
  FROM ind_lista_equipamentoslab
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

DO $$ BEGIN
  CREATE POLICY "equipamentos_lab_anon_select" ON storage.objects
    FOR SELECT TO anon
    USING (bucket_id = 'equipamentos-lab');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
