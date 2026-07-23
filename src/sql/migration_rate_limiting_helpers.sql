-- ============================================================================
-- Migration: Rate Limiting — Fase 1 (auxiliares, NÃO altera login_user)
--
-- Esta migration é 100% aditiva e segura: cria tabelas novas e funções novas,
-- sem tocar em login_user, validate_session, destroy_session ou qualquer RPC
-- de domínio existente. Pode ser aplicada em produção sem risco de regressão
-- no fluxo de autenticação atual.
--
-- Ordem de aplicação:
--   1) Este arquivo (migration_rate_limiting_helpers.sql)
--   2) Rode a bateria de testes manuais no final deste arquivo
--   3) Só então aplique migration_rate_limiting_login_wire.sql (Fase 2)
--
-- Espelha as constantes de src/lib/rateLimitConfig.ts (LOGIN_MAX_ATTEMPTS=5,
-- LOGIN_WINDOW_MS=15min). Ajuste os dois lados juntos se mudar os valores.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================================
-- 1) TABELAS
-- ============================================================================

-- Contador de tentativas por chave. A chave NUNCA guarda o IP em texto puro
-- (LGPD): é um hash SHA-256 de (escopo + IP + identificador), então esta
-- tabela não permite reidentificar o IP/usuário a partir do seu conteúdo.
CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  key_hash text PRIMARY KEY,
  attempt_count integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_attempts_blocked_until
  ON rate_limit_attempts (blocked_until);

