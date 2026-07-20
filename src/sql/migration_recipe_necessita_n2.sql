-- ============================================================
-- Migration: Flag de inertização com N2 (produto inflamável)
-- Coluna necessita_n2 na tabela recipes
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS necessita_n2 boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN recipes.necessita_n2 IS
  'Indica se o produto é inflamável e necessita inertização com N2';
