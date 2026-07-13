-- ============================================================================
-- MIGRATION: Atendimento Fracionado na Produção
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

ALTER TABLE productions ADD COLUMN IF NOT EXISTS fractional_supply boolean DEFAULT false;
ALTER TABLE productions ADD COLUMN IF NOT EXISTS volume_apontado numeric;
ALTER TABLE productions ADD COLUMN IF NOT EXISTS volume_pendente numeric DEFAULT 0;
ALTER TABLE productions ADD COLUMN IF NOT EXISTS complement_status text DEFAULT 'Completa';
ALTER TABLE productions ADD COLUMN IF NOT EXISTS supply_complements jsonb DEFAULT '[]'::jsonb;

-- Backfill existing productions
UPDATE productions
SET
  volume_apontado = COALESCE(volume_apontado, volume),
  volume_pendente = COALESCE(volume_pendente, 0),
  complement_status = COALESCE(complement_status, 'Completa'),
  supply_complements = COALESCE(supply_complements, '[]'::jsonb)
WHERE fractional_supply IS NOT TRUE OR fractional_supply IS NULL;
