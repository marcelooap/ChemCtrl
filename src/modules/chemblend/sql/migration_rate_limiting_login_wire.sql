-- ============================================================================
-- Migration: Rate Limiting — Fase 2 (integração em login_user)
--
-- ATENÇÃO — aplique esta migration SOMENTE depois de:
--   1) Ter aplicado migration_rate_limiting_helpers.sql (Fase 1)
--   2) Ter rodado a bateria de testes manuais da Fase 1 com sucesso
--   3) Ter validado, na tela de login real do ChemCtrl, que login válido
--      e login inválido continuam funcionando exatamente como hoje
--
-- Esta migration assume que a versão ATUALMENTE ativa de login_user no seu
-- banco é a de src/sql/migration_rbac_login_fix.sql (a versão "à prova de
-- colunas", com to_jsonb, perfil/permissions e preferred_language — é a mais
-- completa e recente entre os arquivos de migration do projeto).
--
-- Antes de rodar, CONFIRME isso no SQL Editor do Supabase:
--   SELECT prosrc FROM pg_proc WHERE proname = 'login_user';
-- Se o corpo retornado for MUITO diferente do login_user abaixo (fora as 4
-- linhas marcadas com "-- [RATE LIMIT]"), NÃO rode este arquivo — adapte os
-- 4 pontos de inserção manualmente na sua versão atual, copiando as chamadas
-- marcadas abaixo, em vez de substituir a função inteira.
--
-- O que muda no comportamento de login_user (e só isso):
--   - Início da função: verifica se a chave (IP + usuário) está bloqueada;
--     se estiver, levanta erro HTTP 429 com a mensagem genérica de login
--     (sem revelar se o bloqueio é por IP ou por usuário).
--   - Usuário inexistente OU senha incorreta: registra uma tentativa falha
--     (mesma mensagem genérica de sempre — nenhuma mudança visível para o
--     usuário final, só passa a contar para o rate limit).
--   - Usuário inativo: comportamento 100% inalterado (não é sinal de força
--     bruta, não conta tentativa).
--   - Login bem-sucedido: reseta o contador da chave e retorna o MESMO JSON
--     de sempre (success/session_id/user), sem nenhum campo novo ou removido.
-- ============================================================================

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
  -- [RATE LIMIT] bloqueia antes de qualquer consulta a credenciais — protege
  -- igualmente usuário inexistente e senha errada (anti-enumeração).
  PERFORM check_login_rate_limit(p_username);

  SELECT to_jsonb(u) INTO v_row
  FROM usuarios u
  WHERE u.usuario = p_username
  LIMIT 1;

  IF v_row IS NULL THEN
    -- [RATE LIMIT] conta como tentativa falha.
    PERFORM register_failed_login_attempt(p_username);
    RETURN jsonb_build_object('success', false, 'error', 'Usuário ou senha inválidos.');
  END IF;

  v_status := COALESCE(v_row->>'status', 'Ativo');
  IF v_status = 'Inativo' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuário inativo. Contate o administrador do sistema.');
  END IF;

  v_senha_hash := v_row->>'senha_hash';
  IF v_senha_hash IS NULL OR v_senha_hash = '' OR v_senha_hash != extensions.crypt(p_password, v_senha_hash) THEN
    -- [RATE LIMIT] conta como tentativa falha.
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

  -- [RATE LIMIT] login OK — libera a chave para não penalizar acessos futuros.
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
      'permissions', COALESCE(v_permissions, '[]'::jsonb)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION login_user(text, text) TO anon;

-- ============================================================================
-- TESTES MANUAIS (Fase 2) — rode todos antes de considerar a migration concluída
-- ============================================================================
--
-- 1) Login válido — deve funcionar exatamente como antes (mesmo JSON de retorno).
-- 2) Login com senha errada — mesma mensagem "Usuário ou senha inválidos.".
-- 3) Login com usuário inexistente — mesma mensagem "Usuário ou senha inválidos.".
-- 4) Login com usuário inativo — mesma mensagem "Usuário inativo...", SEM contar
--    como tentativa de força bruta (confirme em rate_limit_attempts que a chave
--    não é incrementada por esse motivo).
-- 5) 5 tentativas com senha errada para o MESMO usuário → a 5ª falha já bloqueia;
--    a 6ª tentativa (mesmo com senha certa) retorna HTTP 429 com a mensagem
--    "Muitas tentativas de login. Aguarde alguns minutos antes de tentar novamente.".
-- 6) validate_session (sessão já existente antes desta migration) continua válida.
-- 7) destroy_session (logout) continua funcionando sem qualquer bloqueio.
--
-- Rollback: caso algo falhe, restaure a versão anterior rodando novamente o
-- CREATE OR REPLACE FUNCTION login_user(...) de src/sql/migration_rbac_login_fix.sql
-- (idêntico ao acima, mas sem as 4 linhas marcadas "-- [RATE LIMIT]").
-- ============================================================================
