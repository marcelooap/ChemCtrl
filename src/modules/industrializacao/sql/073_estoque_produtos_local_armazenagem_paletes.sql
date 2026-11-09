-- =============================================================================
-- 073_estoque_produtos_local_armazenagem_paletes.sql
-- Local de armazenagem (Tenda|Pátio) e quantidade de paletes para recebimento
-- embalado. Idempotente. Aplicar no SQL Editor do Supabase.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.estoque_produtos') IS NULL THEN
    RAISE EXCEPTION '073: estoque_produtos não existe';
  END IF;
END $$;

ALTER TABLE estoque_produtos
  ADD COLUMN IF NOT EXISTS local_armazenagem text,
  ADD COLUMN IF NOT EXISTS qtd_paletes numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'estoque_produtos_local_armazenagem_check'
  ) THEN
    ALTER TABLE estoque_produtos
      ADD CONSTRAINT estoque_produtos_local_armazenagem_check
      CHECK (
        local_armazenagem IS NULL
        OR local_armazenagem IN ('Tenda', 'Pátio')
      );
  END IF;
END $$;

COMMENT ON COLUMN estoque_produtos.local_armazenagem IS
  'Local de armazenagem do produto embalado: Tenda ou Pátio.';

COMMENT ON COLUMN estoque_produtos.qtd_paletes IS
  'Quantidade de paletes recebidos no recebimento embalado.';

-- Mantém o JSON de lote alinhado às novas colunas (consulta pública / views).
CREATE OR REPLACE FUNCTION ep_item_json(p estoque_produtos)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'produto_id', p.produto_id,
    'produto_nome', p.produto_nome,
    'produto_codigo', p.produto_codigo,
    'nota_fiscal', p.nota_fiscal,
    'lote', p.lote,
    'densidade', p.densidade,
    'quantidade', p.saldo_inicial,
    'unidade_medida', p.unidade_medida,
    'data_fabricacao', p.data_fabricacao,
    'data_validade', p.data_validade,
    'validade_indeterminada', p.validade_indeterminada,
    'preco_unitario', p.preco_unitario,
    'tipo_recebimento', p.tipo_recebimento,
    'tipo_embalagem', p.tipo_embalagem,
    'embalado', p.embalado,
    'peso_liquido', p.peso_liquido,
    'quantidade_embalagens', p.quantidade_embalagens,
    'local_armazenagem', p.local_armazenagem,
    'qtd_paletes', p.qtd_paletes,
    'placa', v.placa,
    'barril', v.barril,
    'volume', v.volume,
    'tara', v.tara,
    'lacres', v.lacres,
    'eslinga', v.eslinga,
    'gps', v.gps,
    'menor_teste', v.menor_teste,
    'fracionado', v.fracionado,
    'peso_bruto', v.peso_bruto,
    'vasilhame_id', p.vasilhame_id,
    'ind_mp_id', p.legacy_mp_id_text
  ))
  FROM (SELECT 1) AS anchor
  LEFT JOIN t_vasilhames v ON v.id = p.vasilhame_id;
$$;

COMMIT;
