-- =============================================================================
-- 051_cq_esp_tec_linhas.sql
-- Cadastro CQ: renomeia ind_cq_esp_tec para cadastro_analises e grava
-- 1 linha por análise.
-- O cabeçalho do produto acabado (produto, cliente, revisão, validade, resp.)
-- repete em cada linha. codigo_en (EN01, EN02, …) é o ID da tela de Ensaios,
-- o mesmo número para todas as análises daquele cadastro — equivalente ao
-- codigo_rc (RC01) das receitas.
--
-- Interpreta analyses como array JSONB ou string JSON serializada.
-- Idempotente. Não faz DROP/TRUNCATE de dados de negócio.
-- NÃO executar no Supabase sem autorização explícita.
-- Aplicar junto com o app que agrupa as linhas (qualitySpecComposition.js).
-- =============================================================================

BEGIN;

-- A tabela em produção ainda se chama ind_cq_esp_tec.
DO $$
BEGIN
  IF to_regclass('public.cadastro_analises') IS NOT NULL
     AND to_regclass('public.ind_cq_esp_tec') IS NOT NULL THEN
    RAISE EXCEPTION 'cadastro_analises e ind_cq_esp_tec existem ao mesmo tempo. Mantenha só a tabela com os dados.';
  END IF;

  IF to_regclass('public.cadastro_analises') IS NULL
     AND to_regclass('public.ind_cq_esp_tec') IS NOT NULL THEN
    ALTER TABLE public.ind_cq_esp_tec RENAME TO cadastro_analises;
  END IF;

  IF to_regclass('public.cadastro_analises') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.cadastro_analises / ind_cq_esp_tec nao encontrada.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_ind_cq_esp_tec'
      AND tgrelid = 'public.cadastro_analises'::regclass
  ) THEN
    ALTER TRIGGER update_updated_date_ind_cq_esp_tec ON public.cadastro_analises
      RENAME TO update_updated_date_cadastro_analises;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'allow_all_ind_cq_esp_tec'
      AND polrelid = 'public.cadastro_analises'::regclass
  ) THEN
    ALTER POLICY "allow_all_ind_cq_esp_tec" ON public.cadastro_analises
      RENAME TO allow_all_cadastro_analises;
  END IF;
END $$;

ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS validity_days numeric;
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS created_by text;

-- Backup do formato legado (1 linha = ensaio, analyses jsonb), antes das colunas novas.
DO $$
BEGIN
  IF to_regclass('public._chemctrl_051_cadastro_analises_backup') IS NULL THEN
    CREATE TABLE public._chemctrl_051_cadastro_analises_backup AS
    SELECT * FROM public.cadastro_analises;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public._chemctrl_051_cadastro_analises_report (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source_id text,
  product text,
  status text NOT NULL,
  detail text,
  analysis_count integer
);

-- ---------------------------------------------------------------------------
-- Parsers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cadastro_analises_parse_analyses(p_raw jsonb)
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

CREATE OR REPLACE FUNCTION public.cadastro_analises_to_numeric(p_text text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_text)::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Colunas da linha de análise
-- ---------------------------------------------------------------------------
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS ensaio_id text;
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS registro integer;
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS linha_ordem integer NOT NULL DEFAULT 1;
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS analysis_name text;
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS methodology text;
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS specification text;
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS min_limit numeric;
ALTER TABLE public.cadastro_analises ADD COLUMN IF NOT EXISTS max_limit numeric;

