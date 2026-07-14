-- ============================================================================
-- CHEMCTRL — AUDITORIA DE SEGURANÇA COMPLETA
-- Migração SQL: RLS, autenticação, senhas, storage, permissões
-- 
-- Execute no: Supabase Dashboard → SQL Editor → New Query → cole e rode
-- ============================================================================

-- ============================================================================
-- 1. EXTENSÃO PGCRYPTO (para hash de senhas com bcrypt)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 2. TABELA DE SESSÕES — gerencia sessões de usuários autenticados
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
  session_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL,
  nome_completo text,
  usuario text,
  nivel_acesso text,
  tipo text DEFAULT 'interno',
  cliente text,
  cargo text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  last_activity timestamptz DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_direct_access_sessions" ON sessions;
CREATE POLICY "no_direct_access_sessions" ON sessions
  FOR ALL USING (false) WITH CHECK (false);

-- ============================================================================
-- 3. COLUNA senha_hash EM USUARIOS — armazena hash bcrypt em vez de texto plano
-- ============================================================================
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_hash text;

-- ============================================================================
-- 4. HASHEAR SENHAS EXISTENTES (texto plano → bcrypt)
-- ============================================================================
UPDATE usuarios
SET senha_hash = crypt(senha, gen_salt('bf', 10))
WHERE senha IS NOT NULL AND senha != '' AND senha_hash IS NULL;

-- ============================================================================
-- 5. TRIGGER PARA HASH AUTOMÁTICO DE SENHA
-- Substitui o trigger update_updated_date_usuarios com um combinado que:
--   - Atualiza updated_date
--   - Se senha for fornecida (INSERT/UPDATE): hasheia para senha_hash e limpa senha
--   - Se senha não for fornecida (UPDATE): mantém senha_hash anterior
-- ============================================================================
CREATE OR REPLACE FUNCTION manage_usuarios()
RETURNS trigger AS $$
BEGIN
  NEW.updated_date = now();
  IF NEW.senha IS NOT NULL AND NEW.senha != '' THEN
    NEW.senha_hash := crypt(NEW.senha, gen_salt('bf', 10));
    NEW.senha := null;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.senha_hash := COALESCE(NEW.senha_hash, OLD.senha_hash);
    NEW.senha := null;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_updated_date_usuarios ON usuarios;
DROP TRIGGER IF EXISTS manage_usuarios_trigger ON usuarios;
CREATE TRIGGER manage_usuarios_trigger
  BEFORE INSERT OR UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION manage_usuarios();

-- ============================================================================
-- 6. LIMPAR SENHAS EM TEXTO PLANO (após hash bem-sucedido)
-- ============================================================================
ALTER TABLE usuarios ALTER COLUMN senha DROP NOT NULL;
UPDATE usuarios SET senha = null WHERE senha_hash IS NOT NULL;

-- ============================================================================
-- 7. FUNÇÕES AUXILIARES DE SESSÃO — usadas nas políticas RLS
-- ============================================================================

-- Retorna a sessão atual como JSONB (lê o header x-session-id da requisição)
CREATE OR REPLACE FUNCTION get_current_session()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(s.*) FROM sessions s
  WHERE s.session_id = NULLIF(current_setting('request.header.x-session-id', true), '')
  AND s.expires_at > now()
  LIMIT 1
$$;

-- Retorna true se o usuário atual é interno
CREATE OR REPLACE FUNCTION is_internal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((get_current_session() ->> 'tipo') = 'interno', false)
$$;

-- Retorna o nível de acesso do usuário atual
CREATE OR REPLACE FUNCTION current_user_nivel()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_current_session() ->> 'nivel_acesso'
$$;

-- Retorna o cliente do usuário atual (para usuários externos)
CREATE OR REPLACE FUNCTION current_user_cliente()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_current_session() ->> 'cliente'
$$;

-- Retorna true se o usuário pode escrever (Admin, Supervisor, Operacional)
CREATE OR REPLACE FUNCTION can_write()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    current_user_nivel() IN ('Administrador', 'Supervisor', 'Operacional'),
    false
  )
$$;

-- Retorna true se o usuário pode gerenciar (Admin, Supervisor)
CREATE OR REPLACE FUNCTION can_manage()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    current_user_nivel() IN ('Administrador', 'Supervisor'),
    false
  )
$$;

-- Retorna true se o usuário é Administrador
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(current_user_nivel() = 'Administrador', false)
$$;