-- Auditoria de bloqueios. Aqui SIM guardamos o IP real (necessário para
-- investigação de abuso), mas nunca senha ou corpo de requisição.
CREATE TABLE IF NOT EXISTS rate_limit_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ip text,
  user_agent text,
  origin text,
  session_id text,
  correlation_id text,
  user_id text,
  usuario text,
  endpoint text,
  route text,
  reason text NOT NULL CHECK (reason IN ('login', 'api', 'public', 'upload', 'download')),
  block_count integer NOT NULL DEFAULT 1,
  blocked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_blocked_at ON rate_limit_logs (blocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_correlation_id ON rate_limit_logs (correlation_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_reason ON rate_limit_logs (reason);

-- RLS: nenhum acesso direto via PostgREST. Todo acesso passa por funções
-- SECURITY DEFINER abaixo — mesmo padrão usado pela tabela `sessions`.
ALTER TABLE rate_limit_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no_direct_access_rate_limit_attempts" ON rate_limit_attempts;
CREATE POLICY "no_direct_access_rate_limit_attempts" ON rate_limit_attempts
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "no_direct_access_rate_limit_logs" ON rate_limit_logs;
CREATE POLICY "no_direct_access_rate_limit_logs" ON rate_limit_logs
  FOR ALL USING (false) WITH CHECK (false);

-- ============================================================================
-- 2) HELPERS DE REQUISIÇÃO (IP, User-Agent, Origin, Session-Id, Correlation-Id)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_request_header(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value text;
  v_headers jsonb;
BEGIN
  v_value := NULLIF(current_setting('request.header.' || p_name, true), '');
  IF v_value IS NOT NULL THEN
    RETURN v_value;
  END IF;

  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
    v_value := NULLIF(v_headers ->> p_name, '');
  EXCEPTION WHEN OTHERS THEN
    v_value := NULL;
  END;

  RETURN v_value;
END;
$$;

-- IP real do cliente. Prioriza x-forwarded-for (padrão em proxies/CDNs, incluindo
-- Vercel); cai para cf-connecting-ip e x-real-ip. Nunca falha a requisição —
-- na ausência de qualquer header, retorna 'unknown' (mais seguro do que travar login).
CREATE OR REPLACE FUNCTION get_request_client_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

-- Chave de rate limit hasheada (LGPD): nunca persiste IP/usuário em texto puro
-- na tabela de contadores. `p_scope` isola o namespace (ex.: 'login', 'public:get_public_lot_info').
CREATE OR REPLACE FUNCTION make_rate_limit_key(p_scope text, p_identifier text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
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

-- ============================================================================
-- 3) NÚCLEO GENÉRICO DE SLIDING WINDOW (reutilizado por login e APIs públicas)
-- ============================================================================

-- Verifica e incrementa o contador de uma chave. Sliding window real: cada
-- chamada bloqueada estende o bloqueio a partir do momento atual, e a janela
-- de contagem é sempre "os últimos N segundos", nunca uma janela de relógio
-- fixa (evita o efeito de pico na virada do minuto).
CREATE OR REPLACE FUNCTION rate_limit_hit(
  p_key_hash text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer
)
RETURNS TABLE(blocked boolean, retry_after_seconds integer, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row rate_limit_attempts;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_row FROM rate_limit_attempts WHERE key_hash = p_key_hash FOR UPDATE;

  IF v_row.key_hash IS NOT NULL AND v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN QUERY SELECT true, CEIL(EXTRACT(EPOCH FROM (v_row.blocked_until - v_now)))::integer, v_row.attempt_count;
    RETURN;
  END IF;

  IF v_row.key_hash IS NULL THEN
    INSERT INTO rate_limit_attempts (key_hash, attempt_count, window_start, updated_at)
    VALUES (p_key_hash, 1, v_now, v_now);
    RETURN QUERY SELECT false, 0, 1;
    RETURN;
  END IF;

  -- Fora da janela: reinicia a contagem sem penalizar o próximo período.
  IF v_now - v_row.window_start > (p_window_seconds || ' seconds')::interval THEN
    UPDATE rate_limit_attempts
    SET attempt_count = 1, window_start = v_now, blocked_until = NULL, updated_at = v_now
    WHERE key_hash = p_key_hash;
    RETURN QUERY SELECT false, 0, 1;
    RETURN;
  END IF;

  IF v_row.attempt_count + 1 >= p_max_attempts THEN
    UPDATE rate_limit_attempts
    SET attempt_count = v_row.attempt_count + 1,
        blocked_until = v_now + (p_block_seconds || ' seconds')::interval,
        updated_at = v_now
    WHERE key_hash = p_key_hash;
    RETURN QUERY SELECT true, p_block_seconds, v_row.attempt_count + 1;
    RETURN;
  END IF;

  UPDATE rate_limit_attempts
  SET attempt_count = v_row.attempt_count + 1, updated_at = v_now
  WHERE key_hash = p_key_hash;
  RETURN QUERY SELECT false, 0, v_row.attempt_count + 1;
END;
$$;

CREATE OR REPLACE FUNCTION rate_limit_is_blocked(p_key_hash text)
RETURNS TABLE(blocked boolean, retry_after_seconds integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (blocked_until IS NOT NULL AND blocked_until > now()),
    CASE WHEN blocked_until IS NOT NULL AND blocked_until > now()
      THEN CEIL(EXTRACT(EPOCH FROM (blocked_until - now())))::integer
      ELSE 0
    END
  FROM rate_limit_attempts
  WHERE key_hash = p_key_hash;
$$;

CREATE OR REPLACE FUNCTION rate_limit_reset(p_key_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM rate_limit_attempts WHERE key_hash = p_key_hash;
$$;

-- ============================================================================
-- 4) LOG (User-Agent, Origin, Session-Id, Correlation-Id, IP — nunca senha)
-- ============================================================================

CREATE OR REPLACE FUNCTION log_rate_limit_event(
  p_reason text,
  p_endpoint text,
  p_route text DEFAULT NULL,
  p_user_id text DEFAULT NULL,
  p_usuario text DEFAULT NULL,
  p_block_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO rate_limit_logs (
    ip, user_agent, origin, session_id, correlation_id,
    user_id, usuario, endpoint, route, reason, block_count
  ) VALUES (
    get_request_client_ip(),
    get_request_header('user-agent'),
    get_request_header('origin'),
    get_request_header('x-session-id'),
    get_request_header('x-correlation-id'),
    p_user_id,
    p_usuario,
    p_endpoint,
    p_route,
    p_reason,
    p_block_count
  );
END;
$$;

-- ============================================================================
-- 5) LOGIN — auxiliares específicas (usadas somente na Fase 2, dentro de login_user)
--    Consulte src/lib/rateLimitConfig.ts para manter os números sincronizados.
-- ============================================================================

-- Somente verifica (não incrementa) — chamada no início de login_user, antes
-- de validar usuário/senha, para bloquear igualmente tentativas com usuário
-- inexistente e com senha errada (anti-enumeração).
CREATE OR REPLACE FUNCTION check_login_rate_limit(p_username text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := make_rate_limit_key('login', p_username);
  v_status record;
BEGIN
  SELECT * INTO v_status FROM rate_limit_is_blocked(v_key);
  IF v_status.blocked THEN
    RAISE EXCEPTION 'Muitas tentativas de login. Aguarde alguns minutos antes de tentar novamente.'
      USING ERRCODE = 'PT429',
            DETAIL = json_build_object('retry_after_seconds', v_status.retry_after_seconds)::text;
  END IF;
END;
$$;

-- Chamada após uma tentativa de login falhar (usuário inexistente, inativo com
-- senha incorreta não se aplica — inativo é caso de negócio, não de força bruta
-- — ou senha errada). Incrementa o contador; ao atingir o limite, bloqueia e loga.
CREATE OR REPLACE FUNCTION register_failed_login_attempt(p_username text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := make_rate_limit_key('login', p_username);
  v_result record;
BEGIN
  SELECT * INTO v_result FROM rate_limit_hit(v_key, 5, 15 * 60, 15 * 60);
  IF v_result.blocked THEN
    PERFORM log_rate_limit_event('login', 'login_user', '/login', NULL, p_username, v_result.attempt_count);
  END IF;
END;
$$;

-- Chamada em login bem-sucedido — limpa o contador da chave (IP + usuário).
CREATE OR REPLACE FUNCTION reset_login_attempts(p_username text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rate_limit_reset(make_rate_limit_key('login', p_username));
$$;

-- ============================================================================
-- 6) APIs PÚBLICAS — proteção genérica por IP (consulta pública / QR Code)
--    Usada dentro das RPCs get_public_lot_info / get_public_coa_data /
--    get_public_sds_path — ver migration_rate_limiting_public_wire.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_public_rate_limit(p_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := make_rate_limit_key('public:' || p_endpoint, '');
  v_result record;
BEGIN
  SELECT * INTO v_result FROM rate_limit_hit(v_key, 30, 60, 60);
  IF v_result.blocked THEN
    PERFORM log_rate_limit_event('public', p_endpoint, NULL, NULL, NULL, v_result.attempt_count);
    RAISE EXCEPTION 'Muitas requisições. Aguarde alguns segundos.'
      USING ERRCODE = 'PT429',
            DETAIL = json_build_object('retry_after_seconds', 60)::text;
  END IF;
END;
$$;

-- ============================================================================
-- 7) GRANTS
--    anon precisa executar check/register/reset diretamente para permitir os
--    testes manuais abaixo via supabase.rpc(...) antes da Fase 2. Os helpers
--    internos (get_request_*, make_rate_limit_key, rate_limit_hit/is_blocked/
--    reset, log_rate_limit_event) NÃO são expostos a anon — só chamados de
--    dentro de outras funções SECURITY DEFINER.
-- ============================================================================

GRANT EXECUTE ON FUNCTION check_login_rate_limit(text) TO anon;
GRANT EXECUTE ON FUNCTION register_failed_login_attempt(text) TO anon;
GRANT EXECUTE ON FUNCTION reset_login_attempts(text) TO anon;
GRANT EXECUTE ON FUNCTION enforce_public_rate_limit(text) TO anon, authenticated;

-- ============================================================================
-- 8) TESTES MANUAIS (Fase 1) — rode no SQL Editor do Supabase antes da Fase 2
-- ============================================================================
--
-- -- a) Hash estável e sem IP em texto puro na tabela:
-- SELECT make_rate_limit_key('login', 'usuario.teste');
-- SELECT * FROM rate_limit_attempts; -- key_hash não deve ser um IP nem username legível
--
-- -- b) Simula 5 falhas e confirma bloqueio na 5ª:
-- SELECT register_failed_login_attempt('usuario.teste'); -- x5
-- SELECT check_login_rate_limit('usuario.teste'); -- deve levantar PT429 (HTTP 429)
--
-- -- c) Reset libera imediatamente:
-- SELECT reset_login_attempts('usuario.teste');
-- SELECT check_login_rate_limit('usuario.teste'); -- não deve levantar erro
--
-- -- d) Log sem senha, com metadados:
-- SELECT ip, user_agent, origin, session_id, correlation_id, usuario, reason, block_count
-- FROM rate_limit_logs ORDER BY blocked_at DESC LIMIT 5;
--
-- -- e) login_user, validate_session e destroy_session continuam intactos
-- --    (esta migration não os toca — confirme rodando um login real na aplicação).
-- ============================================================================
