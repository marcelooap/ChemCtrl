-- =============================================================================
-- 071_estoque_produtos_unifica_quantidades_rollback.sql
-- Restaura colunas antigas a partir de saldo_inicial / saldo_final.
-- quantidade_nf e quantidade_declarada voltam nulas (dados removidos na 071).
-- =============================================================================

BEGIN;

ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS expedido;

ALTER TABLE estoque_produtos
  ADD COLUMN IF NOT EXISTS quantidade numeric,
  ADD COLUMN IF NOT EXISTS initial_stock numeric,
  ADD COLUMN IF NOT EXISTS saldo_atual numeric,
  ADD COLUMN IF NOT EXISTS quantidade_nf numeric,
  ADD COLUMN IF NOT EXISTS quantidade_declarada numeric;

UPDATE estoque_produtos
SET
  quantidade = COALESCE(quantidade, saldo_inicial, 0),
  initial_stock = COALESCE(initial_stock, saldo_inicial),
  saldo_atual = COALESCE(saldo_atual, saldo_final, 0);

ALTER TABLE estoque_produtos
  ALTER COLUMN quantidade SET DEFAULT 0,
  ALTER COLUMN saldo_atual SET DEFAULT 0;

UPDATE estoque_produtos SET quantidade = 0 WHERE quantidade IS NULL;
UPDATE estoque_produtos SET saldo_atual = 0 WHERE saldo_atual IS NULL;

ALTER TABLE estoque_produtos
  ALTER COLUMN quantidade SET NOT NULL,
  ALTER COLUMN saldo_atual SET NOT NULL;

DROP INDEX IF EXISTS idx_estoque_produtos_saldo;
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_saldo
  ON estoque_produtos (saldo_atual);

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
  v_id bigint;
  v_entry text;
  v_before numeric;
  v_after numeric;
BEGIN
  IF p_stock_id IS NULL OR btrim(p_stock_id) = '' THEN
    RAISE EXCEPTION 'stock_id obrigatório' USING ERRCODE = '22023';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta inválido' USING ERRCODE = '22023';
  END IF;

  SELECT id, id_entrada, COALESCE(saldo_atual, 0)
    INTO v_id, v_entry, v_before
  FROM estoque_produtos
  WHERE origem = 'MATERIA_PRIMA'
    AND legacy_mp_id_text = p_stock_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estoque MP não encontrado: %', p_stock_id USING ERRCODE = 'P0002';
  END IF;

  v_after := round((v_before + p_delta)::numeric, 3);
  IF p_require_sufficient AND p_delta < 0 AND v_after < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente (disponível %, solicitado %)', v_before, abs(p_delta)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_require_sufficient AND v_after < 0 THEN
    v_after := 0;
  END IF;

  UPDATE estoque_produtos
  SET saldo_atual = v_after
  WHERE id = v_id;

  RETURN jsonb_build_object(
    'id', p_stock_id,
    'entry_id', v_entry,
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
  v_row estoque_produtos%ROWTYPE;
BEGIN
  UPDATE estoque_produtos
  SET
    saldo_atual = COALESCE(p_current_stock, saldo_atual),
    lote = COALESCE(p_lot, lote),
    status_wms = COALESCE(p_status_wms::boolean, status_wms)
  WHERE origem = 'MATERIA_PRIMA'
    AND legacy_mp_id_text = p_id
    AND updated_at IS NOT DISTINCT FROM p_expected_updated
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', to_jsonb(v_row));
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'conflict', true,
    'message', 'Estoque alterado por outro usuário. Recarregue e tente novamente.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION optimistic_update_estoque_mp(text, timestamptz, numeric, text, text) TO anon, authenticated;

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
    'mp_code', v_row.produto_codigo,
    'mp_name', v_row.produto_nome,
    'client', v_row.cliente_nome,
    'lot', v_row.lote,
    'unit', v_row.unidade_medida,
    'current_stock', v_row.saldo_atual
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;

ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS saldo_inicial;
ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS saldo_final;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
