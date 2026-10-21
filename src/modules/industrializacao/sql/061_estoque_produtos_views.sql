-- =============================================================================
-- 061_estoque_produtos_views.sql
-- Vistas operacionais sobre estoque_produtos.
-- O app passa a ler/gravar ep_entradas, ep_estoque e ep_mp.
-- t_entradas, t_estoque e estoque_mp permanecem intactas.
-- Aplicar depois de 060_estoque_produtos.sql.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Cada item em colunas. O JSON de lotes só existia como cópia do item.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ep_lote_item(p_lotes jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(coalesce(p_lotes, 'null'::jsonb)) = 'array'
         AND jsonb_array_length(p_lotes) > 0
      THEN p_lotes -> 0
    WHEN jsonb_typeof(p_lotes) = 'object' THEN p_lotes
    ELSE '{}'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION ep_txt(p_item jsonb, p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(p_item ->> p_key), '');
$$;

CREATE OR REPLACE FUNCTION ep_num(p_item jsonb, p_key text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN ep_txt(p_item, p_key) ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN ep_txt(p_item, p_key)::numeric
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION ep_bool(p_item jsonb, p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(ep_txt(p_item, p_key), ''))
    WHEN 'true' THEN true
    WHEN 't' THEN true
    WHEN '1' THEN true
    WHEN 'false' THEN false
    WHEN 'f' THEN false
    WHEN '0' THEN false
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION ep_date(p_item jsonb, p_key text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF ep_txt(p_item, p_key) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN ep_txt(p_item, p_key)::date;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

ALTER TABLE estoque_produtos
  ADD COLUMN IF NOT EXISTS peso_bruto numeric,
  ADD COLUMN IF NOT EXISTS quantidade_nf numeric,
  ADD COLUMN IF NOT EXISTS quantidade_declarada numeric,
  ADD COLUMN IF NOT EXISTS tipo_recebimento text,
  ADD COLUMN IF NOT EXISTS tipo_embalagem text,
  ADD COLUMN IF NOT EXISTS placa text,
  ADD COLUMN IF NOT EXISTS barril text,
  ADD COLUMN IF NOT EXISTS volume numeric,
  ADD COLUMN IF NOT EXISTS tara numeric,
  ADD COLUMN IF NOT EXISTS lacres text,
  ADD COLUMN IF NOT EXISTS eslinga text,
  ADD COLUMN IF NOT EXISTS gps text,
  ADD COLUMN IF NOT EXISTS menor_teste text,
  ADD COLUMN IF NOT EXISTS fracionado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vasilhame_id uuid,
  ADD COLUMN IF NOT EXISTS vasilhame_existente_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'estoque_produtos'
      AND column_name = 'lotes'
  ) THEN
    EXECUTE $upd$
      UPDATE estoque_produtos ep
      SET
        produto_id = COALESCE(ep.produto_id, ep_uuid(src.item ->> 'produto_id')),
        produto_nome = COALESCE(NULLIF(btrim(ep.produto_nome), ''), ep_txt(src.item, 'produto_nome'), ep.produto_nome),
        produto_codigo = COALESCE(NULLIF(btrim(ep.produto_codigo), ''), ep_txt(src.item, 'produto_codigo')),
        nota_fiscal = COALESCE(NULLIF(btrim(ep.nota_fiscal), ''), ep_txt(src.item, 'nota_fiscal')),
        lote = COALESCE(NULLIF(btrim(ep.lote), ''), ep_txt(src.item, 'lote')),
        densidade = COALESCE(NULLIF(btrim(ep.densidade), ''), ep_txt(src.item, 'densidade')),
        quantidade = CASE
          WHEN ep.quantidade IS NULL OR ep.quantidade = 0 THEN COALESCE(ep_num(src.item, 'quantidade'), ep.quantidade)
          ELSE ep.quantidade
        END,
        unidade_medida = COALESCE(NULLIF(btrim(ep.unidade_medida), ''), ep_txt(src.item, 'unidade_medida'), ep.unidade_medida),
        data_fabricacao = COALESCE(ep.data_fabricacao, ep_date(src.item, 'data_fabricacao')),
        data_validade = COALESCE(ep.data_validade, ep_date(src.item, 'data_validade')),
        preco_unitario = COALESCE(ep.preco_unitario, ep_num(src.item, 'preco_unitario')),
        embalado = COALESCE(ep_bool(src.item, 'embalado'), ep.embalado),
        peso_liquido = COALESCE(ep.peso_liquido, ep_num(src.item, 'peso_liquido')),
        peso_bruto = COALESCE(ep.peso_bruto, ep_num(src.item, 'peso_bruto')),
        quantidade_embalagens = COALESCE(ep.quantidade_embalagens, ep_num(src.item, 'quantidade_embalagens')),
        quantidade_nf = COALESCE(ep.quantidade_nf, ep_num(src.item, 'quantidade_nf')),
        quantidade_declarada = COALESCE(ep.quantidade_declarada, ep_num(src.item, 'quantidade_declarada')),
        tipo_recebimento = COALESCE(ep.tipo_recebimento, ep_txt(src.item, 'tipo_recebimento')),
        tipo_embalagem = COALESCE(ep.tipo_embalagem, ep_txt(src.item, 'tipo_embalagem')),
        placa = COALESCE(ep.placa, ep_txt(src.item, 'placa')),
        barril = COALESCE(ep.barril, ep_txt(src.item, 'barril')),
        volume = COALESCE(ep.volume, ep_num(src.item, 'volume')),
        tara = COALESCE(ep.tara, ep_num(src.item, 'tara')),
        lacres = COALESCE(ep.lacres, ep_txt(src.item, 'lacres')),
        eslinga = COALESCE(ep.eslinga, ep_txt(src.item, 'eslinga')),
        gps = COALESCE(ep.gps, ep_txt(src.item, 'gps')),
        menor_teste = COALESCE(ep.menor_teste, ep_txt(src.item, 'menor_teste')),
        fracionado = COALESCE(ep_bool(src.item, 'fracionado'), ep.fracionado),
        vasilhame_id = COALESCE(ep.vasilhame_id, ep_uuid(src.item ->> 'vasilhame_id')),
        vasilhame_existente_id = COALESCE(ep.vasilhame_existente_id, ep_uuid(src.item ->> 'vasilhame_existente_id'))
      FROM (
        SELECT id, ep_lote_item(lotes) AS item
        FROM estoque_produtos
      ) src
      WHERE ep.id = src.id
        AND src.item <> '{}'::jsonb
    $upd$;
  END IF;
END $$;

DROP VIEW IF EXISTS ep_entradas CASCADE;
DROP VIEW IF EXISTS ep_estoque CASCADE;
DROP VIEW IF EXISTS ep_mp CASCADE;
DROP INDEX IF EXISTS idx_estoque_produtos_lotes;
ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS lotes;

CREATE INDEX IF NOT EXISTS idx_estoque_produtos_placa
  ON estoque_produtos (placa) WHERE placa IS NOT NULL;

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
    'peso_bruto', p.peso_bruto,
    'quantidade_embalagens', p.quantidade_embalagens,
    'placa', p.placa,
    'barril', p.barril,
    'volume', p.volume,
    'tara', p.tara,
    'lacres', p.lacres,
    'eslinga', p.eslinga,
    'gps', p.gps,
    'menor_teste', p.menor_teste,
    'fracionado', p.fracionado,
    'vasilhame_id', p.vasilhame_id,
    'vasilhame_existente_id', p.vasilhame_existente_id,
    'ind_mp_id', p.legacy_mp_id_text
  ));
