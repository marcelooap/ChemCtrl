-- ============================================================
-- Hotfix: responsável pelo cadastro em recipes (Receitas)
-- ============================================================

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS created_by TEXT;

UPDATE recipes
SET created_by = 'Marcelo Amaral'
WHERE created_by IS NULL OR trim(created_by) = '' OR created_by <> 'Marcelo Amaral';
