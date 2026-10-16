-- =============================================================================
-- 046_cadastro_produtos_central.sql
-- Centraliza produtos: renomeia ind_lista_receitas -> receitas e
-- t_produtos -> cadastro_produtos; adiciona origem; RPC de registro de uso;
-- backfill idempotente apenas por codigo+nome inequívocos.
--
-- Idempotente. Sem DROP/TRUNCATE/DELETE de dados de negócio.
-- Rollback (manual): ver comentário no final deste arquivo.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Backup de definições de funções que citam os nomes antigos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _chemctrl_migration_fn_backup (
  id bigserial PRIMARY KEY,
  migrated_at timestamptz NOT NULL DEFAULT now(),
  migration_tag text NOT NULL DEFAULT '046_cadastro_produtos_central',
  schema_name text NOT NULL,
  function_identity text NOT NULL,
  definition text NOT NULL
);

DO $$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (
        pg_get_functiondef(p.oid) ILIKE '%ind_lista_receitas%'
        OR pg_get_functiondef(p.oid) ILIKE '%t_produtos%'
      )
  LOOP
    def := pg_get_functiondef(r.oid);
    IF NOT EXISTS (
      SELECT 1
      FROM _chemctrl_migration_fn_backup b
      WHERE b.migration_tag = '046_cadastro_produtos_central'
        AND b.function_identity = r.proname || '(' || r.args || ')'
        AND b.definition = def
    ) THEN
      INSERT INTO _chemctrl_migration_fn_backup (schema_name, function_identity, definition)
      VALUES (r.schema_name, r.proname || '(' || r.args || ')', def);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Renomear tabelas (preserva OID, FKs, índices, RLS, triggers, realtime)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.ind_lista_receitas') IS NOT NULL
     AND to_regclass('public.receitas') IS NULL THEN
    ALTER TABLE public.ind_lista_receitas RENAME TO receitas;
  END IF;

  IF to_regclass('public.t_produtos') IS NOT NULL
     AND to_regclass('public.cadastro_produtos') IS NULL THEN
    ALTER TABLE public.t_produtos RENAME TO cadastro_produtos;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Coluna origem em cadastro_produtos
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.cadastro_produtos') IS NULL THEN
    RAISE EXCEPTION 'Tabela cadastro_produtos nao encontrada apos rename';
  END IF;

  ALTER TABLE public.cadastro_produtos
    ADD COLUMN IF NOT EXISTS origem text;

  UPDATE public.cadastro_produtos
  SET origem = 'ARMAZENAGEM'
  WHERE origem IS NULL;

  ALTER TABLE public.cadastro_produtos
    ALTER COLUMN origem SET DEFAULT 'ARMAZENAGEM';

  ALTER TABLE public.cadastro_produtos
    ALTER COLUMN origem SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_cadastro_produtos_origem'
      AND conrelid = 'public.cadastro_produtos'::regclass
  ) THEN
    ALTER TABLE public.cadastro_produtos
      ADD CONSTRAINT chk_cadastro_produtos_origem
      CHECK (origem IN ('INDUSTRIALIZACAO', 'ARMAZENAGEM', 'AMBOS'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cadastro_produtos_origem
  ON public.cadastro_produtos (origem);

-- ---------------------------------------------------------------------------
-- 3) Reescrever corpos de funções: substituir somente nomes de relação
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  def text;
  new_def text;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (
        pg_get_functiondef(p.oid) ILIKE '%ind_lista_receitas%'
        OR pg_get_functiondef(p.oid) ILIKE '%t_produtos%'
      )
  LOOP
    def := pg_get_functiondef(r.oid);
    new_def := replace(def, 'ind_lista_receitas', 'receitas');
    new_def := replace(new_def, 't_produtos', 'cadastro_produtos');
    IF new_def IS DISTINCT FROM def THEN
      EXECUTE new_def;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Normalização e RPC de registro de uso
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cadastro_produtos_norm(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(trim(both FROM regexp_replace(
    normalize(coalesce(p_value, ''), NFD),
    '[\u0300-\u036f]',
    '',
    'g'
  )));
$$;

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
BEGIN
  IF v_codigo = '' OR v_nome = '' THEN
    RAISE EXCEPTION 'codigo e nome sao obrigatorios para cadastro_produtos_registrar_uso';
  END IF;

  IF v_modulo NOT IN ('INDUSTRIALIZACAO', 'ARMAZENAGEM') THEN
    RAISE EXCEPTION 'modulo invalido: % (use INDUSTRIALIZACAO ou ARMAZENAGEM)', p_modulo;
  END IF;

  v_key := cadastro_produtos_norm(v_codigo) || '|' || cadastro_produtos_norm(v_nome);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

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
    SELECT p.id, p.origem INTO v_id, v_origem
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
  v_cliente := nullif(trim(both FROM coalesce(p_attrs->>'cliente_nome', '')), '');

  INSERT INTO cadastro_produtos (
    codigo,
    produto,
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

CREATE OR REPLACE FUNCTION public.cadastro_produtos_promover_ids(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE cadastro_produtos
  SET origem = 'AMBOS'
  WHERE id = ANY (p_ids)
    AND origem = 'INDUSTRIALIZACAO';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cadastro_produtos_norm(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cadastro_produtos_registrar_uso(text, text, text, jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cadastro_produtos_promover_ids(uuid[])
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Triggers: uso no Transbordo promove INDUSTRIALIZACAO -> AMBOS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cadastro_produtos_promover_por_produto_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.produto_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.produto_id IS DISTINCT FROM OLD.produto_id) THEN
    UPDATE cadastro_produtos
    SET origem = 'AMBOS'
    WHERE id = NEW.produto_id
      AND origem = 'INDUSTRIALIZACAO';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    't_isotanques',
    't_entradas',
    't_estoque',
    't_transbordos',
    't_vasilhames',
    't_transbordo_validacoes',
    't_filtracoes',
    't_material_reservas'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'produto_id'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_promover_origem ON public.%I',
      t, t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%s_promover_origem
         AFTER INSERT OR UPDATE OF produto_id ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.cadastro_produtos_promover_por_produto_id()',
      t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Backfill idempotente a partir de receitas (PA + MPs com codigo+nome)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  mp jsonb;
  v_code text;
  v_name text;
  v_attrs jsonb;
BEGIN
  IF to_regclass('public.receitas') IS NULL THEN
    RAISE NOTICE 'Tabela receitas ausente; backfill ignorado';
    RETURN;
  END IF;

  -- Produto acabado
  FOR r IN
    SELECT id, code, product_name, client, density
    FROM receitas
  LOOP
    v_code := trim(both FROM coalesce(r.code, ''));
    v_name := trim(both FROM coalesce(r.product_name, ''));
    IF v_code = '' OR v_name = '' THEN
      CONTINUE;
    END IF;
    v_attrs := jsonb_build_object(
      'cliente_nome', coalesce(r.client, ''),
      'densidade', CASE
        WHEN r.density IS NULL THEN '-'
        ELSE r.density::text
      END,
      'densidade_tabelada', (r.density IS NOT NULL)
    );
    PERFORM cadastro_produtos_registrar_uso(
      v_code, v_name, 'INDUSTRIALIZACAO', v_attrs
    );
  END LOOP;

  -- Materias-primas do JSON
  FOR r IN
    SELECT id, raw_materials
    FROM receitas
    WHERE raw_materials IS NOT NULL
  LOOP
    IF jsonb_typeof(r.raw_materials) <> 'array' THEN
      CONTINUE;
    END IF;
    FOR mp IN SELECT * FROM jsonb_array_elements(r.raw_materials)
    LOOP
      v_code := trim(both FROM coalesce(mp->>'mp_code', ''));
      v_name := trim(both FROM coalesce(mp->>'mp_name', ''));
      IF v_code = '' OR v_name = '' THEN
        CONTINUE;
      END IF;
      v_attrs := jsonb_build_object(
        'densidade', coalesce(nullif(trim(both FROM coalesce(mp->>'mp_density', '')), ''), '-'),
        'densidade_tabelada', (nullif(trim(both FROM coalesce(mp->>'mp_density', '')), '') IS NOT NULL),
        'controlado', coalesce((mp->>'controlado')::boolean, false),
        'orgao_regulamentador', coalesce(mp->>'orgao_regulamentador', '')
      );
      PERFORM cadastro_produtos_registrar_uso(
        v_code, v_name, 'INDUSTRIALIZACAO', v_attrs
      );
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- ROLLBACK MANUAL (não executar automaticamente)
-- =============================================================================
-- BEGIN;
-- -- 1) Restaurar funções a partir de _chemctrl_migration_fn_backup
-- --    (definition original com ind_lista_receitas / t_produtos).
-- -- 2) ALTER TABLE public.receitas RENAME TO ind_lista_receitas;
-- -- 3) ALTER TABLE public.cadastro_produtos RENAME TO t_produtos;
-- -- A coluna origem permanece (remoção seria destrutiva e não faz parte do
-- -- rollback padrão). Triggers trg_*_promover_origem podem ser DROP TRIGGER.
-- -- NOTIFY pgrst, 'reload schema';
-- COMMIT;
-- =============================================================================
