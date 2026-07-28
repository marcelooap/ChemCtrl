-- ============================================================
-- Migration: FDS pública com fallback para produções legadas
-- Resolve FDS por recipe_id OU por product_name (estoque antigo)
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

-- Resolve receita com FDS para uma produção:
-- 1) recipe_id direto (se tem fds_url)
-- 2) fallback: receita do mesmo product_name com fds_url (mais recente)
CREATE OR REPLACE FUNCTION resolve_recipe_fds_for_production(p_production_id text)
RETURNS TABLE(fds_url text, fds_filename text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH prod AS (
    SELECT id, recipe_id, product
    FROM productions
    WHERE id = p_production_id
  ),
  by_recipe_id AS (
    SELECT r.fds_url, r.fds_filename
    FROM prod p
    JOIN recipes r ON r.id = p.recipe_id
    WHERE r.fds_url IS NOT NULL AND r.fds_url <> ''
    LIMIT 1
  ),
  by_product_name AS (
    SELECT r.fds_url, r.fds_filename
    FROM prod p
    JOIN recipes r ON r.product_name = p.product
    WHERE r.fds_url IS NOT NULL AND r.fds_url <> ''
    ORDER BY r.fds_uploaded_at DESC NULLS LAST, r.updated_date DESC NULLS LAST
    LIMIT 1
  )
  SELECT * FROM by_recipe_id
  UNION ALL
  SELECT * FROM by_product_name
  WHERE NOT EXISTS (SELECT 1 FROM by_recipe_id)
  LIMIT 1;
$$;

-- Atualizar get_public_lot_info — has_sds via resolução legada
CREATE OR REPLACE FUNCTION get_public_lot_info(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'product', p.product,
    'client', p.client,
    'lot', p.lot,
    'mfg_date', p.end_time,
    'expiry_date', CASE
      WHEN p.end_time IS NOT NULL AND r.validity_days IS NOT NULL
      THEN (p.end_time::date + (r.validity_days || ' day')::interval)::text
      ELSE NULL
    END,
    'status', p.status,
    'op_number', p.op_number,
    'has_coa', EXISTS(
      SELECT 1 FROM quality_results qr
      WHERE qr.production_id = p.id
        AND qr.results IS NOT NULL
        AND qr.results::text NOT IN ('[]', 'null', '')
    ),
    'has_sds', EXISTS(
      SELECT 1 FROM resolve_recipe_fds_for_production(p.id)
    )
  )
  FROM productions p
  LEFT JOIN recipes r ON r.id = p.recipe_id
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado';
$$;

-- Atualizar get_public_sds_path — path FDS via resolução legada
CREATE OR REPLACE FUNCTION get_public_sds_path(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN f.fds_url IS NOT NULL AND f.fds_url <> '' THEN
      jsonb_build_object(
        'has_sds', true,
        'fds_url', f.fds_url,
        'fds_filename', COALESCE(f.fds_filename, 'sds.pdf')
      )
    ELSE
      jsonb_build_object('has_sds', false)
  END
  FROM productions p
  LEFT JOIN LATERAL resolve_recipe_fds_for_production(p.id) f ON true
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION resolve_recipe_fds_for_production(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_public_lot_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_sds_path(text) TO anon, authenticated, service_role;
