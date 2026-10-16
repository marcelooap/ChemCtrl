-- =============================================================================
-- 049_cadastro_tanka_central.sql
-- Unifica cadastros de tanka: cria cadastro_tanka (mestre), migra t_isotanques
-- e ind_cadastro_tanka com mapa/relatório, atualiza tanka_id em t_transbordos
-- apenas quando o UUID antigo está no mapa.
--
-- Decisões:
--   - nome normalizado UNIQUE global (1B)
--   - produto_id/produto_nome opcionais (produto em uso) (2A)
--   - codigo_itku nullable (legado Ind)
--   - NÃO dropa t_isotanques / ind_cadastro_tanka
--   - NÃO reescreve placa / container_number / tank_name / descontaminacoes
--
-- Idempotente. Sem DELETE de dados de negócio nas tabelas origem.
-- NÃO aplicar remotamente sem autorização explícita.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Função de normalização (trim, upper, sem acento)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cadastro_tanka_norm(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT upper(trim(both FROM translate(
    coalesce(p, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
  )));
$$;

-- ---------------------------------------------------------------------------
-- 1) Tabela mestre
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cadastro_tanka (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_itku text,
  nome text NOT NULL,
  cliente_id uuid REFERENCES public.t_clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  capacidade numeric,
  inicio_locacao date,
  produto_id uuid REFERENCES public.cadastro_produtos(id) ON DELETE SET NULL,
  produto_nome text,
  observacao text,
  created_by_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Se cadastro_produtos ainda não existir (pré-046), remove FK produto e recria nullable sem FK
DO $$
BEGIN
  IF to_regclass('public.cadastro_produtos') IS NULL THEN
    ALTER TABLE public.cadastro_tanka
      DROP CONSTRAINT IF EXISTS cadastro_tanka_produto_id_fkey;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 't_set_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS cadastro_tanka_set_updated_at ON public.cadastro_tanka;
    CREATE TRIGGER cadastro_tanka_set_updated_at
      BEFORE UPDATE ON public.cadastro_tanka
      FOR EACH ROW EXECUTE FUNCTION public.t_set_updated_at();
  ELSIF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_date'
  ) THEN
    -- fallback Ind: updated_at permanece via trigger genérico se houver
    NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cadastro_tanka_nome_norm
  ON public.cadastro_tanka (public.cadastro_tanka_norm(nome));

CREATE UNIQUE INDEX IF NOT EXISTS uq_cadastro_tanka_itku_norm
  ON public.cadastro_tanka (public.cadastro_tanka_norm(codigo_itku))
  WHERE codigo_itku IS NOT NULL AND btrim(codigo_itku) <> '';

CREATE INDEX IF NOT EXISTS idx_cadastro_tanka_cliente_id
  ON public.cadastro_tanka (cliente_id);
CREATE INDEX IF NOT EXISTS idx_cadastro_tanka_produto_id
  ON public.cadastro_tanka (produto_id);

ALTER TABLE public.cadastro_tanka ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS t_anon_all_cadastro_tanka ON public.cadastro_tanka;
CREATE POLICY t_anon_all_cadastro_tanka
  ON public.cadastro_tanka
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadastro_tanka TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Colunas ponte nas tabelas origem
-- ---------------------------------------------------------------------------
ALTER TABLE public.t_isotanques
  ADD COLUMN IF NOT EXISTS cadastro_tanka_id uuid REFERENCES public.cadastro_tanka(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF to_regclass('public.ind_cadastro_tanka') IS NOT NULL THEN
    ALTER TABLE public.ind_cadastro_tanka
      ADD COLUMN IF NOT EXISTS cadastro_tanka_id uuid REFERENCES public.cadastro_tanka(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Tabelas de diagnóstico / mapa / relatório
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._chemctrl_049_tanka_diag (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  metric text NOT NULL,
  value_num bigint,
  detail text
);

CREATE TABLE IF NOT EXISTS public._chemctrl_049_tanka_map (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('ISOTANQUE', 'IND_TANKA')),
  old_id text NOT NULL,
  new_id uuid,
  match_status text NOT NULL,
  detail text,
  UNIQUE (source, old_id)
);

CREATE TABLE IF NOT EXISTS public._chemctrl_049_tanka_report (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text,
  old_id text,
  nome text,
  status text NOT NULL,
  detail text
);

-- ---------------------------------------------------------------------------
-- 4) Diagnóstico pré-migração
-- ---------------------------------------------------------------------------
INSERT INTO public._chemctrl_049_tanka_diag (metric, value_num)
SELECT 'isotanques_total', COUNT(*)::bigint FROM public.t_isotanques;

DO $$
BEGIN
  IF to_regclass('public.ind_cadastro_tanka') IS NOT NULL THEN
    INSERT INTO public._chemctrl_049_tanka_diag (metric, value_num)
    SELECT 'ind_tanka_total', COUNT(*)::bigint FROM public.ind_cadastro_tanka;
  ELSE
    INSERT INTO public._chemctrl_049_tanka_diag (metric, value_num, detail)
    VALUES ('ind_tanka_total', 0, 'tabela ausente');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Migrar t_isotanques → cadastro_tanka
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_nome text;
  v_new_id uuid;
  v_existing uuid;
BEGIN
  FOR r IN
    SELECT * FROM public.t_isotanques
    ORDER BY created_at NULLS LAST, id
  LOOP
    -- Já mapeado?
    IF EXISTS (
      SELECT 1 FROM public._chemctrl_049_tanka_map m
      WHERE m.source = 'ISOTANQUE' AND m.old_id = r.id::text
    ) THEN
      CONTINUE;
    END IF;

    IF r.cadastro_tanka_id IS NOT NULL THEN
      INSERT INTO public._chemctrl_049_tanka_map (source, old_id, new_id, match_status, detail)
      VALUES ('ISOTANQUE', r.id::text, r.cadastro_tanka_id, 'already_linked', 'cadastro_tanka_id pré-existente')
      ON CONFLICT (source, old_id) DO NOTHING;
      CONTINUE;
    END IF;

    v_nome := nullif(trim(both FROM coalesce(r.tanka, '')), '');
    IF v_nome IS NULL THEN
      v_nome := nullif(trim(both FROM coalesce(r.codigo_itku, '')), '');
    END IF;
    IF v_nome IS NULL THEN
      INSERT INTO public._chemctrl_049_tanka_map (source, old_id, new_id, match_status, detail)
      VALUES ('ISOTANQUE', r.id::text, NULL, 'skipped_no_name', 'sem tanka nem codigo_itku');
      INSERT INTO public._chemctrl_049_tanka_report (source, old_id, nome, status, detail)
      VALUES ('ISOTANQUE', r.id::text, NULL, 'skipped_no_name', 'sem nome utilizável');
      CONTINUE;
    END IF;

    SELECT c.id INTO v_existing
    FROM public.cadastro_tanka c
    WHERE public.cadastro_tanka_norm(c.nome) = public.cadastro_tanka_norm(v_nome)
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      -- Nome já no mestre (re-run): apenas linka
      UPDATE public.t_isotanques SET cadastro_tanka_id = v_existing WHERE id = r.id;
      INSERT INTO public._chemctrl_049_tanka_map (source, old_id, new_id, match_status, detail)
      VALUES ('ISOTANQUE', r.id::text, v_existing, 'linked_existing_nome', 'nome já existia no mestre')
      ON CONFLICT (source, old_id) DO NOTHING;
      CONTINUE;
    END IF;

    INSERT INTO public.cadastro_tanka (
      id, codigo_itku, nome, cliente_id, cliente_nome, capacidade,
      inicio_locacao, produto_id, produto_nome, observacao, created_at, updated_at
    ) VALUES (
      r.id, -- preserva UUID do isotanque quando possível (referências JSON tanka_id)
      nullif(trim(both FROM coalesce(r.codigo_itku, '')), ''),
      v_nome,
      r.cliente_id,
      nullif(trim(both FROM coalesce(r.cliente_nome, '')), ''),
      r.capacidade,
      r.inicio_locacao,
      r.produto_id,
      nullif(trim(both FROM coalesce(r.produto_nome, '')), ''),
      r.observacao,
      coalesce(r.created_at, now()),
      coalesce(r.updated_at, now())
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO v_new_id;

    IF v_new_id IS NULL THEN
      -- conflito de PK: gera novo id
      INSERT INTO public.cadastro_tanka (
        codigo_itku, nome, cliente_id, cliente_nome, capacidade,
        inicio_locacao, produto_id, produto_nome, observacao, created_at, updated_at
      ) VALUES (
        nullif(trim(both FROM coalesce(r.codigo_itku, '')), ''),
        v_nome,
        r.cliente_id,
        nullif(trim(both FROM coalesce(r.cliente_nome, '')), ''),
        r.capacidade,
        r.inicio_locacao,
        r.produto_id,
        nullif(trim(both FROM coalesce(r.produto_nome, '')), ''),
        r.observacao,
        coalesce(r.created_at, now()),
        coalesce(r.updated_at, now())
      )
      RETURNING id INTO v_new_id;
    END IF;

    UPDATE public.t_isotanques SET cadastro_tanka_id = v_new_id WHERE id = r.id;
    INSERT INTO public._chemctrl_049_tanka_map (source, old_id, new_id, match_status, detail)
    VALUES ('ISOTANQUE', r.id::text, v_new_id, 'inserted', 'migrado de t_isotanques')
    ON CONFLICT (source, old_id) DO NOTHING;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Migrar ind_cadastro_tanka → merge ou insert
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_nome text;
  v_client text;
  v_existing record;
  v_new_id uuid;
  v_client_ok boolean;
  v_cli_id uuid;
BEGIN
  IF to_regclass('public.ind_cadastro_tanka') IS NULL THEN
    INSERT INTO public._chemctrl_049_tanka_report (source, status, detail)
    VALUES ('IND_TANKA', 'skipped_table_missing', 'ind_cadastro_tanka ausente');
    RETURN;
  END IF;

  FOR r IN
    SELECT
      id::text AS id,
      name,
      client,
      capacity,
      product,
      observacao,
      created_by_id,
      created_date,
      updated_date,
      cadastro_tanka_id
    FROM public.ind_cadastro_tanka
    ORDER BY created_date NULLS LAST, id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public._chemctrl_049_tanka_map m
      WHERE m.source = 'IND_TANKA' AND m.old_id = r.id
    ) THEN
      CONTINUE;
    END IF;

    IF r.cadastro_tanka_id IS NOT NULL THEN
      INSERT INTO public._chemctrl_049_tanka_map (source, old_id, new_id, match_status, detail)
      VALUES ('IND_TANKA', r.id, r.cadastro_tanka_id, 'already_linked', 'cadastro_tanka_id pré-existente')
      ON CONFLICT (source, old_id) DO NOTHING;
      CONTINUE;
    END IF;

    v_nome := nullif(trim(both FROM coalesce(r.name, '')), '');
    IF v_nome IS NULL THEN
      INSERT INTO public._chemctrl_049_tanka_map (source, old_id, new_id, match_status, detail)
      VALUES ('IND_TANKA', r.id, NULL, 'skipped_no_name', 'name vazio');
      INSERT INTO public._chemctrl_049_tanka_report (source, old_id, nome, status, detail)
      VALUES ('IND_TANKA', r.id, NULL, 'skipped_no_name', 'name vazio');
      CONTINUE;
    END IF;

    v_client := nullif(trim(both FROM coalesce(r.client, '')), '');

    SELECT c.* INTO v_existing
    FROM public.cadastro_tanka c
    WHERE public.cadastro_tanka_norm(c.nome) = public.cadastro_tanka_norm(v_nome)
    LIMIT 1;

    IF FOUND THEN
      v_client_ok :=
        (v_client IS NULL)
        OR (v_existing.cliente_nome IS NULL OR btrim(v_existing.cliente_nome) = '')
        OR (public.cadastro_tanka_norm(v_existing.cliente_nome) = public.cadastro_tanka_norm(v_client));

      IF NOT v_client_ok THEN
        INSERT INTO public._chemctrl_049_tanka_map (source, old_id, new_id, match_status, detail)
        VALUES (
          'IND_TANKA', r.id, v_existing.id, 'blocked_name_collision',
          format('nome=%s ind_client=%s master_client=%s', v_nome, v_client, v_existing.cliente_nome)
        );
        INSERT INTO public._chemctrl_049_tanka_report (source, old_id, nome, status, detail)
        VALUES (
          'IND_TANKA', r.id, v_nome, 'conflict_client',
          format('Clientes conflitantes; mestre preservado id=%s client=%s', v_existing.id, v_existing.cliente_nome)
        );
        UPDATE public.ind_cadastro_tanka
        SET cadastro_tanka_id = v_existing.id
        WHERE id::text = r.id;
        CONTINUE;
      END IF;

      UPDATE public.cadastro_tanka c
      SET
        cliente_nome = COALESCE(nullif(btrim(c.cliente_nome), ''), v_client),
        capacidade = COALESCE(c.capacidade, r.capacity, 26000),
        observacao = COALESCE(c.observacao, r.observacao),
        updated_at = now()
      WHERE c.id = v_existing.id;

      UPDATE public.ind_cadastro_tanka
      SET cadastro_tanka_id = v_existing.id
      WHERE id::text = r.id;

      INSERT INTO public._chemctrl_049_tanka_map (source, old_id, new_id, match_status, detail)
      VALUES ('IND_TANKA', r.id, v_existing.id, 'merged_by_nome', 'merge automático nome+cliente compatível')
      ON CONFLICT (source, old_id) DO NOTHING;
      CONTINUE;
    END IF;

    v_cli_id := NULL;
    IF v_client IS NOT NULL THEN
      SELECT c.id INTO v_cli_id
      FROM public.t_clientes c
      WHERE public.cadastro_tanka_norm(c.nome) = public.cadastro_tanka_norm(v_client)
      LIMIT 1;
    END IF;

    INSERT INTO public.cadastro_tanka (
      codigo_itku, nome, cliente_id, cliente_nome, capacidade,
      produto_nome, observacao, created_by_id, created_at, updated_at
    ) VALUES (
      NULL,
      v_nome,
      v_cli_id,
      v_client,
      COALESCE(r.capacity, 26000),
      nullif(trim(both FROM coalesce(r.product, '')), ''),
      r.observacao,
      r.created_by_id,
      coalesce(r.created_date, now()),
      coalesce(r.updated_date, now())
    )
    RETURNING id INTO v_new_id;

    UPDATE public.ind_cadastro_tanka
    SET cadastro_tanka_id = v_new_id
    WHERE id::text = r.id;

    INSERT INTO public._chemctrl_049_tanka_map (source, old_id, new_id, match_status, detail)
    VALUES ('IND_TANKA', r.id, v_new_id, 'inserted', 'migrado de ind_cadastro_tanka')
    ON CONFLICT (source, old_id) DO NOTHING;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7) Atualizar tanka_id / entrada_id (tipo tanka) em t_transbordos JSON
