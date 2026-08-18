-- ============================================================================
-- MIGRATION: Nota Fiscal em entradas de estoque de MP (industrialização)
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

ALTER TABLE ind_estoque_mp
  ADD COLUMN IF NOT EXISTS nota_fiscal text;

COMMENT ON COLUMN ind_estoque_mp.nota_fiscal IS
  'Número da nota fiscal de entrada da matéria-prima';
