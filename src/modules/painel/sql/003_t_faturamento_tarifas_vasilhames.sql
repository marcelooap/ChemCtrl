-- =============================================================================
-- 003_t_faturamento_tarifas_vasilhames.sql
-- Tarifas versionadas do faturamento de vasilhames por capacidade nominal.
-- Independente de t_faturamento_tarifas (embalados).
-- Idempotente. Aplicar no SQL Editor do Supabase (ChemFlow).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS t_faturamento_tarifas_vasilhames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacidade_litros numeric(12, 3) NOT NULL,
  tarifa_diaria numeric(30, 15) NOT NULL,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  observacao text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_t_faturamento_tarifas_vasilhames_cap_positiva
    CHECK (capacidade_litros > 0),
  CONSTRAINT chk_t_faturamento_tarifas_vasilhames_tarifa_nao_negativa
    CHECK (tarifa_diaria >= 0),
  CONSTRAINT chk_t_faturamento_tarifas_vasilhames_vigencia
    CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_t_faturamento_tarifas_vasilhames_cap_vigencia
  ON t_faturamento_tarifas_vasilhames (capacidade_litros, vigencia_inicio);

CREATE INDEX IF NOT EXISTS idx_t_faturamento_tarifas_vasilhames_cap
  ON t_faturamento_tarifas_vasilhames (capacidade_litros);

CREATE INDEX IF NOT EXISTS idx_t_faturamento_tarifas_vasilhames_vigencia_desc
  ON t_faturamento_tarifas_vasilhames (vigencia_inicio DESC);

COMMENT ON TABLE t_faturamento_tarifas_vasilhames IS
  'Tarifas diárias de armazenagem de vasilhames por capacidade nominal e vigência.';
COMMENT ON COLUMN t_faturamento_tarifas_vasilhames.capacidade_litros IS
  'Capacidade nominal do tanque (ex.: 1000, 1500, 5000).';
COMMENT ON COLUMN t_faturamento_tarifas_vasilhames.tarifa_diaria IS
  'Valor R$ por dia. Até 15 casas decimais.';
COMMENT ON COLUMN t_faturamento_tarifas_vasilhames.vigencia_inicio IS
  'Início da vigência (inclusive).';
COMMENT ON COLUMN t_faturamento_tarifas_vasilhames.vigencia_fim IS
  'Fim da vigência (inclusive). NULL = aberta até a próxima vigência da mesma capacidade.';

INSERT INTO t_faturamento_tarifas_vasilhames (
  capacidade_litros,
  tarifa_diaria,
  vigencia_inicio,
  observacao
)
SELECT v.capacidade_litros, v.tarifa_diaria, v.vigencia_inicio::date, v.observacao
FROM (
  VALUES
    (5000::numeric, 5.63589476994486::numeric, '2000-01-01', 'Tarifa inicial — vasilhame 5.000 L'),
    (1500::numeric, 1.25242105998775::numeric, '2000-01-01', 'Tarifa inicial — vasilhame 1.500 L'),
    (1000::numeric, 1.25242105998775::numeric, '2000-01-01', 'Tarifa inicial — vasilhame 1.000 L')
) AS v(capacidade_litros, tarifa_diaria, vigencia_inicio, observacao)
WHERE NOT EXISTS (
  SELECT 1
  FROM t_faturamento_tarifas_vasilhames t
  WHERE t.capacidade_litros = v.capacidade_litros
    AND t.vigencia_inicio = v.vigencia_inicio::date
);

ALTER TABLE t_faturamento_tarifas_vasilhames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_anon_all_t_faturamento_tarifas_vasilhames ON t_faturamento_tarifas_vasilhames;
CREATE POLICY t_anon_all_t_faturamento_tarifas_vasilhames ON t_faturamento_tarifas_vasilhames
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
