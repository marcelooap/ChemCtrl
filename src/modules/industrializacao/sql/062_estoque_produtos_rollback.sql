-- =============================================================================
-- 062_estoque_produtos_rollback.sql
-- Desfaz o cutover. Não apaga t_entradas, t_estoque, estoque_mp nem estoque_produtos.
--
-- 1. Devolve saldos e recebimentos novos para as tabelas antigas.
-- 2. As RPCs de matéria-prima voltam a gravar em estoque_mp.
-- 3. Remove as vistas ep_*. O aplicativo volta a usar as tabelas antigas.
--
-- Executar só para reverter. estoque_produtos permanece para auditoria.
-- =============================================================================

BEGIN;

ALTER TABLE t_entradas ADD COLUMN IF NOT EXISTS id_entrada text;
ALTER TABLE t_entradas ADD COLUMN IF NOT EXISTS public_token text;

-- Cabeçalhos de armazenagem nascidos depois da migração.
INSERT INTO t_entradas (
  id, cliente_id, cliente_nome, produto_id, produto_nome, produto_codigo,
  nota_fiscal, lote, densidade, data_fabricacao, data_validade,
  quantidade, unidade_medida, preco_unitario, custo_total, saldo_atual,
  embalado, peso_liquido, quantidade_embalagens, status_wms,
  granel_pesagem, granel_ticket, granel_peso_bruto, granel_validacao_bruto,
  granel_peso_liquido, granel_validacao_liquido, granel_erro_admissivel,
  granel_peso_minimo, granel_peso_maximo, granel_margem,
  grupo_entrada, lotes, origem, fornecedor, comunicacao_enviada, data,
  public_token, id_entrada, created_at, updated_at
)
SELECT
  cab.legacy_entrada_id,
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
  COALESCE(agg.quantidade, 0),
  COALESCE(cab.unidade_medida, 'kg'),
  cab.preco_unitario,
  agg.custo_total,
  COALESCE(agg.saldo_atual, 0),
  COALESCE(cab.embalado, false),
  cab.peso_liquido,
  cab.quantidade_embalagens,
  COALESCE(cab.status_wms, false),
  COALESCE(cab.granel_pesagem, false),
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
  COALESCE(agg.lotes, '[]'::jsonb),
  'convencional',
  cab.fornecedor,
  COALESCE(cab.comunicacao_enviada, false),
  cab.data,
  cab.public_token_entrada,
  cab.id_entrada,
  cab.created_at,
  cab.updated_at
FROM (
  SELECT DISTINCT ON (legacy_entrada_id) *
  FROM estoque_produtos
  WHERE origem = 'ARMAZENAGEM'
    AND legacy_entrada_id IS NOT NULL
    AND coalesce(grupo_entrada, '') NOT LIKE 'TB%'
  ORDER BY legacy_entrada_id, id
) cab
JOIN (
  SELECT
    legacy_entrada_id,
    sum(quantidade) AS quantidade,
    sum(saldo_atual) AS saldo_atual,
    sum(custo_total) AS custo_total,
    jsonb_agg(ep_item_json(ep) ORDER BY ep.id) AS lotes
  FROM estoque_produtos ep
  WHERE ep.origem = 'ARMAZENAGEM'
    AND legacy_entrada_id IS NOT NULL
    AND coalesce(grupo_entrada, '') NOT LIKE 'TB%'
  GROUP BY legacy_entrada_id
) agg ON agg.legacy_entrada_id = cab.legacy_entrada_id
WHERE NOT EXISTS (
  SELECT 1 FROM t_entradas en WHERE en.id = cab.legacy_entrada_id
);

UPDATE t_entradas en
SET
  id_entrada = src.id_entrada,
  fornecedor = src.fornecedor,
  comunicacao_enviada = src.comunicacao_enviada,
  public_token = COALESCE(src.public_token_entrada, en.public_token),
  data = src.data,
  quantidade = src.quantidade,
  saldo_atual = src.saldo_atual,
  custo_total = src.custo_total,
  lotes = src.lotes,
  granel_pesagem = src.granel_pesagem,
  granel_ticket = src.granel_ticket,
  granel_peso_bruto = src.granel_peso_bruto,
  granel_validacao_bruto = src.granel_validacao_bruto,
  granel_peso_liquido = src.granel_peso_liquido,
  granel_validacao_liquido = src.granel_validacao_liquido,
  granel_erro_admissivel = src.granel_erro_admissivel,
  granel_peso_minimo = src.granel_peso_minimo,
  granel_peso_maximo = src.granel_peso_maximo,
  granel_margem = src.granel_margem,
  updated_at = now()
