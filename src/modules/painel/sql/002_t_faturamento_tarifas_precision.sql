-- =============================================================================
-- 002_t_faturamento_tarifas_precision.sql
-- Amplia precisão das tarifas para até 15 casas decimais.
-- Idempotente. Aplicar no SQL Editor do Supabase (ChemFlow).
-- =============================================================================

BEGIN;

ALTER TABLE t_faturamento_tarifas
  ALTER COLUMN movimentacao_palete TYPE numeric(30, 15)
    USING movimentacao_palete::numeric(30, 15),
  ALTER COLUMN armazenagem_tenda TYPE numeric(30, 15)
    USING armazenagem_tenda::numeric(30, 15),
  ALTER COLUMN armazenagem_patio TYPE numeric(30, 15)
    USING armazenagem_patio::numeric(30, 15);

COMMENT ON COLUMN t_faturamento_tarifas.movimentacao_palete IS
  'Valor R$ por palete movimentado (entrada ou saída). Até 15 casas decimais.';
COMMENT ON COLUMN t_faturamento_tarifas.armazenagem_tenda IS
  'Valor R$ por palete/dia na Tenda. Até 15 casas decimais.';
COMMENT ON COLUMN t_faturamento_tarifas.armazenagem_patio IS
  'Valor R$ por palete/dia no Pátio. Até 15 casas decimais.';

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
