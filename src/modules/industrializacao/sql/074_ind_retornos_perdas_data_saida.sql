-- ============================================================================
-- MIGRATION: data_saida em movimentações fiscais de MP (ind_retornos_perdas)
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
--
-- Espelha o comportamento de data_saida/departure_date dos vasilhames:
-- preenchida quando o Retorno de MP Não Aplicada é aplicado em solicitação de saída.
-- Perda em Processo permanece NULL (UI exibe "-").
-- ============================================================================

ALTER TABLE ind_retornos_perdas
  ADD COLUMN IF NOT EXISTS data_saida date;

COMMENT ON COLUMN ind_retornos_perdas.data_saida IS
  'Data de saída comercial do retorno de MP (data programada da saída). Nula para Perda em Processo e retornos ainda não aplicados.';

CREATE INDEX IF NOT EXISTS idx_ind_retornos_perdas_data_saida
  ON ind_retornos_perdas (data_saida);

-- Backfill histórico: retornos MP229+ (número do entry_id >= 229) → 31/10/2026
UPDATE ind_retornos_perdas
SET data_saida = DATE '2026-10-31'
WHERE destination = 'Retorno de MP Não Aplicada'
  AND data_saida IS NULL
  AND entry_id ~* '^MP[0-9]+$'
  AND CAST(substring(entry_id from 3) AS integer) >= 229;

-- Perda em Processo: garantir NULL (UI mostra "-")
UPDATE ind_retornos_perdas
SET data_saida = NULL
WHERE destination = 'Perda em Processo'
  AND data_saida IS NOT NULL;
