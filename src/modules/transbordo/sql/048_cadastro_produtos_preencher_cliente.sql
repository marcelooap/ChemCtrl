-- =============================================================================
-- 048_cadastro_produtos_preencher_cliente.sql
-- Ao reutilizar produto existente, preenche cliente_nome/cliente_id se estiverem
-- vazios. RPC receitas_salvar_revisao passa o cliente da receita também para MPs.
-- Idempotente.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cadastro_produtos_registrar_uso(
  p_codigo text,
  p_nome text,
  p_modulo text,
  p_attrs jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_codigo text := trim(both FROM coalesce(p_codigo, ''));
  v_nome text := trim(both FROM coalesce(p_nome, ''));
  v_modulo text := upper(trim(both FROM coalesce(p_modulo, '')));
  v_key text;
  v_count integer;
  v_id uuid;
  v_origem text;
  v_densidade text;
  v_controlado boolean;
  v_orgao text;
  v_cliente text;
  v_cliente_id uuid;
  v_cur_cliente text;
  v_cur_cliente_id uuid;
BEGIN
  IF v_codigo = '' OR v_nome = '' THEN
    RAISE EXCEPTION 'codigo e nome sao obrigatorios para cadastro_produtos_registrar_uso';
  END IF;

  IF v_modulo NOT IN ('INDUSTRIALIZACAO', 'ARMAZENAGEM') THEN
    RAISE EXCEPTION 'modulo invalido: % (use INDUSTRIALIZACAO ou ARMAZENAGEM)', p_modulo;
  END IF;

  v_key := cadastro_produtos_norm(v_codigo) || '|' || cadastro_produtos_norm(v_nome);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  v_cliente := nullif(trim(both FROM coalesce(p_attrs->>'cliente_nome', '')), '');

  SELECT count(*)::integer INTO v_count
  FROM cadastro_produtos p
  WHERE cadastro_produtos_norm(p.codigo) = cadastro_produtos_norm(v_codigo)
    AND cadastro_produtos_norm(p.produto) = cadastro_produtos_norm(v_nome);

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'produtos duplicados no cadastro para codigo+nome: % / %',
      v_codigo, v_nome;
  END IF;

  IF v_count = 1 THEN
    SELECT p.id, p.origem, p.cliente_nome, p.cliente_id
    INTO v_id, v_origem, v_cur_cliente, v_cur_cliente_id
    FROM cadastro_produtos p
    WHERE cadastro_produtos_norm(p.codigo) = cadastro_produtos_norm(v_codigo)
      AND cadastro_produtos_norm(p.produto) = cadastro_produtos_norm(v_nome);

    IF v_origem IS DISTINCT FROM 'AMBOS'
       AND v_origem IS DISTINCT FROM v_modulo THEN
      UPDATE cadastro_produtos
      SET origem = 'AMBOS'
      WHERE id = v_id
        AND origem IS DISTINCT FROM 'AMBOS';
    END IF;

    -- Preenche cliente em branco a partir do attrs (ex.: cliente da receita)
    IF v_cliente IS NOT NULL
       AND (v_cur_cliente IS NULL OR btrim(v_cur_cliente) = '' OR v_cur_cliente = '-') THEN
      SELECT c.id INTO v_cliente_id
      FROM t_clientes c
      WHERE cadastro_produtos_norm(c.nome) = cadastro_produtos_norm(v_cliente)
      LIMIT 1;

      UPDATE cadastro_produtos
      SET
        cliente_nome = v_cliente,
        cliente_id = COALESCE(v_cliente_id, cliente_id)
      WHERE id = v_id;
    END IF;

    RETURN v_id;
  END IF;

  v_densidade := nullif(trim(both FROM coalesce(p_attrs->>'densidade', '')), '');
  IF v_densidade IS NULL THEN
    v_densidade := '-';
  END IF;

  v_controlado := coalesce((p_attrs->>'controlado')::boolean, false);
  v_orgao := nullif(trim(both FROM coalesce(p_attrs->>'orgao_regulamentador', '')), '');
  IF NOT v_controlado THEN
    v_orgao := NULL;
  END IF;

  IF v_cliente IS NOT NULL THEN
    SELECT c.id INTO v_cliente_id
    FROM t_clientes c
    WHERE cadastro_produtos_norm(c.nome) = cadastro_produtos_norm(v_cliente)
    LIMIT 1;
  END IF;

  INSERT INTO cadastro_produtos (
    codigo,
    produto,
    cliente_id,
    cliente_nome,
    densidade,
    densidade_tabelada,
    filtrado,
    controlado,
    orgao_regulamentador,
    data_cadastro,
    origem
  ) VALUES (
    v_codigo,
    v_nome,
    v_cliente_id,
    v_cliente,
    v_densidade,
    coalesce((p_attrs->>'densidade_tabelada')::boolean, false),
    coalesce((p_attrs->>'filtrado')::boolean, false),
    v_controlado,
    v_orgao,
    current_date,
    v_modulo
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Atualiza RPC de save da receita: MPs herdam cliente do header
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
  v_fds_url text;
  v_fds_filename text;
  v_fds_uploaded_at timestamptz;
  v_fds_uploaded_by text;
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
  ELSIF v_mode = 'new_revision' THEN
    IF v_receita_id IS NULL THEN
      RAISE EXCEPTION 'receita_id obrigatorio para new_revision';
    END IF;
    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_rev
    FROM receitas
    WHERE receita_id = v_receita_id;
    SELECT fds_url, fds_filename, fds_uploaded_at, fds_uploaded_by
    INTO v_fds_url, v_fds_filename, v_fds_uploaded_at, v_fds_uploaded_by
    FROM receitas
    WHERE receita_id = v_receita_id
    ORDER BY revision_number DESC, linha_ordem ASC
    LIMIT 1;
  ELSE
    IF v_receita_id IS NULL THEN
      RAISE EXCEPTION 'receita_id obrigatorio para replace';
    END IF;
    SELECT id, fds_url, fds_filename, fds_uploaded_at, fds_uploaded_by
    INTO v_anchor_id, v_fds_url, v_fds_filename, v_fds_uploaded_at, v_fds_uploaded_by
    FROM receitas
    WHERE receita_id = v_receita_id
      AND revision_number = v_rev
    ORDER BY linha_ordem ASC
    LIMIT 1;

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
      revision, revision_date, revision_number,
      raw_materials, fds_url, fds_filename, fds_uploaded_at, fds_uploaded_by,
      necessita_n2,
      receita_id, produto_acabado_id, materia_prima_id,
      mp_code, mp_name, mp_density, percentage, quantity_kg,
      controlado, orgao_regulamentador, linha_ordem
    ) VALUES (
      v_new_id, now(), now(), v_created_by_id, v_created_by,
      nullif(v_code, ''), v_name, v_client, v_density, v_price,
      v_revision, v_revision_date, v_rev,
      NULL,
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

  UPDATE receitas
  SET
    code = nullif(v_code, ''),
    product_name = v_name,
    client = v_client,
    density = v_density,
    price = v_price,
    revision = v_revision,
    revision_date = v_revision_date,
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

GRANT EXECUTE ON FUNCTION public.cadastro_produtos_registrar_uso(text, text, text, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receitas_salvar_revisao(text, integer, jsonb, jsonb, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
