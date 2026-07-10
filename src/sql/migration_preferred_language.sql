-- ============================================================================
-- Migration: preferred_language on usuarios (i18n user preference)
-- Does NOT modify sessions table.
-- ============================================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'pt-BR'
  CHECK (preferred_language IN ('pt-BR', 'en', 'es', 'fr'));

-- ============================================================================
-- Update login_user to return preferred_language in user JSON
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
  SELECT id, nome_completo, usuario, nivel_acesso, status, tipo, cliente, cargo, senha_hash, preferred_language
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
      'cargo', v_user.cargo,
      'preferred_language', COALESCE(v_user.preferred_language, 'pt-BR')
    )
  );
END;
$$;

-- ============================================================================
-- Update user language preference (usuarios only)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_user_language(p_session_id text, p_language text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id text;
BEGIN
  IF p_language NOT IN ('pt-BR', 'en', 'es', 'fr') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid language.');
  END IF;

  SELECT user_id INTO v_user_id
  FROM sessions
  WHERE session_id = p_session_id
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session expired.');
  END IF;

  UPDATE usuarios
  SET preferred_language = p_language,
      updated_date = now()
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'preferred_language', p_language);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_language(text, text) TO anon;
