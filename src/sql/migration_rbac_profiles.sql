-- ============================================================================
-- Migration: RBAC Profiles & Permissions
-- Apply manually in Supabase SQL Editor AFTER relying on Profiles UI.
-- Safe to re-run for CREATE OR REPLACE functions; seed uses ON CONFLICT.
-- If login fails with Postgres 42703, run migration_rbac_login_fix.sql next.
-- ============================================================================

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS perfis (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nome text NOT NULL UNIQUE,
  slug text UNIQUE,
  descricao text,
  status text NOT NULL DEFAULT 'Ativo',
  is_system boolean NOT NULL DEFAULT false,
  default_route text DEFAULT '/',
  created_date timestamptz DEFAULT now(),
  updated_date timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS perfil_permissoes (
  perfil_id text NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (perfil_id, permission_key)
);

CREATE TABLE IF NOT EXISTS perfil_auditoria (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  perfil_id text REFERENCES perfis(id) ON DELETE SET NULL,
  actor_user_id text,
  actor_usuario text,
  action_type text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil_id text REFERENCES perfis(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS perfil_id text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_usuarios_perfil_id ON usuarios(perfil_id);
CREATE INDEX IF NOT EXISTS idx_perfil_permissoes_key ON perfil_permissoes(permission_key);
CREATE INDEX IF NOT EXISTS idx_perfil_auditoria_perfil ON perfil_auditoria(perfil_id, created_at DESC);

-- ============================================================================
-- 2. SEED PROFILES
-- ============================================================================

INSERT INTO perfis (id, nome, slug, descricao, status, is_system, default_route)
VALUES
  ('perfil_administrador', 'Administrador', 'administrador', 'Acesso total ao sistema', 'Ativo', true, '/'),
  ('perfil_supervisor', 'Supervisor', 'supervisor', 'Gestão operacional sem administração de usuários', 'Ativo', true, '/'),
  ('perfil_operacional', 'Operacional', 'operacional', 'Execução de produção e inventário', 'Ativo', true, '/ordens'),
  ('perfil_visualizacao', 'Visualização', 'visualizacao', 'Somente leitura em telas permitidas', 'Ativo', true, '/vasilhames'),
  ('perfil_cliente', 'Cliente', 'cliente', 'Portal do cliente externo', 'Ativo', true, '/tela-clientes')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. SEED PERMISSIONS HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION _rbac_seed_keys(p_perfil_id text, p_keys text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
BEGIN
  DELETE FROM perfil_permissoes WHERE perfil_id = p_perfil_id;
  FOREACH k IN ARRAY p_keys LOOP
    INSERT INTO perfil_permissoes (perfil_id, permission_key)
    VALUES (p_perfil_id, k)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- All keys (must stay in sync with src/lib/rbac/permissionCatalog.js)
DO $$
DECLARE
  all_keys text[] := ARRAY[
    'home.view','dashboard.view',
    'recipes.view','recipes.create','recipes.edit','recipes.delete','recipes.approve','recipes.manage_fds','recipes.remove_fds',
    'orders.view','orders.create','orders.edit','orders.delete',
    'raw_material_stock.view','raw_material_stock.create','raw_material_stock.edit','raw_material_stock.delete',
    'inventory.view','inventory.create','inventory.edit','inventory.delete',
    'containers.view','containers.create','containers.edit','containers.delete',
    'tankage.view','tankage.create','tankage.edit','tankage.delete',
    'transfer.view','transfer.create','transfer.edit','transfer.delete',
    'new_production.view','new_production.create',
    'productions.view','productions.create_op','productions.edit_op','productions.complement','productions.cancel','productions.finish','productions.print_label','productions.export',
    'production_orders.view','production_orders.create','production_orders.edit','production_orders.delete',
    'quality_tests.view','quality_tests.register_test','quality_tests.edit','quality_tests.delete',
    'quality_pending.view','quality_pending.release_production','quality_pending.edit',
    'quality_coa.view','quality_coa.issue_coa','quality_coa.export',
    'lab_equipment.view','lab_equipment.create','lab_equipment.edit','lab_equipment.delete',
    'client_portal.view','client_stock.view',
    'users.view','users.create','users.edit','users.delete',
    'profiles.view','profiles.create','profiles.edit','profiles.delete'
  ];
  supervisor_keys text[];
BEGIN
  PERFORM _rbac_seed_keys('perfil_administrador', all_keys);

  SELECT array_agg(k) INTO supervisor_keys
  FROM unnest(all_keys) AS k
  WHERE k NOT LIKE 'users.%' AND k NOT LIKE 'profiles.%';
  PERFORM _rbac_seed_keys('perfil_supervisor', supervisor_keys);

  PERFORM _rbac_seed_keys('perfil_operacional', ARRAY[
    'home.view',
    'production_orders.view','production_orders.create','production_orders.edit',
    'inventory.view','inventory.create','inventory.edit',
    'containers.view',
    'raw_material_stock.view'
  ]);

  PERFORM _rbac_seed_keys('perfil_visualizacao', ARRAY[
    'home.view','orders.view','containers.view','tankage.view','client_stock.view','quality_coa.view'
  ]);

  PERFORM _rbac_seed_keys('perfil_cliente', ARRAY['client_portal.view']);
END $$;

-- ============================================================================
-- 4. BACKFILL USUARIOS.perfil_id
-- ============================================================================

UPDATE usuarios u
SET perfil_id = 'perfil_cliente'
WHERE u.tipo = 'externo' AND (u.perfil_id IS NULL OR u.perfil_id = '');

UPDATE usuarios u
SET perfil_id = 'perfil_administrador'
WHERE u.tipo IS DISTINCT FROM 'externo'
  AND (u.perfil_id IS NULL OR u.perfil_id = '')
  AND lower(coalesce(u.nivel_acesso, '')) IN ('administrador');

UPDATE usuarios u
SET perfil_id = 'perfil_supervisor'
WHERE u.tipo IS DISTINCT FROM 'externo'
  AND (u.perfil_id IS NULL OR u.perfil_id = '')
  AND lower(coalesce(u.nivel_acesso, '')) IN ('supervisor');

UPDATE usuarios u
SET perfil_id = 'perfil_operacional'
WHERE u.tipo IS DISTINCT FROM 'externo'
  AND (u.perfil_id IS NULL OR u.perfil_id = '')
  AND lower(coalesce(u.nivel_acesso, '')) IN ('operacional', 'operador');

UPDATE usuarios u
SET perfil_id = 'perfil_visualizacao'
WHERE u.tipo IS DISTINCT FROM 'externo'
  AND (u.perfil_id IS NULL OR u.perfil_id = '')
  AND (
    lower(coalesce(u.nivel_acesso, '')) LIKE 'visualiza%'
    OR lower(coalesce(u.nivel_acesso, '')) = 'visualização'
  );

-- Anyone still without profile → Administrador (safe default per plan)
UPDATE usuarios
SET perfil_id = 'perfil_administrador'
WHERE perfil_id IS NULL;

-- ============================================================================
-- 5. SESSION / PERMISSION HELPERS
-- ============================================================================

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

CREATE OR REPLACE FUNCTION has_permission(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (get_current_session() -> 'permissions') ? p_key
    OR (
      jsonb_typeof(get_current_session() -> 'permissions') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(get_current_session() -> 'permissions', '[]'::jsonb)) k
        WHERE k = p_key
      )
    )
    -- Fallback legacy while old sessions exist
    OR (
      (get_current_session() ->> 'nivel_acesso') = 'Administrador'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION has_any_permission(p_keys text[])
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
BEGIN
  FOREACH k IN ARRAY p_keys LOOP
    IF has_permission(k) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    has_permission('profiles.edit')
    OR has_permission('users.edit')
    OR (get_current_session() ->> 'nivel_acesso') = 'Administrador',
    false
  );
$$;

CREATE OR REPLACE FUNCTION can_manage()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    has_permission('recipes.edit')
    OR has_permission('recipes.approve')
    OR has_permission('profiles.view')
    OR (get_current_session() ->> 'nivel_acesso') IN ('Administrador', 'Supervisor'),
    false
  );
$$;

CREATE OR REPLACE FUNCTION can_write()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    has_any_permission(ARRAY[
      'productions.edit_op','productions.create_op','production_orders.edit',
      'orders.edit','recipes.edit','inventory.edit','raw_material_stock.edit',
      'containers.edit','tankage.edit','transfer.edit','quality_tests.register_test'
    ])
    OR (get_current_session() ->> 'nivel_acesso') IN ('Administrador', 'Supervisor', 'Operacional'),
    false
  );
$$;

-- ============================================================================
-- 6. LOGIN / VALIDATE with permissions
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
  v_permissions jsonb;
  v_perfil record;
BEGIN
  SELECT id, nome_completo, usuario, nivel_acesso, status, tipo, cliente, cargo, senha_hash,
         preferred_language, perfil_id
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

  v_permissions := get_profile_permission_keys(v_user.perfil_id);

  SELECT id, nome, slug, default_route INTO v_perfil
  FROM perfis WHERE id = v_user.perfil_id LIMIT 1;

  v_session_id := gen_random_uuid()::text;
  INSERT INTO sessions (
    session_id, user_id, nome_completo, usuario, nivel_acesso, tipo, cliente, cargo,
    expires_at, perfil_id, permissions
  )
  VALUES (
    v_session_id, v_user.id, v_user.nome_completo, v_user.usuario, v_user.nivel_acesso,
    v_user.tipo, v_user.cliente, v_user.cargo, now() + interval '24 hours',
    v_user.perfil_id, v_permissions
  );

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
      'cargo', v_user.cargo,
      'preferred_language', COALESCE(v_user.preferred_language, 'pt-BR'),
      'perfil_id', v_user.perfil_id,
      'perfil', CASE WHEN v_perfil.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_perfil.id,
        'nome', v_perfil.nome,
        'slug', v_perfil.slug,
        'default_route', v_perfil.default_route
      ) END,
      'permissions', v_permissions
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION validate_session(p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_perfil record;
  v_permissions jsonb;
BEGIN
  SELECT * INTO v_session
  FROM sessions
  WHERE session_id = p_session_id AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Refresh permissions from profile to avoid stale grants
  IF v_session.perfil_id IS NOT NULL THEN
    v_permissions := get_profile_permission_keys(v_session.perfil_id);
    UPDATE sessions
    SET permissions = v_permissions, last_activity = now()
    WHERE session_id = p_session_id;

    SELECT id, nome, slug, default_route INTO v_perfil
    FROM perfis WHERE id = v_session.perfil_id LIMIT 1;
  ELSE
    v_permissions := COALESCE(v_session.permissions, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session.session_id,
    'user_id', v_session.user_id,
    'nome_completo', v_session.nome_completo,
    'usuario', v_session.usuario,
    'nivel_acesso', v_session.nivel_acesso,
    'tipo', v_session.tipo,
    'cliente', v_session.cliente,
    'cargo', v_session.cargo,
    'perfil_id', v_session.perfil_id,
    'permissions', v_permissions,
    'perfil', CASE WHEN v_perfil.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_perfil.id,
      'nome', v_perfil.nome,
      'slug', v_perfil.slug,
      'default_route', v_perfil.default_route
    ) END
  );
