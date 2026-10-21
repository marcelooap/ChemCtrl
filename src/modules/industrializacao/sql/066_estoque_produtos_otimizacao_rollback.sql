-- =============================================================================
-- 066_estoque_produtos_otimizacao_rollback.sql
-- Recria colunas removidas pela 066 e repovoa valores deriváveis.
-- Dados não deriváveis devem vir do backup em database/backups/.
-- =============================================================================

BEGIN;

ALTER TABLE estoque_produtos ADD COLUMN IF NOT EXISTS mp_code text;
ALTER TABLE estoque_produtos ADD COLUMN IF NOT EXISTS legacy_mp_id uuid;
ALTER TABLE estoque_produtos ADD COLUMN IF NOT EXISTS status text;

UPDATE estoque_produtos
SET mp_code = produto_codigo
WHERE origem = 'MATERIA_PRIMA'
  AND (mp_code IS NULL OR btrim(mp_code) = '')
  AND produto_codigo IS NOT NULL;

UPDATE estoque_produtos
SET legacy_mp_id = ep_uuid(legacy_mp_id_text)
WHERE legacy_mp_id IS NULL
  AND legacy_mp_id_text IS NOT NULL
  AND ep_uuid(legacy_mp_id_text) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_estoque_produtos_legacy_estoque
  ON estoque_produtos (legacy_estoque_id);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_legacy_mp_text
  ON estoque_produtos (legacy_mp_id_text);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_saldo
  ON estoque_produtos (saldo_atual);

CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estoque_produtos%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('get_public_raw_material_info');
  SELECT * INTO v_row
  FROM estoque_produtos
  WHERE origem = 'MATERIA_PRIMA' AND public_token = p_token
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'mp_code', COALESCE(v_row.mp_code, v_row.produto_codigo),
    'mp_name', v_row.produto_nome,
    'client', v_row.cliente_nome,
    'lot', v_row.lote,
    'unit', v_row.unidade_medida,
    'current_stock', v_row.saldo_atual
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
