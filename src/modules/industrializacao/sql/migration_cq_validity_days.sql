-- ============================================================
-- Validade do produto no Cadastro CQ (ind_cq_esp_tec)
-- A data de validade do lote / COA = data de fabricação + validity_days.
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

DO $$
DECLARE
  cq_table text;
  recipe_table text;
BEGIN
  IF to_regclass('public.ind_cq_esp_tec') IS NOT NULL THEN
    cq_table := 'ind_cq_esp_tec';
  ELSIF to_regclass('public.quality_tests') IS NOT NULL THEN
    cq_table := 'quality_tests';
  ELSE
    RAISE EXCEPTION 'Tabela de Cadastro CQ não encontrada (ind_cq_esp_tec / quality_tests)';
  END IF;

  EXECUTE format(
    'ALTER TABLE %I ADD COLUMN IF NOT EXISTS validity_days numeric',
    cq_table
  );
  EXECUTE format(
    'COMMENT ON COLUMN %I.validity_days IS %L',
    cq_table,
    'Dias de validade do produto. Data de validade do lote = data de fabricação + estes dias.'
  );

  IF to_regclass('public.ind_lista_receitas') IS NOT NULL THEN
    recipe_table := 'ind_lista_receitas';
  ELSIF to_regclass('public.recipes') IS NOT NULL THEN
    recipe_table := 'recipes';
  END IF;

  IF recipe_table IS NULL THEN
    RETURN;
  END IF;

  -- 1) Mesmo produto e mesmo cliente
  EXECUTE format($sql$
    UPDATE %I qt
    SET validity_days = src.validity_days
    FROM (
      SELECT DISTINCT ON (lower(trim(product_name)), lower(trim(coalesce(client, ''))))
        product_name,
        client,
        validity_days
      FROM %I
      WHERE validity_days IS NOT NULL AND validity_days > 0
      ORDER BY
        lower(trim(product_name)),
        lower(trim(coalesce(client, ''))),
        revision_number DESC NULLS LAST,
        updated_date DESC NULLS LAST
    ) src
    WHERE lower(trim(coalesce(qt.product, ''))) = lower(trim(coalesce(src.product_name, '')))
      AND lower(trim(coalesce(qt.client, ''))) = lower(trim(coalesce(src.client, '')))
      AND (qt.validity_days IS NULL OR qt.validity_days <= 0)
  $sql$, cq_table, recipe_table);

  -- 2) CQ ainda sem validade: última revisão do produto, independente do cliente
  EXECUTE format($sql$
    UPDATE %I qt
    SET validity_days = src.validity_days
    FROM (
      SELECT DISTINCT ON (lower(trim(product_name)))
        product_name,
        validity_days
      FROM %I
      WHERE validity_days IS NOT NULL AND validity_days > 0
      ORDER BY
        lower(trim(product_name)),
        revision_number DESC NULLS LAST,
        updated_date DESC NULLS LAST
    ) src
    WHERE lower(trim(coalesce(qt.product, ''))) = lower(trim(coalesce(src.product_name, '')))
      AND (qt.validity_days IS NULL OR qt.validity_days <= 0)
  $sql$, cq_table, recipe_table);
END $$;

-- Resolve os dias: Cadastro CQ primeiro; receita só como fallback de dados já existentes.
CREATE OR REPLACE FUNCTION ind_resolve_validity_days(p_product text, p_client text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT qt.validity_days
      FROM ind_cq_esp_tec qt
      WHERE lower(trim(coalesce(qt.product, ''))) = lower(trim(coalesce(p_product, '')))
        AND qt.validity_days IS NOT NULL
        AND qt.validity_days > 0
        AND (
          trim(coalesce(p_client, '')) = ''
          OR trim(coalesce(qt.client, '')) = ''
          OR lower(trim(qt.client)) = lower(trim(p_client))
        )
      ORDER BY
        CASE
          WHEN trim(coalesce(p_client, '')) <> ''
            AND lower(trim(coalesce(qt.client, ''))) = lower(trim(p_client)) THEN 0
          ELSE 1
        END,
        qt.updated_date DESC NULLS LAST,
        qt.created_date DESC NULLS LAST
      LIMIT 1
    ),
    (
      SELECT r.validity_days
      FROM ind_lista_receitas r
      WHERE lower(trim(coalesce(r.product_name, ''))) = lower(trim(coalesce(p_product, '')))
        AND r.validity_days IS NOT NULL
        AND r.validity_days > 0
      ORDER BY
        CASE
          WHEN trim(coalesce(p_client, '')) <> ''
            AND lower(trim(coalesce(r.client, ''))) = lower(trim(p_client)) THEN 0
          ELSE 1
        END,
        r.revision_number DESC NULLS LAST,
        r.updated_date DESC NULLS LAST
      LIMIT 1
    )
  );
$$;

REVOKE ALL ON FUNCTION ind_resolve_validity_days(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ind_resolve_validity_days(text, text) TO postgres, service_role;

CREATE OR REPLACE FUNCTION get_public_lot_info(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_lot_info'))
  SELECT jsonb_build_object(
    'product', p.product,
    'client', p.client,
    'lot', p.lot,
    'mfg_date', p.end_time,
    'expiry_date', CASE
      WHEN p.end_time IS NOT NULL AND v.validity_days IS NOT NULL
      THEN (p.end_time::date + (v.validity_days || ' day')::interval)::text
      ELSE NULL
    END,
    'status', p.status,
    'op_number', p.op_number,
    'has_coa', EXISTS(
      SELECT 1 FROM ind_cq_resultados qr
      WHERE qr.production_id = p.id
        AND qr.results IS NOT NULL
        AND qr.results::text NOT IN ('[]', 'null', '')
    ),
    'has_sds', EXISTS(
      SELECT 1 FROM resolve_recipe_fds_for_production(p.id)
    )
  )
  FROM guard, ind_lista_producoes p
  LEFT JOIN LATERAL (
    SELECT ind_resolve_validity_days(p.product, p.client) AS validity_days
  ) v ON true
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado';
$$;

CREATE OR REPLACE FUNCTION get_public_coa_data(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_coa_data'))
  SELECT jsonb_build_object(
    'result', jsonb_build_object(
      'product', qr.product,
      'lot', qr.lot,
      'client', qr.client,
      'op_number', qr.op_number,
      'observations', qr.observations,
      'results', qr.results,
      'sample_photo_url', null::text
    ),
    'production', jsonb_build_object(
      'end_time', p.end_time,
      'mass', p.mass,
      'client_order', p.client_order
    ),
    'containers', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'container_number', c.container_number,
        'barril_number', c.barril_number,
        'volume', c.volume
      ))
      FROM ind_lista_vasilhames c WHERE c.op_number = p.op_number),
      '[]'::jsonb
    ),
    'recipe', jsonb_build_object(
      'validity_days', ind_resolve_validity_days(
        COALESCE(qr.product, p.product),
        COALESCE(qr.client, p.client)
      )
    )
  )
  FROM guard, ind_lista_producoes p
  JOIN ind_cq_resultados qr ON qr.production_id = p.id
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado'
  ORDER BY qr.updated_date DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_public_lot_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_coa_data(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
