-- =============================================================================
-- 063_ep_estoque_lotes_array.sql
-- A vista devolve ep_estoque.lotes como lista.
-- Dados do tanque (placa, tara, lacres etc.) não são colunas desta vista:
-- entram em lotes a partir de t_vasilhames, via vasilhame_id.
-- Se 064 ainda não rodou, rode 064 em seguida para remover as colunas.
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS ep_estoque CASCADE;

CREATE VIEW ep_estoque AS
SELECT
  legacy_estoque_id AS id,
  codigo_estoque,
  legacy_entrada_id AS entrada_id,
  id_entrada AS entrada_codigo,
  grupo_entrada,
  cliente_id,
  cliente_nome,
  produto_id,
  produto_nome,
  produto_codigo,
  nota_fiscal,
  nota_fiscal_troca,
  lote,
  densidade,
  data_fabricacao,
  data_validade,
  quantidade,
  unidade_medida,
  saldo_atual,
  preco_unitario,
  custo_total,
  embalado,
  peso_liquido,
  quantidade_embalagens,
  quantidade_nf,
  quantidade_declarada,
  tipo_recebimento,
  tipo_embalagem,
  vasilhame_id,
  status_wms,
  jsonb_build_array(ep_item_json(estoque_produtos)) AS lotes,
  origem,
  granel_pesagem,
  granel_ticket,
  granel_peso_bruto,
  granel_validacao_bruto,
  granel_peso_liquido,
  granel_validacao_liquido,
  granel_erro_admissivel,
  granel_peso_minimo,
  granel_peso_maximo,
  granel_margem,
  data,
  fornecedor,
  comunicacao_enviada,
  public_token_entrada AS public_token,
  created_at,
  updated_at
FROM estoque_produtos
WHERE origem = 'ARMAZENAGEM'
  AND legacy_estoque_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON ep_estoque TO anon, authenticated;

DROP TRIGGER IF EXISTS ep_estoque_ins ON ep_estoque;
CREATE TRIGGER ep_estoque_ins INSTEAD OF INSERT ON ep_estoque
  FOR EACH ROW EXECUTE FUNCTION ep_estoque_insert();
DROP TRIGGER IF EXISTS ep_estoque_upd ON ep_estoque;
CREATE TRIGGER ep_estoque_upd INSTEAD OF UPDATE ON ep_estoque
  FOR EACH ROW EXECUTE FUNCTION ep_estoque_update();
DROP TRIGGER IF EXISTS ep_estoque_del ON ep_estoque;
CREATE TRIGGER ep_estoque_del INSTEAD OF DELETE ON ep_estoque
  FOR EACH ROW EXECUTE FUNCTION ep_estoque_delete();

COMMIT;
