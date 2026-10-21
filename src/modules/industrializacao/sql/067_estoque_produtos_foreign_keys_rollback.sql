BEGIN;
ALTER TABLE estoque_produtos DROP CONSTRAINT IF EXISTS fk_estoque_produtos_produto_id;
ALTER TABLE estoque_produtos DROP CONSTRAINT IF EXISTS fk_estoque_produtos_cliente_id;
ALTER TABLE estoque_produtos DROP CONSTRAINT IF EXISTS fk_estoque_produtos_vasilhame_id;
SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
