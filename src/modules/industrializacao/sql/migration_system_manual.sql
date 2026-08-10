-- ============================================================
-- Migration: Guia de Uso ChemCtrl (manual do sistema)
-- Path: documentos-tecnicos/manual/guia-uso-chemctrl.pdf
--
-- Auth ChemCtrl é client-side (x-session-id). Políticas seguem o
-- padrão de migration_recipe_fds.sql — escopo por path.
-- Atualização do PDF: somente admin no app (isAdminUser).
-- Download: todos os usuários autenticados via UI.
--
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos-tecnicos', 'documentos-tecnicos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "doc_manual_read" ON storage.objects;
DROP POLICY IF EXISTS "doc_manual_upload" ON storage.objects;
DROP POLICY IF EXISTS "doc_manual_update" ON storage.objects;
DROP POLICY IF EXISTS "doc_manual_delete" ON storage.objects;

DO $$ BEGIN
  CREATE POLICY "doc_manual_read" ON storage.objects
    FOR SELECT USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'manual'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "doc_manual_upload" ON storage.objects
    FOR INSERT WITH CHECK (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'manual'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "doc_manual_update" ON storage.objects
    FOR UPDATE USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'manual'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "doc_manual_delete" ON storage.objects
    FOR DELETE USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'manual'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
