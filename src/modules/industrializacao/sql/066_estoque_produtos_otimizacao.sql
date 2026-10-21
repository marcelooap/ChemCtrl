-- =============================================================================
-- 066_estoque_produtos_otimizacao.sql
-- Remove colunas comprovadamente redundantes/vazias e índices duplicados.
--
-- Pré-condições (guardas abortam a transação se falharem):
--   1. mp_code sempre igual a produto_codigo quando preenchido (MATERIA_PRIMA)
--   2. legacy_mp_id sempre igual a legacy_mp_id_text quando ambos preenchidos
--   3. status 100% nulo (senão a coluna status NÃO é removida)
--
-- Seguro para aplicar após o app já ler produto_codigo como mp_code.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_mp_diff bigint;
  v_legacy_diff bigint;
  v_status_filled bigint;
  v_saldo_scans bigint;
BEGIN
  IF to_regclass('public.estoque_produtos') IS NULL THEN
    RAISE EXCEPTION '066: estoque_produtos não existe';
  END IF;

  -- Backfill: se algum MP tiver só mp_code, copia para produto_codigo
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estoque_produtos' AND column_name = 'mp_code'
  ) THEN
    UPDATE estoque_produtos
    SET produto_codigo = mp_code
    WHERE origem = 'MATERIA_PRIMA'
      AND (produto_codigo IS NULL OR btrim(produto_codigo) = '')
      AND mp_code IS NOT NULL
      AND btrim(mp_code) <> '';

    SELECT count(*) INTO v_mp_diff
    FROM estoque_produtos
    WHERE origem = 'MATERIA_PRIMA'
      AND mp_code IS DISTINCT FROM produto_codigo
      AND NOT (mp_code IS NULL AND produto_codigo IS NULL);

    IF v_mp_diff > 0 THEN
      RAISE EXCEPTION '066: mp_code diverge de produto_codigo em % linha(s). Abortado.', v_mp_diff;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estoque_produtos' AND column_name = 'legacy_mp_id'
  ) THEN
    SELECT count(*) INTO v_legacy_diff
    FROM estoque_produtos
    WHERE legacy_mp_id IS NOT NULL
      AND legacy_mp_id_text IS NOT NULL
      AND legacy_mp_id::text IS DISTINCT FROM legacy_mp_id_text;

    IF v_legacy_diff > 0 THEN
      RAISE EXCEPTION '066: legacy_mp_id diverge de legacy_mp_id_text em % linha(s). Abortado.', v_legacy_diff;
    END IF;
  END IF;

  -- RPC pública passa a usar produto_codigo
  CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
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
  $fn$;

  GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;

  -- Drop colunas redundantes
  ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS mp_code;
  ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS legacy_mp_id;

  -- status só se 100% nulo
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estoque_produtos' AND column_name = 'status'
  ) THEN
    SELECT count(*) INTO v_status_filled
    FROM estoque_produtos
    WHERE status IS NOT NULL AND btrim(status::text) <> '';

    IF v_status_filled = 0 THEN
      ALTER TABLE estoque_produtos DROP COLUMN status;
      RAISE NOTICE '066: coluna status removida (100%% nula).';
    ELSE
      RAISE NOTICE '066: coluna status mantida (% valor(es) preenchido(s)).', v_status_filled;
    END IF;
  END IF;

  -- Índices não-únicos redundantes com os UNIQUE parciais
  DROP INDEX IF EXISTS idx_estoque_produtos_legacy_estoque;
  DROP INDEX IF EXISTS idx_estoque_produtos_legacy_mp_text;

  -- Índice de saldo só se nunca usado
  SELECT COALESCE(idx_scan, 0) INTO v_saldo_scans
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
    AND indexrelname = 'idx_estoque_produtos_saldo';

  IF v_saldo_scans IS NULL OR v_saldo_scans = 0 THEN
    DROP INDEX IF EXISTS idx_estoque_produtos_saldo;
    RAISE NOTICE '066: idx_estoque_produtos_saldo removido (idx_scan=%).', coalesce(v_saldo_scans, 0);
  ELSE
    RAISE NOTICE '066: idx_estoque_produtos_saldo mantido (idx_scan=%).', v_saldo_scans;
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
