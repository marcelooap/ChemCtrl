-- =============================================================================
-- 071_estoque_produtos_unifica_quantidades.sql
-- Unifica colunas de quantidade em estoque_produtos:
--   saldo_inicial  ← COALESCE(initial_stock, quantidade, 0)
--   saldo_final    ← COALESCE(saldo_atual, 0)
--   expedido       ← GENERATED ALWAYS AS (GREATEST(0, saldo_inicial - saldo_final)) STORED
-- Remove: quantidade, initial_stock, saldo_atual, quantidade_nf, quantidade_declarada
-- Atualiza RPCs e funções que leem/gravam as colunas antigas.
-- Idempotente. Aplicar no SQL Editor do Supabase.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.estoque_produtos') IS NULL THEN
    RAISE EXCEPTION '071: estoque_produtos não existe';
  END IF;
END $$;

-- Vistas ep_* (se ainda existirem) dependem das colunas antigas.
DROP VIEW IF EXISTS ep_estoque CASCADE;
DROP VIEW IF EXISTS ep_mp CASCADE;
DROP VIEW IF EXISTS ep_entradas CASCADE;

-- ---------------------------------------------------------------------------
-- 1. Novas colunas + backfill
-- ---------------------------------------------------------------------------
ALTER TABLE estoque_produtos
  ADD COLUMN IF NOT EXISTS saldo_inicial numeric,
  ADD COLUMN IF NOT EXISTS saldo_final numeric;

DO $$
DECLARE
  has_initial boolean;
  has_qtd boolean;
  has_saldo boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estoque_produtos'
      AND column_name = 'initial_stock'
  ) INTO has_initial;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estoque_produtos'
      AND column_name = 'quantidade'
  ) INTO has_qtd;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estoque_produtos'
      AND column_name = 'saldo_atual'
  ) INTO has_saldo;

  -- MP: initial_stock é o canônico; ARMAZENAGEM: quantidade é o canônico.
  IF has_initial AND has_qtd THEN
    EXECUTE $upd$
      UPDATE estoque_produtos
      SET saldo_inicial = CASE
        WHEN origem = 'MATERIA_PRIMA'
          THEN COALESCE(initial_stock, quantidade, saldo_inicial, 0)
        ELSE COALESCE(quantidade, initial_stock, saldo_inicial, 0)
      END
    $upd$;
  ELSIF has_initial THEN
    EXECUTE $upd$
      UPDATE estoque_produtos
      SET saldo_inicial = COALESCE(initial_stock, saldo_inicial, 0)
    $upd$;
  ELSIF has_qtd THEN
    EXECUTE $upd$
      UPDATE estoque_produtos
      SET saldo_inicial = COALESCE(quantidade, saldo_inicial, 0)
    $upd$;
  ELSE
    UPDATE estoque_produtos
    SET saldo_inicial = COALESCE(saldo_inicial, 0)
    WHERE saldo_inicial IS NULL;
  END IF;

  IF has_saldo THEN
    EXECUTE $upd$
      UPDATE estoque_produtos
      SET saldo_final = COALESCE(saldo_atual, saldo_final, 0)
    $upd$;
  ELSE
    UPDATE estoque_produtos
    SET saldo_final = COALESCE(saldo_final, 0)
    WHERE saldo_final IS NULL;
  END IF;
END $$;

UPDATE estoque_produtos
SET saldo_inicial = COALESCE(saldo_inicial, 0)
WHERE saldo_inicial IS NULL;

UPDATE estoque_produtos
SET saldo_final = COALESCE(saldo_final, 0)
WHERE saldo_final IS NULL;

ALTER TABLE estoque_produtos
  ALTER COLUMN saldo_inicial SET DEFAULT 0,
  ALTER COLUMN saldo_inicial SET NOT NULL,
  ALTER COLUMN saldo_final SET DEFAULT 0,
  ALTER COLUMN saldo_final SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Coluna gerada expedido
-- ---------------------------------------------------------------------------
ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS expedido;

ALTER TABLE estoque_produtos
  ADD COLUMN expedido numeric
  GENERATED ALWAYS AS (GREATEST(0, saldo_inicial - saldo_final)) STORED;

-- ---------------------------------------------------------------------------
-- 3. Índice de saldo → saldo_final
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_estoque_produtos_saldo;
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_saldo
  ON estoque_produtos (saldo_final);

-- ---------------------------------------------------------------------------
-- 4. RPCs / funções que referenciam colunas antigas
-- ---------------------------------------------------------------------------

