-- =============================================================================
-- 068_estoque_produtos_densidade_numeric.sql
-- Preserva texto original em densidade_legacy; normaliza vírgula decimal (29 linhas).
-- Idempotente: se densidade já for numeric, só garante densidade_legacy e encerra.
-- =============================================================================

BEGIN;

ALTER TABLE estoque_produtos
  ADD COLUMN IF NOT EXISTS densidade_legacy text;

DO $$
DECLARE
  v_type text;
  v_bad bigint;
BEGIN
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'estoque_produtos'
    AND column_name = 'densidade';

  IF v_type IS NULL THEN
    RAISE EXCEPTION '068: coluna densidade não encontrada';
  END IF;

  IF v_type IN ('numeric', 'double precision', 'real', 'integer', 'bigint') THEN
    RAISE NOTICE '068: densidade já é % — normalização/ALTER ignorados.', v_type;
    RETURN;
  END IF;

  -- densidade ainda é text (ou varchar)
  UPDATE estoque_produtos
  SET densidade_legacy = densidade::text
  WHERE densidade IS NOT NULL
    AND btrim(densidade::text) <> ''
    AND densidade::text !~ '^-?[0-9]+([.][0-9]+)?$'
    AND (densidade_legacy IS NULL OR btrim(densidade_legacy) = '');

  UPDATE estoque_produtos
  SET densidade = replace(btrim(densidade::text), ',', '.')
  WHERE densidade IS NOT NULL
    AND btrim(densidade::text) <> ''
    AND densidade::text ~ ','
    AND replace(btrim(densidade::text), ',', '.') ~ '^-?[0-9]+([.][0-9]+)?$';

  SELECT count(*) INTO v_bad
  FROM estoque_produtos
  WHERE densidade IS NOT NULL
    AND btrim(densidade::text) <> ''
    AND densidade::text !~ '^-?[0-9]+([.][0-9]+)?$';

  IF v_bad > 0 THEN
    RAISE EXCEPTION '068: ainda existem % densidade(s) não convertíveis. Abortado.', v_bad;
  END IF;

  ALTER TABLE estoque_produtos
    ALTER COLUMN densidade TYPE numeric
    USING CASE
      WHEN densidade IS NULL OR btrim(densidade::text) = '' THEN NULL
      ELSE densidade::numeric
    END;
END $$;

COMMENT ON COLUMN estoque_produtos.densidade_legacy IS
  'Texto original da densidade antes da normalização (068). Auditoria/rastreabilidade.';

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
