-- =============================================================================
-- 069_estoque_produtos_initial_stock_fix.sql
-- Corrige divergência única ARMAZENAGEM (id=348, audit 2026-10-21):
--   quantidade/saldo_atual = 2009.95 (operacional correto)
--   initial_stock = 512.025 (valor parcial legado da edição)
-- Regra: initial_stock documenta a quantidade recebida na linha; alinhar a quantidade
-- quando saldo_atual já reflete a quantidade final (sem perda de saldo).
-- =============================================================================

BEGIN;

UPDATE estoque_produtos
SET initial_stock = quantidade
WHERE id = 348
  AND origem = 'ARMAZENAGEM'
  AND initial_stock IS DISTINCT FROM quantidade
  AND saldo_atual IS NOT DISTINCT FROM quantidade;

-- Se 0 linhas afetadas, a linha já estava correta ou as condições não se aplicam.

COMMIT;