FROM (
  SELECT
    cab.legacy_entrada_id,
    cab.id_entrada,
    cab.fornecedor,
    cab.comunicacao_enviada,
    cab.public_token_entrada,
    cab.data,
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
    agg.quantidade,
    agg.saldo_atual,
    agg.custo_total,
    agg.lotes
  FROM (
    SELECT DISTINCT ON (legacy_entrada_id) *
    FROM estoque_produtos
    WHERE origem = 'ARMAZENAGEM'
      AND legacy_entrada_id IS NOT NULL
      AND coalesce(grupo_entrada, '') NOT LIKE 'TB%'
    ORDER BY legacy_entrada_id, id
  ) cab
  JOIN (
    SELECT
      legacy_entrada_id,
      sum(quantidade) AS quantidade,
      sum(saldo_atual) AS saldo_atual,
      sum(custo_total) AS custo_total,
      jsonb_agg(ep_item_json(ep) ORDER BY ep.id) AS lotes
    FROM estoque_produtos ep
    WHERE ep.origem = 'ARMAZENAGEM'
      AND legacy_entrada_id IS NOT NULL
      AND coalesce(grupo_entrada, '') NOT LIKE 'TB%'
    GROUP BY legacy_entrada_id
  ) agg ON agg.legacy_entrada_id = cab.legacy_entrada_id
) src
WHERE en.id = src.legacy_entrada_id;

UPDATE t_estoque s
SET
  saldo_atual = ep.saldo_atual,
  quantidade = ep.quantidade,
  lote = ep.lote,
  nota_fiscal = ep.nota_fiscal,
  nota_fiscal_troca = ep.nota_fiscal_troca,
  entrada_codigo = ep.id_entrada,
  lotes = jsonb_build_array(ep_item_json(ep)),
  updated_at = now()
FROM estoque_produtos ep
WHERE ep.origem = 'ARMAZENAGEM'
  AND ep.legacy_estoque_id = s.id;

INSERT INTO t_estoque (
  id, codigo_estoque, entrada_id, entrada_codigo, grupo_entrada,
  cliente_id, cliente_nome, produto_id, produto_nome, produto_codigo,
  nota_fiscal, nota_fiscal_troca, lote, densidade,
  data_fabricacao, data_validade, quantidade, unidade_medida, saldo_atual,
  preco_unitario, custo_total, embalado, peso_liquido, quantidade_embalagens,
  status_wms, lotes, origem,
  granel_pesagem, granel_ticket, granel_peso_bruto, granel_validacao_bruto,
  granel_peso_liquido, granel_validacao_liquido, granel_erro_admissivel,
  granel_peso_minimo, granel_peso_maximo, granel_margem,
  created_at, updated_at
)
SELECT
  ep.legacy_estoque_id,
  ep.codigo_estoque,
  ep.legacy_entrada_id,
  ep.id_entrada,
  ep.grupo_entrada,
  ep.cliente_id,
  ep.cliente_nome,
  ep.produto_id,
  ep.produto_nome,
  ep.produto_codigo,
  ep.nota_fiscal,
  ep.nota_fiscal_troca,
  ep.lote,
  ep.densidade,
  ep.data_fabricacao,
  ep.data_validade,
  ep.quantidade,
  ep.unidade_medida,
  ep.saldo_atual,
  ep.preco_unitario,
  ep.custo_total,
  ep.embalado,
  ep.peso_liquido,
  ep.quantidade_embalagens,
  ep.status_wms,
  jsonb_build_array(ep_item_json(ep)),
  'convencional',
  ep.granel_pesagem,
  ep.granel_ticket,
  ep.granel_peso_bruto,
  ep.granel_validacao_bruto,
  ep.granel_peso_liquido,
  ep.granel_validacao_liquido,
  ep.granel_erro_admissivel,
  ep.granel_peso_minimo,
  ep.granel_peso_maximo,
  ep.granel_margem,
  ep.created_at,
  ep.updated_at
FROM estoque_produtos ep
WHERE ep.origem = 'ARMAZENAGEM'
  AND ep.legacy_estoque_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM t_estoque s WHERE s.id = ep.legacy_estoque_id);

UPDATE estoque_mp m
SET
  current_stock = ep.saldo_atual,
  initial_stock = COALESCE(ep.initial_stock, m.initial_stock),
  lot = ep.lote,
  nota_fiscal = ep.nota_fiscal,
  supplier = ep.fornecedor,
  observations = ep.observations,
  tank_storage = ep.tank_storage,
  tank_entries = ep.tank_entries,
  packaging_type = ep.packaging_type,
  packaging_capacity = ep.packaging_capacity,
  packaging_quantity = ep.packaging_quantity,
  status = ep.status,
  status_wms = COALESCE(ep.status_wms, m.status_wms),
  public_token = COALESCE(ep.public_token, m.public_token),
  updated_date = now()
