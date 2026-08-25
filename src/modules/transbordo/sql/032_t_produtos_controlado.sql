-- ============================================================
-- Migration: Produto controlado + órgão regulamentador
-- Colunas em t_produtos para indicar se o produto é controlado
-- e por qual órgão (Federal ou Exército).
--
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE t_produtos
  ADD COLUMN IF NOT EXISTS controlado boolean NOT NULL DEFAULT false;

ALTER TABLE t_produtos
  ADD COLUMN IF NOT EXISTS orgao_regulamentador text;

DO $$ BEGIN
  ALTER TABLE t_produtos
    ADD CONSTRAINT chk_t_produtos_orgao_regulamentador
    CHECK (
      orgao_regulamentador IS NULL
      OR orgao_regulamentador IN ('Federal', 'Exército')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Produto não controlado não deve manter órgão preenchido
UPDATE t_produtos
SET orgao_regulamentador = NULL
WHERE controlado = false
  AND orgao_regulamentador IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_t_produtos_controlado
  ON t_produtos (controlado)
  WHERE controlado = true;
