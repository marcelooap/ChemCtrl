-- ============================================================
-- Migration: permitir assinatura pública de URLs FDS (anon)
-- Necessário para fallback client-side quando edge function
-- public-sds-url não estiver deployada.
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

-- Garante que role anon pode ler objetos SDS em recipes/ (para /object/sign)
DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_anon_sds_read" ON storage.objects
    FOR SELECT TO anon
    USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'recipes'
      AND (storage.foldername(name))[3] = 'sds'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
