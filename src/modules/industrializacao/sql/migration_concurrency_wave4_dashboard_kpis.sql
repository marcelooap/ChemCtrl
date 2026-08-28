-- ============================================================================
-- Onda 4 — Agregações do Dashboard no banco (em vez de 2000 rows no browser)
-- ============================================================================

CREATE OR REPLACE FUNCTION dashboard_production_kpis(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, date_trunc('year', now()));
  v_to timestamptz := COALESCE(p_to, now());
  v_total int;
  v_finalizadas int;
  v_volume numeric;
  v_by_product jsonb;
  v_by_month jsonb;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status ILIKE 'Finalizado%'),
         COALESCE(SUM(volume), 0)
    INTO v_total, v_finalizadas, v_volume
  FROM ind_lista_producoes
  WHERE created_date BETWEEN v_from AND v_to
    AND (op_number IS NULL OR op_number NOT LIKE 'TB%');

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    INTO v_by_product
  FROM (
    SELECT product, COUNT(*) AS qty, COALESCE(SUM(volume), 0) AS volume
    FROM ind_lista_producoes
    WHERE created_date BETWEEN v_from AND v_to
      AND (op_number IS NULL OR op_number NOT LIKE 'TB%')
    GROUP BY product
    ORDER BY volume DESC
    LIMIT 20
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    INTO v_by_month
  FROM (
    SELECT to_char(date_trunc('month', created_date), 'YYYY-MM') AS month,
           COUNT(*) AS qty,
           COALESCE(SUM(volume), 0) AS volume
    FROM ind_lista_producoes
    WHERE created_date BETWEEN v_from AND v_to
      AND (op_number IS NULL OR op_number NOT LIKE 'TB%')
    GROUP BY 1
    ORDER BY 1
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'finalizadas', v_finalizadas,
    'volume', v_volume,
    'by_product', v_by_product,
    'by_month', v_by_month
  );
END;
$$;

GRANT EXECUTE ON FUNCTION dashboard_production_kpis(timestamptz, timestamptz) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