--    apenas quando old_id (ISOTANQUE) ≠ new_id
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t record;
  v_origens jsonb;
  v_destinos jsonb;
  v_changed boolean;
  o jsonb;
  d jsonb;
  v_new text;
  v_idx int;
  v_arr jsonb;
BEGIN
  FOR t IN SELECT id, origens, destinos FROM public.t_transbordos
  LOOP
    v_changed := false;
    v_origens := coalesce(t.origens, '[]'::jsonb);
    v_destinos := coalesce(t.destinos, '[]'::jsonb);

    IF jsonb_typeof(v_destinos) = 'array' THEN
      v_arr := '[]'::jsonb;
      FOR v_idx IN 0 .. greatest(jsonb_array_length(v_destinos) - 1, -1)
      LOOP
        d := v_destinos -> v_idx;
        IF coalesce(d->>'tipo_embalagem', '') = 'Tankagem'
           AND nullif(trim(both FROM coalesce(d->>'tanka_id', '')), '') IS NOT NULL THEN
          SELECT m.new_id::text INTO v_new
          FROM public._chemctrl_049_tanka_map m
          WHERE m.source = 'ISOTANQUE'
            AND m.old_id = trim(both FROM d->>'tanka_id')
            AND m.new_id IS NOT NULL
          LIMIT 1;
          IF v_new IS NOT NULL AND v_new IS DISTINCT FROM (d->>'tanka_id') THEN
            d := jsonb_set(d, '{tanka_id}', to_jsonb(v_new));
            v_changed := true;
          END IF;
        END IF;
        v_arr := v_arr || jsonb_build_array(d);
      END LOOP;
      IF v_changed THEN
        v_destinos := v_arr;
      END IF;
    END IF;

    v_changed := false;
    IF jsonb_typeof(v_origens) = 'array' THEN
      v_arr := '[]'::jsonb;
      FOR v_idx IN 0 .. greatest(jsonb_array_length(v_origens) - 1, -1)
      LOOP
        o := v_origens -> v_idx;
        IF coalesce(o->>'tipo_origem', '') = 'tanka'
           AND nullif(trim(both FROM coalesce(o->>'entrada_id', '')), '') IS NOT NULL THEN
          SELECT m.new_id::text INTO v_new
          FROM public._chemctrl_049_tanka_map m
          WHERE m.source = 'ISOTANQUE'
            AND m.old_id = trim(both FROM o->>'entrada_id')
            AND m.new_id IS NOT NULL
          LIMIT 1;
          IF v_new IS NOT NULL AND v_new IS DISTINCT FROM (o->>'entrada_id') THEN
            o := jsonb_set(o, '{entrada_id}', to_jsonb(v_new));
            v_changed := true;
          END IF;
        END IF;
        v_arr := v_arr || jsonb_build_array(o);
      END LOOP;
      IF v_changed THEN
        v_origens := v_arr;
      END IF;
    END IF;

    IF v_origens IS DISTINCT FROM coalesce(t.origens, '[]'::jsonb)
       OR v_destinos IS DISTINCT FROM coalesce(t.destinos, '[]'::jsonb) THEN
      UPDATE public.t_transbordos
      SET origens = v_origens, destinos = v_destinos
      WHERE id = t.id;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8) Relatório final
