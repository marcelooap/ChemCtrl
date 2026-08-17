-- ============================================================
-- Migration: FDS (Ficha de Dados de Segurança) por produto do Transbordo
-- Colunas em t_produtos + path produtos/ no bucket documentos-tecnicos
-- + RPCs públicas para QR da etiqueta convencional.
--
-- Execute no: Supabase Dashboard → SQL Editor
-- NÃO altera RPCs/páginas públicas da Industrialização.
-- ============================================================

-- 1. Metadados FDS + token público (QR da etiqueta convencional)
ALTER TABLE t_produtos ADD COLUMN IF NOT EXISTS fds_url text;
ALTER TABLE t_produtos ADD COLUMN IF NOT EXISTS fds_filename text;
ALTER TABLE t_produtos ADD COLUMN IF NOT EXISTS fds_uploaded_at timestamptz;
ALTER TABLE t_produtos ADD COLUMN IF NOT EXISTS fds_uploaded_by text;
ALTER TABLE t_produtos ADD COLUMN IF NOT EXISTS public_token text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_t_produtos_public_token
  ON t_produtos (public_token)
  WHERE public_token IS NOT NULL AND btrim(public_token) <> '';

CREATE INDEX IF NOT EXISTS idx_t_produtos_public_token
  ON t_produtos (public_token)
  WHERE public_token IS NOT NULL AND btrim(public_token) <> '';

-- 2. Bucket privado (já existe para receitas; idempotente)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos-tecnicos', 'documentos-tecnicos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 3. Políticas de Storage — prefixo produtos/ (não altera as de recipes/)
DROP POLICY IF EXISTS "doc_tecnicos_produtos_upload" ON storage.objects;
DROP POLICY IF EXISTS "doc_tecnicos_produtos_read" ON storage.objects;
DROP POLICY IF EXISTS "doc_tecnicos_produtos_update" ON storage.objects;
DROP POLICY IF EXISTS "doc_tecnicos_produtos_delete" ON storage.objects;
DROP POLICY IF EXISTS "doc_tecnicos_anon_produto_sds_read" ON storage.objects;

DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_produtos_upload" ON storage.objects
    FOR INSERT WITH CHECK (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'produtos'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_produtos_read" ON storage.objects
    FOR SELECT USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'produtos'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_produtos_update" ON storage.objects
    FOR UPDATE USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'produtos'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_produtos_delete" ON storage.objects
    FOR DELETE USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'produtos'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Assinatura pública (anon) apenas do PDF SDS — fallback sem Edge Function
DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_anon_produto_sds_read" ON storage.objects
    FOR SELECT TO anon
    USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'produtos'
      AND (storage.foldername(name))[3] = 'sds'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. RPCs públicas — somente dados do produto transbordo (sem lote/COA)
CREATE OR REPLACE FUNCTION get_public_produto_info(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_produto_info'))
  SELECT jsonb_build_object(
    'product', p.produto,
    'code', p.codigo,
    'client', p.cliente_nome,
    'has_sds', (p.fds_url IS NOT NULL AND p.fds_url <> '')
  )
  FROM guard, t_produtos p
  WHERE p.public_token = p_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_public_produto_sds_path(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_produto_sds_path'))
  SELECT CASE
    WHEN p.fds_url IS NOT NULL AND p.fds_url <> '' THEN
      jsonb_build_object(
        'has_sds', true,
        'fds_url', p.fds_url,
        'fds_filename', COALESCE(p.fds_filename, 'sds.pdf')
      )
    ELSE
      jsonb_build_object('has_sds', false)
  END
  FROM guard, t_produtos p
  WHERE p.public_token = p_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_public_produto_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_produto_sds_path(text) TO anon, authenticated, service_role;
