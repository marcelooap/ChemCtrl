-- ============================================================================
-- Onda 1 — RPCs atômicas de baixa / restauração de estoque de MP
-- Evita lost-update (read-modify-write no cliente).
-- ============================================================================

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
  v_row ind_estoque_mp%ROWTYPE;
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
  FROM ind_estoque_mp
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

  -- Nunca deixa negativo se require_sufficient=false e delta negativo
  IF NOT p_require_sufficient AND v_after < 0 THEN
    v_after := 0;
  END IF;

  UPDATE ind_estoque_mp
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
    -- fallback se a coluna temporal for updated_at
    UPDATE ind_estoque_mp
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

-- Atalhos semânticos
CREATE OR REPLACE FUNCTION deduct_raw_material_stock(
  p_stock_id text,
  p_qty numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'quantidade deve ser positiva' USING ERRCODE = '22023';
  END IF;
  RETURN adjust_raw_material_stock(p_stock_id, -abs(p_qty), true);
END;
$$;
GRANT EXECUTE ON FUNCTION deduct_raw_material_stock(text, numeric) TO anon, authenticated;

CREATE OR REPLACE FUNCTION restore_raw_material_stock(
  p_stock_id text,
  p_qty numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'quantidade deve ser positiva' USING ERRCODE = '22023';
  END IF;
  RETURN adjust_raw_material_stock(p_stock_id, abs(p_qty), false);
END;
$$;
GRANT EXECUTE ON FUNCTION restore_raw_material_stock(text, numeric) TO anon, authenticated;

-- Baixa em lote (uma transação): [{ "stock_id": "...", "qty": 1.5 }, ...]
CREATE OR REPLACE FUNCTION deduct_raw_material_stock_batch(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items deve ser um array JSON' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_result := deduct_raw_material_stock(
      v_item ->> 'stock_id',
      (v_item ->> 'qty')::numeric
    );
    v_results := v_results || jsonb_build_array(v_result);
  END LOOP;

  RETURN v_results;
END;
$$;
GRANT EXECUTE ON FUNCTION deduct_raw_material_stock_batch(jsonb) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
