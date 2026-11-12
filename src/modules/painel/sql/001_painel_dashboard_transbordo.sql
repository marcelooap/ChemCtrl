-- ============================================================================
-- Painel Dashboard — consolidação Transbordo (KPIs + séries)
-- Executar no SQL Editor do Supabase (opcional; o frontend tem fallback).
-- ============================================================================

CREATE OR REPLACE FUNCTION painel_dashboard_transbordo(p_year integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
  v_from date := make_date(v_year, 1, 1);
  v_to date := make_date(v_year, 12, 31);
  v_from_ts timestamptz := v_from::timestamptz;
  v_to_ts timestamptz := (v_to + 1)::timestamptz - interval '1 millisecond';
  v_convencional numeric := 0;
  v_filtrado numeric := 0;
  v_industrializado numeric := 0;
  v_monthly jsonb;
  v_operators jsonb;
BEGIN
  -- Destinos de transbordo classificados
  WITH dest AS (
    SELECT
      t.id AS transbordo_id,
      t.data,
      EXTRACT(MONTH FROM t.data)::int AS month_num,
      t.operadores,
      COALESCE(p.filtrado, false) AS produto_filtrado,
      COALESCE(NULLIF(d.elem->>'tipo_embalagem', ''), '') AS tipo_embalagem,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(t.origens, '[]'::jsonb)) o(elem)
          WHERE o.elem->>'_uid' IS NOT NULL
            AND o.elem->>'_uid' = d.elem->>'origem_uid'
            AND (
              o.elem->>'tipo_origem' = 'embalado'
              OR COALESCE((o.elem->>'embalado')::boolean, false)
            )
            AND lower(COALESCE(o.elem->>'unidade_medida', 'kg')) IN ('kg', 'lb')
        ) AND NULLIF(t.densidade::text, '') IS NOT NULL
          AND t.densidade::numeric > 0
        THEN ROUND(
          (
            CASE
              WHEN lower(COALESCE((
                SELECT o.elem->>'unidade_medida'
                FROM jsonb_array_elements(COALESCE(t.origens, '[]'::jsonb)) o(elem)
                WHERE o.elem->>'_uid' = d.elem->>'origem_uid'
                LIMIT 1
              ), 'kg')) = 'lb'
              THEN COALESCE((d.elem->>'volume_total')::numeric, (d.elem->>'volume')::numeric, 0) * 0.453592
              ELSE COALESCE((d.elem->>'volume_total')::numeric, (d.elem->>'volume')::numeric, 0)
            END
          ) / NULLIF(t.densidade::numeric, 0),
          3
        )
        ELSE ROUND(COALESCE((d.elem->>'volume_total')::numeric, (d.elem->>'volume')::numeric, 0), 3)
      END AS volume_l,
      CASE
        WHEN COALESCE(NULLIF(d.elem->>'tipo_embalagem', ''), '') = 'Tankagem' THEN 'convencional'
        WHEN COALESCE(p.filtrado, false)
          AND COALESCE(NULLIF(d.elem->>'tipo_embalagem', ''), '') = 'Vasilhame'
          THEN 'filtrado'
        ELSE 'convencional'
      END AS categoria
    FROM t_transbordos t
    LEFT JOIN cadastro_produtos p ON p.id = t.produto_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.destinos, '[]'::jsonb)) AS d(elem)
    WHERE t.data BETWEEN v_from AND v_to
  ),
  dest_ok AS (
    SELECT * FROM dest WHERE volume_l > 0
  ),
  prod AS (
    SELECT
      id,
      ROUND(COALESCE(volume, 0), 3) AS volume_l,
      COALESCE(NULLIF(btrim(operator), ''), NULL) AS operator_name,
      EXTRACT(MONTH FROM COALESCE(end_time, updated_date))::int AS month_num
    FROM ind_lista_producoes
    WHERE status = 'Finalizado'
      AND (op_number IS NULL OR op_number NOT LIKE 'TB%')
      AND COALESCE(end_time, updated_date) BETWEEN v_from_ts AND v_to_ts
      AND COALESCE(volume, 0) > 0
  )
  SELECT
    COALESCE(SUM(volume_l) FILTER (WHERE categoria = 'convencional'), 0),
    COALESCE(SUM(volume_l) FILTER (WHERE categoria = 'filtrado'), 0)
  INTO v_convencional, v_filtrado
  FROM dest_ok;

  SELECT COALESCE(SUM(volume_l), 0) INTO v_industrializado FROM prod;

  -- Série mensal (12 meses)
  WITH months AS (
    SELECT generate_series(1, 12) AS month_num
  ),
  dest AS (
    SELECT
      EXTRACT(MONTH FROM t.data)::int AS month_num,
      ROUND(COALESCE((d.elem->>'volume_total')::numeric, (d.elem->>'volume')::numeric, 0), 3) AS volume_l,
      CASE
        WHEN COALESCE(NULLIF(d.elem->>'tipo_embalagem', ''), '') = 'Tankagem' THEN 'convencional'
        WHEN COALESCE(p.filtrado, false)
          AND COALESCE(NULLIF(d.elem->>'tipo_embalagem', ''), '') = 'Vasilhame'
          THEN 'filtrado'
        ELSE 'convencional'
      END AS categoria
    FROM t_transbordos t
    LEFT JOIN cadastro_produtos p ON p.id = t.produto_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.destinos, '[]'::jsonb)) AS d(elem)
    WHERE t.data BETWEEN v_from AND v_to
  ),
  prod AS (
    SELECT
      EXTRACT(MONTH FROM COALESCE(end_time, updated_date))::int AS month_num,
      ROUND(COALESCE(volume, 0), 3) AS volume_l
    FROM ind_lista_producoes
    WHERE status = 'Finalizado'
      AND (op_number IS NULL OR op_number NOT LIKE 'TB%')
      AND COALESCE(end_time, updated_date) BETWEEN v_from_ts AND v_to_ts
  ),
  agg AS (
    SELECT month_num,
           COALESCE(SUM(volume_l) FILTER (WHERE categoria = 'convencional'), 0) AS convencional,
           COALESCE(SUM(volume_l) FILTER (WHERE categoria = 'filtrado'), 0) AS filtrado,
           0::numeric AS industrializado
    FROM dest
    WHERE volume_l > 0
    GROUP BY month_num
    UNION ALL
    SELECT month_num, 0, 0, COALESCE(SUM(volume_l), 0)
    FROM prod
    GROUP BY month_num
  ),
  rolled AS (
    SELECT month_num,
           SUM(convencional) AS convencional,
           SUM(filtrado) AS filtrado,
           SUM(industrializado) AS industrializado
    FROM agg
    GROUP BY month_num
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'monthIndex', m.month_num - 1,
      'monthLabel', (ARRAY['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'])[m.month_num],
      'convencional', ROUND(COALESCE(r.convencional, 0), 3),
      'filtrado', ROUND(COALESCE(r.filtrado, 0), 3),
      'industrializado', ROUND(COALESCE(r.industrializado, 0), 3),
      'total', ROUND(COALESCE(r.convencional, 0) + COALESCE(r.filtrado, 0) + COALESCE(r.industrializado, 0), 3)
    )
    ORDER BY m.month_num
  ), '[]'::jsonb)
  INTO v_monthly
  FROM months m
  LEFT JOIN rolled r ON r.month_num = m.month_num;

  -- Operadores (transbordo rateado + industrialização)
  WITH dest AS (
    SELECT
      t.operadores,
      ROUND(COALESCE((d.elem->>'volume_total')::numeric, (d.elem->>'volume')::numeric, 0), 3) AS volume_l
    FROM t_transbordos t
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.destinos, '[]'::jsonb)) AS d(elem)
    WHERE t.data BETWEEN v_from AND v_to
      AND COALESCE((d.elem->>'volume_total')::numeric, (d.elem->>'volume')::numeric, 0) > 0
  ),
  tb_ops AS (
    SELECT
      NULLIF(btrim(op.elem #>> '{}'), '') AS name,
      ROUND(d.volume_l / NULLIF(jsonb_array_length(COALESCE(d.operadores, '[]'::jsonb)), 0), 3) AS volume
    FROM dest d
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.operadores, '[]'::jsonb)) AS op(elem)
    WHERE jsonb_array_length(COALESCE(d.operadores, '[]'::jsonb)) > 0
  ),
  ind_ops AS (
    SELECT
      NULLIF(btrim(operator), '') AS name,
      ROUND(COALESCE(volume, 0), 3) AS volume
    FROM ind_lista_producoes
    WHERE status = 'Finalizado'
      AND (op_number IS NULL OR op_number NOT LIKE 'TB%')
      AND COALESCE(end_time, updated_date) BETWEEN v_from_ts AND v_to_ts
      AND NULLIF(btrim(operator), '') IS NOT NULL
      AND COALESCE(volume, 0) > 0
  ),
  all_ops AS (
    SELECT name, volume FROM tb_ops WHERE name IS NOT NULL
    UNION ALL
    SELECT name, volume FROM ind_ops WHERE name IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'volume', ROUND(SUM(volume), 3))
    ORDER BY SUM(volume) DESC
  ), '[]'::jsonb)
  INTO v_operators
  FROM all_ops
  GROUP BY name;

  RETURN jsonb_build_object(
    'year', v_year,
    'totals', jsonb_build_object(
      'total', ROUND(v_convencional + v_filtrado + v_industrializado, 3),
      'convencional', ROUND(v_convencional, 3),
      'industrializado', ROUND(v_industrializado, 3),
      'filtrado', ROUND(v_filtrado, 3)
    ),
    'monthly', v_monthly,
    'distribution', jsonb_build_array(
      jsonb_build_object(
        'key', 'convencional',
        'name', 'Convencional',
        'volume', ROUND(v_convencional, 3),
        'percent', CASE WHEN (v_convencional + v_filtrado + v_industrializado) > 0
          THEN (v_convencional / (v_convencional + v_filtrado + v_industrializado)) * 100 ELSE 0 END
      ),
      jsonb_build_object(
        'key', 'industrializado',
        'name', 'Industrializado',
        'volume', ROUND(v_industrializado, 3),
        'percent', CASE WHEN (v_convencional + v_filtrado + v_industrializado) > 0
          THEN (v_industrializado / (v_convencional + v_filtrado + v_industrializado)) * 100 ELSE 0 END
      ),
      jsonb_build_object(
        'key', 'filtrado',
        'name', 'Filtrado',
        'volume', ROUND(v_filtrado, 3),
        'percent', CASE WHEN (v_convencional + v_filtrado + v_industrializado) > 0
          THEN (v_filtrado / (v_convencional + v_filtrado + v_industrializado)) * 100 ELSE 0 END
      )
    ),
    'operators', COALESCE(v_operators, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION painel_dashboard_transbordo(integer) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
