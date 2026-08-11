-- =============================================================================
-- Migration: perfil_modulos — acesso por módulo (camada acima ao RBAC)
-- =============================================================================
-- Módulos de app: industrializacao | transbordo
-- Painel permanece exclusivo de Administrador (não entra nesta tabela).
-- =============================================================================

CREATE TABLE IF NOT EXISTS perfil_modulos (
  perfil_id text NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  modulo text NOT NULL CHECK (modulo IN ('industrializacao', 'transbordo')),
  PRIMARY KEY (perfil_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_perfil_modulos_modulo ON perfil_modulos (modulo);

-- Seed: Administrador → ambos; demais internos → industrializacao; Cliente → nenhum
INSERT INTO perfil_modulos (perfil_id, modulo)
SELECT p.id, m.modulo
FROM perfis p
CROSS JOIN (
  VALUES
    ('administrador', 'industrializacao'),
    ('administrador', 'transbordo'),
    ('supervisor', 'industrializacao'),
    ('operacional', 'industrializacao'),
    ('visualizacao', 'industrializacao')
) AS m(slug, modulo)
WHERE p.slug = m.slug
   OR (m.slug = 'administrador' AND p.id = 'perfil_administrador')
ON CONFLICT DO NOTHING;

-- Fallback por nome caso slug esteja ausente
INSERT INTO perfil_modulos (perfil_id, modulo)
SELECT p.id, 'industrializacao'
FROM perfis p
WHERE lower(trim(p.nome)) IN ('administrador', 'supervisor', 'operacional', 'visualização', 'visualizacao')
  AND NOT EXISTS (
    SELECT 1 FROM perfil_modulos pm WHERE pm.perfil_id = p.id AND pm.modulo = 'industrializacao'
  )
ON CONFLICT DO NOTHING;

INSERT INTO perfil_modulos (perfil_id, modulo)
SELECT p.id, 'transbordo'
FROM perfis p
WHERE (p.slug = 'administrador' OR p.id = 'perfil_administrador' OR lower(trim(p.nome)) = 'administrador')
  AND NOT EXISTS (
    SELECT 1 FROM perfil_modulos pm WHERE pm.perfil_id = p.id AND pm.modulo = 'transbordo'
  )
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Helper: módulos do perfil
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_profile_module_keys(p_perfil_id text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(pm.modulo ORDER BY pm.modulo), ARRAY[]::text[])
  FROM perfil_modulos pm
  WHERE pm.perfil_id = p_perfil_id;
$$;

GRANT EXECUTE ON FUNCTION get_profile_module_keys(text) TO anon;

-- -----------------------------------------------------------------------------
-- login_user — inclui modules[] no payload do usuário
-- (base: migration_rename_tables_ind.sql + rate limit)
-- -----------------------------------------------------------------------------
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
  v_modules text[] := ARRAY[]::text[];
  v_perfil jsonb;
  v_perfil_id text;
  v_senha_hash text;
  v_status text;
  v_admin_id text;
BEGIN
  PERFORM check_login_rate_limit(p_username);

  SELECT to_jsonb(u) INTO v_row
  FROM ind_lista_usuarios u
  WHERE u.usuario = p_username
  LIMIT 1;

  IF v_row IS NULL THEN
    PERFORM register_failed_login_attempt(p_username);
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  v_status := COALESCE(v_row->>'status', 'Ativo');
  IF v_status = 'Inativo' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário inativo. Contate o administrador do sistema.');
  END IF;

  v_senha_hash := v_row->>'senha_hash';
  IF v_senha_hash IS NULL OR v_senha_hash = '' OR v_senha_hash != extensions.crypt(p_password, v_senha_hash) THEN
    PERFORM register_failed_login_attempt(p_username);
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  v_perfil_id := NULLIF(v_row->>'perfil_id', '');

  IF v_perfil_id IS NULL THEN
    SELECT id INTO v_admin_id
    FROM perfis
    WHERE slug = 'administrador' OR nome = 'Administrador' OR id = 'perfil_administrador'
    LIMIT 1;

    IF v_admin_id IS NOT NULL THEN
      UPDATE ind_lista_usuarios SET perfil_id = v_admin_id WHERE id = v_row->>'id';
      v_perfil_id := v_admin_id;
    END IF;
  END IF;

  IF v_perfil_id IS NOT NULL THEN
    v_permissions := get_profile_permission_keys(v_perfil_id);
    v_modules := get_profile_module_keys(v_perfil_id);
    SELECT to_jsonb(p) INTO v_perfil
    FROM perfis p
    WHERE p.id = v_perfil_id
    LIMIT 1;
  END IF;

  v_session_id := gen_random_uuid()::text;

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

  PERFORM reset_login_attempts(p_username);

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
      'permissions', COALESCE(v_permissions, '[]'::jsonb),
      'modules', to_jsonb(COALESCE(v_modules, ARRAY[]::text[]))
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION login_user(text, text) TO anon;

-- -----------------------------------------------------------------------------
-- validate_session — inclui modules[]
-- -----------------------------------------------------------------------------
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
  v_modules text[] := ARRAY[]::text[];
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
    v_modules := get_profile_module_keys(v_perfil_id);
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
    'modules', to_jsonb(COALESCE(v_modules, ARRAY[]::text[])),
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

GRANT EXECUTE ON FUNCTION validate_session(text) TO anon;

-- -----------------------------------------------------------------------------
-- list_profiles — inclui modules agregados
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_profiles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    has_permission('profiles.view')
    OR has_permission('users.view')
    OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.nome)
    FROM (
      SELECT
        p.id,
        p.nome,
        p.slug,
        p.descricao,
        p.status,
        p.is_system,
        p.default_route,
        p.created_date,
        p.updated_date,
        (SELECT COUNT(*) FROM ind_lista_usuarios u WHERE u.perfil_id = p.id) AS users_count,
        (SELECT COUNT(*) FROM perfil_permissoes pp WHERE pp.perfil_id = p.id) AS permissions_count,
        COALESCE((
          SELECT jsonb_agg(pm.modulo ORDER BY pm.modulo)
          FROM perfil_modulos pm
          WHERE pm.perfil_id = p.id
        ), '[]'::jsonb) AS modules
      FROM perfis p
    ) r
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION list_profiles() TO anon;

-- -----------------------------------------------------------------------------
-- get_profile_modules / replace_profile_modules
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_profile_modules(p_perfil_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    has_permission('profiles.view')
    OR has_permission('profiles.edit')
    OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN to_jsonb(COALESCE(get_profile_module_keys(p_perfil_id), ARRAY[]::text[]));
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_modules(text) TO anon;

CREATE OR REPLACE FUNCTION replace_profile_modules(p_perfil_id text, p_modules jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil record;
  v_keys text[];
  k text;
  v_allowed text[] := ARRAY['industrializacao', 'transbordo'];
BEGIN
  PERFORM _rbac_require_profiles_edit();

  SELECT * INTO v_perfil FROM perfis WHERE id = p_perfil_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil não encontrado');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT value), ARRAY[]::text[]) INTO v_keys
  FROM jsonb_array_elements_text(COALESCE(p_modules, '[]'::jsonb)) AS value
  WHERE value = ANY (v_allowed);

  DELETE FROM perfil_modulos WHERE perfil_id = p_perfil_id;
  FOREACH k IN ARRAY COALESCE(v_keys, ARRAY[]::text[]) LOOP
    INSERT INTO perfil_modulos (perfil_id, modulo) VALUES (p_perfil_id, k)
    ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM _rbac_audit(p_perfil_id, 'replace_modules', jsonb_build_object(
    'modules', to_jsonb(COALESCE(v_keys, ARRAY[]::text[]))
  ));

  PERFORM _rbac_invalidate_profile_sessions(p_perfil_id);

  RETURN jsonb_build_object(
    'success', true,
    'modules', to_jsonb(COALESCE(get_profile_module_keys(p_perfil_id), ARRAY[]::text[]))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION replace_profile_modules(text, jsonb) TO anon;

-- -----------------------------------------------------------------------------
-- duplicate_profile — copia também os módulos
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION duplicate_profile(p_perfil_id text, p_novo_nome text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src record;
  v_id text;
BEGIN
  PERFORM _rbac_require_profiles_edit();
  SELECT * INTO v_src FROM perfis WHERE id = p_perfil_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil não encontrado');
  END IF;
  IF p_novo_nome IS NULL OR length(trim(p_novo_nome)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nome obrigatório');
  END IF;

  v_id := gen_random_uuid()::text;
  INSERT INTO perfis (id, nome, descricao, status, is_system, default_route)
  VALUES (v_id, trim(p_novo_nome), v_src.descricao, 'Ativo', false, v_src.default_route);

  INSERT INTO perfil_permissoes (perfil_id, permission_key)
  SELECT v_id, permission_key FROM perfil_permissoes WHERE perfil_id = p_perfil_id;

  INSERT INTO perfil_modulos (perfil_id, modulo)
  SELECT v_id, modulo FROM perfil_modulos WHERE perfil_id = p_perfil_id;

  PERFORM _rbac_audit(v_id, 'duplicate', jsonb_build_object('source_id', p_perfil_id, 'source_name', v_src.nome));

  RETURN jsonb_build_object('success', true, 'id', v_id, 'perfil', jsonb_build_object('id', v_id, 'nome', trim(p_novo_nome)));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Já existe um perfil com este nome');
END;
$$;

GRANT EXECUTE ON FUNCTION duplicate_profile(text, text) TO anon;

SELECT pg_notify('pgrst', 'reload schema');
