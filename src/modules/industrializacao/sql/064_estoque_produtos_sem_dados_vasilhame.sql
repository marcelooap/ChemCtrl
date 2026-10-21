-- =============================================================================
-- 064_estoque_produtos_sem_dados_vasilhame.sql
-- Placa, barril, tara, lacres e os demais dados do tanque ficam só em
-- t_vasilhames. estoque_produtos guarda o recebimento, o produto e o
-- vasilhame_id que aponta para esse tanque.
-- Aplicar depois de 061 e 063.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'estoque_produtos'
      AND column_name = 'vasilhame_existente_id'
  ) THEN
    UPDATE estoque_produtos
    SET vasilhame_id = vasilhame_existente_id
    WHERE vasilhame_id IS NULL
      AND vasilhame_existente_id IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'estoque_produtos'
      AND column_name = 'placa'
  ) AND to_regclass('public.t_vasilhames') IS NOT NULL THEN
    UPDATE estoque_produtos ep
    SET vasilhame_id = unico.vasilhame_id
    FROM (
      SELECT ep2.id AS estoque_id, (min(v.id::text))::uuid AS vasilhame_id
      FROM estoque_produtos ep2
      JOIN t_vasilhames v
        ON btrim(v.placa) = btrim(ep2.placa)
       AND coalesce(btrim(v.barril), '') = coalesce(btrim(ep2.barril), '')
      WHERE ep2.vasilhame_id IS NULL
        AND nullif(btrim(ep2.placa), '') IS NOT NULL
      GROUP BY ep2.id
      HAVING count(*) = 1
    ) unico
    WHERE ep.id = unico.estoque_id;
  END IF;
END $$;

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
    'quantidade', p.quantidade,
    'quantidade_nf', p.quantidade_nf,
    'quantidade_declarada', p.quantidade_declarada,
    'unidade_medida', p.unidade_medida,
    'data_fabricacao', p.data_fabricacao,
    'data_validade', p.data_validade,
    'preco_unitario', p.preco_unitario,
    'tipo_recebimento', p.tipo_recebimento,
    'tipo_embalagem', p.tipo_embalagem,
    'embalado', p.embalado,
    'peso_liquido', p.peso_liquido,
    'quantidade_embalagens', p.quantidade_embalagens,
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

CREATE OR REPLACE FUNCTION ep_estoque_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_entrada uuid;
  v_codigo text;
  v_item jsonb;
