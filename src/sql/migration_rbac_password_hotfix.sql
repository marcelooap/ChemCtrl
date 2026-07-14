-- ============================================================================
-- Hotfix: senha + crypt no schema extensions
-- Resolve "usuário ou senha inválidos" quando senha_hash está NULL/legado
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Permite limpar texto plano após gerar senha_hash
ALTER TABLE usuarios
  ALTER COLUMN senha DROP NOT NULL;

-- 1) Rehashear quem ainda tem senha em texto e hash vazio
UPDATE usuarios
SET senha_hash = extensions.crypt(senha, extensions.gen_salt('bf', 10)),
    senha = NULL
WHERE senha IS NOT NULL
  AND btrim(senha) <> ''
  AND (senha_hash IS NULL OR btrim(senha_hash) = '');

-- 2) Trigger de hash também no schema extensions
CREATE OR REPLACE FUNCTION manage_usuarios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.senha IS NOT NULL AND btrim(NEW.senha) <> '') THEN
    NEW.senha_hash := extensions.crypt(NEW.senha, extensions.gen_salt('bf', 10));
    NEW.senha := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.senha_hash := COALESCE(NEW.senha_hash, OLD.senha_hash);
    IF NEW.senha_hash IS NOT NULL THEN
      NEW.senha := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manage_usuarios_trigger ON usuarios;
CREATE TRIGGER manage_usuarios_trigger
  BEFORE INSERT OR UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION manage_usuarios();

-- 3) login_user: valida hash e faz fallback legado em senha plaintext
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
  v_senha_plain text;
  v_status text;
  v_admin_id text;
  v_ok boolean := false;
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

  v_senha_hash := NULLIF(btrim(COALESCE(v_row->>'senha_hash', '')), '');
  v_senha_plain := NULLIF(v_row->>'senha', '');

  -- 1) bcrypt
  IF v_senha_hash IS NOT NULL THEN
    BEGIN
      v_ok := (v_senha_hash = extensions.crypt(p_password, v_senha_hash));
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
    END;
  END IF;

  -- 2) legado: senha em texto (migração incompleta)
  IF (NOT v_ok) AND v_senha_plain IS NOT NULL AND v_senha_plain = p_password THEN
    v_ok := true;
    UPDATE usuarios
    SET senha_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
        senha = NULL
    WHERE id = v_row->>'id';
  END IF;

  IF NOT v_ok THEN
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
    BEGIN
      v_permissions := get_profile_permission_keys(v_perfil_id);
    EXCEPTION WHEN undefined_function THEN
      v_permissions := '[]'::jsonb;
    END;

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

GRANT EXECUTE ON FUNCTION login_user(text, text) TO anon;
GRANT EXECUTE ON FUNCTION manage_usuarios() TO anon;

-- 4) Reset explícito da senha do usuário admin (descomente se ainda falhar)
-- UPDATE usuarios
-- SET senha_hash = extensions.crypt('jesussave', extensions.gen_salt('bf', 10)),
--     senha = NULL
-- WHERE usuario = 'marcelo.amaral';

SELECT pg_notify('pgrst', 'reload schema');

-- Diagnóstico opcional:
-- SELECT usuario,
--        (senha_hash IS NOT NULL) AS has_hash,
--        (senha IS NOT NULL AND senha <> '') AS has_plain
-- FROM usuarios
-- WHERE usuario = 'marcelo.amaral';
