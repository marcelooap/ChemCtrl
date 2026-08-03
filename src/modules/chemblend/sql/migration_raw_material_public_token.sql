-- ============================================================
-- Migration: Token público para etiquetas de Estoque de MP
-- Permite QR Code → /consulta/:token com dados do item de estoque
-- ============================================================

-- 1. Coluna public_token
ALTER TABLE raw_material_stocks ADD COLUMN IF NOT EXISTS public_token text;

-- 2. Índice único para lookup rápido
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_material_stocks_public_token
  ON raw_material_stocks (public_token)
  WHERE public_token IS NOT NULL;

-- 3. RPC pública: espelha os dados do RawMaterialViewDialog
--    (identidade, embalagem, OPs que usaram o lote, movimentações)
CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Rate limit alinhado às demais RPCs públicas (migration_rate_limiting_helpers)
  PERFORM enforce_public_rate_limit('get_public_raw_material_info');

  SELECT jsonb_build_object(
    'type', 'raw_material',
    'entry_id', s.entry_id,
    'entry_date', s.entry_date,
    'mp_code', s.mp_code,
    'mp_name', s.mp_name,
    'client', s.client,
    'lot', s.lot,
    'supplier', s.supplier,
    'manufacture_date', s.manufacture_date,
    'expiry_date', s.expiry_date,
    'unit', s.unit,
    'initial_stock', s.initial_stock,
    'current_stock', s.current_stock,
    'unit_price', s.unit_price,
    'packaging_type', s.packaging_type,
    'packaging_capacity', s.packaging_capacity,
    'packaging_quantity', s.packaging_quantity,
    'observations', s.observations,
    'productions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'op_number', p.op_number,
          'product', p.product,
          'date', p.date,
          'qty_fiscal', NULLIF(mp.elem->>'qty_fiscal', '')::numeric,
          'qty_operational', NULLIF(mp.elem->>'qty_operational', '')::numeric
        )
        ORDER BY p.date DESC NULLS LAST
      )
      FROM productions p
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN p.raw_materials_used IS NULL THEN '[]'::jsonb
          WHEN jsonb_typeof(p.raw_materials_used) = 'array' THEN p.raw_materials_used
          ELSE '[]'::jsonb
        END
      ) AS mp(elem)
      WHERE p.status IS DISTINCT FROM 'Cancelado'
        AND mp.elem->>'stock_id' = s.id
    ), '[]'::jsonb),
    'movements', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'movement_date', m.movement_date,
          'destination', m.destination,
          'quantity', m.quantity,
          'unit', m.unit,
          'balance_before', m.balance_before,
          'balance_after', m.balance_after
        )
        ORDER BY m.movement_date DESC NULLS LAST
      )
      FROM stock_movements m
      WHERE m.stock_id = s.id
    ), '[]'::jsonb)
  )
  INTO result
  FROM raw_material_stocks s
  WHERE s.public_token = p_token;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;
