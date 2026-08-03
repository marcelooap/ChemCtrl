-- ============================================================
-- Hotfix: status + responsável pelo cadastro em quality_analyses
-- ============================================================

ALTER TABLE quality_analyses
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE quality_analyses
  ADD COLUMN IF NOT EXISTS created_by TEXT;

UPDATE quality_analyses
SET created_by = 'Marcelo Amaral'
WHERE created_by IS NULL OR trim(created_by) = '' OR created_by <> 'Marcelo Amaral';
