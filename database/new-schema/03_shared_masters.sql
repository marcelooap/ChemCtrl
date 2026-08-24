-- ============================================================================
-- ChemCtrl v2 — Bloco 03: Shared Masters
-- ============================================================================

CREATE TABLE IF NOT EXISTS clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  responsavel_tecnico text,
  config_etiquetas jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes (lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS operadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operadores_nome_ci
  ON operadores (lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS etiqueta_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome text NOT NULL,
  contexto text NOT NULL,
  tipo text NOT NULL,
  campos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_etiqueta_configs_contexto
    CHECK (contexto IN ('industrializacao', 'convencional')),
  CONSTRAINT chk_etiqueta_configs_tipo
    CHECK (tipo IN ('granel', 'embalado'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_etiqueta_configs_ctx_tipo_cliente
  ON etiqueta_configs (contexto, tipo, lower(btrim(cliente_nome)));
CREATE INDEX IF NOT EXISTS idx_etiqueta_configs_cliente_id
  ON etiqueta_configs (cliente_id);

DROP TRIGGER IF EXISTS trg_clientes_set_updated_at ON clientes;
CREATE TRIGGER trg_clientes_set_updated_at
  BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_operadores_set_updated_at ON operadores;
CREATE TRIGGER trg_operadores_set_updated_at
  BEFORE UPDATE ON operadores FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_etiqueta_configs_set_updated_at ON etiqueta_configs;
CREATE TRIGGER trg_etiqueta_configs_set_updated_at
  BEFORE UPDATE ON etiqueta_configs FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
