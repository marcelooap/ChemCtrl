-- ============================================================================
-- HOTFIX: Novas entradas de MP devem nascer com Status WMS = NOK (false)
-- Tabela canônica ChemBlend: ind_estoque_mp
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

ALTER TABLE ind_estoque_mp
  ALTER COLUMN status_wms SET DEFAULT false;

-- Compatibilidade com ambientes que ainda usam raw_material_stocks
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'raw_material_stocks'
      AND column_name = 'status_wms'
  ) THEN
    EXECUTE 'ALTER TABLE raw_material_stocks ALTER COLUMN status_wms SET DEFAULT false';
  END IF;
END $$;
