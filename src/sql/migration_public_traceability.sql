-- ============================================================
-- Migration: Rastreabilidade Pública via QR Code
-- Adiciona token público aos lotes e cria RPCs seguras para consulta pública
-- ============================================================

-- 1. Adicionar coluna public_token à tabela productions
ALTER TABLE productions ADD COLUMN IF NOT EXISTS public_token text;

-- 2. Índice único para consultas ultra-rápidas por token
CREATE UNIQUE INDEX IF NOT EXISTS idx_productions_public_token
  ON productions (public_token)
  WHERE public_token IS NOT NULL;

-- 3. RPC: Consulta pública de informações do lote
--    SECURITY DEFINER: executa com privilégios do owner, ignorando RLS
--    Retorna APENAS campos públicos (sem custos, estoque, observações internas, usuários, etc.)
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
    )
  )
  FROM productions p
  LEFT JOIN recipes r ON r.id = p.recipe_id
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado';
$$;

-- 4. RPC: Consulta pública de dados do COA (Certificado de Análise)
--    Retorna apenas dados que aparecem no certificado (documento público por natureza)
--    NÃO expõe: custos, MP utilizadas, operador, observações internas, foto da amostra
CREATE OR REPLACE FUNCTION get_public_coa_data(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
  FROM productions p
  JOIN quality_results qr ON qr.production_id = p.id
  LEFT JOIN recipes r ON r.id = p.recipe_id
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado'
  ORDER BY qr.updated_date DESC
  LIMIT 1;
$$;

-- 5. Permitir que role anon (público, sem login) execute as RPCs
GRANT EXECUTE ON FUNCTION get_public_lot_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_coa_data(text) TO anon, authenticated;

-- 6. Backfill: Gerar tokens para produções existentes que ainda não possuem
--    gen_random_bytes(24) = 24 bytes aleatórios = 48 caracteres hex (192 bits de entropia)
UPDATE productions
SET public_token = encode(gen_random_bytes(24), 'hex')
WHERE public_token IS NULL;