END;
$$;

-- ============================================================================
-- 7. AUDIT HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION _rbac_audit(
  p_perfil_id text,
  p_action text,
  p_changes jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess jsonb;
BEGIN
  v_sess := get_current_session();
  INSERT INTO perfil_auditoria (perfil_id, actor_user_id, actor_usuario, action_type, changes)
  VALUES (
    p_perfil_id,
    v_sess ->> 'user_id',
    v_sess ->> 'usuario',
    p_action,
    COALESCE(p_changes, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION _rbac_invalidate_profile_sessions(p_perfil_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM sessions WHERE perfil_id = p_perfil_id;
$$;

CREATE OR REPLACE FUNCTION _rbac_require_profiles_edit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (has_permission('profiles.edit') OR has_permission('profiles.create') OR (get_current_session() ->> 'nivel_acesso') = 'Administrador') THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar perfis';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _rbac_active_admin_user_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM usuarios u
  JOIN perfis p ON p.id = u.perfil_id
  WHERE u.status = 'Ativo'
    AND (p.slug = 'administrador' OR p.id = 'perfil_administrador');
$$;

-- ============================================================================
-- 8. PROFILE RPCs
-- ============================================================================

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
        (SELECT COUNT(*) FROM usuarios u WHERE u.perfil_id = p.id) AS users_count,
        (SELECT COUNT(*) FROM perfil_permissoes pp WHERE pp.perfil_id = p.id) AS permissions_count
      FROM perfis p
    ) r
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION get_profile_permissions(p_perfil_id text)
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
  RETURN get_profile_permission_keys(p_perfil_id);
END;
$$;

CREATE OR REPLACE FUNCTION create_profile(p_nome text, p_descricao text DEFAULT '', p_status text DEFAULT 'Ativo')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
BEGIN
  PERFORM _rbac_require_profiles_edit();
  IF p_nome IS NULL OR length(trim(p_nome)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nome obrigatório');
  END IF;

  v_id := gen_random_uuid()::text;
  INSERT INTO perfis (id, nome, slug, descricao, status, is_system)
  VALUES (v_id, trim(p_nome), null, COALESCE(p_descricao, ''), COALESCE(p_status, 'Ativo'), false);

  PERFORM _rbac_audit(v_id, 'create', jsonb_build_object('nome', trim(p_nome)));

  RETURN jsonb_build_object('success', true, 'id', v_id, 'perfil', jsonb_build_object('id', v_id, 'nome', trim(p_nome)));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Já existe um perfil com este nome');
END;
$$;

CREATE OR REPLACE FUNCTION update_profile_meta(
  p_perfil_id text,
  p_nome text,
  p_descricao text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old record;
BEGIN
  PERFORM _rbac_require_profiles_edit();
  SELECT * INTO v_old FROM perfis WHERE id = p_perfil_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil não encontrado');
  END IF;

  IF v_old.slug = 'administrador' AND p_status = 'Inativo' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Não é permitido inativar o perfil Administrador');
  END IF;

  UPDATE perfis
  SET
    nome = COALESCE(NULLIF(trim(p_nome), ''), nome),
    descricao = COALESCE(p_descricao, descricao),
    status = COALESCE(p_status, status),
    updated_date = now()
  WHERE id = p_perfil_id;

  PERFORM _rbac_audit(p_perfil_id, 'update_meta', jsonb_build_object(
    'nome', jsonb_build_object('from', v_old.nome, 'to', COALESCE(NULLIF(trim(p_nome), ''), v_old.nome)),
    'status', jsonb_build_object('from', v_old.status, 'to', COALESCE(p_status, v_old.status))
  ));

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Já existe um perfil com este nome');
END;
$$;

CREATE OR REPLACE FUNCTION replace_profile_permissions(p_perfil_id text, p_permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil record;
  v_before text[];
  v_after text[];
  v_added text[];
  v_removed text[];
  v_keys text[];
  k text;
  admin_keys text[] := ARRAY[
    'profiles.view','profiles.create','profiles.edit','profiles.delete',
    'users.view','users.create','users.edit','users.delete'
  ];
BEGIN
  PERFORM _rbac_require_profiles_edit();

  SELECT * INTO v_perfil FROM perfis WHERE id = p_perfil_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil não encontrado');
  END IF;

  SELECT COALESCE(array_agg(permission_key), ARRAY[]::text[]) INTO v_before
  FROM perfil_permissoes WHERE perfil_id = p_perfil_id;

  SELECT COALESCE(array_agg(value), ARRAY[]::text[]) INTO v_keys
  FROM jsonb_array_elements_text(COALESCE(p_permissions, '[]'::jsonb)) AS value;

  IF v_perfil.slug = 'administrador' THEN
    FOREACH k IN ARRAY admin_keys LOOP
      IF NOT (k = ANY (v_keys)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Não é permitido remover permissões administrativas do Administrador');
      END IF;
    END LOOP;
  END IF;

  DELETE FROM perfil_permissoes WHERE perfil_id = p_perfil_id;
  FOREACH k IN ARRAY v_keys LOOP
    INSERT INTO perfil_permissoes (perfil_id, permission_key) VALUES (p_perfil_id, k)
    ON CONFLICT DO NOTHING;
  END LOOP;

  SELECT COALESCE(array_agg(permission_key), ARRAY[]::text[]) INTO v_after
  FROM perfil_permissoes WHERE perfil_id = p_perfil_id;

  SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_added
  FROM unnest(v_after) x WHERE NOT (x = ANY (v_before));
  SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_removed
  FROM unnest(v_before) x WHERE NOT (x = ANY (v_after));

  PERFORM _rbac_audit(p_perfil_id, 'replace_permissions', jsonb_build_object(
    'added', to_jsonb(v_added),
    'removed', to_jsonb(v_removed),
    'before_count', coalesce(array_length(v_before, 1), 0),
    'after_count', coalesce(array_length(v_after, 1), 0)
  ));

  PERFORM _rbac_invalidate_profile_sessions(p_perfil_id);

  RETURN jsonb_build_object('success', true, 'permissions_count', coalesce(array_length(v_after, 1), 0));
END;
$$;

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

  PERFORM _rbac_audit(v_id, 'duplicate', jsonb_build_object('source_id', p_perfil_id, 'source_name', v_src.nome));

  RETURN jsonb_build_object('success', true, 'id', v_id, 'perfil', jsonb_build_object('id', v_id, 'nome', trim(p_novo_nome)));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'Já existe um perfil com este nome');
END;
$$;

CREATE OR REPLACE FUNCTION delete_profile(p_perfil_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil record;
  v_users integer;
BEGIN
  PERFORM _rbac_require_profiles_edit();
  SELECT * INTO v_perfil FROM perfis WHERE id = p_perfil_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil não encontrado');
  END IF;
  IF v_perfil.is_system OR v_perfil.slug = 'administrador' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfis de sistema não podem ser excluídos');
  END IF;

  SELECT COUNT(*) INTO v_users FROM usuarios WHERE perfil_id = p_perfil_id;
  IF v_users > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Existem usuários vinculados a este perfil');
  END IF;

  PERFORM _rbac_audit(p_perfil_id, 'delete', jsonb_build_object('nome', v_perfil.nome));
  DELETE FROM perfis WHERE id = p_perfil_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 9. RLS
-- ============================================================================

ALTER TABLE perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfil_permissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfil_auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfis_select ON perfis;
DROP POLICY IF EXISTS perfis_write ON perfis;
DROP POLICY IF EXISTS perfil_permissoes_select ON perfil_permissoes;
DROP POLICY IF EXISTS perfil_permissoes_write ON perfil_permissoes;
DROP POLICY IF EXISTS perfil_auditoria_select ON perfil_auditoria;
DROP POLICY IF EXISTS perfil_auditoria_deny_write ON perfil_auditoria;

CREATE POLICY perfis_select ON perfis FOR SELECT USING (
  has_permission('profiles.view') OR has_permission('users.view') OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
);
CREATE POLICY perfis_write ON perfis FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY perfil_permissoes_select ON perfil_permissoes FOR SELECT USING (
  has_permission('profiles.view') OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
);
CREATE POLICY perfil_permissoes_write ON perfil_permissoes FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY perfil_auditoria_select ON perfil_auditoria FOR SELECT USING (
  has_permission('profiles.view') OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
);
CREATE POLICY perfil_auditoria_deny_write ON perfil_auditoria FOR ALL USING (false) WITH CHECK (false);

-- ============================================================================
-- 10. GRANTS
-- ============================================================================

GRANT SELECT ON perfis TO anon;
GRANT SELECT ON perfil_permissoes TO anon;
GRANT SELECT ON perfil_auditoria TO anon;

GRANT EXECUTE ON FUNCTION get_profile_permission_keys(text) TO anon;
GRANT EXECUTE ON FUNCTION has_permission(text) TO anon;
GRANT EXECUTE ON FUNCTION has_any_permission(text[]) TO anon;
GRANT EXECUTE ON FUNCTION list_profiles() TO anon;
GRANT EXECUTE ON FUNCTION get_profile_permissions(text) TO anon;
GRANT EXECUTE ON FUNCTION create_profile(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION update_profile_meta(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION replace_profile_permissions(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION duplicate_profile(text, text) TO anon;
GRANT EXECUTE ON FUNCTION delete_profile(text) TO anon;
GRANT EXECUTE ON FUNCTION login_user(text, text) TO anon;
GRANT EXECUTE ON FUNCTION validate_session(text) TO anon;
GRANT EXECUTE ON FUNCTION is_admin() TO anon;
GRANT EXECUTE ON FUNCTION can_write() TO anon;
GRANT EXECUTE ON FUNCTION can_manage() TO anon;

-- Allow perfil_id on usuarios for admin CRUD via REST
GRANT SELECT (id, created_date, updated_date, created_by_id, nome_completo, usuario, senha, nivel_acesso, status, cargo, tipo, cliente, criado_por, preferred_language, perfil_id) ON usuarios TO anon;
GRANT INSERT (id, created_date, updated_date, created_by_id, nome_completo, usuario, senha, nivel_acesso, status, cargo, tipo, cliente, criado_por, preferred_language, perfil_id) ON usuarios TO anon;
GRANT UPDATE (nome_completo, usuario, senha, nivel_acesso, status, cargo, tipo, cliente, criado_por, preferred_language, perfil_id) ON usuarios TO anon;

COMMENT ON TABLE perfis IS 'RBAC profiles — ChemCtrl';
COMMENT ON TABLE perfil_permissoes IS 'Permission keys granted to a profile';
COMMENT ON TABLE perfil_auditoria IS 'Audit log for profile/permission changes';
