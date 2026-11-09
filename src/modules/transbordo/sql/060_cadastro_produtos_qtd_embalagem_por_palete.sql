-- =============================================================================
-- 060_cadastro_produtos_qtd_embalagem_por_palete.sql
-- Quantidade de embalagens por palete no cadastro de produtos.
-- Idempotente. Aplicar no SQL Editor do Supabase.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cadastro_produtos') IS NULL THEN
    RAISE EXCEPTION '060: cadastro_produtos não existe';
  END IF;
END $$;

ALTER TABLE cadastro_produtos
  ADD COLUMN IF NOT EXISTS qtd_embalagem_por_palete numeric;

COMMENT ON COLUMN cadastro_produtos.qtd_embalagem_por_palete IS
  'Quantidade de embalagens por palete do produto.';

COMMIT;
