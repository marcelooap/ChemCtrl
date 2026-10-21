-- =============================================================================
-- 056_rename_ind_estoque_mp.sql
-- Renomeia ind_estoque_mp -> estoque_mp.
-- Idempotente. Dados, grants, RLS, trigger de entry_id e a publication
-- acompanham o OID.
-- Recria as funções cujo corpo cita o nome antigo:
--   adjust_raw_material_stock, optimistic_update_estoque_mp,
--   optimistic_update_row (lista de tabelas) e get_public_raw_material_info.
-- Aplicar junto com o app que aponta RawMaterialStock para o nome novo
-- (fallback temporário: ind_estoque_mp).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.estoque_mp') IS NOT NULL
     AND to_regclass('public.ind_estoque_mp') IS NOT NULL THEN
    RAISE EXCEPTION 'estoque_mp e ind_estoque_mp existem ao mesmo tempo. Mantenha só a tabela com os dados.';
  END IF;

  IF to_regclass('public.estoque_mp') IS NULL
     AND to_regclass('public.ind_estoque_mp') IS NOT NULL THEN
    ALTER TABLE public.ind_estoque_mp RENAME TO estoque_mp;
  ELSIF to_regclass('public.estoque_mp') IS NULL THEN
    RAISE EXCEPTION '056: tabela ind_estoque_mp nao encontrada';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_ind_estoque_mp_mp_code') IS NOT NULL
     AND to_regclass('public.idx_estoque_mp_mp_code') IS NULL THEN
    ALTER INDEX public.idx_ind_estoque_mp_mp_code RENAME TO idx_estoque_mp_mp_code;
  END IF;

  IF to_regclass('public.idx_ind_estoque_mp_status_wms') IS NOT NULL
     AND to_regclass('public.idx_estoque_mp_status_wms') IS NULL THEN
    ALTER INDEX public.idx_ind_estoque_mp_status_wms RENAME TO idx_estoque_mp_status_wms;
  END IF;

  IF to_regclass('public.idx_ind_estoque_mp_public_token') IS NOT NULL
     AND to_regclass('public.idx_estoque_mp_public_token') IS NULL THEN
    ALTER INDEX public.idx_ind_estoque_mp_public_token RENAME TO idx_estoque_mp_public_token;
  END IF;

  IF to_regclass('public.idx_ind_estoque_mp_client_lot') IS NOT NULL
     AND to_regclass('public.idx_estoque_mp_client_lot') IS NULL THEN
    ALTER INDEX public.idx_ind_estoque_mp_client_lot RENAME TO idx_estoque_mp_client_lot;
  END IF;

  IF to_regclass('public.idx_ind_estoque_mp_status_expiry') IS NOT NULL
     AND to_regclass('public.idx_estoque_mp_status_expiry') IS NULL THEN
    ALTER INDEX public.idx_ind_estoque_mp_status_expiry RENAME TO idx_estoque_mp_status_expiry;
  END IF;

  IF to_regclass('public.uq_ind_estoque_mp_entry_id') IS NOT NULL
     AND to_regclass('public.uq_estoque_mp_entry_id') IS NULL THEN
    ALTER INDEX public.uq_ind_estoque_mp_entry_id RENAME TO uq_estoque_mp_entry_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_ind_estoque_mp'
      AND tgrelid = 'public.estoque_mp'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_ind_estoque_mp ON public.estoque_mp
      RENAME TO update_updated_date_estoque_mp;
  ELSIF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_raw_material_stocks'
      AND tgrelid = 'public.estoque_mp'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_raw_material_stocks ON public.estoque_mp
      RENAME TO update_updated_date_estoque_mp;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'estoque_mp'
      AND policyname = 'allow_all_ind_estoque_mp'
  ) THEN
    ALTER POLICY "allow_all_ind_estoque_mp" ON public.estoque_mp
      RENAME TO "allow_all_estoque_mp";
  END IF;
END $$;

CREATE OR REPLACE FUNCTION adjust_raw_material_stock(
  p_stock_id text,
  p_delta numeric,
  p_require_sufficient boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estoque_mp%ROWTYPE;
  v_before numeric;
  v_after numeric;
BEGIN
  IF p_stock_id IS NULL OR btrim(p_stock_id) = '' THEN
    RAISE EXCEPTION 'stock_id obrigatório' USING ERRCODE = '22023';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta inválido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM estoque_mp
  WHERE id::text = p_stock_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estoque MP não encontrado: %', p_stock_id USING ERRCODE = 'P0002';
  END IF;

  v_before := COALESCE(v_row.current_stock, 0);
  v_after := round((v_before + p_delta)::numeric, 3);

  IF p_require_sufficient AND p_delta < 0 AND v_after < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente (disponível %, solicitado %)',
      v_before, abs(p_delta)
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_require_sufficient AND v_after < 0 THEN
    v_after := 0;
  END IF;

  UPDATE estoque_mp
  SET current_stock = v_after,
      updated_date = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'entry_id', v_row.entry_id,
    'balance_before', v_before,
    'balance_after', v_after,
    'delta', p_delta
  );
