-- =============================================================================
-- 001_t_faturamento_tarifas.sql
-- Tarifas versionadas do faturamento de materiais embalados (Painel).
-- Idempotente. Aplicar no SQL Editor do Supabase (ChemFlow).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS t_faturamento_tarifas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vigencia_inicio date NOT NULL,
  movimentacao_palete numeric(12, 2) NOT NULL,
  armazenagem_tenda numeric(12, 2) NOT NULL,
  armazenagem_patio numeric(12, 2) NOT NULL,
  observacao text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_t_faturamento_tarifas_vigencia
  ON t_faturamento_tarifas (vigencia_inicio);

CREATE INDEX IF NOT EXISTS idx_t_faturamento_tarifas_vigencia_desc
  ON t_faturamento_tarifas (vigencia_inicio DESC);

COMMENT ON TABLE t_faturamento_tarifas IS
  'Tarifas de faturamento embalado com vigência. Reajuste = novo insert; não sobrescreve histórico.';
COMMENT ON COLUMN t_faturamento_tarifas.vigencia_inicio IS
  'Data a partir da qual a tarifa vale (inclusive). Para um dia D usa-se a maior vigencia_inicio <= D.';
COMMENT ON COLUMN t_faturamento_tarifas.movimentacao_palete IS
  'Valor R$ por palete movimentado (entrada ou saída).';
COMMENT ON COLUMN t_faturamento_tarifas.armazenagem_tenda IS
  'Valor R$ por palete/dia na Tenda.';
COMMENT ON COLUMN t_faturamento_tarifas.armazenagem_patio IS
  'Valor R$ por palete/dia no Pátio.';

INSERT INTO t_faturamento_tarifas (
  vigencia_inicio,
  movimentacao_palete,
  armazenagem_tenda,
  armazenagem_patio,
  observacao
)
SELECT
  '2000-01-01'::date,
  25.57,
  2.00,
  1.25,
  'Tarifa inicial — faturamento embalados'
WHERE NOT EXISTS (
  SELECT 1 FROM t_faturamento_tarifas WHERE vigencia_inicio = '2000-01-01'::date
);

ALTER TABLE t_faturamento_tarifas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_anon_all_t_faturamento_tarifas ON t_faturamento_tarifas;
CREATE POLICY t_anon_all_t_faturamento_tarifas ON t_faturamento_tarifas
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