-- ============================================================================
-- 8. FUNÇÃO DE LOGIN — verifica credenciais e cria sessão
-- SECURITY DEFINER: bypassa RLS e column privileges para ler senha_hash
-- ============================================================================
CREATE OR REPLACE FUNCTION login_user(p_username text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_session_id text;
BEGIN
  SELECT id, nome_completo, usuario, nivel_acesso, status, tipo, cliente, cargo, senha_hash
  INTO v_user
  FROM usuarios
  WHERE usuario = p_username
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  IF v_user.status = 'Inativo' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário inativo. Contate o administrador do sistema.');
  END IF;

  IF v_user.senha_hash IS NULL OR v_user.senha_hash != crypt(p_password, v_user.senha_hash) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  v_session_id := gen_random_uuid()::text;
  INSERT INTO sessions (session_id, user_id, nome_completo, usuario, nivel_acesso, tipo, cliente, cargo, expires_at)
  VALUES (v_session_id, v_user.id, v_user.nome_completo, v_user.usuario, v_user.nivel_acesso, v_user.tipo, v_user.cliente, v_user.cargo, now() + interval '24 hours');

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'user', jsonb_build_object(
      'id', v_user.id,
      'nome_completo', v_user.nome_completo,
      'usuario', v_user.usuario,
      'nivel_acesso', v_user.nivel_acesso,
      'status', v_user.status,
      'tipo', v_user.tipo,
      'cliente', v_user.cliente,
      'cargo', v_user.cargo
    )
  );
END;
$$;

