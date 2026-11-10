-- =============================================================================
-- 004_t_vasilhames_capacidade_nominal.sql
-- Cadastro persistente da capacidade nominal por identidade física do tanque
-- (placa + barril). Reutilizado entre ciclos de faturamento.
-- Idempotente. Aplicar no SQL Editor do Supabase (ChemFlow).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS t_vasilhames_capacidade_nominal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key text NOT NULL,
  placa text,
  barril text,
  capacidade_litros numeric(12, 3) NOT NULL,
  origem text NOT NULL DEFAULT 'manual'
    CHECK (origem IN ('manual', 'historico', 'cadastro')),
  confirmada boolean NOT NULL DEFAULT false,
  vasilhame_id uuid,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_t_vasilhames_capacidade_nominal_positiva
    CHECK (capacidade_litros > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_t_vasilhames_capacidade_nominal_identity
  ON t_vasilhames_capacidade_nominal (identity_key);

CREATE INDEX IF NOT EXISTS idx_t_vasilhames_capacidade_nominal_placa
  ON t_vasilhames_capacidade_nominal (placa);

CREATE INDEX IF NOT EXISTS idx_t_vasilhames_capacidade_nominal_confirmada
  ON t_vasilhames_capacidade_nominal (confirmada);

COMMENT ON TABLE t_vasilhames_capacidade_nominal IS
  'Capacidade nominal confirmada/inferida por tanque físico (placa/barril).';
COMMENT ON COLUMN t_vasilhames_capacidade_nominal.identity_key IS
  'Chave normalizada PLACA|BARRIL (ou só um dos dois quando o outro estiver vazio).';
COMMENT ON COLUMN t_vasilhames_capacidade_nominal.confirmada IS
  'true = definida/confirmada pelo usuário; não pode ser sobrescrita por inferência.';
COMMENT ON COLUMN t_vasilhames_capacidade_nominal.origem IS
  'manual = usuário; historico = inferida; cadastro = campo operacional do tanque.';

CREATE OR REPLACE FUNCTION t_vasilhames_capacidade_nominal_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_t_vasilhames_capacidade_nominal_updated_at
  ON t_vasilhames_capacidade_nominal;
CREATE TRIGGER trg_t_vasilhames_capacidade_nominal_updated_at
  BEFORE UPDATE ON t_vasilhames_capacidade_nominal
  FOR EACH ROW
  EXECUTE FUNCTION t_vasilhames_capacidade_nominal_set_updated_at();

ALTER TABLE t_vasilhames_capacidade_nominal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_anon_all_t_vasilhames_capacidade_nominal
  ON t_vasilhames_capacidade_nominal;
CREATE POLICY t_anon_all_t_vasilhames_capacidade_nominal
  ON t_vasilhames_capacidade_nominal
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
