-- ============================================================
-- Hotfix: responsável pelo cadastro em quality_tests (Cadastro CQ)
-- ============================================================

ALTER TABLE quality_tests
  ADD COLUMN IF NOT EXISTS created_by TEXT;

UPDATE quality_tests
SET created_by = 'Marcelo Amaral'
WHERE created_by IS NULL OR trim(created_by) = '' OR created_by <> 'Marcelo Amaral';