EXCEPTION
  WHEN undefined_column THEN
    UPDATE estoque_mp
    SET current_stock = v_after
    WHERE id = v_row.id;
    RETURN jsonb_build_object(
      'id', v_row.id,
      'entry_id', v_row.entry_id,
      'balance_before', v_before,
      'balance_after', v_after,
      'delta', p_delta
    );
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_raw_material_stock(text, numeric, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION optimistic_update_estoque_mp(
  p_id text,
  p_expected_updated timestamptz,
  p_current_stock numeric DEFAULT NULL,
  p_lot text DEFAULT NULL,
  p_status_wms text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estoque_mp%ROWTYPE;
BEGIN
  UPDATE estoque_mp
  SET
    current_stock = COALESCE(p_current_stock, current_stock),
    lot = COALESCE(p_lot, lot),
    status_wms = COALESCE(p_status_wms, status_wms),
    updated_date = now()
  WHERE id::text = p_id
    AND updated_date IS NOT DISTINCT FROM p_expected_updated
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', true,
      'message', 'Estoque alterado por outro usuário. Recarregue e tente novamente.'
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', to_jsonb(v_row));
EXCEPTION WHEN undefined_column THEN
  UPDATE estoque_mp
  SET current_stock = COALESCE(p_current_stock, current_stock)
  WHERE id::text = p_id
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', to_jsonb(v_row));
END;
$$;

GRANT EXECUTE ON FUNCTION optimistic_update_estoque_mp(text, timestamptz, numeric, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION optimistic_update_row(
  p_table text,
  p_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sql text;
  v_row jsonb;
  v_allowed text[] := ARRAY[
    'ind_lista_producoes',
    'estoque_mp',
    'ind_lista_vasilhames',
    't_saidas',
    't_estoque',
    't_vasilhames',
    't_transbordos'
  ];
  v_ts_col text;
BEGIN
  IF p_table IS NULL OR p_table <> ALL (v_allowed) THEN
    RAISE EXCEPTION 'Tabela não permitida para optimistic update: %', p_table;
  END IF;

  v_ts_col := CASE
    WHEN p_table LIKE 't_%' THEN 'updated_at'
    ELSE 'updated_date'
  END;

  v_sql := format(
    'UPDATE %I SET %s = now() WHERE id::text = $1 AND %I IS NOT DISTINCT FROM $2 RETURNING to_jsonb(%I.*)',
    p_table,
    v_ts_col,
    v_ts_col,
    p_table
  );

  EXECUTE format(
    'UPDATE %I AS t SET %s = COALESCE(t.%s, now()) FROM (SELECT $3 AS patch) p
     WHERE t.id::text = $1
       AND t.%I IS NOT DISTINCT FROM $2
     RETURNING to_jsonb(t.*)',
    p_table, v_ts_col, v_ts_col, v_ts_col
  ) INTO v_row USING p_id, p_expected_updated_at, p_patch;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', true,
      'message', 'Registro alterado por outro usuário. Recarregue e tente novamente.'
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION optimistic_update_row(text, text, timestamptz, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  stock_row estoque_mp%ROWTYPE;
  productions_json jsonb := '[]'::jsonb;
  movements_json jsonb := '[]'::jsonb;
BEGIN
  PERFORM enforce_public_rate_limit('get_public_raw_material_info');

  BEGIN
    PERFORM set_config('row_security', 'off', true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  SELECT * INTO stock_row
  FROM estoque_mp s
  WHERE s.public_token = p_token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
    INTO productions_json
    FROM (
      SELECT
        p.op_number,
        p.product,
        p.date,
        safe_jsonb_numeric(elem->>'qty_fiscal') AS qty_fiscal,
        safe_jsonb_numeric(elem->>'qty_operational') AS qty_operational
      FROM ind_lista_producoes p
      CROSS JOIN LATERAL jsonb_array_elements(normalize_jsonb_array(p.raw_materials_used)) AS elem
      WHERE COALESCE(p.status, '') <> 'Cancelado'
        AND elem->>'stock_id' = stock_row.id
      ORDER BY p.date DESC NULLS LAST
    ) q;
  EXCEPTION WHEN OTHERS THEN
    productions_json := '[]'::jsonb;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
    INTO movements_json
    FROM (
      SELECT
        m.movement_date,
        m.destination,
        m.quantity,
        m.unit,
        m.balance_before,
        m.balance_after
      FROM ind_retornos_perdas m
      WHERE m.stock_id = stock_row.id
         OR (
           m.entry_id IS NOT NULL
           AND stock_row.entry_id IS NOT NULL
           AND m.entry_id = stock_row.entry_id
         )
      ORDER BY m.movement_date DESC NULLS LAST
    ) q;
  EXCEPTION WHEN OTHERS THEN
    movements_json := '[]'::jsonb;
  END;

  result := jsonb_build_object(
    'type', 'raw_material',
    'entry_id', stock_row.entry_id,
    'entry_date', stock_row.entry_date,
    'mp_code', stock_row.mp_code,
    'mp_name', stock_row.mp_name,
    'client', stock_row.client,
    'lot', stock_row.lot,
    'supplier', stock_row.supplier,
    'manufacture_date', stock_row.manufacture_date,
    'expiry_date', stock_row.expiry_date,
    'unit', stock_row.unit,
    'initial_stock', stock_row.initial_stock,
    'current_stock', stock_row.current_stock,
    'unit_price', stock_row.unit_price,
    'packaging_type', stock_row.packaging_type,
    'packaging_capacity', stock_row.packaging_capacity,
    'packaging_quantity', stock_row.packaging_quantity,
    'observations', stock_row.observations,
    'productions', COALESCE(productions_json, '[]'::jsonb),
    'movements', COALESCE(movements_json, '[]'::jsonb)
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;

ALTER TABLE public.estoque_mp REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.estoque_mp';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
