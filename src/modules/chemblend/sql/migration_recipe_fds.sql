-- ============================================================
-- Migration: FDS (Ficha de Dados de Segurança) por receita
-- Colunas em recipes + bucket documentos-tecnicos + RPCs públicas
-- Execute no: Supabase Dashboard → SQL Editor
--
-- Compatível com o banco atual do ChemCtrl (auth client-side,
-- RLS aberto nas tabelas). Políticas de Storage seguem o mesmo
-- padrão de migration_lab_equipment.sql — escopo por bucket/path,
-- sem get_current_session() / can_write() / is_admin().
-- Permissões de upload/remoção são aplicadas no app (permissions.js).
-- ============================================================

-- 1. Colunas de metadados FDS na tabela recipes
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS fds_url text;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS fds_filename text;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS fds_uploaded_at timestamptz;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS fds_uploaded_by text;

-- 2. Bucket privado para documentos técnicos (hierarquia expansível)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos-tecnicos', 'documentos-tecnicos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 3. Políticas do bucket documentos-tecnicos
--    Mesmo padrão de equipamentos-lab: auth gerenciada client-side.
--    Restringe paths ao prefixo recipes/ para expansão futura (tds/, certificates/).
DROP POLICY IF EXISTS "doc_tecnicos_upload" ON storage.objects;
DROP POLICY IF EXISTS "doc_tecnicos_read" ON storage.objects;
DROP POLICY IF EXISTS "doc_tecnicos_update" ON storage.objects;
DROP POLICY IF EXISTS "doc_tecnicos_delete" ON storage.objects;

DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_upload" ON storage.objects
    FOR INSERT WITH CHECK (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'recipes'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_read" ON storage.objects
    FOR SELECT USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'recipes'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_update" ON storage.objects
    FOR UPDATE USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'recipes'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "doc_tecnicos_delete" ON storage.objects
    FOR DELETE USING (
      bucket_id = 'documentos-tecnicos'
      AND (storage.foldername(name))[1] = 'recipes'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Atualizar RPC get_public_lot_info — incluir flag has_sds
CREATE OR REPLACE FUNCTION get_public_lot_info(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'product', p.product,
    'client', p.client,
    'lot', p.lot,
    'mfg_date', p.end_time,
    'expiry_date', CASE
      WHEN p.end_time IS NOT NULL AND r.validity_days IS NOT NULL
      THEN (p.end_time::date + (r.validity_days || ' day')::interval)::text
      ELSE NULL
    END,
    'status', p.status,
    'op_number', p.op_number,
    'has_coa', EXISTS(
      SELECT 1 FROM quality_results qr
      WHERE qr.production_id = p.id
        AND qr.results IS NOT NULL
        AND qr.results::text NOT IN ('[]', 'null', '')
    ),
    'has_sds', (r.fds_url IS NOT NULL AND r.fds_url <> '')
  )
  FROM productions p
  LEFT JOIN recipes r ON r.id = p.recipe_id
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado';
$$;

-- 5. RPC auxiliar para Edge Function — retorna path SDS após validar token
CREATE OR REPLACE FUNCTION get_public_sds_path(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN r.fds_url IS NOT NULL AND r.fds_url <> '' THEN
      jsonb_build_object(
        'has_sds', true,
        'fds_url', r.fds_url,
        'fds_filename', COALESCE(r.fds_filename, 'sds.pdf')
      )
    ELSE
      jsonb_build_object('has_sds', false)
  END
  FROM productions p
  JOIN recipes r ON r.id = p.recipe_id
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado'
  LIMIT 1;
$$;

-- 6. Grants
GRANT EXECUTE ON FUNCTION get_public_lot_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_sds_path(text) TO anon, authenticated, service_role;