-- ============================================================================
-- 9. FUNÇÃO DE LOGOUT — destrói a sessão
-- ============================================================================
CREATE OR REPLACE FUNCTION destroy_session(p_session_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM sessions WHERE session_id = p_session_id;
$$;

-- ============================================================================
-- 10. FUNÇÃO DE VALIDAÇÃO DE SESSÃO — verifica se a sessão ainda é válida
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_session(p_session_id text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(s.*) FROM sessions s
  WHERE s.session_id = p_session_id
  AND s.expires_at > now()
  LIMIT 1
$$;

-- ============================================================================
-- 11. CONCEDER EXECUTE NAS FUNÇÕES PARA anon
-- ============================================================================
GRANT EXECUTE ON FUNCTION login_user(text, text) TO anon;
GRANT EXECUTE ON FUNCTION destroy_session(text) TO anon;
GRANT EXECUTE ON FUNCTION validate_session(text) TO anon;
GRANT EXECUTE ON FUNCTION get_current_session() TO anon;
GRANT EXECUTE ON FUNCTION is_internal_user() TO anon;
GRANT EXECUTE ON FUNCTION current_user_nivel() TO anon;
GRANT EXECUTE ON FUNCTION current_user_cliente() TO anon;
GRANT EXECUTE ON FUNCTION can_write() TO anon;
GRANT EXECUTE ON FUNCTION can_manage() TO anon;
GRANT EXECUTE ON FUNCTION is_admin() TO anon;
GRANT EXECUTE ON FUNCTION manage_usuarios() TO anon;

-- ============================================================================
-- 12. PERMISSÕES DE COLUNA EM USUARIOS
-- senha: selecionável (sempre null após trigger) mas não senha_hash
-- ============================================================================
REVOKE ALL ON usuarios FROM anon;
GRANT SELECT (id, created_date, updated_date, created_by_id, nome_completo, usuario, senha, nivel_acesso, status, cargo, tipo, cliente, criado_por) ON usuarios TO anon;
GRANT INSERT (id, created_date, updated_date, created_by_id, nome_completo, usuario, senha, nivel_acesso, status, cargo, tipo, cliente, criado_por) ON usuarios TO anon;
GRANT UPDATE (nome_completo, usuario, senha, nivel_acesso, status, cargo, tipo, cliente, criado_por) ON usuarios TO anon;

-- ============================================================================
-- 13. CRIAR TABELA stock_movements (se não existir)
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date timestamptz DEFAULT now(),
  updated_date timestamptz DEFAULT now(),
  created_by_id text,
  stock_id text,
  entry_id text,
  mp_code text,
  mp_name text,
  client text,
  lot text,
  quantity numeric,
  unit text,
  destination text,
  observations text,
  operator text,
  movement_date timestamptz,
  balance_before numeric,
  balance_after numeric
);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS update_updated_date_stock_movements ON stock_movements;
CREATE TRIGGER update_updated_date_stock_movements
  BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION update_updated_date();

-- ============================================================================
-- 14. ADICIONAR COLUNAS AUSENTES
-- ============================================================================
ALTER TABLE productions ADD COLUMN IF NOT EXISTS invoiced boolean DEFAULT false;
ALTER TABLE quality_results ADD COLUMN IF NOT EXISTS sample_photo_url text;

-- ============================================================================
-- 15. REMOVER TODAS AS POLÍTICAS PERMISSIVAS (using(true) with check(true))
-- ============================================================================
DROP POLICY IF EXISTS "allow_all_usuarios" ON usuarios;
DROP POLICY IF EXISTS "allow_all_productions" ON productions;
DROP POLICY IF EXISTS "allow_all_raw_material_stocks" ON raw_material_stocks;
DROP POLICY IF EXISTS "allow_all_tanks" ON tanks;
DROP POLICY IF EXISTS "allow_all_transfers" ON transfers;
DROP POLICY IF EXISTS "allow_all_containers" ON containers;
DROP POLICY IF EXISTS "allow_all_orders" ON orders;
DROP POLICY IF EXISTS "allow_all_recipes" ON recipes;
DROP POLICY IF EXISTS "allow_all_quality_results" ON quality_results;
DROP POLICY IF EXISTS "allow_all_quality_tests" ON quality_tests;
DROP POLICY IF EXISTS "allow_all_inventories" ON inventories;
DROP POLICY IF EXISTS "allow_all_stock_movements" ON stock_movements;

-- ============================================================================
-- 16. NOVAS POLÍTICAS RLS — USUARIOS (apenas Administradores)
-- ============================================================================
CREATE POLICY "usuarios_select" ON usuarios FOR SELECT USING (is_admin());
CREATE POLICY "usuarios_insert" ON usuarios FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "usuarios_update" ON usuarios FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "usuarios_delete" ON usuarios FOR DELETE USING (is_admin());

-- ============================================================================
-- 17. NOVAS POLÍTICAS RLS — TABELAS DE PRODUÇÃO/OPERACIONAIS
-- Padrão: SELECT (interno OU cliente próprio), WRITE (can_write), DELETE (admin)
-- ============================================================================

-- productions
CREATE POLICY "productions_select" ON productions FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "productions_insert" ON productions FOR INSERT WITH CHECK (can_write());
CREATE POLICY "productions_update" ON productions FOR UPDATE USING (can_write()) WITH CHECK (can_write());
CREATE POLICY "productions_delete" ON productions FOR DELETE USING (is_admin());

-- raw_material_stocks
CREATE POLICY "raw_material_stocks_select" ON raw_material_stocks FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "raw_material_stocks_insert" ON raw_material_stocks FOR INSERT WITH CHECK (can_write());
CREATE POLICY "raw_material_stocks_update" ON raw_material_stocks FOR UPDATE USING (can_write()) WITH CHECK (can_write());
CREATE POLICY "raw_material_stocks_delete" ON raw_material_stocks FOR DELETE USING (is_admin());

-- containers
CREATE POLICY "containers_select" ON containers FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "containers_insert" ON containers FOR INSERT WITH CHECK (can_write());
CREATE POLICY "containers_update" ON containers FOR UPDATE USING (can_write()) WITH CHECK (can_write());
CREATE POLICY "containers_delete" ON containers FOR DELETE USING (is_admin());

-- transfers
CREATE POLICY "transfers_select" ON transfers FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "transfers_insert" ON transfers FOR INSERT WITH CHECK (can_write());
CREATE POLICY "transfers_update" ON transfers FOR UPDATE USING (can_write()) WITH CHECK (can_write());
CREATE POLICY "transfers_delete" ON transfers FOR DELETE USING (is_admin());

-- orders
CREATE POLICY "orders_select" ON orders FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "orders_insert" ON orders FOR INSERT WITH CHECK (can_write());
CREATE POLICY "orders_update" ON orders FOR UPDATE USING (can_write()) WITH CHECK (can_write());
CREATE POLICY "orders_delete" ON orders FOR DELETE USING (is_admin());

-- quality_results
CREATE POLICY "quality_results_select" ON quality_results FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "quality_results_insert" ON quality_results FOR INSERT WITH CHECK (can_write());
CREATE POLICY "quality_results_update" ON quality_results FOR UPDATE USING (can_write()) WITH CHECK (can_write());
CREATE POLICY "quality_results_delete" ON quality_results FOR DELETE USING (is_admin());

-- stock_movements
CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "stock_movements_insert" ON stock_movements FOR INSERT WITH CHECK (can_write());
CREATE POLICY "stock_movements_update" ON stock_movements FOR UPDATE USING (can_write()) WITH CHECK (can_write());
CREATE POLICY "stock_movements_delete" ON stock_movements FOR DELETE USING (is_admin());

-- ============================================================================
-- 18. NOVAS POLÍTICAS RLS — TABELAS DE GESTÃO (Admin + Supervisor)
-- ============================================================================

-- recipes
CREATE POLICY "recipes_select" ON recipes FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "recipes_insert" ON recipes FOR INSERT WITH CHECK (can_manage());
CREATE POLICY "recipes_update" ON recipes FOR UPDATE USING (can_manage()) WITH CHECK (can_manage());
CREATE POLICY "recipes_delete" ON recipes FOR DELETE USING (is_admin());

-- quality_tests
CREATE POLICY "quality_tests_select" ON quality_tests FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "quality_tests_insert" ON quality_tests FOR INSERT WITH CHECK (can_manage());
CREATE POLICY "quality_tests_update" ON quality_tests FOR UPDATE USING (can_manage()) WITH CHECK (can_manage());
CREATE POLICY "quality_tests_delete" ON quality_tests FOR DELETE USING (is_admin());

-- tanks
CREATE POLICY "tanks_select" ON tanks FOR SELECT USING (
  is_internal_user() OR client = current_user_cliente()
);
CREATE POLICY "tanks_insert" ON tanks FOR INSERT WITH CHECK (can_manage());
CREATE POLICY "tanks_update" ON tanks FOR UPDATE USING (can_manage()) WITH CHECK (can_manage());
CREATE POLICY "tanks_delete" ON tanks FOR DELETE USING (is_admin());

-- ============================================================================
-- 19. NOVAS POLÍTICAS RLS — INVENTORIES (apenas interno)
-- ============================================================================
CREATE POLICY "inventories_select" ON inventories FOR SELECT USING (is_internal_user());
CREATE POLICY "inventories_insert" ON inventories FOR INSERT WITH CHECK (can_manage());
CREATE POLICY "inventories_update" ON inventories FOR UPDATE USING (is_internal_user()) WITH CHECK (is_internal_user());
CREATE POLICY "inventories_delete" ON inventories FOR DELETE USING (is_admin());

-- ============================================================================
-- 20. GARANTIR RLS HABILITADO EM TODAS AS TABELAS
-- ============================================================================
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE productions ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_material_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tanks ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 21. STORAGE — TORNAR BUCKET fotos-cq PRIVADO E PROTEGIDO
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('fotos-cq', 'fotos-cq', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Remover políticas existentes do bucket
DROP POLICY IF EXISTS "fotos_cq_public_select" ON storage.objects;
DROP POLICY IF EXISTS "fotos_cq_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "fotos_cq_upload" ON storage.objects;
DROP POLICY IF EXISTS "fotos_cq_read" ON storage.objects;
DROP POLICY IF EXISTS "fotos_cq_delete" ON storage.objects;
DROP POLICY IF EXISTS "fotos-cq_select" ON storage.objects;
DROP POLICY IF EXISTS "fotos-cq_insert" ON storage.objects;
DROP POLICY IF EXISTS "fotos-cq_update" ON storage.objects;
DROP POLICY IF EXISTS "fotos-cq_delete" ON storage.objects;

-- Upload: apenas usuários autenticados (com sessão válida)
CREATE POLICY "fotos_cq_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'fotos-cq' AND get_current_session() IS NOT NULL
  );

-- Leitura: apenas usuários autenticados (para gerar URLs assinadas)
CREATE POLICY "fotos_cq_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'fotos-cq' AND get_current_session() IS NOT NULL
  );

