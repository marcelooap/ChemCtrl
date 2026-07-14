-- ============================================================================
-- ChemCtrl: FIX login RBAC v2 (idempotente)
-- Rode este arquivo TODO no Supabase SQL Editor.
-- Cada bloco tolera reexecução e não depende de seed perfeito.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- --------------------------------------------------------------------------
-- 1) Tabelas / colunas (nunca aborta por já existir)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perfis (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nome text NOT NULL,
  slug text,
  descricao text,
  status text NOT NULL DEFAULT 'Ativo',
  is_system boolean NOT NULL DEFAULT false,
  default_route text DEFAULT '/',
  created_date timestamptz DEFAULT now(),
  updated_date timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS perfis_nome_uidx ON perfis (nome);
CREATE UNIQUE INDEX IF NOT EXISTS perfis_slug_uidx ON perfis (slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS perfil_permissoes (
  perfil_id text NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (perfil_id, permission_key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'preferred_language'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN preferred_language text DEFAULT 'pt-BR';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'perfil_id'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN perfil_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'senha_hash'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN senha_hash text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'perfil_id'
  ) THEN
    ALTER TABLE sessions ADD COLUMN perfil_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'permissions'
  ) THEN
    ALTER TABLE sessions ADD COLUMN permissions jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'last_activity'
  ) THEN
    ALTER TABLE sessions ADD COLUMN last_activity timestamptz DEFAULT now();
  END IF;
END $$;

UPDATE sessions SET permissions = '[]'::jsonb WHERE permissions IS NULL;

-- --------------------------------------------------------------------------
-- 2) Seed perfis sem quebrar por UNIQUE(nome/slug)
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM perfis WHERE id = 'perfil_administrador' OR slug = 'administrador' OR nome = 'Administrador') THEN
    INSERT INTO perfis (id, nome, slug, descricao, status, is_system, default_route)
    VALUES ('perfil_administrador', 'Administrador', 'administrador', 'Acesso total', 'Ativo', true, '/');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM perfis WHERE id = 'perfil_supervisor' OR slug = 'supervisor' OR nome = 'Supervisor') THEN
    INSERT INTO perfis (id, nome, slug, descricao, status, is_system, default_route)
    VALUES ('perfil_supervisor', 'Supervisor', 'supervisor', 'Gestão operacional', 'Ativo', true, '/');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM perfis WHERE id = 'perfil_operacional' OR slug = 'operacional' OR nome = 'Operacional') THEN
    INSERT INTO perfis (id, nome, slug, descricao, status, is_system, default_route)
    VALUES ('perfil_operacional', 'Operacional', 'operacional', 'Produção', 'Ativo', true, '/ordens');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM perfis WHERE id = 'perfil_visualizacao' OR slug = 'visualizacao' OR nome = 'Visualização') THEN
    INSERT INTO perfis (id, nome, slug, descricao, status, is_system, default_route)
    VALUES ('perfil_visualizacao', 'Visualização', 'visualizacao', 'Somente leitura', 'Ativo', true, '/vasilhames');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM perfis WHERE id = 'perfil_cliente' OR slug = 'cliente' OR nome = 'Cliente') THEN
    INSERT INTO perfis (id, nome, slug, descricao, status, is_system, default_route)
    VALUES ('perfil_cliente', 'Cliente', 'cliente', 'Portal externo', 'Ativo', true, '/tela-clientes');
  END IF;
END $$;

-- Resolve id do admin (pode ter sido criado com outro id na migration anterior)
DO $$
DECLARE
  v_admin_id text;
  v_cliente_id text;
  v_sup_id text;
  v_op_id text;
  v_viz_id text;
