-- ============================================================================
-- MIGRATION: Add status_wms to raw_material_stocks (Estoque de MP)
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

ALTER TABLE raw_material_stocks
  ADD COLUMN IF NOT EXISTS status_wms boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_raw_material_stocks_status_wms
  ON raw_material_stocks (status_wms);

-- Marca todos os itens existentes como Status WMS = OK
UPDATE raw_material_stocks
SET status_wms = true;