-- ---------------------------------------------------------------------------
-- Explosão do JSON (só enquanto ensaio_id ainda não foi preenchido)
-- ---------------------------------------------------------------------------
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
    SELECT 1 FROM public.cadastro_analises WHERE ensaio_id IS NOT NULL LIMIT 1
  ) INTO v_already;

  IF v_already THEN
    INSERT INTO public._chemctrl_051_cadastro_analises_report (source_id, status, detail)
    VALUES (NULL, 'skipped_already_converted', 'ensaio_id ja preenchido');
    RETURN;
  END IF;

  FOR r IN
    SELECT *
    FROM public._chemctrl_051_cadastro_analises_backup
    ORDER BY created_date ASC NULLS LAST, id ASC
  LOOP
    SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(public.cadastro_analises_parse_analyses(r.analyses))
      WITH ORDINALITY AS t(elem, ord)
    WHERE nullif(trim(both FROM coalesce(elem->>'analysis_name', '')), '') IS NOT NULL
       OR nullif(trim(both FROM coalesce(elem->>'specification', '')), '') IS NOT NULL
       OR public.cadastro_analises_to_numeric(elem->>'min_limit') IS NOT NULL
       OR public.cadastro_analises_to_numeric(elem->>'max_limit') IS NOT NULL;

    v_count := COALESCE(jsonb_array_length(v_items), 0);

    IF v_count = 0 THEN
      UPDATE public.cadastro_analises
      SET
        ensaio_id = r.id,
        linha_ordem = 1,
        analysis_name = NULL,
        methodology = NULL,
        specification = NULL,
        unit = NULL,
        min_limit = NULL,
        max_limit = NULL,
        analyses = NULL,
        updated_date = now()
      WHERE id = r.id;

      INSERT INTO public._chemctrl_051_cadastro_analises_report (source_id, product, status, detail, analysis_count)
      VALUES (r.id, r.product, 'converted_no_analyses', 'Linha mantida sem analise', 0);
      CONTINUE;
    END IF;

    v_first := true;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_idx := v_idx + 1;
      IF v_first THEN
        UPDATE public.cadastro_analises
        SET
          ensaio_id = r.id,
          linha_ordem = v_idx,
          analysis_name = nullif(trim(both FROM coalesce(v_item->>'analysis_name', '')), ''),
          methodology = nullif(trim(both FROM coalesce(v_item->>'methodology', '')), ''),
          specification = nullif(trim(both FROM coalesce(v_item->>'specification', '')), ''),
          unit = nullif(trim(both FROM coalesce(v_item->>'unit', '')), ''),
          min_limit = public.cadastro_analises_to_numeric(v_item->>'min_limit'),
          max_limit = public.cadastro_analises_to_numeric(v_item->>'max_limit'),
          analyses = NULL,
          updated_date = now()
        WHERE id = r.id;
        v_first := false;
      ELSE
        v_new_id := gen_random_uuid()::text;
        INSERT INTO public.cadastro_analises (
          id, created_date, updated_date, created_by_id, created_by,
          product, client, revision, revision_date, validity_days, analyses,
          ensaio_id, linha_ordem,
          analysis_name, methodology, specification, unit, min_limit, max_limit
        ) VALUES (
          v_new_id, r.created_date, now(), r.created_by_id, r.created_by,
          r.product, r.client, r.revision, r.revision_date, r.validity_days, NULL,
          r.id, v_idx,
          nullif(trim(both FROM coalesce(v_item->>'analysis_name', '')), ''),
          nullif(trim(both FROM coalesce(v_item->>'methodology', '')), ''),
          nullif(trim(both FROM coalesce(v_item->>'specification', '')), ''),
          nullif(trim(both FROM coalesce(v_item->>'unit', '')), ''),
          public.cadastro_analises_to_numeric(v_item->>'min_limit'),
          public.cadastro_analises_to_numeric(v_item->>'max_limit')
        );
      END IF;
    END LOOP;

    INSERT INTO public._chemctrl_051_cadastro_analises_report (source_id, product, status, detail, analysis_count)
    VALUES (r.id, r.product, 'converted', 'OK', v_count);
  END LOOP;
END $$;

-- EN01 = cadastro mais antigo, igual à ordem que a tela calculava por created_date.
WITH ranked AS (
  SELECT
    id AS source_id,
    ROW_NUMBER() OVER (ORDER BY created_date ASC NULLS LAST, id ASC) AS registro
  FROM public._chemctrl_051_cadastro_analises_backup
)
UPDATE public.cadastro_analises t
SET registro = ranked.registro
FROM ranked
WHERE t.ensaio_id = ranked.source_id
  AND t.registro IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cadastro_analises WHERE registro IS NULL OR ensaio_id IS NULL) THEN
    RAISE EXCEPTION '051: existem linhas sem ensaio_id ou registro';
  END IF;
END $$;

