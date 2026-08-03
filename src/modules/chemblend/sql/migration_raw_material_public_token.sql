-- ============================================================
-- Migration: Token público para etiquetas de Estoque de MP
-- Permite QR Code → /consulta/:token com dados do item de estoque
-- Reexecute este arquivo no SQL Editor do Supabase para atualizar a RPC.
-- ============================================================

ALTER TABLE raw_material_stocks ADD COLUMN IF NOT EXISTS public_token text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_material_stocks_public_token
  ON raw_material_stocks (public_token)
  WHERE public_token IS NOT NULL;

-- Normaliza jsonb que pode vir como array ou string JSON (legado)
CREATE OR REPLACE FUNCTION normalize_jsonb_array(j jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parsed jsonb;
BEGIN
  IF j IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF jsonb_typeof(j) = 'array' THEN
    RETURN j;
  END IF;

  IF jsonb_typeof(j) = 'string' THEN
    BEGIN
      IF COALESCE(btrim(j #>> '{}'), '') = '' THEN
        RETURN '[]'::jsonb;
      END IF;
      parsed := (j #>> '{}')::jsonb;
      IF jsonb_typeof(parsed) = 'array' THEN
        RETURN parsed;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN '[]'::jsonb;
    END;
  END IF;

  RETURN '[]'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION safe_jsonb_numeric(v text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN
    RETURN NULL;
  END IF;
  RETURN replace(btrim(v), ',', '.')::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  stock_row raw_material_stocks%ROWTYPE;
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
  FROM raw_material_stocks s
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
      FROM productions p
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
      FROM stock_movements m
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

GRANT EXECUTE ON FUNCTION normalize_jsonb_array(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION safe_jsonb_numeric(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;