-- ep_item_json (usado por get_public_entrada_info se ainda existir)
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
BEGIN
  IF p_stock_id IS NULL OR btrim(p_stock_id) = '' THEN
    RAISE EXCEPTION 'stock_id obrigatório' USING ERRCODE = '22023';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta inválido' USING ERRCODE = '22023';
  END IF;

  SELECT id, id_entrada, COALESCE(saldo_final, 0)
    INTO v_id, v_entry, v_before
  FROM estoque_produtos
  WHERE origem = 'MATERIA_PRIMA'
    AND legacy_mp_id_text = p_stock_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estoque MP não encontrado: %', p_stock_id USING ERRCODE = 'P0002';
  END IF;

  v_after := round((v_before + p_delta)::numeric, 3);
  IF p_require_sufficient AND p_delta < 0 AND v_after < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente (disponível %, solicitado %)', v_before, abs(p_delta)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_require_sufficient AND v_after < 0 THEN
    v_after := 0;
  END IF;

  UPDATE estoque_produtos
  SET saldo_final = v_after
  WHERE id = v_id;

  RETURN jsonb_build_object(
    'id', p_stock_id,
    'entry_id', v_entry,
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
    saldo_final = COALESCE(p_current_stock, saldo_final),
    lote = COALESCE(p_lot, lote),
    status_wms = COALESCE(p_status_wms::boolean, status_wms)
  WHERE origem = 'MATERIA_PRIMA'
    AND legacy_mp_id_text = p_id
    AND updated_at IS NOT DISTINCT FROM p_expected_updated
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', to_jsonb(v_row));
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'conflict', true,
    'message', 'Estoque alterado por outro usuário. Recarregue e tente novamente.'
  );
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
BEGIN
  PERFORM enforce_public_rate_limit('get_public_raw_material_info');
  SELECT * INTO v_row
  FROM estoque_produtos
  WHERE origem = 'MATERIA_PRIMA' AND public_token = p_token
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'mp_code', v_row.produto_codigo,
    'mp_name', v_row.produto_nome,
    'client', v_row.cliente_nome,
    'lot', v_row.lote,
    'unit', v_row.unidade_medida,
    'current_stock', v_row.saldo_final
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;

-- t_fisico_embalado (se existir) passa a somar saldo_final
DO $$
BEGIN
  IF to_regprocedure('public.t_fisico_embalado(uuid, text, text, text, text)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION t_fisico_embalado(
        p_cliente_id uuid,
        p_cliente_nome text,
        p_produto_codigo text,
        p_lote text,
        p_unidade text
      ) RETURNS numeric
      LANGUAGE plpgsql
      AS $body$
      DECLARE
        v_ids uuid[];
        v_total numeric := 0;
        v_unidade text := lower(trim(coalesce(nullif(p_unidade, ''), 'kg')));
      BEGIN
        SELECT coalesce(array_agg(e.legacy_estoque_id), '{}')
          INTO v_ids
        FROM estoque_produtos e
        WHERE e.origem = 'ARMAZENAGEM'
          AND e.legacy_estoque_id IS NOT NULL
          AND (
            CASE
              WHEN coalesce(e.tipo_recebimento, '') IN ('embalado', 'vasilhame', 'granel')
                THEN e.tipo_recebimento = 'embalado'
              ELSE coalesce(e.embalado, false)
            END
          )
          AND t_norm_txt(e.produto_codigo) = t_norm_txt(p_produto_codigo)
          AND t_norm_txt(coalesce(e.lote, '')) = t_norm_txt(coalesce(p_lote, ''))
          AND lower(trim(coalesce(nullif(trim(e.unidade_medida), ''), 'kg'))) = v_unidade
          AND (
            (p_cliente_id IS NOT NULL AND e.cliente_id = p_cliente_id)
            OR (
              p_cliente_id IS NULL
              AND t_norm_txt(e.cliente_nome) = t_norm_txt(p_cliente_nome)
            )
          );

        IF coalesce(array_length(v_ids, 1), 0) > 0 THEN
          PERFORM 1
          FROM estoque_produtos
          WHERE legacy_estoque_id = ANY (v_ids)
          FOR UPDATE;
          SELECT coalesce(round(sum(coalesce(saldo_final, 0))), 0)
            INTO v_total
          FROM estoque_produtos
          WHERE legacy_estoque_id = ANY (v_ids);
        END IF;

        RETURN coalesce(v_total, 0);
      END;
      $body$;
    $fn$;
  END IF;
END $$;

-- get_public_entrada_info: soma saldo_inicial no lugar de quantidade
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
    IF to_regprocedure('public.get_public_entrada_info_legado(text)') IS NOT NULL THEN
      RETURN get_public_entrada_info_legado(v_token);
    END IF;
    RETURN NULL;
  END IF;

  PERFORM enforce_public_rate_limit('get_public_entrada_info');

  SELECT coalesce(sum(saldo_inicial), 0)
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

  IF to_regclass('public.t_transbordos') IS NOT NULL THEN
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
    WHERE jsonb_typeof(coalesce(t.origens, '[]'::jsonb)) = 'array'
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
  ELSE
    v_transbordos := '[]'::jsonb;
  END IF;

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
    'transbordos', coalesce(v_transbordos, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_entrada_info(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Drop das colunas antigas (só depois das RPCs atualizadas)
-- CASCADE remove dependências órfãs de vistas/funções ep_* legadas.
-- ---------------------------------------------------------------------------
ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS quantidade CASCADE;
ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS initial_stock CASCADE;
ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS saldo_atual CASCADE;
ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS quantidade_nf CASCADE;
ALTER TABLE estoque_produtos DROP COLUMN IF EXISTS quantidade_declarada CASCADE;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