BEGIN
  v_item := ep_lote_item(ep_as_jsonb(NEW.lotes));
  v_id := COALESCE(NEW.id, gen_random_uuid());
  v_entrada := NEW.entrada_id;
  SELECT id_entrada INTO v_codigo
  FROM estoque_produtos
  WHERE legacy_entrada_id = v_entrada
    AND id_entrada ~ '^E[0-9]+$'
  LIMIT 1;
  IF v_codigo IS NULL THEN
    IF NEW.entrada_codigo ~ '^E[0-9]+$' AND NEW.entrada_codigo !~ '^E0' THEN
      v_codigo := NEW.entrada_codigo;
    ELSE
      v_codigo := next_entrada_id();
    END IF;
  END IF;
  IF v_entrada IS NULL THEN
    v_entrada := gen_random_uuid();
  END IF;

  INSERT INTO estoque_produtos (
    id_entrada, origem, produto_id, produto_nome, produto_codigo,
    cliente_id, cliente_nome, data, nota_fiscal, nota_fiscal_troca,
    lote, densidade, data_fabricacao, data_validade,
    quantidade, initial_stock, unidade_medida, preco_unitario, custo_total,
    saldo_atual, embalado, peso_liquido, quantidade_embalagens,
    quantidade_nf, quantidade_declarada, tipo_recebimento, tipo_embalagem,
    vasilhame_id, status_wms,
    granel_pesagem, granel_ticket, granel_peso_bruto, granel_validacao_bruto,
    granel_peso_liquido, granel_validacao_liquido, granel_erro_admissivel,
    granel_peso_minimo, granel_peso_maximo, granel_margem,
    legacy_estoque_id, legacy_entrada_id, legacy_entrada_codigo,
    grupo_entrada, codigo_estoque, fornecedor, comunicacao_enviada,
    public_token_entrada
  ) VALUES (
    v_codigo, 'ARMAZENAGEM', NEW.produto_id,
    COALESCE(NULLIF(btrim(NEW.produto_nome), ''), 'Produto sem nome'),
    NEW.produto_codigo, NEW.cliente_id, NEW.cliente_nome,
    COALESCE(NEW.data, current_date), NEW.nota_fiscal, NEW.nota_fiscal_troca,
    COALESCE(ep_txt(v_item, 'lote'), NEW.lote),
    COALESCE(ep_txt(v_item, 'densidade'), NEW.densidade),
    NEW.data_fabricacao, NEW.data_validade,
    COALESCE(NEW.quantidade, 0), COALESCE(NEW.quantidade, 0),
    COALESCE(NULLIF(btrim(NEW.unidade_medida), ''), 'kg'),
    NEW.preco_unitario, NEW.custo_total,
    COALESCE(NEW.saldo_atual, NEW.quantidade, 0),
    COALESCE(ep_bool(v_item, 'embalado'), NEW.embalado, false),
    COALESCE(ep_num(v_item, 'peso_liquido'), NEW.peso_liquido),
    COALESCE(ep_num(v_item, 'quantidade_embalagens'), NEW.quantidade_embalagens),
    ep_num(v_item, 'quantidade_nf'),
    ep_num(v_item, 'quantidade_declarada'),
    ep_txt(v_item, 'tipo_recebimento'),
    ep_txt(v_item, 'tipo_embalagem'),
    COALESCE(ep_uuid(v_item ->> 'vasilhame_id'), ep_uuid(v_item ->> 'vasilhame_existente_id')),
    COALESCE(NEW.status_wms, false),
    COALESCE(NEW.granel_pesagem, false),
    NEW.granel_ticket, NEW.granel_peso_bruto, NEW.granel_validacao_bruto,
    NEW.granel_peso_liquido, NEW.granel_validacao_liquido, NEW.granel_erro_admissivel,
    NEW.granel_peso_minimo, NEW.granel_peso_maximo, NEW.granel_margem,
    v_id, v_entrada, NEW.entrada_codigo, NEW.grupo_entrada, NEW.codigo_estoque,
    NEW.fornecedor, COALESCE(NEW.comunicacao_enviada, false), NEW.public_token
  );

  NEW.id := v_id;
  NEW.entrada_id := v_entrada;
  NEW.entrada_codigo := v_codigo;
  NEW.origem := 'ARMAZENAGEM';
  NEW.created_at := COALESCE(NEW.created_at, now());
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ep_estoque_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
BEGIN
  v_item := ep_lote_item(ep_as_jsonb(NEW.lotes));
  UPDATE estoque_produtos
  SET
    produto_id = COALESCE(ep_uuid(v_item ->> 'produto_id'), NEW.produto_id),
    produto_nome = COALESCE(NULLIF(btrim(NEW.produto_nome), ''), produto_nome),
    produto_codigo = NEW.produto_codigo,
    cliente_id = NEW.cliente_id,
    cliente_nome = NEW.cliente_nome,
    nota_fiscal = CASE WHEN v_item ? 'nota_fiscal' THEN ep_txt(v_item, 'nota_fiscal') ELSE NEW.nota_fiscal END,
    nota_fiscal_troca = NEW.nota_fiscal_troca,
    lote = CASE WHEN v_item ? 'lote' THEN ep_txt(v_item, 'lote') ELSE NEW.lote END,
    densidade = CASE WHEN v_item ? 'densidade' THEN ep_txt(v_item, 'densidade') ELSE NEW.densidade END,
    data_fabricacao = NEW.data_fabricacao,
    data_validade = NEW.data_validade,
    quantidade = COALESCE(NEW.quantidade, quantidade),
    unidade_medida = COALESCE(NULLIF(btrim(NEW.unidade_medida), ''), unidade_medida),
    preco_unitario = NEW.preco_unitario,
    custo_total = NEW.custo_total,
    saldo_atual = COALESCE(NEW.saldo_atual, saldo_atual),
    embalado = COALESCE(ep_bool(v_item, 'embalado'), NEW.embalado, embalado),
    peso_liquido = CASE WHEN v_item ? 'peso_liquido' THEN ep_num(v_item, 'peso_liquido') ELSE NEW.peso_liquido END,
    quantidade_embalagens = CASE WHEN v_item ? 'quantidade_embalagens' THEN ep_num(v_item, 'quantidade_embalagens') ELSE NEW.quantidade_embalagens END,
    quantidade_nf = CASE WHEN v_item ? 'quantidade_nf' THEN ep_num(v_item, 'quantidade_nf') ELSE quantidade_nf END,
    quantidade_declarada = CASE WHEN v_item ? 'quantidade_declarada' THEN ep_num(v_item, 'quantidade_declarada') ELSE quantidade_declarada END,
    tipo_recebimento = CASE WHEN v_item ? 'tipo_recebimento' THEN ep_txt(v_item, 'tipo_recebimento') ELSE tipo_recebimento END,
    tipo_embalagem = CASE WHEN v_item ? 'tipo_embalagem' THEN ep_txt(v_item, 'tipo_embalagem') ELSE tipo_embalagem END,
    vasilhame_id = COALESCE(
      ep_uuid(v_item ->> 'vasilhame_id'),
      ep_uuid(v_item ->> 'vasilhame_existente_id'),
      vasilhame_id
    ),
    status_wms = COALESCE(NEW.status_wms, status_wms),
    granel_pesagem = COALESCE(NEW.granel_pesagem, granel_pesagem),
    granel_ticket = NEW.granel_ticket,
    granel_peso_bruto = NEW.granel_peso_bruto,
    granel_validacao_bruto = NEW.granel_validacao_bruto,
    granel_peso_liquido = NEW.granel_peso_liquido,
    granel_validacao_liquido = NEW.granel_validacao_liquido,
    granel_erro_admissivel = NEW.granel_erro_admissivel,
    granel_peso_minimo = NEW.granel_peso_minimo,
    granel_peso_maximo = NEW.granel_peso_maximo,
    granel_margem = NEW.granel_margem,
    grupo_entrada = COALESCE(NEW.grupo_entrada, grupo_entrada)
  WHERE legacy_estoque_id = OLD.id;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

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

