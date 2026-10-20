-- ============================================================
-- Token público da entrada (QR da etiqueta de recebimento)
-- + RPC anônima com os dados operacionais do recebimento.
--
-- Não expõe preço, custo nem identificadores internos.
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE t_entradas ADD COLUMN IF NOT EXISTS public_token text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_t_entradas_public_token
  ON t_entradas (public_token)
  WHERE public_token IS NOT NULL AND btrim(public_token) <> '';

CREATE INDEX IF NOT EXISTS idx_t_entradas_public_token
  ON t_entradas (public_token)
  WHERE public_token IS NOT NULL AND btrim(public_token) <> '';

CREATE OR REPLACE FUNCTION get_public_entrada_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entrada t_entradas%ROWTYPE;
  v_codigo text;
  v_ids text[];
  v_lotes jsonb;
  v_lote_src jsonb;
  v_pesagem jsonb;
  v_transbordos jsonb;
BEGIN
  PERFORM enforce_public_rate_limit('get_public_entrada_info');

  IF p_token IS NULL OR length(btrim(p_token)) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_entrada
  FROM t_entradas
  WHERE public_token = btrim(p_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT 'E' || lpad(rn::text, 3, '0')
    INTO v_codigo
  FROM (
    SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
    FROM t_entradas
  ) ranked
  WHERE ranked.id = v_entrada.id;

  SELECT coalesce(array_agg(src.id::text), ARRAY[]::text[])
    INTO v_ids
  FROM (
    SELECT v_entrada.id AS id
    UNION
    SELECT s.id
    FROM t_estoque s
    WHERE s.entrada_id = v_entrada.id
      AND coalesce(s.grupo_entrada, '') NOT LIKE 'TB%'
  ) src;

  v_lote_src := CASE
    WHEN jsonb_typeof(v_entrada.lotes) = 'array' AND jsonb_array_length(v_entrada.lotes) > 0
      THEN v_entrada.lotes
    ELSE jsonb_build_array(jsonb_build_object(
      'produto_nome', v_entrada.produto_nome,
      'produto_codigo', v_entrada.produto_codigo,
      'nota_fiscal', v_entrada.nota_fiscal,
      'lote', v_entrada.lote,
      'densidade', v_entrada.densidade,
      'quantidade', v_entrada.quantidade,
      'unidade_medida', v_entrada.unidade_medida,
      'data_fabricacao', v_entrada.data_fabricacao,
      'data_validade', v_entrada.data_validade,
      'embalado', v_entrada.embalado,
      'peso_liquido', v_entrada.peso_liquido,
      'quantidade_embalagens', v_entrada.quantidade_embalagens
    ))
  END;

  SELECT coalesce(jsonb_agg(mapped.obj ORDER BY mapped.ord), '[]'::jsonb)
    INTO v_lotes
  FROM (
    SELECT
      x.ord,
      jsonb_build_object(
        'produto_nome', x.item->>'produto_nome',
        'produto_codigo', x.item->>'produto_codigo',
        'nota_fiscal', x.item->>'nota_fiscal',
        'lote', x.item->>'lote',
        'densidade', x.item->'densidade',
        'quantidade', x.item->'quantidade',
        'quantidade_nf', x.item->'quantidade_nf',
        'quantidade_declarada', x.item->'quantidade_declarada',
        'unidade_medida', x.item->>'unidade_medida',
        'data_fabricacao', x.item->>'data_fabricacao',
        'data_validade', x.item->>'data_validade',
        'tipo_recebimento', x.item->>'tipo_recebimento',
        'embalado', x.item->'embalado',
        'tipo_embalagem', x.item->>'tipo_embalagem',
        'peso_liquido', x.item->'peso_liquido',
        'peso_bruto', x.item->'peso_bruto',
        'quantidade_embalagens', x.item->'quantidade_embalagens',
        'placa', x.item->>'placa',
        'barril', x.item->>'barril',
        'volume', x.item->'volume',
        'tara', x.item->'tara',
        'lacres', x.item->>'lacres'
      ) AS obj
    FROM jsonb_array_elements(v_lote_src) WITH ORDINALITY AS x(item, ord)
  ) mapped;

  IF v_entrada.granel_pesagem
     OR v_entrada.granel_peso_bruto IS NOT NULL
     OR v_entrada.granel_peso_liquido IS NOT NULL THEN
    v_pesagem := jsonb_build_object(
      'ticket', v_entrada.granel_ticket,
      'peso_bruto', v_entrada.granel_peso_bruto,
      'peso_liquido', v_entrada.granel_peso_liquido,
      'validacao_bruto', v_entrada.granel_validacao_bruto,
      'validacao_liquido', v_entrada.granel_validacao_liquido,
      'erro_admissivel', v_entrada.granel_erro_admissivel,
      'peso_minimo', v_entrada.granel_peso_minimo,
      'peso_maximo', v_entrada.granel_peso_maximo,
      'margem', v_entrada.granel_margem
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
  WHERE jsonb_typeof(coalesce(t.origens, '[]'::jsonb)) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(t.origens) o
      WHERE o->>'entrada_id' = ANY (v_ids)
         OR (
           coalesce(o->>'entrada_id', '') = ''
           AND EXISTS (
             SELECT 1
             FROM t_estoque s
             WHERE s.entrada_id = v_entrada.id
               AND btrim(coalesce(s.entrada_codigo, '')) <> ''
               AND (
                 upper(btrim(o->>'entrada_codigo')) = upper(btrim(s.entrada_codigo))
                 OR upper(btrim(o->>'entrada_codigo')) LIKE upper(btrim(s.entrada_codigo)) || ' %'
                 OR upper(btrim(o->>'entrada_codigo')) LIKE upper(btrim(s.entrada_codigo)) || '-%'
                 OR upper(btrim(o->>'entrada_codigo')) LIKE upper(btrim(s.entrada_codigo)) || '—%'
               )
           )
         )
    );

  RETURN jsonb_build_object(
    'codigo', v_codigo,
    'data', v_entrada.data,
    'cliente', v_entrada.cliente_nome,
    'fornecedor', v_entrada.fornecedor,
    'nota_fiscal', v_entrada.nota_fiscal,
    'origem', v_entrada.origem,
    'quantidade', v_entrada.quantidade,
    'unidade', v_entrada.unidade_medida,
    'lotes', v_lotes,
    'pesagem', v_pesagem,
    'transbordos', v_transbordos
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_entrada_info(text) TO anon, authenticated;
