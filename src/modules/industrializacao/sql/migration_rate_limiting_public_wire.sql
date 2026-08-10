-- ============================================================================
-- Migration: Rate Limiting — Proteção das RPCs públicas de consulta (QR Code)
--
-- Pré-requisito: migration_rate_limiting_helpers.sql (Fase 1) já aplicada
-- (usa enforce_public_rate_limit, criada naquele arquivo).
--
-- Estas 3 funções são `LANGUAGE sql` (não plpgsql), então a proteção é
-- aplicada com uma CTE de guarda: `enforce_public_rate_limit(...)` é chamada
-- primeiro (dentro do WITH); se ela levantar a exceção PT429, a consulta
-- principal nunca chega a executar. O SELECT de dados abaixo é EXATAMENTE
-- o mesmo das versões atuais (migration_public_sds_legacy.sql /
-- migration_public_traceability.sql) — nenhuma regra de negócio foi alterada,
-- apenas a guarda de rate limit foi adicionada no início.
--
-- Limite: 30 requisições/minuto por IP e por endpoint (ver rateLimitConfig.ts
-- PUBLIC_LIMIT/PUBLIC_WINDOW_MS e migration_rate_limiting_helpers.sql).
-- ============================================================================

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
  FROM guard, productions p
  LEFT JOIN recipes r ON r.id = p.recipe_id
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
      FROM containers c WHERE c.op_number = p.op_number),
      '[]'::jsonb
    ),
    'recipe', jsonb_build_object(
      'validity_days', r.validity_days
    )
  )
  FROM guard, productions p
  JOIN quality_results qr ON qr.production_id = p.id
  LEFT JOIN recipes r ON r.id = p.recipe_id
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado'
  ORDER BY qr.updated_date DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_public_sds_path(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_sds_path'))
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
  FROM guard, productions p
  LEFT JOIN LATERAL resolve_recipe_fds_for_production(p.id) f ON true
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_public_lot_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_coa_data(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_sds_path(text) TO anon, authenticated, service_role;

-- ============================================================================
-- TESTE MANUAL
-- ============================================================================
-- Chame get_public_lot_info(token_valido) 31 vezes em <60s (mesmo IP/sessão de
-- teste) — a partir da 31ª deve retornar HTTP 429 com "Muitas requisições.
-- Aguarde alguns segundos.". Aguarde 60s e confirme que volta a funcionar.
-- ============================================================================
