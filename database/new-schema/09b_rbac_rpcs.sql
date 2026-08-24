-- ============================================================================
-- ChemCtrl v2 — Bloco 09b: RBAC RPCs (list/create/update profiles & user perms)
-- Compatível com src/modules/industrializacao/lib/rbac/rbacApi.js
-- ============================================================================

CREATE OR REPLACE FUNCTION list_profiles()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_current_session() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'nome', p.nome,
      'slug', p.slug,
      'descricao', p.descricao,
      'status', p.status,
      'is_system', p.is_system,
      'default_route', p.default_route,
      'modules', COALESCE((
        SELECT jsonb_agg(pm.modulo ORDER BY pm.modulo)
        FROM perfil_modulos pm WHERE pm.perfil_id = p.id
      ), '[]'::jsonb),
      'users_count', (
        SELECT COUNT(*)::int FROM usuarios u WHERE u.perfil_id = p.id
      )
    ) ORDER BY p.nome)
    FROM perfis p
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION list_profiles() TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_profile_permissions(p_perfil_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(permission_key ORDER BY permission_key)
    FROM perfil_permissoes WHERE perfil_id = p_perfil_id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_permissions(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_profile_modules(p_perfil_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(modulo ORDER BY modulo)
    FROM perfil_modulos WHERE perfil_id = p_perfil_id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_modules(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION create_profile(p_nome text, p_descricao text, p_status text DEFAULT 'Ativo')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  INSERT INTO perfis (id, nome, descricao, status, is_system)
  VALUES (v_id, p_nome, p_descricao, COALESCE(p_status, 'Ativo'), false);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION create_profile(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION update_profile_meta(
  p_perfil_id text, p_nome text, p_descricao text, p_status text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  UPDATE perfis SET
    nome = COALESCE(p_nome, nome),
    descricao = COALESCE(p_descricao, descricao),
    status = COALESCE(p_status, status),
    updated_at = now()
  WHERE id = p_perfil_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_profile_meta(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION replace_profile_permissions(p_perfil_id text, p_permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE k text;
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  DELETE FROM perfil_permissoes WHERE perfil_id = p_perfil_id;
  FOR k IN SELECT jsonb_array_elements_text(COALESCE(p_permissions, '[]'::jsonb))
  LOOP
    INSERT INTO perfil_permissoes (perfil_id, permission_key)
    VALUES (p_perfil_id, k) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION replace_profile_permissions(text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION replace_profile_modules(p_perfil_id text, p_modules jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE m text;
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  DELETE FROM perfil_modulos WHERE perfil_id = p_perfil_id;
  FOR m IN SELECT jsonb_array_elements_text(COALESCE(p_modules, '[]'::jsonb))
  LOOP
    IF EXISTS (SELECT 1 FROM modulos WHERE codigo = m AND ativo) THEN
      INSERT INTO perfil_modulos (perfil_id, modulo) VALUES (p_perfil_id, m)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION replace_profile_modules(text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION duplicate_profile(p_perfil_id text, p_novo_nome text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id text := gen_random_uuid()::text;
  v_src perfis%ROWTYPE;
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  SELECT * INTO v_src FROM perfis WHERE id = p_perfil_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Perfil não encontrado'); END IF;

  INSERT INTO perfis (id, nome, slug, descricao, status, is_system, default_route)
  VALUES (v_new_id, p_novo_nome, NULL, v_src.descricao, v_src.status, false, v_src.default_route);

  INSERT INTO perfil_permissoes (perfil_id, permission_key)
  SELECT v_new_id, permission_key FROM perfil_permissoes WHERE perfil_id = p_perfil_id;

  INSERT INTO perfil_modulos (perfil_id, modulo)
  SELECT v_new_id, modulo FROM perfil_modulos WHERE perfil_id = p_perfil_id;

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION duplicate_profile(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION delete_profile(p_perfil_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_is_system boolean;
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  SELECT is_system INTO v_is_system FROM perfis WHERE id = p_perfil_id;
  IF v_is_system THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil de sistema não pode ser excluído');
  END IF;
  IF EXISTS (SELECT 1 FROM usuarios WHERE perfil_id = p_perfil_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Existem usuários vinculados a este perfil');
  END IF;
  DELETE FROM perfis WHERE id = p_perfil_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_profile(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  RETURN _resolve_user_authz(p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_permissions(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION replace_user_permissions(p_user_id text, p_codes jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c text;
BEGIN
  IF get_current_session() IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  DELETE FROM usuario_permissoes WHERE usuario_id::text = p_user_id;
  FOR c IN SELECT jsonb_array_elements_text(COALESCE(p_codes, '[]'::jsonb))
  LOOP
    IF EXISTS (SELECT 1 FROM permissoes WHERE id = c) THEN
      INSERT INTO usuario_permissoes (usuario_id, permissao_id)
      VALUES (p_user_id::uuid, c)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION replace_user_permissions(text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION grant_default_user_permissions(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil_id text;
  k text;
BEGIN
  SELECT perfil_id INTO v_perfil_id FROM usuarios WHERE id::text = p_user_id;
  IF v_perfil_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário sem perfil');
  END IF;

  DELETE FROM usuario_permissoes WHERE usuario_id::text = p_user_id;
  FOR k IN SELECT permission_key FROM perfil_permissoes WHERE perfil_id = v_perfil_id
  LOOP
    IF EXISTS (SELECT 1 FROM permissoes WHERE id = k) THEN
      INSERT INTO usuario_permissoes (usuario_id, permissao_id)
      VALUES (p_user_id::uuid, k) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- module access from perfil_modulos
  IF EXISTS (SELECT 1 FROM perfil_modulos WHERE perfil_id = v_perfil_id AND modulo = 'industrializacao') THEN
    INSERT INTO usuario_permissoes (usuario_id, permissao_id)
    VALUES (p_user_id::uuid, 'module.industrializacao') ON CONFLICT DO NOTHING;
  END IF;
  IF EXISTS (SELECT 1 FROM perfil_modulos WHERE perfil_id = v_perfil_id AND modulo = 'transbordo') THEN
    INSERT INTO usuario_permissoes (usuario_id, permissao_id)
    VALUES (p_user_id::uuid, 'module.transbordo') ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION grant_default_user_permissions(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION _trg_grant_default_user_permissions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.perfil_id IS NOT NULL THEN
    PERFORM grant_default_user_permissions(NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_default_user_permissions ON usuarios;
CREATE TRIGGER trg_grant_default_user_permissions
  AFTER INSERT ON usuarios
  FOR EACH ROW EXECUTE FUNCTION _trg_grant_default_user_permissions();