$$;

-- ---------------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ep_estoque AS
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
  peso_bruto,
  quantidade_embalagens,
  quantidade_nf,
  quantidade_declarada,
  tipo_recebimento,
  tipo_embalagem,
  placa,
  barril,
  volume,
  tara,
  lacres,
  eslinga,
  gps,
  menor_teste,
  fracionado,
  vasilhame_id,
  vasilhame_existente_id,
  status_wms,
  ep_item_json(estoque_produtos) AS lotes,
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

CREATE OR REPLACE VIEW ep_mp AS
SELECT
  legacy_mp_id_text AS id,
  created_at AS created_date,
  updated_at AS updated_date,
  created_by_id,
  id_entrada AS entry_id,
  data AS entry_date,
  COALESCE(mp_code, produto_codigo) AS mp_code,
  produto_nome AS mp_name,
  cliente_nome AS client,
  lote AS lot,
  nota_fiscal,
  fornecedor AS supplier,
  data_fabricacao AS manufacture_date,
  data_validade AS expiry_date,
  initial_stock,
  saldo_atual AS current_stock,
  unidade_medida AS unit,
  preco_unitario AS unit_price,
  CASE
    WHEN densidade ~ '^-?[0-9]+([.][0-9]+)?$' THEN densidade::numeric
    ELSE NULL
  END AS density,
  status,
  status_wms,
  observations,
  tank_storage,
  tank_entries,
  packaging_type,
  packaging_capacity,
  packaging_quantity,
  public_token
FROM estoque_produtos
WHERE origem = 'MATERIA_PRIMA'
  AND legacy_mp_id_text IS NOT NULL;

