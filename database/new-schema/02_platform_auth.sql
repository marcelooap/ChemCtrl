-- ============================================================================
-- ChemCtrl v2 — Bloco 02: Platform / Auth
-- ============================================================================
-- NOTA DE COMPATIBILIDADE:
--   perfis.id permanece TEXT com IDs semânticos (perfil_administrador, …)
--   porque o frontend compara perfil?.id === 'perfil_administrador'.
--   usuarios.id → UUID (padronização). sessions.user_id → TEXT (guarda uuid como texto).
--   permissoes.id = codigo (TEXT).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- modulos (nova)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modulos (
  codigo text PRIMARY KEY,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- perfis (PK text semântico — Fase A)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perfis (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nome text NOT NULL UNIQUE,
  slug text UNIQUE,
  descricao text,
  status text NOT NULL DEFAULT 'Ativo',
  is_system boolean NOT NULL DEFAULT false,
  default_route text DEFAULT '/',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS perfil_permissoes (
  perfil_id text NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (perfil_id, permission_key)
);

CREATE TABLE IF NOT EXISTS perfil_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id text REFERENCES perfis(id) ON DELETE SET NULL,
  actor_user_id text,
  actor_usuario text,
  action_type text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS perfil_modulos (
  perfil_id text NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  modulo text NOT NULL REFERENCES modulos(codigo) ON DELETE RESTRICT,
  PRIMARY KEY (perfil_id, modulo)
);

-- ---------------------------------------------------------------------------
-- usuarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_id text,
  nome_completo text NOT NULL,
  usuario text NOT NULL,
  senha text,
  senha_hash text,
  nivel_acesso text DEFAULT 'Operacional',
  status text DEFAULT 'Ativo',
  cargo text,
  tipo text DEFAULT 'interno',
  cliente text,
  criado_por text,
  perfil_id text REFERENCES perfis(id) ON DELETE SET NULL,
  preferred_language text DEFAULT 'pt-BR'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_usuario
  ON usuarios (lower(btrim(usuario)));
CREATE INDEX IF NOT EXISTS idx_usuarios_perfil_id ON usuarios (perfil_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_status ON usuarios (status);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  session_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL,
  nome_completo text,
  usuario text,
  nivel_acesso text,
  tipo text DEFAULT 'interno',
  cliente text,
  cargo text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  last_activity timestamptz DEFAULT now(),
  perfil_id text,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- permissoes / usuario_permissoes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissoes (
  id text PRIMARY KEY,
  modulo text NOT NULL,
  tela text,
  acao text NOT NULL,
  codigo text NOT NULL UNIQUE,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permissoes_modulo ON permissoes (modulo);
CREATE INDEX IF NOT EXISTS idx_permissoes_ativo ON permissoes (ativo);

CREATE TABLE IF NOT EXISTS usuario_permissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  permissao_id text NOT NULL REFERENCES permissoes(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (usuario_id, permissao_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_permissoes_usuario ON usuario_permissoes (usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_permissoes_permissao ON usuario_permissoes (permissao_id);

-- ---------------------------------------------------------------------------
-- rate limiting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  key_hash text PRIMARY KEY,
  attempt_count integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_attempts_blocked_until
  ON rate_limit_attempts (blocked_until);

CREATE TABLE IF NOT EXISTS rate_limit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- Trigger: hash de senha + updated_at
CREATE OR REPLACE FUNCTION manage_usuarios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.senha IS NOT NULL AND NEW.senha != '' THEN
    NEW.senha_hash := extensions.crypt(NEW.senha, extensions.gen_salt('bf', 10));
    NEW.senha := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.senha_hash := COALESCE(NEW.senha_hash, OLD.senha_hash);
    NEW.senha := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manage_usuarios ON usuarios;
CREATE TRIGGER trg_manage_usuarios
  BEFORE INSERT OR UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION manage_usuarios();

DROP TRIGGER IF EXISTS trg_perfis_set_updated_at ON perfis;
CREATE TRIGGER trg_perfis_set_updated_at
  BEFORE UPDATE ON perfis
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_modulos_set_updated_at ON modulos;
CREATE TRIGGER trg_modulos_set_updated_at
  BEFORE UPDATE ON modulos
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
