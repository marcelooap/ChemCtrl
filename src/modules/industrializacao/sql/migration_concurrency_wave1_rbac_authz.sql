-- ============================================================================
-- Onda 1 — Autorização real nas RPCs de RBAC
-- Restaura _rbac_require_profiles_edit e remove grant anônimo perigoso.
-- Assinaturas alinhadas ao schema vivo (09b_rbac_rpcs.sql).
-- ============================================================================

-- Helpers (idempotentes — espelham migration_rbac_profiles.sql)
CREATE OR REPLACE FUNCTION has_permission(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
  v_user_id text;
  v_perfil_id text;
  v_nivel text;
BEGIN
  v_session := get_current_session();
  IF v_session IS NULL THEN
    RETURN false;
  END IF;
  v_user_id := v_session ->> 'id';
  v_perfil_id := v_session ->> 'perfil_id';
  v_nivel := v_session ->> 'nivel_acesso';

  IF v_nivel = 'Administrador' THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM usuario_permissoes up
    JOIN permissoes p ON p.id = up.permissao_id
    WHERE up.usuario_id::text = v_user_id
      AND p.codigo = p_key
  ) THEN
    RETURN true;
  END IF;

  IF v_perfil_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM perfil_permissoes pp
    JOIN permissoes p ON p.id = pp.permissao_id
    WHERE pp.perfil_id::text = v_perfil_id
      AND p.codigo = p_key
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION _rbac_require_profiles_edit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_current_session() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF NOT (
    has_permission('profiles.edit')
    OR has_permission('profiles.create')
    OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
  ) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar perfis';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _rbac_require_users_edit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_current_session() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF NOT (
    has_permission('users.edit')
    OR has_permission('users.create')
    OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
  ) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar usuários/permissões';
  END IF;
END;
$$;

-- create_profile: mesma assinatura do schema vivo (p_nome, p_descricao, p_status)
-- DROP necessário: CREATE OR REPLACE não pode remover/alterar defaults de parâmetros
DROP FUNCTION IF EXISTS create_profile(text, text, text);
CREATE OR REPLACE FUNCTION create_profile(
  p_nome text,
  p_descricao text DEFAULT '',
  p_status text DEFAULT 'Ativo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM _rbac_require_profiles_edit();

  IF p_nome IS NULL OR length(trim(p_nome)) = 0 THEN
    RAISE EXCEPTION 'Nome obrigatório';
  END IF;

  INSERT INTO perfis (id, nome, descricao, status, is_system)
  VALUES (v_id, trim(p_nome), COALESCE(p_descricao, ''), COALESCE(p_status, 'Ativo'), false);

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe um perfil com este nome';
END;
$$;

GRANT EXECUTE ON FUNCTION create_profile(text, text, text) TO anon, authenticated;

-- replace_user_permissions: RETURNS jsonb (schema vivo). DROP para trocar o tipo.
DROP FUNCTION IF EXISTS replace_user_permissions(text, jsonb);
CREATE OR REPLACE FUNCTION replace_user_permissions(p_user_id text, p_codes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_perm_id text;
BEGIN
  PERFORM _rbac_require_users_edit();

  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_id obrigatório');
  END IF;

  DELETE FROM usuario_permissoes WHERE usuario_id::text = p_user_id;

  IF p_codes IS NOT NULL AND jsonb_typeof(p_codes) = 'array' THEN
    FOR v_code IN SELECT jsonb_array_elements_text(p_codes)
    LOOP
      -- Aceita código (preferido) ou id direto
      SELECT id::text INTO v_perm_id
      FROM permissoes
      WHERE codigo = v_code OR id::text = v_code
      LIMIT 1;

      IF v_perm_id IS NOT NULL THEN
        BEGIN
          INSERT INTO usuario_permissoes (usuario_id, permissao_id)
          VALUES (p_user_id::uuid, v_perm_id)
          ON CONFLICT DO NOTHING;
        EXCEPTION WHEN invalid_text_representation OR datatype_mismatch THEN
          INSERT INTO usuario_permissoes (usuario_id, permissao_id)
          VALUES (p_user_id, v_perm_id)
          ON CONFLICT DO NOTHING;
        END;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION replace_user_permissions(text, jsonb) TO anon, authenticated;

-- grant_default_user_permissions: RETURNS jsonb; revoga anon
DROP FUNCTION IF EXISTS grant_default_user_permissions(text);
CREATE OR REPLACE FUNCTION grant_default_user_permissions(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil_id text;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_id obrigatório');
  END IF;

  SELECT perfil_id::text INTO v_perfil_id FROM usuarios WHERE id::text = p_user_id;
  IF v_perfil_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário sem perfil');
  END IF;

  INSERT INTO usuario_permissoes (usuario_id, permissao_id)
  SELECT p_user_id::uuid, pp.permissao_id
  FROM perfil_permissoes pp
  WHERE pp.perfil_id::text = v_perfil_id
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN invalid_text_representation OR datatype_mismatch THEN
    INSERT INTO usuario_permissoes (usuario_id, permissao_id)
    SELECT p_user_id, pp.permissao_id
    FROM perfil_permissoes pp
    WHERE pp.perfil_id::text = v_perfil_id
    ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION grant_default_user_permissions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION grant_default_user_permissions(text) FROM anon;
-- Trigger SECURITY DEFINER ainda executa; authenticated pode chamar se necessário
GRANT EXECUTE ON FUNCTION grant_default_user_permissions(text) TO authenticated;

-- delete_profile: assinatura viva RETURNS jsonb (não void)
-- DROP necessário se a versão anterior desta migration criou RETURNS void
DROP FUNCTION IF EXISTS delete_profile(text);
CREATE OR REPLACE FUNCTION delete_profile(p_perfil_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_system boolean;
BEGIN
  PERFORM _rbac_require_profiles_edit();

  SELECT is_system INTO v_is_system FROM perfis WHERE id = p_perfil_id;
  IF v_is_system THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil de sistema não pode ser excluído');
  END IF;
  IF EXISTS (SELECT 1 FROM usuarios WHERE perfil_id::text = p_perfil_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Existem usuários vinculados a este perfil');
  END IF;

  DELETE FROM perfil_permissoes WHERE perfil_id::text = p_perfil_id;
  DELETE FROM perfil_modulos WHERE perfil_id::text = p_perfil_id;
  DELETE FROM perfis WHERE id::text = p_perfil_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION delete_profile(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
