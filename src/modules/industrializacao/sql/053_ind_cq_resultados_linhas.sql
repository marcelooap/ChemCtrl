-- =============================================================================
-- 053_ind_cq_resultados_linhas.sql
-- Renomeia ind_cq_resultados → resultados_cq e grava 1 linha por análise,
-- no mesmo modelo de cadastro_analises.
-- O cabeçalho (produção, OP, produto, cliente, lote, data, analista, status
-- geral, observações, foto) se repete em cada linha. resultado_id agrupa as
-- análises de um mesmo certificado.
--
-- O valor medido fica em result. O parecer da análise fica em analysis_status
-- (Aprovado/Reprovado). A coluna status continua sendo o parecer geral do CQ.
-- results (jsonb) fica nulo depois da conversão.
--
-- Idempotente. Não faz DROP/TRUNCATE de dados de negócio.
-- Aplicar junto com o app que agrupa as linhas (qualityResultComposition.js).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.resultados_cq') IS NOT NULL
     AND to_regclass('public.ind_cq_resultados') IS NOT NULL THEN
    RAISE EXCEPTION 'resultados_cq e ind_cq_resultados existem ao mesmo tempo. Mantenha só a tabela com os dados.';
  END IF;

  IF to_regclass('public.resultados_cq') IS NULL
     AND to_regclass('public.ind_cq_resultados') IS NOT NULL THEN
    ALTER TABLE public.ind_cq_resultados RENAME TO resultados_cq;
  ELSIF to_regclass('public.resultados_cq') IS NULL THEN
    RAISE EXCEPTION '053: tabela ind_cq_resultados nao encontrada';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_ind_cq_resultados'
      AND tgrelid = 'public.resultados_cq'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_ind_cq_resultados ON public.resultados_cq
      RENAME TO update_updated_date_resultados_cq;
  ELSIF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_quality_results'
      AND tgrelid = 'public.resultados_cq'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_quality_results ON public.resultados_cq
      RENAME TO update_updated_date_resultados_cq;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resultados_cq'
      AND policyname = 'allow_all_ind_cq_resultados'
  ) THEN
    ALTER POLICY "allow_all_ind_cq_resultados" ON public.resultados_cq
      RENAME TO allow_all_resultados_cq;
  END IF;

  IF to_regclass('public.idx_ind_cq_resultados_production_id') IS NOT NULL
     AND to_regclass('public.idx_resultados_cq_production_id') IS NULL THEN
    ALTER INDEX public.idx_ind_cq_resultados_production_id
      RENAME TO idx_resultados_cq_production_id;
  END IF;

  IF to_regclass('public.idx_ind_cq_resultados_prod_created') IS NOT NULL
     AND to_regclass('public.idx_resultados_cq_prod_created') IS NULL THEN
    ALTER INDEX public.idx_ind_cq_resultados_prod_created
      RENAME TO idx_resultados_cq_prod_created;
  END IF;
END $$;

ALTER TABLE public.resultados_cq
  ADD COLUMN IF NOT EXISTS sample_photo_url text;

DO $$
BEGIN
  IF to_regclass('public._chemctrl_053_resultados_cq_backup') IS NULL THEN
    CREATE TABLE public._chemctrl_053_resultados_cq_backup AS
    SELECT * FROM public.resultados_cq;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public._chemctrl_053_resultados_cq_report (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source_id text,
  product text,
  op_number text,
  status text NOT NULL,
  detail text,
  analysis_count integer
);

