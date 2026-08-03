-- ============================================================
-- Migration: Catálogo de Análises (Lista de Ensaios)
-- Tabela master das análises realizadas na empresa.
-- Seed a partir das análises já cadastradas em quality_tests.
-- ============================================================

CREATE TABLE IF NOT EXISTS quality_analyses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date TIMESTAMPTZ DEFAULT now(),
  updated_date TIMESTAMPTZ DEFAULT now(),
  created_by_id TEXT,
  analysis_name TEXT NOT NULL,
  methodology TEXT,
  unit TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  CONSTRAINT quality_analyses_name_unique UNIQUE (analysis_name)
);

-- Compat: se a tabela já existia sem a coluna de status / responsável
ALTER TABLE quality_analyses
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE quality_analyses
  ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_quality_analyses_name
  ON quality_analyses (lower(analysis_name));

ALTER TABLE quality_analyses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "quality_analyses_all" ON quality_analyses FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS update_updated_date_quality_analyses ON quality_analyses;
CREATE TRIGGER update_updated_date_quality_analyses
  BEFORE UPDATE ON quality_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_date();

ALTER TABLE quality_analyses REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE quality_analyses;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- Seed: análises únicas já existentes nos ensaios (Cadastro CQ)
INSERT INTO quality_analyses (analysis_name, methodology, unit)
SELECT DISTINCT ON (lower(trim(a->>'analysis_name')))
  trim(a->>'analysis_name') AS analysis_name,
  NULLIF(trim(a->>'methodology'), '') AS methodology,
  NULLIF(trim(a->>'unit'), '') AS unit
FROM quality_tests qt
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(qt.analyses) = 'array' THEN qt.analyses
    ELSE '[]'::jsonb
  END
) AS a
WHERE coalesce(trim(a->>'analysis_name'), '') <> ''
ORDER BY lower(trim(a->>'analysis_name')), qt.updated_date DESC NULLS LAST, qt.created_date DESC NULLS LAST
ON CONFLICT (analysis_name) DO NOTHING;

UPDATE quality_analyses
SET created_by = 'Marcelo Amaral'
WHERE created_by IS NULL OR trim(created_by) = '';

-- Grant new permission keys to admin/supervisor seed profiles (idempotent)
INSERT INTO perfil_permissoes (perfil_id, permission_key)
SELECT p.id, k.permission_key
FROM (VALUES
  ('perfil_administrador'),
  ('perfil_supervisor')
) AS p(id)
CROSS JOIN (VALUES
  ('quality_analyses.view'),
  ('quality_analyses.create'),
  ('quality_analyses.edit'),
  ('quality_analyses.delete')
) AS k(permission_key)
WHERE EXISTS (SELECT 1 FROM perfis WHERE id = p.id)
ON CONFLICT (perfil_id, permission_key) DO NOTHING;
