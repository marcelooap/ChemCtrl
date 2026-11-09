-- =============================================================================
-- 072_estoque_produtos_validade_indeterminada.sql
-- Adiciona flag de validade indeterminada em estoque_produtos.
-- Usado quando o produto tem fabricação, mas sem data de validade específica.
-- Idempotente. Aplicar no SQL Editor do Supabase.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.estoque_produtos') IS NULL THEN
    RAISE EXCEPTION '072: estoque_produtos não existe';
  END IF;
END $$;

ALTER TABLE estoque_produtos
  ADD COLUMN IF NOT EXISTS validade_indeterminada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN estoque_produtos.validade_indeterminada IS
  'Quando true, a validade do lote é indeterminada (sem data específica).';

COMMIT;