CREATE OR REPLACE FUNCTION public.resultados_cq_parse_results(p_raw jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_txt text;
  v_parsed jsonb;
BEGIN
  IF p_raw IS NULL OR p_raw = 'null'::jsonb THEN
    RETURN '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_raw) = 'array' THEN
    RETURN p_raw;
  END IF;

  IF jsonb_typeof(p_raw) = 'string' THEN
    v_txt := trim(both FROM (p_raw #>> '{}'));
    IF v_txt IS NULL OR v_txt = '' THEN
      RETURN '[]'::jsonb;
    END IF;
    BEGIN
      v_parsed := v_txt::jsonb;
    EXCEPTION WHEN others THEN
      RETURN '[]'::jsonb;
    END;
    IF jsonb_typeof(v_parsed) = 'array' THEN
      RETURN v_parsed;
    END IF;
    RETURN '[]'::jsonb;
  END IF;

  RETURN '[]'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.resultados_cq_to_numeric(p_text text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;
  RETURN replace(btrim(p_text), ',', '.')::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS resultado_id text;
ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS linha_ordem integer NOT NULL DEFAULT 1;
ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS analysis_name text;
ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS methodology text;
ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS specification text;
ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS min_limit numeric;
ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS max_limit numeric;
ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS result text;
ALTER TABLE public.resultados_cq ADD COLUMN IF NOT EXISTS analysis_status text;

DO $$
DECLARE
  r record;
  v_items jsonb;
  v_item jsonb;
  v_count integer;
  v_idx integer;
  v_first boolean;
  v_new_id text;
  v_already boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.resultados_cq WHERE resultado_id IS NOT NULL LIMIT 1
  ) INTO v_already;

  IF v_already THEN
    INSERT INTO public._chemctrl_053_resultados_cq_report (source_id, status, detail)
    VALUES (NULL, 'skipped_already_converted', 'resultado_id ja preenchido');
    RETURN;
  END IF;

  FOR r IN
    SELECT *
    FROM public._chemctrl_053_resultados_cq_backup
    ORDER BY created_date ASC NULLS LAST, id ASC
  LOOP
    SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(public.resultados_cq_parse_results(r.results))
      WITH ORDINALITY AS t(elem, ord)
    WHERE nullif(trim(both FROM coalesce(elem->>'analysis_name', '')), '') IS NOT NULL
       OR nullif(trim(both FROM coalesce(elem->>'result', '')), '') IS NOT NULL
       OR nullif(trim(both FROM coalesce(elem->>'specification', '')), '') IS NOT NULL
       OR public.resultados_cq_to_numeric(elem->>'min_limit') IS NOT NULL
       OR public.resultados_cq_to_numeric(elem->>'max_limit') IS NOT NULL;

    v_count := COALESCE(jsonb_array_length(v_items), 0);

    IF v_count = 0 THEN
      UPDATE public.resultados_cq
      SET
        resultado_id = r.id,
        linha_ordem = 1,
        analysis_name = NULL,
        methodology = NULL,
        specification = NULL,
        unit = NULL,
        min_limit = NULL,
        max_limit = NULL,
        result = NULL,
        analysis_status = NULL,
        results = NULL,
        updated_date = now()
      WHERE id = r.id;

      INSERT INTO public._chemctrl_053_resultados_cq_report (source_id, product, op_number, status, detail, analysis_count)
      VALUES (r.id, r.product, r.op_number, 'converted_no_analyses', 'Linha mantida sem analise', 0);
      CONTINUE;
    END IF;

    v_first := true;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_idx := v_idx + 1;
      IF v_first THEN
        UPDATE public.resultados_cq
        SET
          resultado_id = r.id,
          linha_ordem = v_idx,
          analysis_name = nullif(trim(both FROM coalesce(v_item->>'analysis_name', '')), ''),
          methodology = nullif(trim(both FROM coalesce(v_item->>'methodology', '')), ''),
          specification = nullif(trim(both FROM coalesce(v_item->>'specification', '')), ''),
          unit = nullif(trim(both FROM coalesce(v_item->>'unit', '')), ''),
          min_limit = public.resultados_cq_to_numeric(v_item->>'min_limit'),
          max_limit = public.resultados_cq_to_numeric(v_item->>'max_limit'),
          result = nullif(trim(both FROM coalesce(v_item->>'result', '')), ''),
          analysis_status = nullif(trim(both FROM coalesce(v_item->>'status', '')), ''),
          results = NULL,
          updated_date = now()
        WHERE id = r.id;
        v_first := false;
      ELSE
        v_new_id := gen_random_uuid()::text;
        INSERT INTO public.resultados_cq (
          id, created_date, updated_date, created_by_id,
          production_id, op_number, product, client, lot, date,
          analyst, status, observations, sample_photo_url, results,
          resultado_id, linha_ordem,
          analysis_name, methodology, specification, unit,
          min_limit, max_limit, result, analysis_status
        ) VALUES (
          v_new_id, r.created_date, now(), r.created_by_id,
          r.production_id, r.op_number, r.product, r.client, r.lot, r.date,
          r.analyst, r.status, r.observations, r.sample_photo_url, NULL,
          r.id, v_idx,
          nullif(trim(both FROM coalesce(v_item->>'analysis_name', '')), ''),
          nullif(trim(both FROM coalesce(v_item->>'methodology', '')), ''),
          nullif(trim(both FROM coalesce(v_item->>'specification', '')), ''),
          nullif(trim(both FROM coalesce(v_item->>'unit', '')), ''),
          public.resultados_cq_to_numeric(v_item->>'min_limit'),
          public.resultados_cq_to_numeric(v_item->>'max_limit'),
          nullif(trim(both FROM coalesce(v_item->>'result', '')), ''),
          nullif(trim(both FROM coalesce(v_item->>'status', '')), '')
        );
      END IF;
    END LOOP;

    INSERT INTO public._chemctrl_053_resultados_cq_report (source_id, product, op_number, status, detail, analysis_count)
    VALUES (r.id, r.product, r.op_number, 'converted', 'OK', v_count);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.resultados_cq WHERE resultado_id IS NULL) THEN
    RAISE EXCEPTION '053: existem linhas sem resultado_id';
  END IF;
END $$;

ALTER TABLE public.resultados_cq ALTER COLUMN resultado_id SET NOT NULL;

COMMENT ON COLUMN public.resultados_cq.resultado_id IS 'Agrupa as analises de um mesmo certificado de CQ. Igual em todas as linhas.';
COMMENT ON COLUMN public.resultados_cq.linha_ordem IS 'Ordem da analise dentro do certificado.';
COMMENT ON COLUMN public.resultados_cq.result IS 'Valor medido da analise.';
COMMENT ON COLUMN public.resultados_cq.analysis_status IS 'Parecer da analise (Aprovado/Reprovado). O parecer geral do CQ continua em status.';
COMMENT ON COLUMN public.resultados_cq.results IS 'Legado. Apos a 053 fica nulo; cada analise e uma linha.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_resultados_cq_resultado_ordem
  ON public.resultados_cq (resultado_id, linha_ordem);

CREATE INDEX IF NOT EXISTS idx_resultados_cq_resultado_id
  ON public.resultados_cq (resultado_id);

CREATE INDEX IF NOT EXISTS idx_resultados_cq_analysis_name
  ON public.resultados_cq (analysis_name);

-- ---------------------------------------------------------------------------
-- RPC: gravar o certificado inteiro (cabeçalho repetido + uma linha por análise)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resultados_cq_salvar(
  p_resultado_id text,
  p_header jsonb,
  p_results jsonb,
  p_mode text DEFAULT 'replace'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode text := lower(trim(both FROM coalesce(p_mode, 'replace')));
  v_resultado_id text := nullif(trim(both FROM coalesce(p_resultado_id, '')), '');
  v_items jsonb;
  v_item jsonb;
  v_idx integer := 0;
  v_anchor_id text;
  v_new_id text;
  v_ids text[] := '{}';
  v_created_date timestamptz;
  v_created_by_id text;
  v_production_id text;
  v_op_number text;
  v_product text;
  v_client text;
  v_lot text;
  v_date timestamptz;
  v_analyst text;
  v_status text;
  v_observations text;
  v_photo text;
BEGIN
  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object' THEN
    RAISE EXCEPTION 'p_header deve ser um objeto JSON';
  END IF;

  v_items := resultados_cq_parse_results(p_results);
  SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(elem, ord)
  WHERE nullif(trim(both FROM coalesce(elem->>'analysis_name', '')), '') IS NOT NULL
     OR nullif(trim(both FROM coalesce(elem->>'result', '')), '') IS NOT NULL
     OR nullif(trim(both FROM coalesce(elem->>'specification', '')), '') IS NOT NULL
     OR resultados_cq_to_numeric(elem->>'min_limit') IS NOT NULL
     OR resultados_cq_to_numeric(elem->>'max_limit') IS NOT NULL;

  v_production_id := nullif(trim(both FROM coalesce(p_header->>'production_id', '')), '');
  v_op_number := nullif(trim(both FROM coalesce(p_header->>'op_number', '')), '');
  v_product := trim(both FROM coalesce(p_header->>'product', ''));
  v_client := nullif(trim(both FROM coalesce(p_header->>'client', '')), '');
  v_lot := nullif(trim(both FROM coalesce(p_header->>'lot', '')), '');
  v_analyst := nullif(trim(both FROM coalesce(p_header->>'analyst', '')), '');
  v_status := coalesce(nullif(trim(both FROM coalesce(p_header->>'status', '')), ''), 'Pendente');
  v_observations := nullif(trim(both FROM coalesce(p_header->>'observations', '')), '');
  v_photo := nullif(trim(both FROM coalesce(p_header->>'sample_photo_url', '')), '');
  v_created_by_id := nullif(trim(both FROM coalesce(p_header->>'created_by_id', '')), '');

  IF nullif(p_header->>'date', '') IS NOT NULL THEN
    v_date := (p_header->>'date')::timestamptz;
  ELSE
    v_date := now();
  END IF;

  IF v_production_id IS NULL THEN
    RAISE EXCEPTION 'production_id e obrigatorio';
  END IF;
  IF v_product = '' THEN
    RAISE EXCEPTION 'product e obrigatorio';
  END IF;

  IF v_mode = 'create' THEN
    v_resultado_id := gen_random_uuid()::text;
    v_created_date := now();
    v_anchor_id := NULL;
  ELSIF v_mode = 'replace' THEN
    IF v_resultado_id IS NULL THEN
      RAISE EXCEPTION 'resultado_id obrigatorio para replace';
    END IF;

    SELECT id, created_date, created_by_id
    INTO v_anchor_id, v_created_date, v_created_by_id
    FROM resultados_cq
    WHERE resultado_id = v_resultado_id
    ORDER BY linha_ordem ASC, created_date ASC
    LIMIT 1;

    IF v_anchor_id IS NULL THEN
      RAISE EXCEPTION 'resultado % nao encontrado', v_resultado_id;
    END IF;

    v_created_by_id := coalesce(
      nullif(trim(both FROM coalesce(p_header->>'created_by_id', '')), ''),
      v_created_by_id
    );
    v_created_date := coalesce(v_created_date, now());

    DELETE FROM resultados_cq WHERE resultado_id = v_resultado_id;
  ELSE
    RAISE EXCEPTION 'p_mode invalido: %', v_mode;
  END IF;

  IF COALESCE(jsonb_array_length(v_items), 0) = 0 THEN
    v_new_id := coalesce(v_anchor_id, gen_random_uuid()::text);
    INSERT INTO resultados_cq (
      id, created_date, updated_date, created_by_id,
      production_id, op_number, product, client, lot, date,
      analyst, status, observations, sample_photo_url, results,
      resultado_id, linha_ordem,
      analysis_name, methodology, specification, unit,
      min_limit, max_limit, result, analysis_status
    ) VALUES (
      v_new_id, v_created_date, now(), v_created_by_id,
      v_production_id, v_op_number, v_product, v_client, v_lot, v_date,
      v_analyst, v_status, v_observations, v_photo, NULL,
      v_resultado_id, 1,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL
    );
    v_ids := array_append(v_ids, v_new_id);
  ELSE
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_idx := v_idx + 1;
      IF v_idx = 1 AND v_anchor_id IS NOT NULL THEN
        v_new_id := v_anchor_id;
      ELSE
        v_new_id := gen_random_uuid()::text;
      END IF;

      INSERT INTO resultados_cq (
        id, created_date, updated_date, created_by_id,
        production_id, op_number, product, client, lot, date,
        analyst, status, observations, sample_photo_url, results,
        resultado_id, linha_ordem,
        analysis_name, methodology, specification, unit,
        min_limit, max_limit, result, analysis_status
      ) VALUES (
        v_new_id, v_created_date, now(), v_created_by_id,
        v_production_id, v_op_number, v_product, v_client, v_lot, v_date,
        v_analyst, v_status, v_observations, v_photo, NULL,
        v_resultado_id, v_idx,
        nullif(trim(both FROM coalesce(v_item->>'analysis_name', '')), ''),
        nullif(trim(both FROM coalesce(v_item->>'methodology', '')), ''),
        nullif(trim(both FROM coalesce(v_item->>'specification', '')), ''),
        nullif(trim(both FROM coalesce(v_item->>'unit', '')), ''),
        resultados_cq_to_numeric(v_item->>'min_limit'),
        resultados_cq_to_numeric(v_item->>'max_limit'),
        nullif(trim(both FROM coalesce(v_item->>'result', '')), ''),
        nullif(trim(both FROM coalesce(v_item->>'status', '')), '')
      );
      v_ids := array_append(v_ids, v_new_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'resultado_id', v_resultado_id,
    'anchor_id', v_ids[1],
    'line_ids', to_jsonb(v_ids),
    'analysis_count', COALESCE(jsonb_array_length(v_items), 0),
    'mode', v_mode
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resultados_cq_parse_results(jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resultados_cq_to_numeric(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resultados_cq_salvar(text, jsonb, jsonb, text)
  TO anon, authenticated, service_role;

-- Consulta pública: remonta o JSON de resultados a partir das linhas.
CREATE OR REPLACE FUNCTION get_public_lot_info(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_lot_info'))
  SELECT jsonb_build_object(
    'product', p.product,
    'client', p.client,
    'lot', p.lot,
    'mfg_date', p.end_time,
    'expiry_date', CASE
      WHEN p.end_time IS NOT NULL AND v.validity_days IS NOT NULL
      THEN (p.end_time::date + (v.validity_days || ' day')::interval)::text
      ELSE NULL
    END,
    'status', p.status,
    'op_number', p.op_number,
    'has_coa', EXISTS(
      SELECT 1 FROM resultados_cq qr
      WHERE qr.production_id = p.id
        AND (
          nullif(btrim(coalesce(qr.result, '')), '') IS NOT NULL
          OR nullif(btrim(coalesce(qr.analysis_name, '')), '') IS NOT NULL
          OR (
            qr.results IS NOT NULL
            AND qr.results::text NOT IN ('[]', 'null', '')
          )
        )
    ),
    'has_sds', EXISTS(
      SELECT 1 FROM resolve_recipe_fds_for_production(p.id)
    )
  )
  FROM guard, ind_lista_producoes p
  LEFT JOIN LATERAL (
    SELECT ind_resolve_validity_days(p.product, p.client) AS validity_days
  ) v ON true
  WHERE p.public_token = p_token
    AND p.status != 'Cancelado';
$$;

CREATE OR REPLACE FUNCTION get_public_coa_data(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (SELECT enforce_public_rate_limit('get_public_coa_data')),
  prod AS (
    SELECT p.*
    FROM guard
    CROSS JOIN ind_lista_producoes p
    WHERE p.public_token = p_token
      AND p.status != 'Cancelado'
    LIMIT 1
  ),
  chosen AS (
    SELECT qr.resultado_id, qr.id AS row_id
    FROM resultados_cq qr
    JOIN prod p ON p.id = qr.production_id
    ORDER BY qr.updated_date DESC NULLS LAST, qr.created_date DESC NULLS LAST, COALESCE(qr.linha_ordem, 1) ASC
    LIMIT 1
  ),
  lines AS (
    SELECT qr.*
    FROM resultados_cq qr
    JOIN chosen c ON (
      (c.resultado_id IS NOT NULL AND qr.resultado_id = c.resultado_id)
      OR (c.resultado_id IS NULL AND qr.id = c.row_id)
    )
  ),
  anchor AS (
    SELECT * FROM lines
    ORDER BY COALESCE(linha_ordem, 1) ASC, created_date ASC NULLS LAST
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'result', jsonb_build_object(
      'product', a.product,
      'lot', a.lot,
      'client', a.client,
      'op_number', a.op_number,
      'observations', a.observations,
      'results', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'analysis_name', l.analysis_name,
              'methodology', l.methodology,
              'specification', l.specification,
              'unit', l.unit,
              'min_limit', l.min_limit,
              'max_limit', l.max_limit,
              'result', l.result,
              'status', l.analysis_status
            )
            ORDER BY COALESCE(l.linha_ordem, 1)
          )
          FROM lines l
          WHERE nullif(btrim(coalesce(l.analysis_name, '')), '') IS NOT NULL
             OR nullif(btrim(coalesce(l.result, '')), '') IS NOT NULL
             OR nullif(btrim(coalesce(l.specification, '')), '') IS NOT NULL
        ),
        public.resultados_cq_parse_results(a.results)
      ),
      'sample_photo_url', null::text
    ),
    'production', jsonb_build_object(
      'end_time', p.end_time,
      'mass', p.mass,
      'client_order', p.client_order
    ),
    'containers', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'container_number', c.container_number,
        'barril_number', c.barril_number,
        'volume', c.volume
      ))
      FROM ind_lista_vasilhames c WHERE c.op_number = p.op_number),
      '[]'::jsonb
    ),
    'recipe', jsonb_build_object(
      'validity_days', ind_resolve_validity_days(
        COALESCE(a.product, p.product),
        COALESCE(a.client, p.client)
      )
    )
  )
  FROM anchor a
  JOIN prod p ON true;
$$;

GRANT EXECUTE ON FUNCTION get_public_lot_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_coa_data(text) TO anon, authenticated;

ALTER TABLE public.resultados_cq REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.resultados_cq';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
