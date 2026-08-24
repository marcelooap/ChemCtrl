-- ============================================================================
-- ChemCtrl v2 — Bloco 09: Session helpers + Rate limit + Auth RPCs (Fase A)
-- Núcleo necessário para login / sessão / rate limit / helpers de request.
-- RPCs de domínio adicionais (RBAC completo, checklist, públicos) em 09b.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_request_header(p_name text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value text;
  v_headers jsonb;
BEGIN
  v_value := NULLIF(current_setting('request.header.' || p_name, true), '');
  IF v_value IS NOT NULL THEN RETURN v_value; END IF;
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
    v_value := NULLIF(v_headers ->> p_name, '');
  EXCEPTION WHEN OTHERS THEN
    v_value := NULL;
  END;
  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION get_request_client_ip()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_forwarded text;
  v_ip text;
BEGIN
  v_forwarded := get_request_header('x-forwarded-for');
  IF v_forwarded IS NOT NULL THEN
    v_ip := btrim(split_part(v_forwarded, ',', 1));
    IF v_ip <> '' THEN RETURN v_ip; END IF;
  END IF;
  v_ip := get_request_header('cf-connecting-ip');
  IF v_ip IS NOT NULL AND v_ip <> '' THEN RETURN v_ip; END IF;
  v_ip := get_request_header('x-real-ip');
  IF v_ip IS NOT NULL AND v_ip <> '' THEN RETURN v_ip; END IF;
  RETURN 'unknown';
END;
$$;

CREATE OR REPLACE FUNCTION make_rate_limit_key(p_scope text, p_identifier text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT encode(
    extensions.digest(
      p_scope || ':' || get_request_client_ip() || ':' || lower(coalesce(p_identifier, '')),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION rate_limit_hit(
  p_key_hash text,
  p_max_attempts integer DEFAULT 5,
  p_window_seconds integer DEFAULT 900
)
RETURNS TABLE(blocked boolean, attempt_count integer, blocked_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row rate_limit_attempts%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_row FROM rate_limit_attempts WHERE key_hash = p_key_hash FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO rate_limit_attempts(key_hash, attempt_count, window_start, updated_at)
    VALUES (p_key_hash, 1, v_now, v_now)
    RETURNING * INTO v_row;
  ELSE
    IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
      RETURN QUERY SELECT true, v_row.attempt_count, v_row.blocked_until;
      RETURN;
    END IF;
    IF v_row.window_start < v_now - make_interval(secs => p_window_seconds) THEN
      UPDATE rate_limit_attempts
      SET attempt_count = 1, window_start = v_now, blocked_until = NULL, updated_at = v_now
      WHERE key_hash = p_key_hash
      RETURNING * INTO v_row;
    ELSE
      UPDATE rate_limit_attempts
      SET attempt_count = attempt_count + 1, updated_at = v_now
      WHERE key_hash = p_key_hash
      RETURNING * INTO v_row;
    END IF;
  END IF;

  IF v_row.attempt_count >= p_max_attempts THEN
    UPDATE rate_limit_attempts
    SET blocked_until = v_now + make_interval(secs => p_window_seconds), updated_at = v_now
    WHERE key_hash = p_key_hash
    RETURNING * INTO v_row;
    RETURN QUERY SELECT true, v_row.attempt_count, v_row.blocked_until;
  ELSE
    RETURN QUERY SELECT false, v_row.attempt_count, v_row.blocked_until;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION rate_limit_is_blocked(p_key_hash text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM rate_limit_attempts
    WHERE key_hash = p_key_hash
      AND blocked_until IS NOT NULL
      AND blocked_until > now()
  );
$$;

CREATE OR REPLACE FUNCTION rate_limit_reset(p_key_hash text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM rate_limit_attempts WHERE key_hash = p_key_hash;
END;
$$;

CREATE OR REPLACE FUNCTION log_rate_limit_event(
  p_reason text,
  p_usuario text DEFAULT NULL,
  p_user_id text DEFAULT NULL,
  p_endpoint text DEFAULT NULL,
  p_route text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO rate_limit_logs (
    ip, user_agent, origin, session_id, user_id, usuario, endpoint, route, reason
  ) VALUES (
    get_request_client_ip(),
    get_request_header('user-agent'),
    get_request_header('origin'),
    get_request_header('x-session-id'),
    p_user_id,
    p_usuario,
    p_endpoint,
    p_route,
    p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION check_login_rate_limit(p_username text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := make_rate_limit_key('login', p_username);
  IF rate_limit_is_blocked(v_key) THEN
    PERFORM log_rate_limit_event('login', p_username, NULL, 'login_user', '/login');
    RAISE EXCEPTION 'Muitas tentativas de login. Aguarde alguns minutos.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION register_failed_login_attempt(p_username text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_res record;
BEGIN
  v_key := make_rate_limit_key('login', p_username);
  SELECT * INTO v_res FROM rate_limit_hit(v_key, 5, 900);
  IF v_res.blocked THEN
    PERFORM log_rate_limit_event('login', p_username, NULL, 'login_user', '/login');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reset_login_attempts(p_username text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM rate_limit_reset(make_rate_limit_key('login', p_username));
END;
$$;

CREATE OR REPLACE FUNCTION enforce_public_rate_limit(p_scope text, p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_res record;
BEGIN
  v_key := make_rate_limit_key(p_scope, coalesce(left(p_token, 16), ''));
  IF rate_limit_is_blocked(v_key) THEN
    PERFORM log_rate_limit_event('public', NULL, NULL, p_scope, p_scope);
    RAISE EXCEPTION 'Rate limit exceeded';
  END IF;
  SELECT * INTO v_res FROM rate_limit_hit(v_key, 60, 60);
  IF v_res.blocked THEN
    PERFORM log_rate_limit_event('public', NULL, NULL, p_scope, p_scope);
    RAISE EXCEPTION 'Rate limit exceeded';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_current_session()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id text;
  v_headers jsonb;
BEGIN
  v_session_id := NULLIF(current_setting('request.header.x-session-id', true), '');
  IF v_session_id IS NULL THEN
    BEGIN
      v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
      v_session_id := NULLIF(v_headers ->> 'x-session-id', '');
    EXCEPTION WHEN OTHERS THEN
      v_session_id := NULL;
    END;
  END IF;
  IF v_session_id IS NULL OR btrim(v_session_id) = '' THEN
    RETURN NULL;
  END IF;
  RETURN (
    SELECT to_jsonb(s.*)
    FROM sessions s
    WHERE s.session_id = btrim(v_session_id)
      AND s.expires_at > now()
    LIMIT 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION _resolve_user_authz(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_permissions jsonb := '[]'::jsonb;
  v_modules jsonb := '[]'::jsonb;
  v_perfil_id text;
BEGIN
  SELECT perfil_id::text INTO v_perfil_id
  FROM usuarios WHERE id::text = p_user_id LIMIT 1;

  SELECT COALESCE(jsonb_agg(p.codigo ORDER BY p.codigo), '[]'::jsonb)
  INTO v_permissions
  FROM usuario_permissoes up
  JOIN permissoes p ON p.id = up.permissao_id
  WHERE up.usuario_id::text = p_user_id AND p.ativo = true;

  IF v_perfil_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(pm.modulo ORDER BY pm.modulo), '[]'::jsonb)
    INTO v_modules
    FROM perfil_modulos pm
    WHERE pm.perfil_id = v_perfil_id;
  END IF;

  RETURN jsonb_build_object(
    'permissions', COALESCE(v_permissions, '[]'::jsonb),
    'modules', COALESCE(v_modules, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION login_user(p_username text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row jsonb;
  v_session_id text;
  v_permissions jsonb := '[]'::jsonb;
  v_modules text[] := ARRAY[]::text[];
  v_authz jsonb;
  v_perfil jsonb;
  v_perfil_id text;
  v_senha_hash text;
  v_status text;
  v_admin_id text;
BEGIN
  PERFORM check_login_rate_limit(p_username);

  SELECT to_jsonb(u) INTO v_row
  FROM usuarios u
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
  IF v_senha_hash IS NULL OR v_senha_hash = ''
     OR v_senha_hash != extensions.crypt(p_password, v_senha_hash) THEN
    PERFORM register_failed_login_attempt(p_username);
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  v_perfil_id := NULLIF(v_row->>'perfil_id', '');
  IF v_perfil_id IS NULL THEN
    SELECT id INTO v_admin_id FROM perfis
    WHERE slug = 'administrador' OR nome = 'Administrador' OR id = 'perfil_administrador'
    LIMIT 1;
    IF v_admin_id IS NOT NULL THEN
      UPDATE usuarios SET perfil_id = v_admin_id WHERE id::text = v_row->>'id';
      v_perfil_id := v_admin_id;
    END IF;
  END IF;

  IF v_perfil_id IS NOT NULL THEN
    SELECT to_jsonb(p) INTO v_perfil FROM perfis p WHERE p.id = v_perfil_id LIMIT 1;
  END IF;

  v_authz := _resolve_user_authz(v_row->>'id');
  v_permissions := COALESCE(v_authz->'permissions', '[]'::jsonb);
  SELECT COALESCE(array_agg(value), ARRAY[]::text[])
  INTO v_modules
  FROM jsonb_array_elements_text(COALESCE(v_authz->'modules', '[]'::jsonb)) AS value;

  v_session_id := gen_random_uuid()::text;
  INSERT INTO sessions (
    session_id, user_id, nome_completo, usuario, nivel_acesso, tipo, cliente, cargo,
    expires_at, perfil_id, permissions, last_activity
  ) VALUES (
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
    COALESCE(v_permissions, '[]'::jsonb),
    now()
  );

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

GRANT EXECUTE ON FUNCTION login_user(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION validate_session(p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
  v_perfil jsonb;
  v_permissions jsonb := '[]'::jsonb;
  v_modules text[] := ARRAY[]::text[];
  v_authz jsonb;
  v_perfil_id text;
  v_user_id text;
  v_user jsonb;
BEGIN
  SELECT to_jsonb(s) INTO v_session
  FROM sessions s
  WHERE s.session_id = p_session_id AND s.expires_at > now()
  LIMIT 1;

  IF v_session IS NULL THEN RETURN NULL; END IF;

  v_user_id := NULLIF(v_session->>'user_id', '');
  v_perfil_id := NULLIF(v_session->>'perfil_id', '');

  IF v_user_id IS NOT NULL THEN
    v_authz := _resolve_user_authz(v_user_id);
    v_permissions := COALESCE(v_authz->'permissions', '[]'::jsonb);
    SELECT COALESCE(array_agg(value), ARRAY[]::text[])
    INTO v_modules
    FROM jsonb_array_elements_text(COALESCE(v_authz->'modules', '[]'::jsonb)) AS value;

    UPDATE sessions
    SET permissions = COALESCE(v_permissions, '[]'::jsonb),
        last_activity = now()
    WHERE session_id = p_session_id;
  END IF;

  IF v_perfil_id IS NOT NULL THEN
    SELECT to_jsonb(p) INTO v_perfil FROM perfis p WHERE p.id = v_perfil_id LIMIT 1;
  END IF;

  SELECT to_jsonb(u) INTO v_user FROM usuarios u WHERE u.id::text = v_user_id LIMIT 1;

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'user', jsonb_build_object(
      'id', COALESCE(v_user->>'id', v_user_id),
      'nome_completo', COALESCE(v_user->>'nome_completo', v_session->>'nome_completo'),
      'usuario', COALESCE(v_user->>'usuario', v_session->>'usuario'),
      'nivel_acesso', COALESCE(v_user->>'nivel_acesso', v_session->>'nivel_acesso'),
      'status', COALESCE(v_user->>'status', 'Ativo'),
      'tipo', COALESCE(v_user->>'tipo', v_session->>'tipo'),
      'cliente', COALESCE(v_user->>'cliente', v_session->>'cliente'),
      'cargo', COALESCE(v_user->>'cargo', v_session->>'cargo'),
      'preferred_language', COALESCE(NULLIF(v_user->>'preferred_language', ''), 'pt-BR'),
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

GRANT EXECUTE ON FUNCTION validate_session(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION destroy_session(p_session_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM sessions WHERE session_id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION destroy_session(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION update_user_language(p_session_id text, p_language text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id text;
BEGIN
  SELECT user_id INTO v_user_id
  FROM sessions WHERE session_id = p_session_id AND expires_at > now();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sessão inválida');
  END IF;

  UPDATE usuarios
  SET preferred_language = COALESCE(NULLIF(btrim(p_language), ''), 'pt-BR'),
      updated_at = now()
  WHERE id::text = v_user_id;

  RETURN jsonb_build_object('success', true, 'preferred_language', COALESCE(NULLIF(btrim(p_language), ''), 'pt-BR'));
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_language(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM sessions WHERE expires_at <= now();
END;
$$;

-- Public product RPCs (Transbordo)
CREATE OR REPLACE FUNCTION get_public_produto_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row produtos%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('public:get_public_produto_info', p_token);
  SELECT * INTO v_row FROM produtos WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'codigo', v_row.codigo,
    'produto', v_row.produto,
    'cliente_nome', v_row.cliente_nome,
    'has_sds', (v_row.fds_url IS NOT NULL AND btrim(v_row.fds_url) <> '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_produto_info(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_public_produto_sds_path(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row produtos%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('public:get_public_produto_sds_path', p_token);
  SELECT * INTO v_row FROM produtos WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'fds_url', v_row.fds_url,
    'fds_filename', v_row.fds_filename
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_produto_sds_path(text) TO anon, authenticated;

-- Public lot / COA / MP / SDS (Industrialização) — stubs mínimos compatíveis
CREATE OR REPLACE FUNCTION get_public_lot_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row producoes%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('public:get_public_lot_info', p_token);
  SELECT * INTO v_row FROM producoes WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'op_number', v_row.op_number,
    'product', v_row.product,
    'client', v_row.client,
    'lot', v_row.lot,
    'volume', v_row.volume,
    'status', v_row.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_lot_info(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_public_coa_data(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod producoes%ROWTYPE;
  v_cq cq_resultados%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('public:get_public_coa_data', p_token);
  SELECT * INTO v_prod FROM producoes WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_cq FROM cq_resultados WHERE production_id = v_prod.id
  ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'production', to_jsonb(v_prod),
    'quality', CASE WHEN v_cq.id IS NULL THEN NULL ELSE to_jsonb(v_cq) END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_coa_data(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row estoque_mp%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('public:get_public_raw_material_info', p_token);
  SELECT * INTO v_row FROM estoque_mp WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'mp_code', v_row.mp_code,
    'mp_name', v_row.mp_name,
    'client', v_row.client,
    'lot', v_row.lot,
    'unit', v_row.unit,
    'current_stock', v_row.current_stock
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_public_sds_path(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod producoes%ROWTYPE;
  v_rec receitas%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('public:get_public_sds_path', p_token);
  SELECT * INTO v_prod FROM producoes WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_prod.recipe_id IS NOT NULL THEN
    SELECT * INTO v_rec FROM receitas WHERE id = v_prod.recipe_id LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'fds_url', v_rec.fds_url,
    'fds_filename', v_rec.fds_filename
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_sds_path(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION submit_operational_checklist(
  p_production_id text,
  p_etapa text,
  p_answers jsonb,
  p_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
  v_prod producoes%ROWTYPE;
  v_ans jsonb;
  v_user_id text;
  v_user_nome text;
BEGIN
  IF p_session_id IS NOT NULL THEN
    SELECT to_jsonb(s) INTO v_session FROM sessions s
    WHERE s.session_id = p_session_id AND s.expires_at > now();
  ELSE
    v_session := get_current_session();
  END IF;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sessão inválida');
  END IF;

  v_user_id := v_session->>'user_id';
  v_user_nome := v_session->>'nome_completo';

  SELECT * INTO v_prod FROM producoes WHERE id::text = p_production_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Produção não encontrada');
  END IF;

  FOR v_ans IN SELECT * FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb))
  LOOP
    INSERT INTO checklist_producao (
      production_id, op_number, product, recipe_id, recipe_revision,
      etapa, question_key, question_label, answer, observacao,
      usuario_id, usuario_nome, answered_at
    ) VALUES (
      v_prod.id,
      v_prod.op_number,
      v_prod.product,
      v_prod.recipe_id,
      v_prod.recipe_revision,
      p_etapa,
      COALESCE(v_ans->>'question_key', v_ans->>'key', 'unknown'),
      COALESCE(v_ans->>'question_label', v_ans->>'label', ''),
      COALESCE(v_ans->>'answer', ''),
      v_ans->>'observacao',
      v_user_id,
      v_user_nome,
      now()
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_operational_checklist(text, text, jsonb, text) TO anon, authenticated;