BEGIN
  SELECT id INTO v_admin_id FROM perfis WHERE slug = 'administrador' OR nome = 'Administrador' OR id = 'perfil_administrador' LIMIT 1;
  SELECT id INTO v_cliente_id FROM perfis WHERE slug = 'cliente' OR nome = 'Cliente' OR id = 'perfil_cliente' LIMIT 1;
  SELECT id INTO v_sup_id FROM perfis WHERE slug = 'supervisor' OR nome = 'Supervisor' OR id = 'perfil_supervisor' LIMIT 1;
  SELECT id INTO v_op_id FROM perfis WHERE slug = 'operacional' OR nome = 'Operacional' OR id = 'perfil_operacional' LIMIT 1;
  SELECT id INTO v_viz_id FROM perfis WHERE slug = 'visualizacao' OR nome = 'Visualização' OR id = 'perfil_visualizacao' LIMIT 1;

  IF v_cliente_id IS NOT NULL THEN
    UPDATE usuarios SET perfil_id = v_cliente_id WHERE tipo = 'externo' AND perfil_id IS NULL;
  END IF;

  IF v_admin_id IS NOT NULL THEN
    UPDATE usuarios SET perfil_id = v_admin_id
    WHERE tipo IS DISTINCT FROM 'externo' AND perfil_id IS NULL
      AND lower(coalesce(nivel_acesso, '')) = 'administrador';
  END IF;

  IF v_sup_id IS NOT NULL THEN
    UPDATE usuarios SET perfil_id = v_sup_id
    WHERE tipo IS DISTINCT FROM 'externo' AND perfil_id IS NULL
      AND lower(coalesce(nivel_acesso, '')) = 'supervisor';
  END IF;

  IF v_op_id IS NOT NULL THEN
    UPDATE usuarios SET perfil_id = v_op_id
    WHERE tipo IS DISTINCT FROM 'externo' AND perfil_id IS NULL
      AND lower(coalesce(nivel_acesso, '')) IN ('operacional', 'operador');
  END IF;

  IF v_viz_id IS NOT NULL THEN
    UPDATE usuarios SET perfil_id = v_viz_id
    WHERE tipo IS DISTINCT FROM 'externo' AND perfil_id IS NULL
      AND (lower(coalesce(nivel_acesso, '')) LIKE 'visualiza%' OR nivel_acesso = 'Visualização');
  END IF;

  IF v_admin_id IS NOT NULL THEN
    UPDATE usuarios SET perfil_id = v_admin_id WHERE perfil_id IS NULL;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 3) Helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_profile_permission_keys(p_perfil_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(permission_key ORDER BY permission_key), '[]'::jsonb)
  FROM perfil_permissoes
  WHERE perfil_id = p_perfil_id;
$$;

-- --------------------------------------------------------------------------
-- 4) login_user à prova de colunas (lê usuario via to_jsonb)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION login_user(p_username text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row jsonb;
  v_session_id text;
  v_permissions jsonb := '[]'::jsonb;
  v_perfil jsonb;
  v_perfil_id text;
  v_senha_hash text;
  v_status text;
  v_admin_id text;
BEGIN
  SELECT to_jsonb(u) INTO v_row
  FROM usuarios u
  WHERE u.usuario = p_username
  LIMIT 1;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  v_status := COALESCE(v_row->>'status', 'Ativo');
  IF v_status = 'Inativo' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário inativo. Contate o administrador do sistema.');
  END IF;

  v_senha_hash := v_row->>'senha_hash';
  IF v_senha_hash IS NULL OR v_senha_hash = '' OR v_senha_hash != extensions.crypt(p_password, v_senha_hash) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  v_perfil_id := NULLIF(v_row->>'perfil_id', '');

  IF v_perfil_id IS NULL THEN
    SELECT id INTO v_admin_id
    FROM perfis
    WHERE slug = 'administrador' OR nome = 'Administrador' OR id = 'perfil_administrador'
    LIMIT 1;

    IF v_admin_id IS NOT NULL THEN
      UPDATE usuarios SET perfil_id = v_admin_id WHERE id = v_row->>'id';
      v_perfil_id := v_admin_id;
    END IF;
  END IF;

  IF v_perfil_id IS NOT NULL THEN
    v_permissions := get_profile_permission_keys(v_perfil_id);
    SELECT to_jsonb(p) INTO v_perfil
    FROM perfis p
    WHERE p.id = v_perfil_id
    LIMIT 1;
  END IF;

  v_session_id := gen_random_uuid()::text;

  -- Insert compatível: usa colunas RBAC se existirem; senão, insert legado
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'permissions'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'perfil_id'
  ) THEN
    INSERT INTO sessions (
      session_id, user_id, nome_completo, usuario, nivel_acesso, tipo, cliente, cargo,
      expires_at, perfil_id, permissions
    )
    VALUES (
      v_session_id,
      v_row->>'id',
      v_row->>'nome_completo',
      v_row->>'usuario',
      v_row->>'nivel_acesso',
      COALESCE(v_row->>'tipo', 'interno'),
      v_row->>'cliente',
      v_row->>'cargo',
      now() + interval '24 hours',
      v_perfil_id,
      COALESCE(v_permissions, '[]'::jsonb)
    );
    BEGIN
      UPDATE sessions SET last_activity = now() WHERE session_id = v_session_id;
    EXCEPTION WHEN undefined_column THEN
      NULL;
    END;
  ELSE
    INSERT INTO sessions (
      session_id, user_id, nome_completo, usuario, nivel_acesso, tipo, cliente, cargo, expires_at
    )
    VALUES (
      v_session_id,
      v_row->>'id',
      v_row->>'nome_completo',
      v_row->>'usuario',
      v_row->>'nivel_acesso',
      COALESCE(v_row->>'tipo', 'interno'),
      v_row->>'cliente',
      v_row->>'cargo',
      now() + interval '24 hours'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'user', jsonb_build_object(
      'id', v_row->>'id',
      'nome_completo', v_row->>'nome_completo',
      'usuario', v_row->>'usuario',
      'nivel_acesso', v_row->>'nivel_acesso',
      'status', v_status,
      'tipo', COALESCE(v_row->>'tipo', 'interno'),
      'cliente', v_row->>'cliente',
      'cargo', v_row->>'cargo',
      'preferred_language', COALESCE(NULLIF(v_row->>'preferred_language', ''), 'pt-BR'),
      'perfil_id', v_perfil_id,
      'perfil', CASE
        WHEN v_perfil IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', v_perfil->>'id',
          'nome', v_perfil->>'nome',
          'slug', v_perfil->>'slug',
          'default_route', v_perfil->>'default_route'
        )
      END,
      'permissions', COALESCE(v_permissions, '[]'::jsonb)
    )
  );