ALTER TABLE public.cadastro_analises ALTER COLUMN ensaio_id SET NOT NULL;
ALTER TABLE public.cadastro_analises ALTER COLUMN registro SET NOT NULL;

ALTER TABLE public.cadastro_analises DROP COLUMN IF EXISTS codigo_en;
ALTER TABLE public.cadastro_analises
  ADD COLUMN codigo_en text
  GENERATED ALWAYS AS ('EN' || lpad(registro::text, 2, '0')) STORED;

COMMENT ON COLUMN public.cadastro_analises.ensaio_id IS 'Agrupa as analises de um mesmo cadastro. Igual em todas as linhas do ensaio.';
COMMENT ON COLUMN public.cadastro_analises.registro IS 'Numero do ID da tela (1 = EN01), igual para todas as analises do cadastro.';
COMMENT ON COLUMN public.cadastro_analises.codigo_en IS 'ID exibido no Cadastro CQ. Equivale ao codigo_rc das receitas. Ordenar por registro, linha_ordem.';
COMMENT ON COLUMN public.cadastro_analises.linha_ordem IS 'Ordem da analise dentro do ensaio.';
COMMENT ON COLUMN public.cadastro_analises.analyses IS 'Legado. Apos a 051 fica nulo; cada analise e uma linha.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cadastro_analises_ensaio_ordem
  ON public.cadastro_analises (ensaio_id, linha_ordem);

CREATE INDEX IF NOT EXISTS idx_cadastro_analises_ensaio_id
  ON public.cadastro_analises (ensaio_id);

CREATE INDEX IF NOT EXISTS idx_cadastro_analises_registro
  ON public.cadastro_analises (registro);

CREATE INDEX IF NOT EXISTS idx_cadastro_analises_product
  ON public.cadastro_analises (product);

CREATE INDEX IF NOT EXISTS idx_cadastro_analises_analysis_name
  ON public.cadastro_analises (analysis_name);

