-- Reverte tipo para text; repõe vírgula a partir de densidade_legacy quando existir.
BEGIN;

ALTER TABLE estoque_produtos
  ALTER COLUMN densidade TYPE text
  USING CASE
    WHEN densidade IS NULL THEN NULL
    ELSE densidade::text
  END;

UPDATE estoque_produtos
SET densidade = densidade_legacy
WHERE densidade_legacy IS NOT NULL AND btrim(densidade_legacy) <> '';

ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS densidade_legacy;

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