END;
$$;

-- --------------------------------------------------------------------------
-- 5) validate_session
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_session(p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
  v_perfil jsonb;
  v_permissions jsonb := '[]'::jsonb;
  v_perfil_id text;
BEGIN
  SELECT to_jsonb(s) INTO v_session
  FROM sessions s
  WHERE s.session_id = p_session_id
    AND s.expires_at > now()
  LIMIT 1;

  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  v_perfil_id := NULLIF(v_session->>'perfil_id', '');

  IF v_perfil_id IS NOT NULL THEN
    v_permissions := get_profile_permission_keys(v_perfil_id);
    BEGIN
      UPDATE sessions
      SET permissions = COALESCE(v_permissions, '[]'::jsonb),
          last_activity = now()
      WHERE session_id = p_session_id;
    EXCEPTION WHEN undefined_column THEN
      NULL;
    END;

    SELECT to_jsonb(p) INTO v_perfil
    FROM perfis p
    WHERE p.id = v_perfil_id
    LIMIT 1;
  ELSE
    v_permissions := COALESCE(v_session->'permissions', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session->>'session_id',
    'user_id', v_session->>'user_id',
    'nome_completo', v_session->>'nome_completo',
    'usuario', v_session->>'usuario',
    'nivel_acesso', v_session->>'nivel_acesso',
    'tipo', v_session->>'tipo',
    'cliente', v_session->>'cliente',
    'cargo', v_session->>'cargo',
    'perfil_id', v_perfil_id,
    'permissions', COALESCE(v_permissions, '[]'::jsonb),
    'perfil', CASE
      WHEN v_perfil IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_perfil->>'id',
        'nome', v_perfil->>'nome',
        'slug', v_perfil->>'slug',
        'default_route', v_perfil->>'default_route'
      )
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_permission_keys(text) TO anon;
GRANT EXECUTE ON FUNCTION login_user(text, text) TO anon;
GRANT EXECUTE ON FUNCTION validate_session(text) TO anon;

-- Grants mínimos (ignora falha se coluna ainda não existir no cache)
DO $$
BEGIN
  EXECUTE 'GRANT SELECT ON usuarios TO anon';
  EXECUTE 'GRANT SELECT ON sessions TO anon';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT pg_notify('pgrst', 'reload schema');

-- Teste rápido (deve retornar success:false com texto de credencial — NÃO erro de coluna):
-- SELECT public.login_user('__probe__', 'x');
