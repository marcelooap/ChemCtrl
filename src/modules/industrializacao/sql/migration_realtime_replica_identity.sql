-- ============================================================
-- OBSOLETO / NÃO EXECUTAR
-- ============================================================
-- Este arquivo referencia tabelas legadas (productions, containers,
-- recipes, …) que NÃO existem mais no schema ind_*.
-- Rodá-lo hoje aborta no primeiro ALTER TABLE.
--
-- Use em vez disso:
--   database/new-schema/08_realtime.sql
--
-- Mantido apenas como histórico. Qualquer execução deve ser bloqueada.
-- ============================================================

DO $$
BEGIN
  RAISE EXCEPTION 'OBSOLETO: migration_realtime_replica_identity.sql — use database/new-schema/08_realtime.sql';
END $$;