-- ---------------------------------------------------------------------------
-- RPC: criar ou substituir o ensaio inteiro de forma atômica
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cadastro_analises_salvar(
  p_ensaio_id text,
  p_header jsonb,
  p_analyses jsonb,
  p_mode text DEFAULT 'replace'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode text := lower(trim(both FROM coalesce(p_mode, 'replace')));
  v_ensaio_id text := nullif(trim(both FROM coalesce(p_ensaio_id, '')), '');
  v_items jsonb;
  v_item jsonb;
  v_idx integer := 0;
  v_registro integer;
  v_anchor_id text;
  v_new_id text;
  v_ids text[] := '{}';
  v_created_date timestamptz;
  v_created_by text;
  v_created_by_id text;
  v_product text;
  v_client text;
  v_revision text;
  v_revision_date date;
  v_validity numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cadastro_analises.registro')::bigint);

  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object' THEN
    RAISE EXCEPTION 'p_header deve ser um objeto JSON';
  END IF;

  v_items := cadastro_analises_parse_analyses(p_analyses);
  SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(elem, ord)
  WHERE nullif(trim(both FROM coalesce(elem->>'analysis_name', '')), '') IS NOT NULL
     OR nullif(trim(both FROM coalesce(elem->>'specification', '')), '') IS NOT NULL
     OR cadastro_analises_to_numeric(elem->>'min_limit') IS NOT NULL
     OR cadastro_analises_to_numeric(elem->>'max_limit') IS NOT NULL;

  v_product := trim(both FROM coalesce(p_header->>'product', ''));
  v_client := nullif(trim(both FROM coalesce(p_header->>'client', '')), '');
  v_revision := nullif(trim(both FROM coalesce(p_header->>'revision', '')), '');
  v_revision_date := COALESCE(NULLIF(p_header->>'revision_date', '')::date, current_date);
  v_validity := cadastro_analises_to_numeric(p_header->>'validity_days');
  v_created_by := nullif(trim(both FROM coalesce(p_header->>'created_by', '')), '');
  v_created_by_id := nullif(trim(both FROM coalesce(p_header->>'created_by_id', '')), '');

  IF v_product = '' THEN
    RAISE EXCEPTION 'product e obrigatorio';
  END IF;
  IF v_validity IS NULL OR v_validity <= 0 THEN
    RAISE EXCEPTION 'validity_days obrigatorio';
  END IF;

  IF v_mode = 'create' THEN
    v_ensaio_id := gen_random_uuid()::text;
    v_created_date := now();
    SELECT COALESCE(MAX(registro), 0) + 1 INTO v_registro FROM cadastro_analises;
    v_anchor_id := NULL;
  ELSIF v_mode = 'replace' THEN
    IF v_ensaio_id IS NULL THEN
      RAISE EXCEPTION 'ensaio_id obrigatorio para replace';
    END IF;

    SELECT id, created_date, created_by, created_by_id, registro
    INTO v_anchor_id, v_created_date, v_created_by, v_created_by_id, v_registro
    FROM cadastro_analises
    WHERE ensaio_id = v_ensaio_id
    ORDER BY linha_ordem ASC, created_date ASC
    LIMIT 1;

    IF v_anchor_id IS NULL THEN
      RAISE EXCEPTION 'ensaio % nao encontrado', v_ensaio_id;
    END IF;

    v_created_by := coalesce(nullif(trim(both FROM coalesce(p_header->>'created_by', '')), ''), v_created_by);
    v_created_by_id := coalesce(nullif(trim(both FROM coalesce(p_header->>'created_by_id', '')), ''), v_created_by_id);
    v_created_date := coalesce(v_created_date, now());

    DELETE FROM cadastro_analises WHERE ensaio_id = v_ensaio_id;
  ELSE
    RAISE EXCEPTION 'p_mode invalido: %', v_mode;
  END IF;

  IF COALESCE(jsonb_array_length(v_items), 0) = 0 THEN
    v_new_id := coalesce(v_anchor_id, gen_random_uuid()::text);
    INSERT INTO cadastro_analises (
      id, created_date, updated_date, created_by_id, created_by,
      product, client, revision, revision_date, validity_days, analyses,
      ensaio_id, registro, linha_ordem,
      analysis_name, methodology, specification, unit, min_limit, max_limit
    ) VALUES (
      v_new_id, v_created_date, now(), v_created_by_id, v_created_by,
      v_product, v_client, v_revision, v_revision_date, v_validity, NULL,
      v_ensaio_id, v_registro, 1,
      NULL, NULL, NULL, NULL, NULL, NULL
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

      INSERT INTO cadastro_analises (
        id, created_date, updated_date, created_by_id, created_by,
        product, client, revision, revision_date, validity_days, analyses,
        ensaio_id, registro, linha_ordem,
        analysis_name, methodology, specification, unit, min_limit, max_limit
      ) VALUES (
        v_new_id, v_created_date, now(), v_created_by_id, v_created_by,
        v_product, v_client, v_revision, v_revision_date, v_validity, NULL,
        v_ensaio_id, v_registro, v_idx,
        nullif(trim(both FROM coalesce(v_item->>'analysis_name', '')), ''),
        nullif(trim(both FROM coalesce(v_item->>'methodology', '')), ''),
        nullif(trim(both FROM coalesce(v_item->>'specification', '')), ''),
        nullif(trim(both FROM coalesce(v_item->>'unit', '')), ''),
        cadastro_analises_to_numeric(v_item->>'min_limit'),
        cadastro_analises_to_numeric(v_item->>'max_limit')
      );
      v_ids := array_append(v_ids, v_new_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ensaio_id', v_ensaio_id,
    'registro', v_registro,
    'codigo_en', 'EN' || lpad(v_registro::text, 2, '0'),
    'anchor_id', v_ids[1],
    'line_ids', to_jsonb(v_ids),
    'analysis_count', COALESCE(jsonb_array_length(v_items), 0),
    'mode', v_mode
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cadastro_analises_parse_analyses(jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cadastro_analises_to_numeric(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cadastro_analises_salvar(text, jsonb, jsonb, text)
  TO anon, authenticated, service_role;

-- Realtime acompanha o rename (mesmo OID). Garante a publicação no nome novo.
ALTER TABLE public.cadastro_analises REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.cadastro_analises;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- Validade do lote: lê cadastro_analises (ou o nome antigo, se o rename não rodou).
CREATE OR REPLACE FUNCTION public.ind_resolve_validity_days(p_product text, p_client text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days numeric;
  v_cq text;
  v_recipe text;
BEGIN
  IF to_regclass('public.cadastro_analises') IS NOT NULL THEN
    v_cq := 'cadastro_analises';
  ELSIF to_regclass('public.ind_cq_esp_tec') IS NOT NULL THEN
    v_cq := 'ind_cq_esp_tec';
  END IF;

  IF v_cq IS NOT NULL THEN
    EXECUTE format($q$
      SELECT qt.validity_days
      FROM %I qt
      WHERE lower(trim(coalesce(qt.product, ''))) = lower(trim(coalesce($1, '')))
        AND qt.validity_days IS NOT NULL
        AND qt.validity_days > 0
        AND (
          trim(coalesce($2, '')) = ''
          OR trim(coalesce(qt.client, '')) = ''
          OR lower(trim(qt.client)) = lower(trim($2))
        )
      ORDER BY
        CASE
          WHEN trim(coalesce($2, '')) <> ''
            AND lower(trim(coalesce(qt.client, ''))) = lower(trim($2)) THEN 0
          ELSE 1
        END,
        qt.updated_date DESC NULLS LAST,
        qt.created_date DESC NULLS LAST
      LIMIT 1
    $q$, v_cq)
    INTO v_days
    USING p_product, p_client;

    IF v_days IS NOT NULL THEN
      RETURN v_days;
    END IF;
  END IF;

  IF to_regclass('public.receitas') IS NOT NULL THEN
    v_recipe := 'receitas';
  ELSIF to_regclass('public.ind_lista_receitas') IS NOT NULL THEN
    v_recipe := 'ind_lista_receitas';
  ELSE
    RETURN NULL;
  END IF;

  EXECUTE format($q$
    SELECT r.validity_days
    FROM %I r
    WHERE lower(trim(coalesce(r.product_name, ''))) = lower(trim(coalesce($1, '')))
      AND r.validity_days IS NOT NULL
      AND r.validity_days > 0
    ORDER BY
      CASE
        WHEN trim(coalesce($2, '')) <> ''
          AND lower(trim(coalesce(r.client, ''))) = lower(trim($2)) THEN 0
        ELSE 1
      END,
      r.revision_number DESC NULLS LAST,
      r.updated_date DESC NULLS LAST
    LIMIT 1
  $q$, v_recipe)
  INTO v_days
  USING p_product, p_client;

  RETURN v_days;
END;
$$;

REVOKE ALL ON FUNCTION public.ind_resolve_validity_days(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ind_resolve_validity_days(text, text) TO postgres, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- ROLLBACK MANUAL (não executar automaticamente)
-- O backup guarda o formato anterior (analyses jsonb), sem as colunas novas.
-- =============================================================================
-- BEGIN;
-- ALTER TABLE public.cadastro_analises DROP COLUMN IF EXISTS codigo_en;
-- ALTER TABLE public.cadastro_analises ALTER COLUMN ensaio_id DROP NOT NULL;
-- ALTER TABLE public.cadastro_analises ALTER COLUMN registro DROP NOT NULL;
-- DELETE FROM public.cadastro_analises;
-- INSERT INTO public.cadastro_analises (
--   id, created_date, updated_date, created_by_id, created_by,
--   product, client, revision, revision_date, validity_days, analyses
-- )
-- SELECT
--   id, created_date, updated_date, created_by_id, created_by,
--   product, client, revision, revision_date, validity_days, analyses
-- FROM public._chemctrl_051_cadastro_analises_backup;
-- ALTER TABLE public.cadastro_analises
--   DROP COLUMN IF EXISTS ensaio_id,
--   DROP COLUMN IF EXISTS registro,
--   DROP COLUMN IF EXISTS linha_ordem,
--   DROP COLUMN IF EXISTS analysis_name,
--   DROP COLUMN IF EXISTS methodology,
--   DROP COLUMN IF EXISTS specification,
--   DROP COLUMN IF EXISTS unit,
--   DROP COLUMN IF EXISTS min_limit,
--   DROP COLUMN IF EXISTS max_limit;
-- COMMIT;
-- =============================================================================