CREATE OR REPLACE VIEW ep_entradas AS
WITH base AS (
  SELECT *
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
    legacy_entrada_id,
    sum(quantidade) AS quantidade,
    sum(saldo_atual) AS saldo_atual,
    sum(custo_total) AS custo_total,
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

GRANT SELECT, INSERT, UPDATE, DELETE ON ep_estoque, ep_mp, ep_entradas TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gravação: uma entrada, várias linhas, um único id_entrada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ep_entradas_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lotes jsonb;
  v_id uuid;
  v_codigo text;
  v_origem text;
BEGIN
  v_lotes := ep_as_jsonb(NEW.lotes);
  IF jsonb_typeof(v_lotes) IS DISTINCT FROM 'array' THEN
    v_lotes := '[]'::jsonb;
  END IF;

  IF jsonb_array_length(v_lotes) = 0 AND nullif(btrim(NEW.produto_nome), '') IS NOT NULL THEN
    v_lotes := jsonb_build_array(jsonb_build_object(
      'produto_id', NEW.produto_id,
      'produto_nome', NEW.produto_nome,
      'produto_codigo', NEW.produto_codigo,
      'nota_fiscal', NEW.nota_fiscal,
      'lote', NEW.lote,
      'densidade', NEW.densidade,
      'quantidade', NEW.quantidade,
      'unidade_medida', NEW.unidade_medida,
      'data_fabricacao', NEW.data_fabricacao,
      'data_validade', NEW.data_validade,
      'preco_unitario', NEW.preco_unitario,
      'embalado', NEW.embalado,
      'peso_liquido', NEW.peso_liquido,
      'quantidade_embalagens', NEW.quantidade_embalagens
    ));
  END IF;

  IF jsonb_array_length(v_lotes) = 0 THEN
    RAISE EXCEPTION 'Recebimento sem itens. Nenhum produto foi gravado.'
      USING ERRCODE = '22023';
  END IF;

  -- O identificador nasce aqui. As linhas são gravadas em seguida por ep_estoque,
  -- com a quantidade já convertida pelo aplicativo. Assim não há linha duplicada
  -- nem recebimento parcial se a gravação dos itens falhar.
  v_id := COALESCE(NEW.id, gen_random_uuid());
  v_codigo := next_entrada_id();
  v_origem := ep_origem(NEW.origem);

  NEW.id := v_id;
  NEW.id_entrada := v_codigo;
  NEW.origem := v_origem;
  NEW.created_at := COALESCE(NEW.created_at, now());
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ep_entradas_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE estoque_produtos
  SET
    cliente_id = ep_uuid(NEW.cliente_id::text),
    cliente_nome = NEW.cliente_nome,
    data = COALESCE(NEW.data, data),
    fornecedor = NEW.fornecedor,
    comunicacao_enviada = COALESCE(NEW.comunicacao_enviada, false),
    status_wms = COALESCE(NEW.status_wms, status_wms),
    granel_pesagem = COALESCE(NEW.granel_pesagem, false),
    granel_ticket = NEW.granel_ticket,
    granel_peso_bruto = NEW.granel_peso_bruto,
    granel_validacao_bruto = NEW.granel_validacao_bruto,
    granel_peso_liquido = NEW.granel_peso_liquido,
    granel_validacao_liquido = NEW.granel_validacao_liquido,
    granel_erro_admissivel = NEW.granel_erro_admissivel,
    granel_peso_minimo = NEW.granel_peso_minimo,
    granel_peso_maximo = NEW.granel_peso_maximo,
    granel_margem = NEW.granel_margem,
    public_token_entrada = COALESCE(NEW.public_token, public_token_entrada),
    origem = CASE
      WHEN nullif(btrim(NEW.origem), '') IS NULL THEN origem
      ELSE ep_origem(NEW.origem)
    END,
    grupo_entrada = COALESCE(NEW.grupo_entrada, grupo_entrada)
  WHERE legacy_entrada_id = OLD.id
    AND coalesce(grupo_entrada, '') NOT LIKE 'TB%';
  IF nullif(btrim(NEW.origem), '') IS NOT NULL THEN
    NEW.origem := ep_origem(NEW.origem);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ep_entradas_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM estoque_produtos WHERE legacy_entrada_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS ep_entradas_ins ON ep_entradas;
CREATE TRIGGER ep_entradas_ins INSTEAD OF INSERT ON ep_entradas
  FOR EACH ROW EXECUTE FUNCTION ep_entradas_insert();
DROP TRIGGER IF EXISTS ep_entradas_upd ON ep_entradas;
CREATE TRIGGER ep_entradas_upd INSTEAD OF UPDATE ON ep_entradas
  FOR EACH ROW EXECUTE FUNCTION ep_entradas_update();
DROP TRIGGER IF EXISTS ep_entradas_del ON ep_entradas;
CREATE TRIGGER ep_entradas_del INSTEAD OF DELETE ON ep_entradas
  FOR EACH ROW EXECUTE FUNCTION ep_entradas_delete();

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
    saldo_atual, embalado, peso_liquido, peso_bruto, quantidade_embalagens,
    quantidade_nf, quantidade_declarada, tipo_recebimento, tipo_embalagem,
    placa, barril, volume, tara, lacres, eslinga, gps, menor_teste,
    fracionado, vasilhame_id, vasilhame_existente_id, status_wms,
    granel_pesagem, granel_ticket, granel_peso_bruto, granel_validacao_bruto,
    granel_peso_liquido, granel_validacao_liquido, granel_erro_admissivel,
    granel_peso_minimo, granel_peso_maximo, granel_margem,
    legacy_estoque_id, legacy_entrada_id, legacy_entrada_codigo,
    grupo_entrada, codigo_estoque, fornecedor, comunicacao_enviada,
    public_token_entrada
  ) VALUES (
    v_codigo,
    'ARMAZENAGEM',
    NEW.produto_id,
    COALESCE(NULLIF(btrim(NEW.produto_nome), ''), 'Produto sem nome'),
    NEW.produto_codigo,
    NEW.cliente_id,
    NEW.cliente_nome,
    COALESCE(NEW.data, current_date),
    NEW.nota_fiscal,
    NEW.nota_fiscal_troca,
    COALESCE(ep_txt(v_item, 'lote'), NEW.lote),
    COALESCE(ep_txt(v_item, 'densidade'), NEW.densidade),
    NEW.data_fabricacao,
    NEW.data_validade,
    COALESCE(NEW.quantidade, 0),
    COALESCE(NEW.quantidade, 0),
    COALESCE(NULLIF(btrim(NEW.unidade_medida), ''), 'kg'),
    NEW.preco_unitario,
    NEW.custo_total,
    COALESCE(NEW.saldo_atual, NEW.quantidade, 0),
    COALESCE(ep_bool(v_item, 'embalado'), NEW.embalado, false),
    COALESCE(ep_num(v_item, 'peso_liquido'), NEW.peso_liquido),
    COALESCE(ep_num(v_item, 'peso_bruto'), NEW.peso_bruto),
    COALESCE(ep_num(v_item, 'quantidade_embalagens'), NEW.quantidade_embalagens),
    ep_num(v_item, 'quantidade_nf'),
    ep_num(v_item, 'quantidade_declarada'),
    ep_txt(v_item, 'tipo_recebimento'),
    ep_txt(v_item, 'tipo_embalagem'),
    ep_txt(v_item, 'placa'),
    ep_txt(v_item, 'barril'),
    ep_num(v_item, 'volume'),
    ep_num(v_item, 'tara'),
    ep_txt(v_item, 'lacres'),
    ep_txt(v_item, 'eslinga'),
    ep_txt(v_item, 'gps'),
    ep_txt(v_item, 'menor_teste'),
    COALESCE(ep_bool(v_item, 'fracionado'), false),
    ep_uuid(v_item ->> 'vasilhame_id'),
    ep_uuid(v_item ->> 'vasilhame_existente_id'),
    COALESCE(NEW.status_wms, false),
    COALESCE(NEW.granel_pesagem, false),
    NEW.granel_ticket,
    NEW.granel_peso_bruto,
    NEW.granel_validacao_bruto,
    NEW.granel_peso_liquido,
    NEW.granel_validacao_liquido,
    NEW.granel_erro_admissivel,
    NEW.granel_peso_minimo,
    NEW.granel_peso_maximo,
    NEW.granel_margem,
    v_id,
    v_entrada,
    NEW.entrada_codigo,
    NEW.grupo_entrada,
    NEW.codigo_estoque,
    NEW.fornecedor,
    COALESCE(NEW.comunicacao_enviada, false),
    NEW.public_token
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
    peso_bruto = CASE WHEN v_item ? 'peso_bruto' THEN ep_num(v_item, 'peso_bruto') ELSE NEW.peso_bruto END,
    quantidade_embalagens = CASE WHEN v_item ? 'quantidade_embalagens' THEN ep_num(v_item, 'quantidade_embalagens') ELSE NEW.quantidade_embalagens END,
    quantidade_nf = CASE WHEN v_item ? 'quantidade_nf' THEN ep_num(v_item, 'quantidade_nf') ELSE quantidade_nf END,
    quantidade_declarada = CASE WHEN v_item ? 'quantidade_declarada' THEN ep_num(v_item, 'quantidade_declarada') ELSE quantidade_declarada END,
    tipo_recebimento = CASE WHEN v_item ? 'tipo_recebimento' THEN ep_txt(v_item, 'tipo_recebimento') ELSE tipo_recebimento END,
    tipo_embalagem = CASE WHEN v_item ? 'tipo_embalagem' THEN ep_txt(v_item, 'tipo_embalagem') ELSE tipo_embalagem END,
    placa = CASE WHEN v_item ? 'placa' THEN ep_txt(v_item, 'placa') ELSE placa END,
    barril = CASE WHEN v_item ? 'barril' THEN ep_txt(v_item, 'barril') ELSE barril END,
    volume = CASE WHEN v_item ? 'volume' THEN ep_num(v_item, 'volume') ELSE volume END,
    tara = CASE WHEN v_item ? 'tara' THEN ep_num(v_item, 'tara') ELSE tara END,
    lacres = CASE WHEN v_item ? 'lacres' THEN ep_txt(v_item, 'lacres') ELSE lacres END,
    eslinga = CASE WHEN v_item ? 'eslinga' THEN ep_txt(v_item, 'eslinga') ELSE eslinga END,
    gps = CASE WHEN v_item ? 'gps' THEN ep_txt(v_item, 'gps') ELSE gps END,
    menor_teste = CASE WHEN v_item ? 'menor_teste' THEN ep_txt(v_item, 'menor_teste') ELSE menor_teste END,
    fracionado = COALESCE(ep_bool(v_item, 'fracionado'), fracionado),
    vasilhame_id = CASE WHEN v_item ? 'vasilhame_id' THEN ep_uuid(v_item ->> 'vasilhame_id') ELSE vasilhame_id END,
    vasilhame_existente_id = CASE WHEN v_item ? 'vasilhame_existente_id' THEN ep_uuid(v_item ->> 'vasilhame_existente_id') ELSE vasilhame_existente_id END,
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

CREATE OR REPLACE FUNCTION ep_estoque_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM estoque_produtos WHERE legacy_estoque_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS ep_estoque_ins ON ep_estoque;
CREATE TRIGGER ep_estoque_ins INSTEAD OF INSERT ON ep_estoque
  FOR EACH ROW EXECUTE FUNCTION ep_estoque_insert();
DROP TRIGGER IF EXISTS ep_estoque_upd ON ep_estoque;
CREATE TRIGGER ep_estoque_upd INSTEAD OF UPDATE ON ep_estoque
  FOR EACH ROW EXECUTE FUNCTION ep_estoque_update();
DROP TRIGGER IF EXISTS ep_estoque_del ON ep_estoque;
CREATE TRIGGER ep_estoque_del INSTEAD OF DELETE ON ep_estoque
  FOR EACH ROW EXECUTE FUNCTION ep_estoque_delete();

CREATE OR REPLACE FUNCTION ep_mp_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_codigo text;
  v_entrada uuid;
BEGIN
  v_id := COALESCE(NULLIF(btrim(NEW.id), ''), gen_random_uuid()::text);
  IF NEW.entry_id ~ '^E[1-9][0-9]*$' THEN
    v_codigo := NEW.entry_id;
  ELSE
    v_codigo := next_entrada_id();
  END IF;

  SELECT legacy_entrada_id INTO v_entrada
  FROM estoque_produtos
  WHERE origem = 'MATERIA_PRIMA' AND id_entrada = v_codigo
  LIMIT 1;
  IF v_entrada IS NULL THEN
    v_entrada := gen_random_uuid();
  END IF;

  INSERT INTO estoque_produtos (
    id_entrada, origem, produto_nome, produto_codigo, mp_code,
    cliente_nome, data, nota_fiscal, lote, densidade,
    data_fabricacao, data_validade, fornecedor,
    quantidade, initial_stock, unidade_medida, preco_unitario,
    saldo_atual, status, status_wms, observations,
    tank_storage, tank_entries,     packaging_type, packaging_capacity, packaging_quantity,
    public_token, legacy_entrada_id, legacy_mp_id, legacy_mp_id_text,
    legacy_mp_entry_id, created_by_id
  ) VALUES (
    v_codigo,
    'MATERIA_PRIMA',
    COALESCE(NULLIF(btrim(NEW.mp_name), ''), 'Matéria-prima sem nome'),
    NEW.mp_code,
    NEW.mp_code,
    NEW.client,
    COALESCE(NEW.entry_date, current_date),
    NEW.nota_fiscal,
    NEW.lot,
    CASE WHEN NEW.density IS NULL THEN NULL ELSE NEW.density::text END,
    NEW.manufacture_date,
    NEW.expiry_date,
    NEW.supplier,
    COALESCE(NEW.initial_stock, NEW.current_stock, 0),
    NEW.initial_stock,
    COALESCE(NULLIF(btrim(NEW.unit), ''), 'kg'),
    NEW.unit_price,
    COALESCE(NEW.current_stock, NEW.initial_stock, 0),
    NEW.status,
    COALESCE(NEW.status_wms, false),
    NEW.observations,
    NEW.tank_storage,
    NEW.tank_entries,
    NEW.packaging_type,
    NEW.packaging_capacity,
    NEW.packaging_quantity,
    NEW.public_token,
    v_entrada,
    ep_uuid(v_id),
    v_id,
    v_codigo,
    NEW.created_by_id
  );

  NEW.id := v_id;
  NEW.entry_id := v_codigo;
  NEW.created_date := COALESCE(NEW.created_date, now());
  NEW.updated_date := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ep_mp_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE estoque_produtos
  SET
    produto_nome = COALESCE(NULLIF(btrim(NEW.mp_name), ''), produto_nome),
    produto_codigo = NEW.mp_code,
    mp_code = NEW.mp_code,
    cliente_nome = NEW.client,
    data = COALESCE(NEW.entry_date, data),
    nota_fiscal = NEW.nota_fiscal,
    lote = NEW.lot,
    densidade = CASE WHEN NEW.density IS NULL THEN densidade ELSE NEW.density::text END,
    data_fabricacao = NEW.manufacture_date,
    data_validade = NEW.expiry_date,
    fornecedor = NEW.supplier,
    initial_stock = COALESCE(NEW.initial_stock, initial_stock),
    unidade_medida = COALESCE(NULLIF(btrim(NEW.unit), ''), unidade_medida),
    preco_unitario = NEW.unit_price,
    saldo_atual = COALESCE(NEW.current_stock, saldo_atual),
    status = NEW.status,
    status_wms = COALESCE(NEW.status_wms, status_wms),
    observations = NEW.observations,
    tank_storage = NEW.tank_storage,
    tank_entries = NEW.tank_entries,
    packaging_type = NEW.packaging_type,
    packaging_capacity = NEW.packaging_capacity,
    packaging_quantity = NEW.packaging_quantity,
    public_token = NEW.public_token
  WHERE legacy_mp_id_text = OLD.id;
  NEW.updated_date := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ep_mp_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM estoque_produtos WHERE legacy_mp_id_text = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS ep_mp_ins ON ep_mp;
CREATE TRIGGER ep_mp_ins INSTEAD OF INSERT ON ep_mp
  FOR EACH ROW EXECUTE FUNCTION ep_mp_insert();
DROP TRIGGER IF EXISTS ep_mp_upd ON ep_mp;
CREATE TRIGGER ep_mp_upd INSTEAD OF UPDATE ON ep_mp
  FOR EACH ROW EXECUTE FUNCTION ep_mp_update();
DROP TRIGGER IF EXISTS ep_mp_del ON ep_mp;
CREATE TRIGGER ep_mp_del INSTEAD OF DELETE ON ep_mp
  FOR EACH ROW EXECUTE FUNCTION ep_mp_delete();

-- ---------------------------------------------------------------------------
-- Saldo atômico da matéria-prima passa a gravar em estoque_produtos
-- quando o registro já foi unificado. Caso contrário, mantém estoque_mp.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION adjust_raw_material_stock(
  p_stock_id text,
  p_delta numeric,
  p_require_sufficient boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_entry text;
  v_before numeric;
  v_after numeric;
  v_mp estoque_mp%ROWTYPE;
BEGIN
  IF p_stock_id IS NULL OR btrim(p_stock_id) = '' THEN
    RAISE EXCEPTION 'stock_id obrigatório' USING ERRCODE = '22023';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta inválido' USING ERRCODE = '22023';
  END IF;

  SELECT id, id_entrada, COALESCE(saldo_atual, 0)
    INTO v_id, v_entry, v_before
  FROM estoque_produtos
  WHERE origem = 'MATERIA_PRIMA'
    AND legacy_mp_id_text = p_stock_id
  FOR UPDATE;

  IF FOUND THEN
    v_after := round((v_before + p_delta)::numeric, 3);
    IF p_require_sufficient AND p_delta < 0 AND v_after < 0 THEN
      RAISE EXCEPTION 'Estoque insuficiente (disponível %, solicitado %)', v_before, abs(p_delta)
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT p_require_sufficient AND v_after < 0 THEN
      v_after := 0;
    END IF;
    UPDATE estoque_produtos
    SET saldo_atual = v_after
    WHERE id = v_id;
    RETURN jsonb_build_object(
      'id', p_stock_id,
      'entry_id', v_entry,
      'balance_before', v_before,
      'balance_after', v_after,
      'delta', p_delta
    );
  END IF;

  SELECT * INTO v_mp FROM estoque_mp WHERE id::text = p_stock_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estoque MP não encontrado: %', p_stock_id USING ERRCODE = 'P0002';
  END IF;
  v_before := COALESCE(v_mp.current_stock, 0);
  v_after := round((v_before + p_delta)::numeric, 3);
  IF p_require_sufficient AND p_delta < 0 AND v_after < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente (disponível %, solicitado %)', v_before, abs(p_delta)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_require_sufficient AND v_after < 0 THEN
    v_after := 0;
  END IF;
  UPDATE estoque_mp
  SET current_stock = v_after,
      updated_date = now()
  WHERE id = v_mp.id;
  RETURN jsonb_build_object(
    'id', v_mp.id,
    'entry_id', v_mp.entry_id,
    'balance_before', v_before,
    'balance_after', v_after,
    'delta', p_delta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_raw_material_stock(text, numeric, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION optimistic_update_estoque_mp(
  p_id text,
  p_expected_updated timestamptz,
  p_current_stock numeric DEFAULT NULL,
  p_lot text DEFAULT NULL,
  p_status_wms text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estoque_produtos%ROWTYPE;
BEGIN
  UPDATE estoque_produtos
  SET
    saldo_atual = COALESCE(p_current_stock, saldo_atual),
    lote = COALESCE(p_lot, lote),
    status_wms = COALESCE(p_status_wms::boolean, status_wms)
  WHERE origem = 'MATERIA_PRIMA'
    AND legacy_mp_id_text = p_id
    AND updated_at IS NOT DISTINCT FROM p_expected_updated
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', to_jsonb(v_row));
  END IF;

  IF EXISTS (
    SELECT 1 FROM estoque_produtos
    WHERE origem = 'MATERIA_PRIMA' AND legacy_mp_id_text = p_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', true,
      'message', 'Estoque alterado por outro usuário. Recarregue e tente novamente.'
    );
  END IF;

  UPDATE estoque_mp
  SET
    current_stock = COALESCE(p_current_stock, current_stock),
    lot = COALESCE(p_lot, lot),
    status_wms = COALESCE(p_status_wms::boolean, status_wms),
    updated_date = now()
  WHERE id::text = p_id
    AND updated_date IS NOT DISTINCT FROM p_expected_updated;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', true,
      'message', 'Estoque alterado por outro usuário. Recarregue e tente novamente.'
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'conflict', false);
END;
$$;

GRANT EXECUTE ON FUNCTION optimistic_update_estoque_mp(text, timestamptz, numeric, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estoque_produtos%ROWTYPE;
  v_mp estoque_mp%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('get_public_raw_material_info');
  SELECT * INTO v_row
  FROM estoque_produtos
  WHERE origem = 'MATERIA_PRIMA' AND public_token = p_token
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'mp_code', COALESCE(v_row.mp_code, v_row.produto_codigo),
      'mp_name', v_row.produto_nome,
      'client', v_row.cliente_nome,
      'lot', v_row.lote,
      'unit', v_row.unidade_medida,
      'current_stock', v_row.saldo_atual
    );
  END IF;
  SELECT * INTO v_mp FROM estoque_mp WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'mp_code', v_mp.mp_code,
    'mp_name', v_mp.mp_name,
    'client', v_mp.client,
    'lot', v_mp.lot,
    'unit', v_mp.unit,
    'current_stock', v_mp.current_stock
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;

-- Consulta pública do QR. Recebimentos novos estão em estoque_produtos;
-- o código exibido é o id_entrada (E1, E2…). O histórico que ainda só existe
-- em t_entradas continua no caminho anterior.
DO $$
BEGIN
  IF to_regprocedure('public.get_public_entrada_info_legado(text)') IS NULL
     AND to_regprocedure('public.get_public_entrada_info(text)') IS NOT NULL THEN
    ALTER FUNCTION get_public_entrada_info(text) RENAME TO get_public_entrada_info_legado;
  END IF;
  IF to_regprocedure('public.get_public_entrada_info_legado(text)') IS NULL THEN
    CREATE FUNCTION get_public_entrada_info_legado(p_token text)
    RETURNS jsonb
    LANGUAGE sql
    AS $stub$ SELECT NULL::jsonb $stub$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION get_public_entrada_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := btrim(p_token);
  v_row estoque_produtos%ROWTYPE;
  v_lotes jsonb;
  v_ids text[];
  v_pesagem jsonb;
  v_transbordos jsonb;
  v_qtd numeric;
BEGIN
  IF v_token IS NULL OR length(v_token) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row
  FROM estoque_produtos
  WHERE public_token_entrada = v_token
    AND coalesce(grupo_entrada, '') NOT LIKE 'TB%'
  ORDER BY id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN get_public_entrada_info_legado(v_token);
  END IF;

  PERFORM enforce_public_rate_limit('get_public_entrada_info');

  SELECT coalesce(sum(quantidade), 0)
    INTO v_qtd
  FROM estoque_produtos
  WHERE legacy_entrada_id = v_row.legacy_entrada_id
    AND coalesce(grupo_entrada, '') NOT LIKE 'TB%';

  SELECT coalesce(jsonb_agg(
    (ep_item_json(ep) - 'preco_unitario' - 'ind_mp_id' - 'vasilhame_id' - 'vasilhame_existente_id')
    ORDER BY ep.id
  ), '[]'::jsonb)
    INTO v_lotes
  FROM estoque_produtos ep
  WHERE ep.legacy_entrada_id = v_row.legacy_entrada_id
    AND coalesce(ep.grupo_entrada, '') NOT LIKE 'TB%';

  SELECT coalesce(array_agg(DISTINCT src.id), ARRAY[]::text[])
    INTO v_ids
  FROM (
    SELECT v_row.legacy_entrada_id::text AS id
    UNION ALL
    SELECT ep.legacy_estoque_id::text
    FROM estoque_produtos ep
    WHERE ep.legacy_entrada_id = v_row.legacy_entrada_id
      AND ep.legacy_estoque_id IS NOT NULL
  ) src;

  IF v_row.granel_pesagem
     OR v_row.granel_peso_bruto IS NOT NULL
     OR v_row.granel_peso_liquido IS NOT NULL THEN
    v_pesagem := jsonb_build_object(
      'ticket', v_row.granel_ticket,
      'peso_bruto', v_row.granel_peso_bruto,
      'peso_liquido', v_row.granel_peso_liquido,
      'validacao_bruto', v_row.granel_validacao_bruto,
      'validacao_liquido', v_row.granel_validacao_liquido,
      'erro_admissivel', v_row.granel_erro_admissivel,
      'peso_minimo', v_row.granel_peso_minimo,
      'peso_maximo', v_row.granel_peso_maximo,
      'margem', v_row.granel_margem
    );
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'codigo', t.codigo_transbordo,
        'data', t.data,
        'volume_total', t.volume_total,
        'massa_total', t.massa_total,
        'destinos', CASE
          WHEN jsonb_typeof(coalesce(t.destinos, '[]'::jsonb)) = 'array' THEN (
            SELECT coalesce(jsonb_agg(
              jsonb_build_object(
                'tipo', d.item->>'tipo_embalagem',
                'placa', d.item->>'placa',
                'barril', d.item->>'barril',
                'tanka', d.item->>'tanka_codigo',
                'volume', coalesce(d.item->'volume_total', d.item->'volume'),
                'peso_liquido', d.item->'peso_liquido',
                'peso_bruto', d.item->'peso_bruto',
                'lacres', d.item->>'lacres',
                'quantidade_embalagens', d.item->'quantidade_embalagens'
              )
              ORDER BY d.ord
            ), '[]'::jsonb)
            FROM jsonb_array_elements(t.destinos) WITH ORDINALITY AS d(item, ord)
          )
          ELSE '[]'::jsonb
        END
      )
      ORDER BY t.data ASC NULLS LAST, t.created_at ASC
    ),
    '[]'::jsonb
  )
    INTO v_transbordos
  FROM t_transbordos t
  WHERE to_regclass('public.t_transbordos') IS NOT NULL
    AND jsonb_typeof(coalesce(t.origens, '[]'::jsonb)) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(t.origens) o
      WHERE o->>'entrada_id' = ANY (v_ids)
         OR (
           coalesce(o->>'entrada_id', '') = ''
           AND nullif(btrim(v_row.id_entrada), '') IS NOT NULL
           AND (
             upper(btrim(o->>'entrada_codigo')) = upper(btrim(v_row.id_entrada))
             OR upper(btrim(o->>'entrada_codigo')) LIKE upper(btrim(v_row.id_entrada)) || ' %'
             OR upper(btrim(o->>'entrada_codigo')) LIKE upper(btrim(v_row.id_entrada)) || '-%'
             OR upper(btrim(o->>'entrada_codigo')) LIKE upper(btrim(v_row.id_entrada)) || '—%'
           )
         )
    );

  RETURN jsonb_build_object(
    'codigo', v_row.id_entrada,
    'data', v_row.data,
    'cliente', v_row.cliente_nome,
    'fornecedor', v_row.fornecedor,
    'nota_fiscal', v_row.nota_fiscal,
    'origem', v_row.origem,
    'quantidade', v_qtd,
    'unidade', v_row.unidade_medida,
    'lotes', v_lotes,
    'pesagem', v_pesagem,
    'transbordos', v_transbordos
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_entrada_info(text) TO anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.ind_retornos_perdas') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION ep_movimento_mp_ref()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NEW.stock_produto_id IS NULL AND NEW.stock_id IS NOT NULL THEN
        SELECT id INTO NEW.stock_produto_id
        FROM estoque_produtos
        WHERE origem = 'MATERIA_PRIMA'
          AND legacy_mp_id_text = NEW.stock_id::text
        LIMIT 1;
      END IF;
      RETURN NEW;
    END;
    $fn$;
    DROP TRIGGER IF EXISTS trg_ep_movimento_mp_ref ON ind_retornos_perdas;
    CREATE TRIGGER trg_ep_movimento_mp_ref
      BEFORE INSERT ON ind_retornos_perdas
      FOR EACH ROW EXECUTE FUNCTION ep_movimento_mp_ref();
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND tablename = 'estoque_produtos'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE estoque_produtos;
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
