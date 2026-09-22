-- =============================================================================
-- Hotfix: replace_user_permissions / has_permission
-- =============================================================================
-- Causa: migration_concurrency_wave1_rbac_authz.sql reescreveu as RPCs com
-- assinatura do schema "usuarios(uuid)" e has_permission lendo session->>'id'
-- (inexistente; o correto é user_id). No banco vivo a tabela é
-- ind_lista_usuarios (id text) e a UI de Permissões usa profiles.edit.
--
-- Sintoma: ao salvar permissões no Painel → P0001 / mensagem genérica.
--
-- Idempotente: pode rodar várias vezes no SQL Editor do Supabase.
-- =============================================================================

-- 1) has_permission: prioriza sessão (permissions JSON + Administrador),
--    depois grants individuais e do perfil. Usa user_id (não id).
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

  v_nivel := v_session ->> 'nivel_acesso';
  IF v_nivel = 'Administrador' THEN
    RETURN true;
  END IF;

  -- Sessão já carrega o array de permissões no login
  IF (v_session -> 'permissions') ? p_key THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(v_session -> 'permissions') = 'array'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(COALESCE(v_session -> 'permissions', '[]'::jsonb)) k
       WHERE k = p_key
     )
  THEN
    RETURN true;
  END IF;

  v_user_id := COALESCE(v_session ->> 'user_id', v_session ->> 'id');
  v_perfil_id := v_session ->> 'perfil_id';

  IF v_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM usuario_permissoes up
    JOIN permissoes p ON p.id = up.permissao_id
    WHERE up.usuario_id::text = v_user_id
      AND p.codigo = p_key
      AND COALESCE(p.ativo, true)
  ) THEN
    RETURN true;
  END IF;

  IF v_perfil_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM perfil_permissoes pp
    WHERE pp.perfil_id::text = v_perfil_id
      AND pp.permission_key = p_key
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- 2) Autorização alinhada à UI (Can permission="profiles.edit")
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
    OR has_permission('users.edit')
    OR has_permission('users.create')
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
    OR has_permission('profiles.edit')
    OR has_permission('profiles.create')
    OR (get_current_session() ->> 'nivel_acesso') = 'Administrador'
  ) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar usuários/permissões';
  END IF;
END;
$$;

-- 3) replace_user_permissions: lógica completa do schema vivo
DROP FUNCTION IF EXISTS replace_user_permissions(text, jsonb);
CREATE OR REPLACE FUNCTION replace_user_permissions(p_user_id text, p_codes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_codes text[];
  v_authz jsonb;
  v_audit_perfil text;
BEGIN
  PERFORM _rbac_require_users_edit();

  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_id obrigatório');
  END IF;

  SELECT * INTO v_user FROM ind_lista_usuarios WHERE id::text = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário não encontrado');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT value), ARRAY[]::text[])
  INTO v_codes
  FROM jsonb_array_elements_text(COALESCE(p_codes, '[]'::jsonb)) AS value
  WHERE EXISTS (
    SELECT 1 FROM permissoes p
    WHERE (p.codigo = value OR p.id::text = value)
      AND COALESCE(p.ativo, true)
  );

  IF COALESCE(v_user.tipo, 'interno') = 'externo' THEN
    v_codes := ARRAY['client_portal.view'];
  ELSE
    IF NOT ('module.painel' = ANY (COALESCE(v_codes, ARRAY[]::text[]))) THEN
      v_codes := COALESCE(v_codes, ARRAY[]::text[]) || ARRAY['module.painel'];
    END IF;
    IF NOT ('painel_home.view' = ANY (COALESCE(v_codes, ARRAY[]::text[]))) THEN
      v_codes := v_codes || ARRAY['painel_home.view'];
    END IF;
  END IF;

  DELETE FROM usuario_permissoes WHERE usuario_id::text = p_user_id;
  PERFORM _grant_codes_to_user(p_user_id, v_codes);

  -- Evita FK quebrada em perfil_auditoria quando perfil_id está nulo/órfão
  v_audit_perfil := NULL;
  IF v_user.perfil_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM perfis WHERE id::text = v_user.perfil_id::text
  ) THEN
    v_audit_perfil := v_user.perfil_id::text;
  END IF;

  BEGIN
    PERFORM _rbac_audit(v_audit_perfil, 'replace_user_permissions', jsonb_build_object(
      'usuario_id', p_user_id,
      'usuario', v_user.usuario,
      'permissions', to_jsonb(COALESCE(v_codes, ARRAY[]::text[]))
    ));
  EXCEPTION WHEN OTHERS THEN
    NULL; -- auditoria não deve impedir o save
  END;

  BEGIN
    PERFORM _sync_user_sessions_permissions(p_user_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_authz := _resolve_user_authz(p_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'permissions', COALESCE(v_authz->'permissions', '[]'::jsonb),
    'modules', COALESCE(v_authz->'modules', '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION replace_user_permissions(text, jsonb) TO anon, authenticated;

-- 4) _grant_codes_to_user: robusto a usuario_id text|uuid
CREATE OR REPLACE FUNCTION _grant_codes_to_user(p_user_id text, p_codes text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
BEGIN
  FOREACH k IN ARRAY COALESCE(p_codes, ARRAY[]::text[]) LOOP
    BEGIN
      INSERT INTO usuario_permissoes (usuario_id, permissao_id)
      SELECT p_user_id::uuid, p.id
      FROM permissoes p
      WHERE p.codigo = k OR p.id::text = k
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN invalid_text_representation OR datatype_mismatch THEN
      INSERT INTO usuario_permissoes (usuario_id, permissao_id)
      SELECT p_user_id, p.id
      FROM permissoes p
      WHERE p.codigo = k OR p.id::text = k
      ON CONFLICT DO NOTHING;
    END;
  END LOOP;
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
