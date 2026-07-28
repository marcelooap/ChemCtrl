-- ============================================================
-- Migration: Equipamentos Lab — controle de calibração
-- Cria tabela lab_equipments + bucket de storage
-- ============================================================

-- 1. Tabela de equipamentos
CREATE TABLE IF NOT EXISTS lab_equipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ DEFAULT now(),
  updated_date TIMESTAMPTZ DEFAULT now(),
  created_by_id UUID,

  name TEXT NOT NULL,
  type TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  patrimony_number TEXT,
  location TEXT,
  responsible TEXT,
  lab_responsible TEXT,
  acquisition_date DATE,
  calibration_periodicity_days INTEGER DEFAULT 365,
  calibration_company TEXT,
  calibration_responsible TEXT,
  certificate_number TEXT,
  last_calibration_date DATE,
  next_calibration_date DATE,
  observations TEXT,
  image_url TEXT,
  certificate_url TEXT,
  manual_url TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  calibration_history JSONB DEFAULT '[]'::jsonb
);

-- 2. RLS — mesma política aberta das demais tabelas (auth gerenciada client-side)
ALTER TABLE lab_equipments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "lab_equipments_all" ON lab_equipments FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Replica identity FULL para realtime enviar old_record em DELETEs
ALTER TABLE lab_equipments REPLICA IDENTITY FULL;

-- 4. Bucket de storage para imagens e documentos
INSERT INTO storage.buckets (id, name, public)
VALUES ('equipamentos-lab', 'equipamentos-lab', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Políticas do bucket
DO $$ BEGIN
  CREATE POLICY "equipamentos_lab_insert" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'equipamentos-lab');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "equipamentos_lab_select" ON storage.objects
    FOR SELECT USING (bucket_id = 'equipamentos-lab');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "equipamentos_lab_update" ON storage.objects
    FOR UPDATE USING (bucket_id = 'equipamentos-lab');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "equipamentos_lab_delete" ON storage.objects
    FOR DELETE USING (bucket_id = 'equipamentos-lab');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
