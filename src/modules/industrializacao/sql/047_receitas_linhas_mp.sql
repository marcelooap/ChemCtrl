-- =============================================================================
-- 047_receitas_linhas_mp.sql
-- Refatora receitas: 1 linha por matéria-prima por revisão.
-- Interpreta raw_materials como array JSONB ou string JSON serializada.
-- NÃO reaplica a migration 046.
--
-- Idempotente. Sem DROP/TRUNCATE de dados de negócio.
-- NÃO executar remotamente sem autorização explícita.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Pré-condições
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.receitas') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.receitas nao encontrada. Aplique a 046 antes desta migration.';
  END IF;
  IF to_regclass('public.cadastro_produtos') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.cadastro_produtos nao encontrada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'cadastro_produtos_registrar_uso'
  ) THEN
    RAISE EXCEPTION 'RPC cadastro_produtos_registrar_uso ausente. Aplique a 046 antes.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Parser: array nativo OU string JSON serializada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receitas_parse_raw_materials(p_raw jsonb)
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

-- ---------------------------------------------------------------------------
-- 2) Diagnóstico + backup + relatório
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._chemctrl_047_receitas_diag (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  metric text NOT NULL,
  value_num bigint,
  value_text text
);

CREATE TABLE IF NOT EXISTS public._chemctrl_047_receitas_backup (
  LIKE public.receitas INCLUDING ALL
);

CREATE TABLE IF NOT EXISTS public._chemctrl_047_receitas_report (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source_id text,
  product_name text,
  revision_number integer,
  status text NOT NULL,
  detail text,
  mp_count integer
);

-- Backup apenas na primeira execução (tabela vazia)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public._chemctrl_047_receitas_backup LIMIT 1) THEN
    INSERT INTO public._chemctrl_047_receitas_backup
    SELECT * FROM public.receitas;
  END IF;
END $$;

-- Diagnóstico (append)
INSERT INTO public._chemctrl_047_receitas_diag (metric, value_num)
SELECT 'receitas_total', COUNT(*)::bigint FROM public.receitas;

INSERT INTO public._chemctrl_047_receitas_diag (metric, value_num)
SELECT 'raw_materials_array', COUNT(*)::bigint
FROM public.receitas
WHERE jsonb_typeof(raw_materials) = 'array';

INSERT INTO public._chemctrl_047_receitas_diag (metric, value_num)
SELECT 'raw_materials_json_string', COUNT(*)::bigint
FROM public.receitas
WHERE jsonb_typeof(raw_materials) = 'string';

INSERT INTO public._chemctrl_047_receitas_diag (metric, value_num)
SELECT 'raw_materials_other', COUNT(*)::bigint
FROM public.receitas
WHERE raw_materials IS NOT NULL
  AND jsonb_typeof(raw_materials) NOT IN ('array', 'string');

INSERT INTO public._chemctrl_047_receitas_diag (metric, value_num)
SELECT 'valid_mp_items', COALESCE(SUM(jsonb_array_length(receitas_parse_raw_materials(raw_materials))), 0)::bigint
FROM public.receitas;

INSERT INTO public._chemctrl_047_receitas_diag (metric, value_num)
SELECT 'backup_rows', COUNT(*)::bigint FROM public._chemctrl_047_receitas_backup;