-- Exclusão: apenas Administradores
CREATE POLICY "fotos_cq_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'fotos-cq' AND is_admin()
  );

-- ============================================================================
-- 22. REALTIME — adicionar stock_movements à publicação
-- ============================================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE stock_movements;
EXCEPTION WHEN OTHERS THEN
  -- já está na publicação
END $$;

ALTER TABLE stock_movements REPLICA IDENTITY FULL;

-- ============================================================================
-- 23. ÍNDICES ADICIONAIS
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_stock_id ON stock_movements(stock_id);

-- ============================================================================
-- 24. LIMPEZA PERIÓDICA — remover sessões expiradas
-- (Pode ser configurada como cron job no Supabase)
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM sessions WHERE expires_at < now();
$$;

GRANT EXECUTE ON FUNCTION cleanup_expired_sessions() TO anon;

-- ============================================================================
-- FIM DA MIGRAÇÃO
-- ============================================================================
-- Após executar este script:
-- 1. Todas as senhas em texto plano foram hasheadas com bcrypt
-- 2. Todas as tabelas têm RLS habilitado com políticas baseadas em sessão
-- 3. O bucket fotos-cq é privado (requer autenticação para acesso)
-- 4. A tabela usuarios não expõe senha_hash em consultas SELECT
-- 5. Apenas Administradores podem gerenciar usuários
-- 6. Usuários externos só veem dados do seu próprio cliente
-- 7. Usuários de Visualização não podem escrever (apenas ler)
-- ============================================================================
