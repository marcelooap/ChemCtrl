-- =============================================================================
-- 049_receitas_drop_raw_materials.sql
-- Remove raw_materials (JSON legado) e grava o numero RC da tela.
-- RC01 = produto cuja primeira linha foi criada primeiro; todas as MPs e
-- revisoes desse produto compartilham o mesmo registro.
-- Nao reexecuta a 047.
-- =============================================================================

BEGIN;

ALTER TABLE public.receitas ADD COLUMN IF NOT EXISTS registro integer;

WITH firsts AS (
  SELECT
    btrim(product_name) AS product_name,
    MIN(created_date) AS first_created
  FROM public.receitas
  WHERE nullif(btrim(product_name), '') IS NOT NULL
  GROUP BY btrim(product_name)
),
ranked AS (
  SELECT
    product_name,
    ROW_NUMBER() OVER (ORDER BY first_created ASC NULLS LAST, product_name ASC) AS registro
  FROM firsts
)
UPDATE public.receitas r
SET registro = ranked.registro
FROM ranked
WHERE btrim(r.product_name) = ranked.product_name
  AND r.registro IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.receitas WHERE registro IS NULL) THEN
    RAISE EXCEPTION '049: existem linhas de receitas sem registro';
  END IF;
END $$;

ALTER TABLE public.receitas ALTER COLUMN registro SET NOT NULL;

ALTER TABLE public.receitas DROP COLUMN IF EXISTS codigo_rc;
ALTER TABLE public.receitas
  ADD COLUMN codigo_rc text
  GENERATED ALWAYS AS ('RC' || lpad(registro::text, 2, '0')) STORED;

COMMENT ON COLUMN public.receitas.registro IS 'Numero do ID da tela (1 = RC01), igual para todas as MPs e revisoes do produto.';
COMMENT ON COLUMN public.receitas.codigo_rc IS 'ID exibido na tela de receitas. Ordenar por registro, revision_number, linha_ordem.';
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
                         format('RevisÃ£o %s', lpad(v_rev::text, 2, '0')));
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
    -- herdar FDS da revisÃ£o anterior (maior)
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
    -- preservar id Ã¢ncora (linha_ordem=1) e FDS
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

  -- Propagar FDS e cabecalho para todas as linhas da revisao
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

ALTER TABLE public.receitas DROP COLUMN IF EXISTS raw_materials;

CREATE INDEX IF NOT EXISTS idx_receitas_registro_ordem
  ON public.receitas (registro, revision_number, linha_ordem);

DO $cluster$
BEGIN
  EXECUTE 'CLUSTER public.receitas USING idx_receitas_registro_ordem';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'CLUSTER nao aplicado: %', SQLERRM;
END
$cluster$;

NOTIFY pgrst, 'reload schema';

COMMIT;
