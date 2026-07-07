-- Migração: adicionar coluna sample_photo_url na tabela quality_results
-- Execute este script no SQL Editor do Supabase Dashboard

ALTER TABLE quality_results ADD COLUMN IF NOT EXISTS sample_photo_url text;
