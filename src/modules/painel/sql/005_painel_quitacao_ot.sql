-- ============================================================================
-- Painel — Quitação OT (listagem consolidada paginada)
-- Fontes: t_transbordos + ind_lista_producoes (Finalizado) + ind_transbordo_ind
-- Executar no SQL Editor do Supabase. Frontend tem fallback se a RPC não existir.
-- ============================================================================

-- Normaliza jsonb para array (evita "cannot extract elements from a scalar").
CREATE OR REPLACE FUNCTION painel_quitacao_ot_as_array(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_parsed jsonb;
  v_text text;
BEGIN
  IF p_value IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_value) = 'array' THEN
    RETURN p_value;
  END IF;

  -- Alguns registros legado guardam o array como string JSON.
  IF jsonb_typeof(p_value) = 'string' THEN
    v_text := btrim(p_value #>> '{}');
    IF left(v_text, 1) = '[' THEN
      BEGIN
        v_parsed := v_text::jsonb;
        IF jsonb_typeof(v_parsed) = 'array' THEN
          RETURN v_parsed;
        END IF;
      EXCEPTION WHEN others THEN
        RETURN '[]'::jsonb;
      END;
    END IF;
  END IF;

  RETURN '[]'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION painel_quitacao_ot_list(
  p_search text DEFAULT NULL,
  p_cliente text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_sort_dir text DEFAULT 'desc'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_cliente text := NULLIF(btrim(COALESCE(p_cliente, '')), '');
  v_page integer := GREATEST(1, COALESCE(p_page, 1));
  v_size integer := LEAST(200, GREATEST(1, COALESCE(p_page_size, 50)));
  v_offset integer;
  v_asc boolean := lower(COALESCE(p_sort_dir, 'desc')) = 'asc';
  v_from_ts timestamptz := CASE
    WHEN p_date_from IS NULL THEN NULL
    ELSE p_date_from::timestamptz
  END;
  v_to_ts timestamptz := CASE
    WHEN p_date_to IS NULL THEN NULL
    ELSE ((p_date_to + 1)::timestamptz - interval '1 millisecond')
  END;
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  v_offset := (v_page - 1) * v_size;

  WITH raw AS (
    -- 1) Transbordos ChemFlow
    SELECT
      'transbordo'::text AS origem_fluxo,
      t.id::text AS record_id,
      COALESCE(NULLIF(btrim(t.codigo_transbordo), ''), t.id::text) AS id_exibido,
      (t.data::timestamptz) AS operation_at,
      COALESCE(NULLIF(btrim(t.produto_codigo), ''), '') AS produto_codigo,
      COALESCE(NULLIF(btrim(t.produto_nome), ''), '') AS produto_nome,
      COALESCE(NULLIF(btrim(t.cliente_nome), ''), '') AS cliente,
      COALESCE(t.volume_total, 0)::numeric AS volume,
      painel_quitacao_ot_as_array(t.operadores) AS operadores,
      painel_quitacao_ot_as_array(t.origens) AS origens_json,
      painel_quitacao_ot_as_array(t.destinos) AS destinos_json,
      COALESCE(
        (
          SELECT string_agg(DISTINCT NULLIF(btrim(o.elem->>'lote'), ''), ' ')
          FROM jsonb_array_elements(painel_quitacao_ot_as_array(t.origens)) o(elem)
        ),
        ''
      ) AS lote_text,
      COALESCE(
        (
          SELECT string_agg(
            DISTINCT NULLIF(btrim(COALESCE(
              o.elem->>'tanka_codigo',
              o.elem->>'placa',
              o.elem->>'barril',
              o.elem->>'entrada_codigo'
            )), ''),
            ' '
          )
          FROM jsonb_array_elements(painel_quitacao_ot_as_array(t.origens)) o(elem)
        ),
        ''
      ) AS tanque_origem_text,
      COALESCE(
        (
          SELECT string_agg(
            DISTINCT NULLIF(btrim(COALESCE(
              d.elem->>'tanka_codigo',
              d.elem->>'placa',
              d.elem->>'barril'
            )), ''),
            ' '
          )
          FROM jsonb_array_elements(painel_quitacao_ot_as_array(t.destinos)) d(elem)
        ),
        ''
      ) AS tanque_destino_text,
      NULL::text AS packaging_type,
      NULL::text AS packaging_info,
      NULL::text AS status_text,
      NULL::jsonb AS raw_materials_used,
      false AS fractional_supply,
      NULL::text AS complement_status,
      NULL::numeric AS volume_apontado,
      NULL::numeric AS volume_pendente,
      COALESCE(cp.filtrado, false) AS produto_filtrado
    FROM t_transbordos t
    LEFT JOIN cadastro_produtos cp ON cp.id = t.produto_id
    WHERE (v_from_ts IS NULL OR t.data >= p_date_from)
      AND (v_to_ts IS NULL OR t.data <= p_date_to)

    UNION ALL

    -- 2) Produções finalizadas (Industrialização)
    SELECT
      'producao'::text AS origem_fluxo,
      p.id::text AS record_id,
      COALESCE(NULLIF(btrim(p.op_number), ''), p.id::text) AS id_exibido,
      COALESCE(p.end_time, p.date, p.updated_date, p.created_date) AS operation_at,
      COALESCE(NULLIF(btrim(r.code), ''), '') AS produto_codigo,
      COALESCE(NULLIF(btrim(p.product), ''), '') AS produto_nome,
      COALESCE(NULLIF(btrim(p.client), ''), '') AS cliente,
      -- Complemento pendente: exibe volume apontado (MPs já aplicadas), não o nominal da OP.
      CASE
        WHEN COALESCE(p.fractional_supply, false)
          AND COALESCE(p.complement_status, '') = 'Pendente'
          AND COALESCE(p.volume_pendente, 0) > 0.001
          AND COALESCE(p.volume_apontado, 0) > 0
        THEN p.volume_apontado::numeric
        ELSE COALESCE(p.volume, 0)::numeric
      END AS volume,
      CASE
        WHEN NULLIF(btrim(p.operator), '') IS NULL THEN '[]'::jsonb
        ELSE jsonb_build_array(btrim(p.operator))
      END AS operadores,
      '[]'::jsonb AS origens_json,
      '[]'::jsonb AS destinos_json,
      COALESCE(NULLIF(btrim(p.lot), ''), '') AS lote_text,
      COALESCE(
        (
          SELECT string_agg(
            DISTINCT NULLIF(btrim(COALESCE(c.container_number, c.barril_number)), ''),
            ' '
          )
          FROM ind_lista_vasilhames c
          WHERE c.production_id = p.id
             OR (p.op_number IS NOT NULL AND c.op_number = p.op_number)
        ),
        ''
      ) AS tanque_origem_text,
      ''::text AS tanque_destino_text,
      NULLIF(btrim(p.packaging_type), '') AS packaging_type,
      NULLIF(btrim(p.packaging_info), '') AS packaging_info,
      p.status AS status_text,
      CASE
        WHEN jsonb_array_length(painel_quitacao_ot_as_array(p.raw_materials_used)) > 0
        THEN '[{"present":true}]'::jsonb
        ELSE '[]'::jsonb
      END AS raw_materials_used,
      COALESCE(p.fractional_supply, false) AS fractional_supply,
      NULLIF(btrim(p.complement_status), '') AS complement_status,
      p.volume_apontado::numeric AS volume_apontado,
      p.volume_pendente::numeric AS volume_pendente,
      false AS produto_filtrado
    FROM ind_lista_producoes p
    LEFT JOIN receitas r ON r.id = p.recipe_id
    WHERE p.status = 'Finalizado'
      AND (p.op_number IS NULL OR p.op_number NOT LIKE 'TB%')
      AND (
        v_from_ts IS NULL
        OR COALESCE(p.end_time, p.date, p.updated_date, p.created_date) >= v_from_ts
      )
      AND (
        v_to_ts IS NULL
        OR COALESCE(p.end_time, p.date, p.updated_date, p.created_date) <= v_to_ts
      )

    UNION ALL

    -- 3) Transbordos Industrialização
    SELECT
      'transbordo_ind'::text AS origem_fluxo,
      tr.id::text AS record_id,
      COALESCE(NULLIF(btrim(tr.transfer_number), ''), tr.id::text) AS id_exibido,
      COALESCE(tr.date, tr.updated_date, tr.created_date) AS operation_at,
      COALESCE(NULLIF(btrim(rr.code), ''), '') AS produto_codigo,
      COALESCE(NULLIF(btrim(tr.product), ''), '') AS produto_nome,
      COALESCE(NULLIF(btrim(tr.client), ''), '') AS cliente,
      -- Header.volume pode ser 0 em Expedição: usa soma dos destinos/origens.
      CASE
        WHEN COALESCE(tr.volume, 0) > 0 THEN tr.volume::numeric
        WHEN COALESCE((
          SELECT SUM(COALESCE((d.elem->>'volume')::numeric, 0))
          FROM jsonb_array_elements(painel_quitacao_ot_as_array(tr.destinations)) d(elem)
        ), 0) > 0 THEN (
          SELECT SUM(COALESCE((d.elem->>'volume')::numeric, 0))
          FROM jsonb_array_elements(painel_quitacao_ot_as_array(tr.destinations)) d(elem)
        )
        ELSE COALESCE((
          SELECT SUM(COALESCE((o.elem->>'volume_used')::numeric, 0))
          FROM jsonb_array_elements(painel_quitacao_ot_as_array(tr.origins)) o(elem)
        ), 0)
      END AS volume,
      CASE
        WHEN NULLIF(btrim(tr.operator), '') IS NULL THEN '[]'::jsonb
        ELSE jsonb_build_array(btrim(tr.operator))
      END AS operadores,
      painel_quitacao_ot_as_array(tr.origins) AS origens_json,
      painel_quitacao_ot_as_array(tr.destinations) AS destinos_json,
      COALESCE(
        (
          SELECT string_agg(DISTINCT NULLIF(btrim(o.elem->>'lot'), ''), ' ')
          FROM jsonb_array_elements(painel_quitacao_ot_as_array(tr.origins)) o(elem)
        ),
        ''
      ) AS lote_text,
      COALESCE(
        (
          SELECT string_agg(
            DISTINCT NULLIF(btrim(COALESCE(
              o.elem->>'container_number',
              o.elem->>'barril_number'
            )), ''),
            ' '
          )
          FROM jsonb_array_elements(painel_quitacao_ot_as_array(tr.origins)) o(elem)
        ),
        ''
      ) AS tanque_origem_text,
      COALESCE(
        (
          SELECT string_agg(
            DISTINCT NULLIF(btrim(COALESCE(d.elem->>'placa', d.elem->>'barril')), ''),
            ' '
          )
          FROM jsonb_array_elements(painel_quitacao_ot_as_array(tr.destinations)) d(elem)
        ),
        ''
      ) AS tanque_destino_text,
      NULLIF(btrim(tr.packaging_type), '') AS packaging_type,
      NULL::text AS packaging_info,
      NULL::text AS status_text,
      NULL::jsonb AS raw_materials_used,
      false AS fractional_supply,
      NULL::text AS complement_status,
      NULL::numeric AS volume_apontado,
      NULL::numeric AS volume_pendente,
      false AS produto_filtrado
    FROM ind_transbordo_ind tr
    LEFT JOIN LATERAL (
      SELECT r.code
      FROM receitas r
      WHERE lower(btrim(r.product_name)) = lower(btrim(tr.product))
      ORDER BY r.revision_number DESC NULLS LAST, r.created_date DESC NULLS LAST
      LIMIT 1
    ) rr ON true
    WHERE (v_from_ts IS NULL OR COALESCE(tr.date, tr.updated_date, tr.created_date) >= v_from_ts)
      AND (v_to_ts IS NULL OR COALESCE(tr.date, tr.updated_date, tr.created_date) <= v_to_ts)
  ),
  filtered AS (
    SELECT *
    FROM raw
    WHERE (v_cliente IS NULL OR lower(cliente) = lower(v_cliente))
      AND (
        v_search IS NULL
        OR produto_codigo ILIKE '%' || v_search || '%'
        OR produto_nome ILIKE '%' || v_search || '%'
        OR lote_text ILIKE '%' || v_search || '%'
        OR tanque_origem_text ILIKE '%' || v_search || '%'
        OR tanque_destino_text ILIKE '%' || v_search || '%'
        OR id_exibido ILIKE '%' || v_search || '%'
      )
  ),
  counted AS (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  classified AS (
    SELECT
      f.*,
      CASE
        WHEN f.origem_fluxo = 'producao' THEN 'industrializacao'
        WHEN f.origem_fluxo = 'transbordo_ind' THEN 'convencional'
        WHEN EXISTS (
          SELECT 1
          FROM jsonb_array_elements(f.origens_json) o(elem)
          WHERE lower(NULLIF(btrim(COALESCE(o.elem->>'tipo_origem', o.elem->>'tipo')), ''))
                IN ('entrada', 'granel')
             OR NULLIF(btrim(COALESCE(o.elem->>'tipo_origem', o.elem->>'tipo')), '') IS NULL
        )
          AND jsonb_array_length(f.origens_json) > 0
          THEN 'convencional'
        WHEN COALESCE(f.produto_filtrado, false)
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(f.origens_json) o(elem)
            WHERE lower(COALESCE(o.elem->>'tipo_origem', '')) = 'tanka'
          )
          THEN 'filtracao'
        ELSE 'convencional'
      END AS operacao
    FROM filtered f
  ),
  totals AS (
    SELECT jsonb_build_object(
      'industrializacao', COALESCE(SUM(volume) FILTER (WHERE operacao = 'industrializacao'), 0),
      'filtracao', COALESCE(SUM(volume) FILTER (WHERE operacao = 'filtracao'), 0),
      'convencional', COALESCE(SUM(volume) FILTER (WHERE operacao = 'convencional'), 0)
    ) AS payload
    FROM classified
  ),
  page AS (
    SELECT f.*
    FROM filtered f
    ORDER BY
      CASE WHEN v_asc THEN f.operation_at END ASC NULLS LAST,
      CASE WHEN NOT v_asc THEN f.operation_at END DESC NULLS LAST,
      f.id_exibido DESC
    OFFSET v_offset
    LIMIT v_size
  )
  SELECT
    (SELECT total FROM counted),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'origem_fluxo', p.origem_fluxo,
            'record_id', p.record_id,
            'id_exibido', p.id_exibido,
            'operation_at', p.operation_at,
            'produto_codigo', p.produto_codigo,
            'produto_nome', p.produto_nome,
            'cliente', p.cliente,
            'volume', p.volume,
            'operadores', p.operadores,
            'lote', p.lote_text,
            'origens', p.origens_json,
            'destinos', p.destinos_json,
            'packaging_type', p.packaging_type,
            'packaging_info', p.packaging_info,
            'status', p.status_text,
            'raw_materials_used', p.raw_materials_used,
            'fractional_supply', p.fractional_supply,
            'complement_status', p.complement_status,
            'volume_apontado', p.volume_apontado,
            'volume_pendente', p.volume_pendente,
            'produto_filtrado', p.produto_filtrado
          )
          ORDER BY
            CASE WHEN v_asc THEN p.operation_at END ASC NULLS LAST,
            CASE WHEN NOT v_asc THEN p.operation_at END DESC NULLS LAST,
            p.id_exibido DESC
        )
        FROM page p
      ),
      '[]'::jsonb
    )
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_size,
    'totals', COALESCE((SELECT payload FROM totals), jsonb_build_object(
      'industrializacao', 0,
      'filtracao', 0,
      'convencional', 0
    ))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION painel_quitacao_ot_as_array(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION painel_quitacao_ot_list(text, text, date, date, integer, integer, text)
  TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