-- ---------------------------------------------------------------------------
-- 3) DDL — novas colunas
-- ---------------------------------------------------------------------------
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS receita_id text;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS produto_acabado_id uuid;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS materia_prima_id uuid;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS mp_code text;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS mp_name text;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS mp_density numeric;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS percentage numeric;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS quantity_kg numeric;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS controlado boolean NOT NULL DEFAULT false;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS orgao_regulamentador text;
ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS linha_ordem integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'receitas_produto_acabado_id_fkey'
      AND conrelid = 'public.receitas'::regclass
  ) THEN
    ALTER TABLE public.receitas
      ADD CONSTRAINT receitas_produto_acabado_id_fkey
      FOREIGN KEY (produto_acabado_id)
      REFERENCES public.cadastro_produtos(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'receitas_materia_prima_id_fkey'
      AND conrelid = 'public.receitas'::regclass
  ) THEN
    ALTER TABLE public.receitas
      ADD CONSTRAINT receitas_materia_prima_id_fkey
      FOREIGN KEY (materia_prima_id)
      REFERENCES public.cadastro_produtos(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Dropar unique antiga (product_name, revision_number) — nomes históricos variam
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'receitas'
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) ILIKE '%product_name%'
      AND pg_get_constraintdef(con.oid) ILIKE '%revision_number%'
  LOOP
    EXECUTE format('ALTER TABLE public.receitas DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Conversão idempotente (só se ainda não explodiu)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_live_count bigint;
  v_backup_count bigint;
  v_already_mp bigint;
  r record;
  v_mps jsonb;
  v_mp jsonb;
  v_mp_count integer;
  v_receita_id text;
  v_pa_id uuid;
  v_mp_id uuid;
  v_idx integer;
  v_first boolean;
  v_code text;
  v_name text;
  v_mp_code text;
  v_mp_name text;
  v_new_id text;
BEGIN
  SELECT COUNT(*) INTO v_live_count FROM public.receitas;
  SELECT COUNT(*) INTO v_backup_count FROM public._chemctrl_047_receitas_backup;
  SELECT COUNT(*) INTO v_already_mp FROM public.receitas WHERE mp_code IS NOT NULL AND btrim(mp_code) <> '';

  -- Já convertido: alguma revisão tem mais de uma linha física.
  -- Na reexecução o backup é cópia do estado atual, então live = backup
  -- mesmo com a explosão já feita. Não tratar isso como estado parcial.
  IF v_already_mp > 0 AND EXISTS (
    SELECT 1
    FROM public.receitas
    GROUP BY receita_id, revision_number
    HAVING COUNT(*) > 1
  ) THEN
    INSERT INTO public._chemctrl_047_receitas_report (source_id, status, detail, mp_count)
    VALUES (NULL, 'skipped_already_converted',
            format('live=%s backup=%s with_mp_code=%s multi_line=yes', v_live_count, v_backup_count, v_already_mp),
            NULL);
    RETURN;
  END IF;

  -- Já convertido: mais linhas que o backup (backup anterior à explosão)
  IF v_already_mp > 0 AND v_live_count > v_backup_count THEN
    INSERT INTO public._chemctrl_047_receitas_report (source_id, status, detail, mp_count)
    VALUES (NULL, 'skipped_already_converted',
            format('live=%s backup=%s with_mp_code=%s', v_live_count, v_backup_count, v_already_mp),
            NULL);
    RETURN;
  END IF;

  IF v_already_mp > 0 AND v_live_count = v_backup_count THEN
    -- Colunas preenchidas parcialmente? Abortar para análise manual
    INSERT INTO public._chemctrl_047_receitas_report (source_id, status, detail, mp_count)
    VALUES (NULL, 'error',
            'Estado parcial detectado (mp_code preenchido sem explosao). Interrompido.',
            NULL);
    RAISE EXCEPTION '047: estado parcial detectado; verifique _chemctrl_047_receitas_report';
  END IF;

  -- Mapa familia: product_name -> id da menor revision_number (prefer rev 1)
  CREATE TEMP TABLE _047_family (
    product_name text PRIMARY KEY,
    receita_id text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _047_family (product_name, receita_id)
  SELECT DISTINCT ON (btrim(product_name))
    btrim(product_name),
    id
  FROM public._chemctrl_047_receitas_backup
  WHERE nullif(btrim(product_name), '') IS NOT NULL
  ORDER BY btrim(product_name), revision_number ASC NULLS LAST, created_date ASC NULLS LAST, id ASC;

  FOR r IN
    SELECT *
    FROM public._chemctrl_047_receitas_backup
    ORDER BY product_name, revision_number, id
  LOOP
    SELECT f.receita_id INTO v_receita_id
    FROM _047_family f
    WHERE f.product_name = btrim(r.product_name);

    IF v_receita_id IS NULL THEN
      v_receita_id := r.id;
    END IF;

    -- Registrar PA (se tiver codigo+nome)
    v_pa_id := NULL;
    v_code := trim(both FROM coalesce(r.code, ''));
    v_name := trim(both FROM coalesce(r.product_name, ''));
    IF v_code <> '' AND v_name <> '' THEN
      BEGIN
        v_pa_id := cadastro_produtos_registrar_uso(
          v_code,
          v_name,
          'INDUSTRIALIZACAO',
          jsonb_build_object(
            'cliente_nome', coalesce(r.client, ''),
            'densidade', CASE WHEN r.density IS NULL THEN '-' ELSE r.density::text END,
            'densidade_tabelada', (r.density IS NOT NULL)
          )
        );
      EXCEPTION WHEN others THEN
        INSERT INTO public._chemctrl_047_receitas_report (source_id, product_name, revision_number, status, detail, mp_count)
        VALUES (r.id, r.product_name, r.revision_number, 'error_pa', SQLERRM, 0);
        CONTINUE;
      END;
    END IF;

    -- Filtrar MPs válidas (codigo+nome) a partir de array ou string JSON
    SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
    INTO v_mps
    FROM jsonb_array_elements(receitas_parse_raw_materials(r.raw_materials))
      WITH ORDINALITY AS t(elem, ord)
    WHERE nullif(trim(both FROM coalesce(elem->>'mp_code', '')), '') IS NOT NULL
      AND nullif(trim(both FROM coalesce(elem->>'mp_name', '')), '') IS NOT NULL;

    v_mp_count := COALESCE(jsonb_array_length(v_mps), 0);

    IF v_mp_count = 0 THEN
      -- Sem MP válida: atualiza linha âncora com receita_id / PA, sem inventar composição
      UPDATE public.receitas
      SET
        receita_id = v_receita_id,
        produto_acabado_id = v_pa_id,
        linha_ordem = 1,
        updated_date = now()
      WHERE id = r.id;

      INSERT INTO public._chemctrl_047_receitas_report (source_id, product_name, revision_number, status, detail, mp_count)
      VALUES (r.id, r.product_name, r.revision_number, 'converted_no_mps', 'Linha mantida sem MP valida', 0);
      CONTINUE;
    END IF;

    v_first := true;
    v_idx := 0;
    FOR v_mp IN SELECT * FROM jsonb_array_elements(v_mps)
    LOOP
      v_idx := v_idx + 1;
      v_mp_code := trim(both FROM coalesce(v_mp->>'mp_code', ''));
      v_mp_name := trim(both FROM coalesce(v_mp->>'mp_name', ''));
      v_mp_id := NULL;

      BEGIN
        v_mp_id := cadastro_produtos_registrar_uso(
          v_mp_code,
          v_mp_name,
          'INDUSTRIALIZACAO',
          jsonb_build_object(
            'densidade', coalesce(nullif(trim(both FROM coalesce(v_mp->>'mp_density', '')), ''), '-'),
            'densidade_tabelada', (nullif(trim(both FROM coalesce(v_mp->>'mp_density', '')), '') IS NOT NULL),
            'controlado', coalesce((v_mp->>'controlado')::boolean, false),
            'orgao_regulamentador', coalesce(v_mp->>'orgao_regulamentador', '')
          )
        );
      EXCEPTION WHEN others THEN
        INSERT INTO public._chemctrl_047_receitas_report (source_id, product_name, revision_number, status, detail, mp_count)
        VALUES (r.id, r.product_name, r.revision_number, 'error_mp',
                format('%s / %s: %s', v_mp_code, v_mp_name, SQLERRM), v_mp_count);
        CONTINUE;
      END;

      IF v_first THEN
        UPDATE public.receitas
        SET
          receita_id = v_receita_id,
          produto_acabado_id = v_pa_id,
          materia_prima_id = v_mp_id,
          mp_code = v_mp_code,
          mp_name = v_mp_name,
          mp_density = NULLIF(v_mp->>'mp_density', '')::numeric,
          percentage = NULLIF(v_mp->>'percentage', '')::numeric,
          quantity_kg = NULLIF(v_mp->>'quantity_kg', '')::numeric,
          controlado = coalesce((v_mp->>'controlado')::boolean, false),
          orgao_regulamentador = CASE
            WHEN coalesce((v_mp->>'controlado')::boolean, false)
              THEN nullif(trim(both FROM coalesce(v_mp->>'orgao_regulamentador', '')), '')
            ELSE NULL
          END,
          linha_ordem = v_idx,
          updated_date = now()
        WHERE id = r.id;
        v_first := false;
      ELSE
        v_new_id := gen_random_uuid()::text;
        INSERT INTO public.receitas (
          id, created_date, updated_date, created_by_id, created_by,
          code, product_name, client, density, price,
          revision, revision_date, revision_number, validity_days,
          raw_materials, fds_url, fds_filename, fds_uploaded_at, fds_uploaded_by,
          necessita_n2,
          receita_id, produto_acabado_id, materia_prima_id,
          mp_code, mp_name, mp_density, percentage, quantity_kg,
          controlado, orgao_regulamentador, linha_ordem
        ) VALUES (
          v_new_id, r.created_date, now(), r.created_by_id, r.created_by,
          r.code, r.product_name, r.client, r.density, r.price,
          r.revision, r.revision_date, r.revision_number, r.validity_days,
          r.raw_materials, r.fds_url, r.fds_filename, r.fds_uploaded_at, r.fds_uploaded_by,
          coalesce(r.necessita_n2, false),
          v_receita_id, v_pa_id, v_mp_id,
          v_mp_code, v_mp_name,
          NULLIF(v_mp->>'mp_density', '')::numeric,
          NULLIF(v_mp->>'percentage', '')::numeric,
          NULLIF(v_mp->>'quantity_kg', '')::numeric,
          coalesce((v_mp->>'controlado')::boolean, false),
          CASE
            WHEN coalesce((v_mp->>'controlado')::boolean, false)
              THEN nullif(trim(both FROM coalesce(v_mp->>'orgao_regulamentador', '')), '')
            ELSE NULL
          END,
          v_idx
        );
      END IF;
    END LOOP;

    INSERT INTO public._chemctrl_047_receitas_report (source_id, product_name, revision_number, status, detail, mp_count)
    VALUES (r.id, r.product_name, r.revision_number, 'converted', 'OK', v_mp_count);
  END LOOP;
END $$;

-- Preencher receita_id residual (linhas sem familia)
UPDATE public.receitas
SET receita_id = id
WHERE receita_id IS NULL;

ALTER TABLE public.receitas
  ALTER COLUMN receita_id SET NOT NULL;

-- Uniques / índices novos
CREATE UNIQUE INDEX IF NOT EXISTS uq_receitas_familia_revisao_ordem
  ON public.receitas (receita_id, revision_number, linha_ordem);

CREATE UNIQUE INDEX IF NOT EXISTS uq_receitas_familia_revisao_mp_code
  ON public.receitas (receita_id, revision_number, (cadastro_produtos_norm(mp_code)))
  WHERE mp_code IS NOT NULL AND btrim(mp_code) <> '';

CREATE INDEX IF NOT EXISTS idx_receitas_receita_id_revision
  ON public.receitas (receita_id, revision_number);

CREATE INDEX IF NOT EXISTS idx_receitas_produto_acabado_id
  ON public.receitas (produto_acabado_id);

CREATE INDEX IF NOT EXISTS idx_receitas_materia_prima_id
  ON public.receitas (materia_prima_id);

-- ---------------------------------------------------------------------------
-- 5) RPC: salvar revisão (create / replace / new_revision) de forma atômica
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receitas_salvar_revisao(
  p_receita_id text,
  p_revision_number integer,
  p_header jsonb,
  p_mps jsonb,
  p_mode text DEFAULT 'replace'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode text := lower(trim(both FROM coalesce(p_mode, 'replace')));
  v_receita_id text := nullif(trim(both FROM coalesce(p_receita_id, '')), '');
  v_rev integer := coalesce(p_revision_number, 1);
  v_mps jsonb;
  v_mp jsonb;
  v_count integer;
  v_idx integer := 0;
  v_pa_id uuid;
  v_mp_id uuid;
  v_code text;
  v_name text;
  v_client text;
  v_density numeric;
  v_price numeric;
  v_revision text;
  v_revision_date date;
  v_necessita_n2 boolean;
  v_created_by text;
  v_created_by_id text;
  v_anchor_id text;
  v_ids text[] := ARRAY[]::text[];
  v_mp_code text;
  v_mp_name text;
  v_new_id text;
  v_keep_fds boolean := false;
  v_fds_url text;
  v_fds_filename text;
  v_fds_uploaded_at timestamptz;
  v_fds_uploaded_by text;
  v_registro integer;
BEGIN
  IF v_mode NOT IN ('create', 'replace', 'new_revision') THEN
    RAISE EXCEPTION 'mode invalido: %', p_mode;
  END IF;

  v_mps := receitas_parse_raw_materials(COALESCE(p_mps, '[]'::jsonb));
  IF jsonb_typeof(v_mps) <> 'array' THEN
    RAISE EXCEPTION 'p_mps deve ser um array JSON';
  END IF;

  SELECT COUNT(*)::integer INTO v_count
  FROM jsonb_array_elements(v_mps) elem
  WHERE nullif(trim(both FROM coalesce(elem->>'mp_code', '')), '') IS NOT NULL
    AND nullif(trim(both FROM coalesce(elem->>'mp_name', '')), '') IS NOT NULL;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'informe ao menos uma materia-prima com codigo e nome';
  END IF;

  v_code := trim(both FROM coalesce(p_header->>'code', ''));
  v_name := trim(both FROM coalesce(p_header->>'product_name', ''));
  v_client := nullif(trim(both FROM coalesce(p_header->>'client', '')), '');
  v_density := NULLIF(p_header->>'density', '')::numeric;
  v_price := NULLIF(p_header->>'price', '')::numeric;
  v_revision := coalesce(nullif(trim(both FROM coalesce(p_header->>'revision', '')), ''),
                         format('Revisão %s', lpad(v_rev::text, 2, '0')));
  v_revision_date := COALESCE(NULLIF(p_header->>'revision_date', '')::date, current_date);
  v_necessita_n2 := coalesce((p_header->>'necessita_n2')::boolean, false);
  v_created_by := nullif(trim(both FROM coalesce(p_header->>'created_by', '')), '');
  v_created_by_id := nullif(trim(both FROM coalesce(p_header->>'created_by_id', '')), '');

  IF v_name = '' THEN
    RAISE EXCEPTION 'product_name e obrigatorio';
  END IF;

  IF v_mode = 'create' THEN
    v_receita_id := coalesce(v_receita_id, gen_random_uuid()::text);
    v_rev := 1;
    SELECT COALESCE(MAX(registro), 0) + 1 INTO v_registro FROM receitas;
  ELSIF v_mode = 'new_revision' THEN
    IF v_receita_id IS NULL THEN
      RAISE EXCEPTION 'receita_id obrigatorio para new_revision';
    END IF;
    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_rev
    FROM receitas
    WHERE receita_id = v_receita_id;
    SELECT registro INTO v_registro
    FROM receitas
    WHERE receita_id = v_receita_id
      AND registro IS NOT NULL
    ORDER BY revision_number ASC, linha_ordem ASC
    LIMIT 1;
    IF v_registro IS NULL THEN
      SELECT COALESCE(MAX(registro), 0) + 1 INTO v_registro FROM receitas;
    END IF;
    -- herdar FDS da revisão anterior (maior)
    SELECT fds_url, fds_filename, fds_uploaded_at, fds_uploaded_by
    INTO v_fds_url, v_fds_filename, v_fds_uploaded_at, v_fds_uploaded_by
    FROM receitas
    WHERE receita_id = v_receita_id
    ORDER BY revision_number DESC, linha_ordem ASC
    LIMIT 1;
    v_keep_fds := (v_fds_url IS NOT NULL AND v_fds_url <> '');
  ELSE
    -- replace
    IF v_receita_id IS NULL THEN
      RAISE EXCEPTION 'receita_id obrigatorio para replace';
    END IF;
    -- preservar id âncora (linha_ordem=1) e FDS
    SELECT id, fds_url, fds_filename, fds_uploaded_at, fds_uploaded_by, registro
    INTO v_anchor_id, v_fds_url, v_fds_filename, v_fds_uploaded_at, v_fds_uploaded_by, v_registro
    FROM receitas
    WHERE receita_id = v_receita_id
      AND revision_number = v_rev
    ORDER BY linha_ordem ASC
    LIMIT 1;
    IF v_registro IS NULL THEN
      SELECT registro INTO v_registro
      FROM receitas
      WHERE receita_id = v_receita_id
        AND registro IS NOT NULL
      LIMIT 1;
    END IF;
    IF v_registro IS NULL THEN
      SELECT COALESCE(MAX(registro), 0) + 1 INTO v_registro FROM receitas;
    END IF;

    DELETE FROM receitas
    WHERE receita_id = v_receita_id
      AND revision_number = v_rev;
  END IF;

  v_pa_id := NULL;
  IF v_code <> '' THEN
    v_pa_id := cadastro_produtos_registrar_uso(
      v_code, v_name, 'INDUSTRIALIZACAO',
      jsonb_build_object(
        'cliente_nome', coalesce(v_client, ''),
        'densidade', CASE WHEN v_density IS NULL THEN '-' ELSE v_density::text END,
        'densidade_tabelada', (v_density IS NOT NULL)
      )
    );
  END IF;

  FOR v_mp IN
    SELECT elem
    FROM jsonb_array_elements(v_mps) AS elem
    WHERE nullif(trim(both FROM coalesce(elem->>'mp_code', '')), '') IS NOT NULL
      AND nullif(trim(both FROM coalesce(elem->>'mp_name', '')), '') IS NOT NULL
  LOOP
    v_idx := v_idx + 1;
    v_mp_code := trim(both FROM coalesce(v_mp->>'mp_code', ''));
    v_mp_name := trim(both FROM coalesce(v_mp->>'mp_name', ''));

    v_mp_id := cadastro_produtos_registrar_uso(
      v_mp_code, v_mp_name, 'INDUSTRIALIZACAO',
      jsonb_build_object(
        'cliente_nome', coalesce(v_client, ''),
        'densidade', coalesce(nullif(trim(both FROM coalesce(v_mp->>'mp_density', '')), ''), '-'),
        'densidade_tabelada', (nullif(trim(both FROM coalesce(v_mp->>'mp_density', '')), '') IS NOT NULL),
        'controlado', coalesce((v_mp->>'controlado')::boolean, false),
        'orgao_regulamentador', coalesce(v_mp->>'orgao_regulamentador', '')
      )
    );

    IF v_idx = 1 AND v_mode = 'replace' AND v_anchor_id IS NOT NULL THEN
      v_new_id := v_anchor_id;
    ELSE
      v_new_id := gen_random_uuid()::text;
    END IF;

    INSERT INTO receitas (
      id, created_date, updated_date, created_by_id, created_by,
      code, product_name, client, density, price,
      revision, revision_date, revision_number, registro,
      fds_url, fds_filename, fds_uploaded_at, fds_uploaded_by,
      necessita_n2,
      receita_id, produto_acabado_id, materia_prima_id,
      mp_code, mp_name, mp_density, percentage, quantity_kg,
      controlado, orgao_regulamentador, linha_ordem
    ) VALUES (
      v_new_id, now(), now(), v_created_by_id, v_created_by,
      nullif(v_code, ''), v_name, v_client, v_density, v_price,
      v_revision, v_revision_date, v_rev, v_registro,
      CASE WHEN v_idx = 1 THEN v_fds_url ELSE NULL END,
      CASE WHEN v_idx = 1 THEN v_fds_filename ELSE NULL END,
      CASE WHEN v_idx = 1 THEN v_fds_uploaded_at ELSE NULL END,
      CASE WHEN v_idx = 1 THEN v_fds_uploaded_by ELSE NULL END,
      v_necessita_n2,
      v_receita_id, v_pa_id, v_mp_id,
      v_mp_code, v_mp_name,
      NULLIF(v_mp->>'mp_density', '')::numeric,
      NULLIF(v_mp->>'percentage', '')::numeric,
      NULLIF(v_mp->>'quantity_kg', '')::numeric,
      coalesce((v_mp->>'controlado')::boolean, false),
      CASE
        WHEN coalesce((v_mp->>'controlado')::boolean, false)
          THEN nullif(trim(both FROM coalesce(v_mp->>'orgao_regulamentador', '')), '')
        ELSE NULL
      END,
      v_idx
    );

    v_ids := array_append(v_ids, v_new_id);
  END LOOP;

  -- Propagar FDS/cabeçalho para todas as linhas da revisão
  UPDATE receitas
  SET
    code = nullif(v_code, ''),
    product_name = v_name,
    client = v_client,
    density = v_density,
    price = v_price,
    revision = v_revision,
    revision_date = v_revision_date,
    registro = v_registro,
    necessita_n2 = v_necessita_n2,
    produto_acabado_id = v_pa_id,
    fds_url = CASE WHEN linha_ordem = 1 THEN fds_url ELSE NULL END,
    updated_date = now()
  WHERE receita_id = v_receita_id
    AND revision_number = v_rev;

  RETURN jsonb_build_object(
    'receita_id', v_receita_id,
    'revision_number', v_rev,
    'anchor_id', v_ids[1],
    'line_ids', to_jsonb(v_ids),
    'mp_count', v_idx,
    'mode', v_mode
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receitas_parse_raw_materials(jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receitas_salvar_revisao(text, integer, jsonb, jsonb, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- ROLLBACK MANUAL (não executar automaticamente)
-- =============================================================================
-- BEGIN;
-- DELETE FROM public.receitas;
-- INSERT INTO public.receitas SELECT * FROM public._chemctrl_047_receitas_backup;
-- -- dropar colunas novas se necessário; recriar unique (product_name, revision_number)
-- COMMIT;
-- =============================================================================