DROP VIEW IF EXISTS ep_entradas CASCADE;

CREATE VIEW ep_entradas AS
WITH base AS (
  SELECT
    id,
    legacy_entrada_id,
    id_entrada,
    cliente_id,
    cliente_nome,
    produto_id,
    produto_nome,
    produto_codigo,
    nota_fiscal,
    lote,
    densidade,
    data_fabricacao,
    data_validade,
    unidade_medida,
    preco_unitario,
    embalado,
    peso_liquido,
    quantidade_embalagens,
    status_wms,
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
    grupo_entrada,
    origem,
    fornecedor,
    comunicacao_enviada,
    data,
    public_token_entrada,
    created_at
  FROM estoque_produtos
  WHERE legacy_entrada_id IS NOT NULL
    AND coalesce(grupo_entrada, '') NOT LIKE 'TB%'
),
cab AS (
  SELECT DISTINCT ON (legacy_entrada_id) *
  FROM base
  ORDER BY legacy_entrada_id, id
),
agg AS (
  SELECT
    ep.legacy_entrada_id,
    sum(ep.quantidade) AS quantidade,
    sum(ep.saldo_atual) AS saldo_atual,
    sum(ep.custo_total) AS custo_total,
    max(ep.updated_at) AS updated_at,
    jsonb_agg(ep_item_json(ep) ORDER BY ep.id) AS lotes
  FROM estoque_produtos ep
  WHERE ep.legacy_entrada_id IS NOT NULL
    AND coalesce(ep.grupo_entrada, '') NOT LIKE 'TB%'
  GROUP BY ep.legacy_entrada_id
)
SELECT
  cab.legacy_entrada_id AS id,
  cab.id_entrada,
  cab.cliente_id,
  cab.cliente_nome,
  cab.produto_id,
  cab.produto_nome,
  cab.produto_codigo,
  cab.nota_fiscal,
  cab.lote,
  cab.densidade,
  cab.data_fabricacao,
  cab.data_validade,
  agg.quantidade,
  cab.unidade_medida,
  cab.preco_unitario,
  agg.custo_total,
  agg.saldo_atual,
  cab.embalado,
  cab.peso_liquido,
  cab.quantidade_embalagens,
  cab.status_wms,
  cab.granel_pesagem,
  cab.granel_ticket,
  cab.granel_peso_bruto,
  cab.granel_validacao_bruto,
  cab.granel_peso_liquido,
  cab.granel_validacao_liquido,
  cab.granel_erro_admissivel,
  cab.granel_peso_minimo,
  cab.granel_peso_maximo,
  cab.granel_margem,
  cab.grupo_entrada,
  agg.lotes,
  cab.origem,
  cab.fornecedor,
  cab.comunicacao_enviada,
  cab.data,
  cab.public_token_entrada AS public_token,
  cab.created_at,
  agg.updated_at
FROM cab
JOIN agg ON agg.legacy_entrada_id = cab.legacy_entrada_id;

GRANT SELECT, INSERT, UPDATE, DELETE ON ep_entradas TO anon, authenticated;

DROP TRIGGER IF EXISTS ep_entradas_ins ON ep_entradas;
CREATE TRIGGER ep_entradas_ins INSTEAD OF INSERT ON ep_entradas
  FOR EACH ROW EXECUTE FUNCTION ep_entradas_insert();
DROP TRIGGER IF EXISTS ep_entradas_upd ON ep_entradas;
CREATE TRIGGER ep_entradas_upd INSTEAD OF UPDATE ON ep_entradas
  FOR EACH ROW EXECUTE FUNCTION ep_entradas_update();
DROP TRIGGER IF EXISTS ep_entradas_del ON ep_entradas;
CREATE TRIGGER ep_entradas_del INSTEAD OF DELETE ON ep_entradas
  FOR EACH ROW EXECUTE FUNCTION ep_entradas_delete();

DROP INDEX IF EXISTS idx_estoque_produtos_placa;
ALTER TABLE estoque_produtos
  DROP COLUMN IF EXISTS peso_bruto,
  DROP COLUMN IF EXISTS placa,
  DROP COLUMN IF EXISTS barril,
  DROP COLUMN IF EXISTS volume,
  DROP COLUMN IF EXISTS tara,
  DROP COLUMN IF EXISTS lacres,
  DROP COLUMN IF EXISTS eslinga,
  DROP COLUMN IF EXISTS gps,
  DROP COLUMN IF EXISTS menor_teste,
  DROP COLUMN IF EXISTS fracionado,
  DROP COLUMN IF EXISTS vasilhame_existente_id;

CREATE INDEX IF NOT EXISTS idx_estoque_produtos_vasilhame
  ON estoque_produtos (vasilhame_id) WHERE vasilhame_id IS NOT NULL;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