FROM estoque_produtos ep
WHERE ep.origem = 'MATERIA_PRIMA'
  AND ep.legacy_mp_id_text = m.id::text;

INSERT INTO estoque_mp (
  id, created_date, updated_date, created_by_id, entry_id, entry_date,
  mp_code, mp_name, client, lot, nota_fiscal, supplier,
  manufacture_date, expiry_date, initial_stock, current_stock, unit,
  unit_price, density, status, status_wms, observations,
  tank_storage, tank_entries, packaging_type, packaging_capacity,
  packaging_quantity, public_token
)
SELECT
  ep.legacy_mp_id_text,
  ep.created_at,
  ep.updated_at,
  ep.created_by_id,
  CASE
    WHEN ep.legacy_mp_entry_id ~ '^MP[0-9]+$' THEN ep.legacy_mp_entry_id
    ELSE 'MPR' || ep.id::text
  END,
  ep.data,
  COALESCE(ep.mp_code, ep.produto_codigo),
  ep.produto_nome,
  ep.cliente_nome,
  ep.lote,
  ep.nota_fiscal,
  ep.fornecedor,
  ep.data_fabricacao,
  ep.data_validade,
  ep.initial_stock,
  ep.saldo_atual,
  COALESCE(ep.unidade_medida, 'kg'),
  ep.preco_unitario,
  CASE
    WHEN ep.densidade ~ '^-?[0-9]+([.][0-9]+)?$' THEN ep.densidade::numeric
    ELSE NULL
  END,
  ep.status,
  COALESCE(ep.status_wms, false),
  ep.observations,
  ep.tank_storage,
  ep.tank_entries,
  ep.packaging_type,
  ep.packaging_capacity,
  ep.packaging_quantity,
  ep.public_token
FROM estoque_produtos ep
WHERE ep.origem = 'MATERIA_PRIMA'
  AND ep.legacy_mp_id_text IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM estoque_mp m WHERE m.id::text = ep.legacy_mp_id_text
  );

-- RPCs voltam a gravar somente em estoque_mp. deduct/restore chamam adjust.
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
  v_row estoque_mp%ROWTYPE;
  v_before numeric;
  v_after numeric;
BEGIN
  IF p_stock_id IS NULL OR btrim(p_stock_id) = '' THEN
    RAISE EXCEPTION 'stock_id obrigatório' USING ERRCODE = '22023';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta inválido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM estoque_mp WHERE id::text = p_stock_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estoque MP não encontrado: %', p_stock_id USING ERRCODE = 'P0002';
  END IF;

  v_before := COALESCE(v_row.current_stock, 0);
  v_after := round((v_before + p_delta)::numeric, 3);
  IF p_require_sufficient AND p_delta < 0 AND v_after < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente (disponível %, solicitado %)', v_before, abs(p_delta)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_require_sufficient AND v_after < 0 THEN
    v_after := 0;
  END IF;

  UPDATE estoque_mp
  SET current_stock = v_after, updated_date = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'entry_id', v_row.entry_id,
    'balance_before', v_before,
    'balance_after', v_after,
    'delta', p_delta
  );
END;
$$;

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
  v_row estoque_mp%ROWTYPE;
BEGIN
  UPDATE estoque_mp
  SET
    current_stock = COALESCE(p_current_stock, current_stock),
    lot = COALESCE(p_lot, lot),
    status_wms = COALESCE(p_status_wms::boolean, status_wms),
    updated_date = now()
  WHERE id::text = p_id
    AND updated_date IS NOT DISTINCT FROM p_expected_updated
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', true,
      'message', 'Estoque alterado por outro usuário. Recarregue e tente novamente.'
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estoque_mp%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('get_public_raw_material_info');
  SELECT * INTO v_row FROM estoque_mp WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'mp_code', v_row.mp_code,
    'mp_name', v_row.mp_name,
    'client', v_row.client,
    'lot', v_row.lot,
    'unit', v_row.unit,
    'current_stock', v_row.current_stock
  );
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.get_public_entrada_info_legado(text)') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS get_public_entrada_info(text);
    ALTER FUNCTION get_public_entrada_info_legado(text) RENAME TO get_public_entrada_info;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.ind_retornos_perdas') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ep_movimento_mp_ref ON ind_retornos_perdas;
  END IF;
END $$;
DROP VIEW IF EXISTS ep_entradas CASCADE;
DROP VIEW IF EXISTS ep_estoque CASCADE;
DROP VIEW IF EXISTS ep_mp CASCADE;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
