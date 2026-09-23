-- ============================================================
-- Migration: snapshot da locação na descontaminação
-- Grava, no momento do registro, o ITKU, o cliente e o produto
-- que estava em uso no tanka antes da descontaminação.
-- Sem isso o relatório passaria a refletir edições posteriores
-- do cadastro do isotanque.
--
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE t_descontaminacoes
  ADD COLUMN IF NOT EXISTS codigo_itku text;

ALTER TABLE t_descontaminacoes
  ADD COLUMN IF NOT EXISTS cliente_nome text;

ALTER TABLE t_descontaminacoes
  ADD COLUMN IF NOT EXISTS produto_nome text;

COMMENT ON COLUMN t_descontaminacoes.produto_nome IS
  'Produto que estava em uso no tanka antes da descontaminação';

-- Preenche registros antigos com a locação vigente na data.
UPDATE t_descontaminacoes d
SET
  codigo_itku = sub.codigo_itku,
  cliente_nome = sub.cliente_nome,
  produto_nome = sub.produto_nome
FROM (
  SELECT DISTINCT ON (d2.id)
    d2.id,
    i.codigo_itku,
    i.cliente_nome,
    i.produto_nome
  FROM t_descontaminacoes d2
  JOIN t_isotanques i
    ON lower(trim(i.tanka)) = lower(trim(d2.tanka))
   AND i.inicio_locacao IS NOT NULL
   AND i.inicio_locacao <= d2.data_descontaminacao
  ORDER BY d2.id, i.inicio_locacao DESC, i.created_at DESC
) sub
WHERE d.id = sub.id
  AND d.produto_nome IS NULL;
