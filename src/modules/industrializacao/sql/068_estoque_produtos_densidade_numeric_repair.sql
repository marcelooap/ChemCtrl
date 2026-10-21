-- =============================================================================
-- 068_repair — use SOMENTE se a 068 falhou no meio e densidade já é numeric,
-- mas densidade_legacy não foi preenchida para os 29 registros com vírgula.
-- Não altera densidade; só backfill de legacy a partir do backup ou valores conhecidos.
-- =============================================================================
-- Se você ainda tem vírgula em legacy ou backup JSON, rode manualmente, ex.:
-- UPDATE estoque_produtos SET densidade_legacy = '1,070' WHERE id = 9 AND densidade_legacy IS NULL;
--
-- Verificação:
-- SELECT count(*) FROM estoque_produtos WHERE densidade_legacy IS NOT NULL;
-- SELECT id, densidade, densidade_legacy FROM estoque_produtos WHERE densidade_legacy IS NOT NULL LIMIT 10;

SELECT
  (SELECT data_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'estoque_produtos' AND column_name = 'densidade') AS densidade_type,
  (SELECT count(*) FROM estoque_produtos WHERE densidade_legacy IS NOT NULL) AS legacy_filled,
  (SELECT count(*) FROM estoque_produtos WHERE densidade IS NOT NULL) AS densidade_filled;