-- ---------------------------------------------------------------------------
INSERT INTO public._chemctrl_049_tanka_diag (metric, value_num)
SELECT 'cadastro_tanka_total', COUNT(*)::bigint FROM public.cadastro_tanka;

INSERT INTO public._chemctrl_049_tanka_diag (metric, value_num)
SELECT 'map_isotanque', COUNT(*)::bigint
FROM public._chemctrl_049_tanka_map WHERE source = 'ISOTANQUE';

INSERT INTO public._chemctrl_049_tanka_diag (metric, value_num)
SELECT 'map_ind', COUNT(*)::bigint
FROM public._chemctrl_049_tanka_map WHERE source = 'IND_TANKA';

INSERT INTO public._chemctrl_049_tanka_diag (metric, value_num)
SELECT 'conflicts', COUNT(*)::bigint
FROM public._chemctrl_049_tanka_report WHERE status = 'conflict_client';

INSERT INTO public._chemctrl_049_tanka_report (status, detail)
VALUES (
  'summary',
  (SELECT string_agg(metric || '=' || coalesce(value_num::text, '0'), ', ' ORDER BY id)
   FROM (
     SELECT DISTINCT ON (metric) metric, value_num, id
     FROM public._chemctrl_049_tanka_diag
     ORDER BY metric, id DESC
   ) x)
);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- Queries de verificação (rodar após apply):
--   SELECT * FROM _chemctrl_049_tanka_diag ORDER BY id DESC LIMIT 20;
--   SELECT status, count(*) FROM _chemctrl_049_tanka_map GROUP BY 1;
--   SELECT * FROM _chemctrl_049_tanka_report WHERE status LIKE 'conflict%' OR status LIKE 'blocked%';
--   SELECT id, codigo_itku, nome, cliente_nome FROM cadastro_tanka ORDER BY nome;
--
-- Recuperação (manual — NÃO dropa origem):
--   BEGIN;
--   UPDATE t_isotanques SET cadastro_tanka_id = NULL;
--   UPDATE ind_cadastro_tanka SET cadastro_tanka_id = NULL;
--   TRUNCATE public.cadastro_tanka CASCADE;
--   TRUNCATE public._chemctrl_049_tanka_map, public._chemctrl_049_tanka_report RESTART IDENTITY;
--   -- reaplicar este arquivo se necessário
--   COMMIT;
-- =============================================================================
