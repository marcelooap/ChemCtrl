-- =============================================================================
-- 067_estoque_produtos_foreign_keys.sql
-- FKs para produto_id, cliente_id, vasilhame_id.
-- Pré-condição (REST 2026-10-21): 0 órfãos em 351 linhas.
-- MP mantém produto_id/cliente_id nulos por design; FK permite NULL.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_orf_prod bigint;
  v_orf_cli bigint;
  v_orf_vas bigint;
BEGIN
  IF to_regclass('public.cadastro_produtos') IS NULL THEN
    RAISE EXCEPTION '067: cadastro_produtos ausente';
  END IF;
  IF to_regclass('public.t_clientes') IS NULL THEN
    RAISE EXCEPTION '067: t_clientes ausente';
  END IF;
  IF to_regclass('public.t_vasilhames') IS NULL THEN
    RAISE EXCEPTION '067: t_vasilhames ausente';
  END IF;

  SELECT count(*) INTO v_orf_prod
  FROM estoque_produtos e
  WHERE e.produto_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM cadastro_produtos p WHERE p.id = e.produto_id);

  SELECT count(*) INTO v_orf_cli
  FROM estoque_produtos e
  WHERE e.cliente_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM t_clientes c WHERE c.id = e.cliente_id);

  SELECT count(*) INTO v_orf_vas
  FROM estoque_produtos e
  WHERE e.vasilhame_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM t_vasilhames v WHERE v.id = e.vasilhame_id);

  IF v_orf_prod > 0 OR v_orf_cli > 0 OR v_orf_vas > 0 THEN
    RAISE EXCEPTION '067: órfãos prod=%, cli=%, vas=%. Abortado.', v_orf_prod, v_orf_cli, v_orf_vas;
  END IF;
END $$;

ALTER TABLE estoque_produtos DROP CONSTRAINT IF EXISTS fk_estoque_produtos_produto_id;
ALTER TABLE estoque_produtos DROP CONSTRAINT IF EXISTS fk_estoque_produtos_cliente_id;
ALTER TABLE estoque_produtos DROP CONSTRAINT IF EXISTS fk_estoque_produtos_vasilhame_id;

ALTER TABLE estoque_produtos
  ADD CONSTRAINT fk_estoque_produtos_produto_id
    FOREIGN KEY (produto_id) REFERENCES cadastro_produtos(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT fk_estoque_produtos_cliente_id
    FOREIGN KEY (cliente_id) REFERENCES t_clientes(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT fk_estoque_produtos_vasilhame_id
    FOREIGN KEY (vasilhame_id) REFERENCES t_vasilhames(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE estoque_produtos VALIDATE CONSTRAINT fk_estoque_produtos_produto_id;
ALTER TABLE estoque_produtos VALIDATE CONSTRAINT fk_estoque_produtos_cliente_id;
ALTER TABLE estoque_produtos VALIDATE CONSTRAINT fk_estoque_produtos_vasilhame_id;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
