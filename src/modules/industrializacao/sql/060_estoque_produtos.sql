-- =============================================================================
-- 060_estoque_produtos.sql
-- Unifica t_entradas + t_estoque + estoque_mp em estoque_produtos.
--
-- Não apaga nem reescreve as tabelas antigas.
-- Não migra espelhos de matéria-prima (origem industrializacao / INDMP:).
-- id_entrada novo: E1, E2, E3 (sem zeros à esquerda), sequência global.
-- O id operacional usado pelo app continua o UUID legado
-- (legacy_estoque_id / legacy_mp_id_text), para não reescrever JSONB.
-- Aplicar no SQL Editor do Supabase. Idempotente.
-- =============================================================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS entrada_global_seq AS bigint START WITH 1;

CREATE OR REPLACE FUNCTION next_entrada_id()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'E' || nextval('entrada_global_seq')::text;
END;
$$;

GRANT EXECUTE ON FUNCTION next_entrada_id() TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE entrada_global_seq TO anon, authenticated;

CREATE OR REPLACE FUNCTION ep_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_value)::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION ep_as_jsonb(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_value) = 'string' THEN
    BEGIN
      RETURN (p_value #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN '[]'::jsonb;
    END;
  END IF;
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION ep_lote_item(p_lotes jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(coalesce(p_lotes, 'null'::jsonb)) = 'array'
         AND jsonb_array_length(p_lotes) > 0
      THEN p_lotes -> 0
    WHEN jsonb_typeof(p_lotes) = 'object' THEN p_lotes
    ELSE '{}'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION ep_txt(p_item jsonb, p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(p_item ->> p_key), '');
$$;

CREATE OR REPLACE FUNCTION ep_num(p_item jsonb, p_key text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN ep_txt(p_item, p_key) ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN ep_txt(p_item, p_key)::numeric
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION ep_bool(p_item jsonb, p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(ep_txt(p_item, p_key), ''))
    WHEN 'true' THEN true
    WHEN 't' THEN true
    WHEN '1' THEN true
    WHEN 'false' THEN false
    WHEN 'f' THEN false
    WHEN '0' THEN false
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION ep_origem(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(btrim(coalesce(p_value, ''))) IN ('MATERIA_PRIMA', 'INDUSTRIALIZACAO')
      THEN 'MATERIA_PRIMA'
    ELSE 'ARMAZENAGEM'
  END
$$;

CREATE OR REPLACE FUNCTION ep_eh_espelho_mp(p_origem text, p_grupo text, p_lotes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_origem, '') = 'industrializacao'
    OR coalesce(p_grupo, '') LIKE 'INDMP:%'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(coalesce(p_lotes, '[]'::jsonb)) = 'array'
            THEN coalesce(p_lotes, '[]'::jsonb)
          ELSE '[]'::jsonb
        END
      ) AS lote
      WHERE nullif(lote->>'ind_mp_id', '') IS NOT NULL
    );
$$;

CREATE TABLE IF NOT EXISTS estoque_produtos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_entrada text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('MATERIA_PRIMA', 'ARMAZENAGEM')),
  produto_id uuid,
  produto_nome text NOT NULL,
  produto_codigo text,
  mp_code text,
  cliente_id uuid,
  cliente_nome text,
  data date NOT NULL DEFAULT current_date,
  nota_fiscal text,
  nota_fiscal_troca text,
  lote text,
  densidade text,
  data_fabricacao date,
  data_validade date,
  fornecedor text,
  quantidade numeric NOT NULL DEFAULT 0,
  initial_stock numeric,
  unidade_medida text NOT NULL DEFAULT 'kg',
  preco_unitario numeric,
  custo_total numeric,
  saldo_atual numeric NOT NULL DEFAULT 0,
  embalado boolean NOT NULL DEFAULT false,
  peso_liquido numeric,
  peso_bruto numeric,
  quantidade_embalagens numeric,
  quantidade_nf numeric,
  quantidade_declarada numeric,
  tipo_recebimento text,
  tipo_embalagem text,
  placa text,
  barril text,
  volume numeric,
  tara numeric,
  lacres text,
  eslinga text,
  gps text,
  menor_teste text,
  fracionado boolean NOT NULL DEFAULT false,
  vasilhame_id uuid,
  vasilhame_existente_id uuid,
  status_wms boolean NOT NULL DEFAULT false,
  status text,
  granel_pesagem boolean NOT NULL DEFAULT false,
  granel_ticket text,
  granel_peso_bruto numeric,
  granel_validacao_bruto numeric,
  granel_peso_liquido numeric,
  granel_validacao_liquido numeric,
  granel_erro_admissivel numeric,
  granel_peso_minimo numeric,
  granel_peso_maximo numeric,
  granel_margem text CHECK (granel_margem IS NULL OR granel_margem IN ('dentro', 'fora')),
  tank_storage boolean,
  tank_entries jsonb,
  packaging_type text,
  packaging_capacity numeric,
  packaging_quantity numeric,
  observations text,
  comunicacao_enviada boolean NOT NULL DEFAULT false,
  public_token text,
  public_token_entrada text,
  legacy_estoque_id uuid,
  legacy_entrada_id uuid,
  legacy_mp_id uuid,
  legacy_mp_id_text text,
  legacy_entrada_codigo text,
  legacy_mp_entry_id text,
  grupo_entrada text,
  codigo_estoque integer,
  created_by_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estoque_produtos_id_entrada ON estoque_produtos (id_entrada);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_origem ON estoque_produtos (origem);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_cliente ON estoque_produtos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_produto ON estoque_produtos (produto_id);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_lote ON estoque_produtos (lote);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_data ON estoque_produtos (data DESC);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_saldo ON estoque_produtos (saldo_atual);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_legacy_estoque ON estoque_produtos (legacy_estoque_id);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_legacy_entrada ON estoque_produtos (legacy_entrada_id);
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_legacy_mp_text ON estoque_produtos (legacy_mp_id_text);
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_produtos_legacy_estoque
  ON estoque_produtos (legacy_estoque_id) WHERE legacy_estoque_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_produtos_legacy_mp_text
  ON estoque_produtos (legacy_mp_id_text) WHERE legacy_mp_id_text IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_produtos_public_token
  ON estoque_produtos (public_token) WHERE public_token IS NOT NULL AND btrim(public_token) <> '';
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_token_entrada
  ON estoque_produtos (public_token_entrada) WHERE public_token_entrada IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estoque_produtos_placa
  ON estoque_produtos (placa) WHERE placa IS NOT NULL;

CREATE TABLE IF NOT EXISTS _entrada_id_map (
  novo_id_entrada text PRIMARY KEY,
  legacy_t_entradas_id uuid,
  legacy_entrada_uuid uuid,
  legacy_estoque_id uuid,
  legacy_entrada_codigo text,
  legacy_mp_entry_id text,
  legacy_mp_uuid uuid,
  legacy_mp_id_text text,
  origem text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS _entradas_sem_itens (
  entrada_id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  motivo text NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE estoque_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE _entrada_id_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE _entradas_sem_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_produtos_all ON estoque_produtos;
CREATE POLICY estoque_produtos_all ON estoque_produtos
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION estoque_produtos_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estoque_produtos_updated_at ON estoque_produtos;
CREATE TRIGGER trg_estoque_produtos_updated_at
  BEFORE UPDATE ON estoque_produtos
  FOR EACH ROW EXECUTE FUNCTION estoque_produtos_set_updated_at();

-- ---------------------------------------------------------------------------
-- Migração de dados (não duplica linhas já importadas)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_max bigint;
BEGIN
  IF to_regclass('public.t_entradas') IS NULL
     OR to_regclass('public.t_estoque') IS NULL THEN
    RAISE NOTICE '060: t_entradas/t_estoque ausentes. Carga de armazenagem ignorada.';
  ELSE
    -- 052 já prevê o token. Só cria a coluna se o ambiente ainda não rodou essa migration.
    ALTER TABLE t_entradas ADD COLUMN IF NOT EXISTS public_token text;
    INSERT INTO _entradas_sem_itens (entrada_id, payload, motivo)
    SELECT en.id, to_jsonb(en), 'sem_itens_armazenagem'
    FROM t_entradas en
    WHERE coalesce(en.origem, 'convencional') <> 'industrializacao'
      AND NOT EXISTS (
        SELECT 1 FROM t_estoque s
        WHERE s.entrada_id = en.id
          AND NOT ep_eh_espelho_mp(s.origem, s.grupo_entrada, s.lotes)
      )
    ON CONFLICT (entrada_id) DO NOTHING;

    INSERT INTO _entradas_sem_itens (entrada_id, payload, motivo)
    SELECT en.id, to_jsonb(en), 'espelho_materia_prima'
    FROM t_entradas en
    WHERE en.origem = 'industrializacao'
    ON CONFLICT (entrada_id) DO NOTHING;

    CREATE TEMP TABLE _ep_eventos (
      ts timestamptz,
      chave text,
      tipo text,
      entrada_id uuid,
      estoque_id uuid,
      mp_id text,
      codigo_antigo text
    ) ON COMMIT DROP;

    INSERT INTO _ep_eventos (ts, chave, tipo, entrada_id, codigo_antigo)
    SELECT
      en.created_at,
      'EN:' || en.id::text,
      'ARMAZENAGEM',
      en.id,
      (
        SELECT s.entrada_codigo
        FROM t_estoque s
        WHERE s.entrada_id = en.id
          AND NOT ep_eh_espelho_mp(s.origem, s.grupo_entrada, s.lotes)
          AND nullif(btrim(coalesce(s.entrada_codigo, '')), '') IS NOT NULL
        ORDER BY s.created_at
        LIMIT 1
      )
    FROM t_entradas en
    WHERE coalesce(en.origem, 'convencional') <> 'industrializacao'
      AND EXISTS (
        SELECT 1 FROM t_estoque s
        WHERE s.entrada_id = en.id
          AND NOT ep_eh_espelho_mp(s.origem, s.grupo_entrada, s.lotes)
      );

    INSERT INTO _ep_eventos (ts, chave, tipo, estoque_id, codigo_antigo)
    SELECT
      s.created_at,
      'ES:' || s.id::text,
      'ARMAZENAGEM',
      s.id,
      s.entrada_codigo
    FROM t_estoque s
    WHERE NOT ep_eh_espelho_mp(s.origem, s.grupo_entrada, s.lotes)
      AND (
        s.entrada_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM t_entradas en WHERE en.id = s.entrada_id)
      );

    IF to_regclass('public.estoque_mp') IS NOT NULL THEN
      INSERT INTO _ep_eventos (ts, chave, tipo, mp_id)
      SELECT
        COALESCE(
          NULLIF(to_jsonb(m)->>'created_date', '')::timestamptz,
          NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
          now()
        ),
        'MP:' || m.id::text,
        'MATERIA_PRIMA',
        m.id::text
      FROM estoque_mp m;
    END IF;

    INSERT INTO _entrada_id_map (
      novo_id_entrada,
      legacy_t_entradas_id,
      legacy_entrada_uuid,
      legacy_estoque_id,
      legacy_entrada_codigo,
      legacy_mp_id_text,
      origem
    )
    SELECT
      'E' || (base.max_n + ev.rn)::text,
      ev.entrada_id,
      COALESCE(ev.entrada_id, gen_random_uuid()),
      ev.estoque_id,
      ev.codigo_antigo,
      ev.mp_id,
      ev.tipo
    FROM (
      SELECT
        ev.*,
        row_number() OVER (ORDER BY ev.ts NULLS LAST, ev.chave) AS rn
      FROM _ep_eventos ev
      WHERE NOT EXISTS (
        SELECT 1
        FROM _entrada_id_map m
        WHERE (ev.entrada_id IS NOT NULL AND ev.estoque_id IS NULL AND ev.mp_id IS NULL
               AND m.legacy_t_entradas_id = ev.entrada_id)
           OR (ev.estoque_id IS NOT NULL AND m.legacy_estoque_id = ev.estoque_id)
           OR (ev.mp_id IS NOT NULL AND m.legacy_mp_id_text = ev.mp_id)
      )
    ) ev
    CROSS JOIN (
      SELECT COALESCE(MAX(substring(novo_id_entrada FROM '^E([0-9]+)$')::bigint), 0) AS max_n
      FROM _entrada_id_map
    ) base
    ON CONFLICT (novo_id_entrada) DO NOTHING;

    INSERT INTO estoque_produtos (
      id_entrada, origem, produto_id, produto_nome, produto_codigo,
      cliente_id, cliente_nome, data, nota_fiscal, nota_fiscal_troca,
      lote, densidade, data_fabricacao, data_validade, fornecedor,
      quantidade, initial_stock, unidade_medida, preco_unitario, custo_total,
      saldo_atual, embalado, peso_liquido, peso_bruto, quantidade_embalagens,
      quantidade_nf, quantidade_declarada, tipo_recebimento, tipo_embalagem,
      placa, barril, volume, tara, lacres, eslinga, gps, menor_teste,
      fracionado, vasilhame_id, vasilhame_existente_id,
      status_wms, granel_pesagem, granel_ticket, granel_peso_bruto,
      granel_validacao_bruto, granel_peso_liquido, granel_validacao_liquido,
      granel_erro_admissivel, granel_peso_minimo, granel_peso_maximo, granel_margem,
      comunicacao_enviada, public_token_entrada,
      legacy_estoque_id, legacy_entrada_id, legacy_entrada_codigo,
      grupo_entrada, codigo_estoque, created_at, updated_at
    )
    SELECT
      map.novo_id_entrada,
      'ARMAZENAGEM',
      s.produto_id,
      COALESCE(NULLIF(btrim(s.produto_nome), ''), 'Produto sem nome'),
      s.produto_codigo,
      s.cliente_id,
      s.cliente_nome,
      COALESCE(en.data, s.created_at::date, current_date),
      s.nota_fiscal,
      s.nota_fiscal_troca,
      s.lote,
      s.densidade,
      s.data_fabricacao,
      s.data_validade,
      en.fornecedor,
      COALESCE(s.quantidade, 0),
      COALESCE(s.quantidade, 0),
      COALESCE(NULLIF(btrim(s.unidade_medida), ''), 'kg'),
      s.preco_unitario,
      s.custo_total,
      COALESCE(s.saldo_atual, 0),
      COALESCE(ep_bool(li.item, 'embalado'), s.embalado, false),
      COALESCE(s.peso_liquido, ep_num(li.item, 'peso_liquido')),
      ep_num(li.item, 'peso_bruto'),
      COALESCE(s.quantidade_embalagens, ep_num(li.item, 'quantidade_embalagens')),
      ep_num(li.item, 'quantidade_nf'),
      ep_num(li.item, 'quantidade_declarada'),
      ep_txt(li.item, 'tipo_recebimento'),
      ep_txt(li.item, 'tipo_embalagem'),
      ep_txt(li.item, 'placa'),
      ep_txt(li.item, 'barril'),
      ep_num(li.item, 'volume'),
      ep_num(li.item, 'tara'),
      ep_txt(li.item, 'lacres'),
      ep_txt(li.item, 'eslinga'),
      ep_txt(li.item, 'gps'),
      ep_txt(li.item, 'menor_teste'),
      COALESCE(ep_bool(li.item, 'fracionado'), false),
      ep_uuid(li.item ->> 'vasilhame_id'),
      ep_uuid(li.item ->> 'vasilhame_existente_id'),
      COALESCE(s.status_wms, false),
      COALESCE(s.granel_pesagem, en.granel_pesagem, false),
      COALESCE(s.granel_ticket, en.granel_ticket),
      COALESCE(s.granel_peso_bruto, en.granel_peso_bruto),
      COALESCE(s.granel_validacao_bruto, en.granel_validacao_bruto),
      COALESCE(s.granel_peso_liquido, en.granel_peso_liquido),
      COALESCE(s.granel_validacao_liquido, en.granel_validacao_liquido),
      COALESCE(s.granel_erro_admissivel, en.granel_erro_admissivel),
      COALESCE(s.granel_peso_minimo, en.granel_peso_minimo),
      COALESCE(s.granel_peso_maximo, en.granel_peso_maximo),
      COALESCE(s.granel_margem, en.granel_margem),
      COALESCE(en.comunicacao_enviada, false),
      en.public_token,
      s.id,
      COALESCE(s.entrada_id, map.legacy_entrada_uuid),
      s.entrada_codigo,
      s.grupo_entrada,
      s.codigo_estoque,
      s.created_at,
      s.updated_at
    FROM t_estoque s
    JOIN _entrada_id_map map
      ON (
        s.entrada_id IS NOT NULL
        AND map.legacy_t_entradas_id = s.entrada_id
        AND map.origem = 'ARMAZENAGEM'
      )
      OR map.legacy_estoque_id = s.id
    LEFT JOIN t_entradas en ON en.id = s.entrada_id
    LEFT JOIN LATERAL (SELECT ep_lote_item(s.lotes) AS item) li ON true
    WHERE NOT ep_eh_espelho_mp(s.origem, s.grupo_entrada, s.lotes)
      AND NOT EXISTS (
        SELECT 1 FROM estoque_produtos ep WHERE ep.legacy_estoque_id = s.id
      );
  END IF;

  IF to_regclass('public.estoque_mp') IS NOT NULL THEN
    INSERT INTO estoque_produtos (
      id_entrada, origem, produto_nome, produto_codigo, mp_code,
      cliente_nome, data, nota_fiscal, lote, densidade,
      data_fabricacao, data_validade, fornecedor,
      quantidade, initial_stock, unidade_medida, preco_unitario,
      saldo_atual, status, status_wms, observations,
      tank_storage, tank_entries, packaging_type, packaging_capacity, packaging_quantity,
      public_token,
      legacy_entrada_id, legacy_mp_id, legacy_mp_id_text, legacy_mp_entry_id,
      created_by_id, created_at, updated_at
    )
    SELECT
      map.novo_id_entrada,
      'MATERIA_PRIMA',
      COALESCE(NULLIF(btrim(m.mp_name), ''), 'Matéria-prima sem nome'),
      m.mp_code,
      m.mp_code,
      m.client,
      COALESCE(m.entry_date, current_date),
      m.nota_fiscal,
      m.lot,
      CASE WHEN m.density IS NULL THEN NULL ELSE m.density::text END,
      m.manufacture_date,
      m.expiry_date,
      m.supplier,
      COALESCE(m.initial_stock, m.current_stock, 0),
      m.initial_stock,
      COALESCE(NULLIF(btrim(m.unit), ''), 'kg'),
      m.unit_price,
      COALESCE(m.current_stock, 0),
      m.status,
      COALESCE(m.status_wms, false),
      m.observations,
      m.tank_storage,
      m.tank_entries,
      m.packaging_type,
      m.packaging_capacity,
      m.packaging_quantity,
      m.public_token,
      map.legacy_entrada_uuid,
      ep_uuid(m.id::text),
      m.id::text,
      m.entry_id,
      m.created_by_id,
      COALESCE(
        NULLIF(to_jsonb(m)->>'created_date', '')::timestamptz,
        NULLIF(to_jsonb(m)->>'created_at', '')::timestamptz,
        now()
      ),
      COALESCE(
        NULLIF(to_jsonb(m)->>'updated_date', '')::timestamptz,
        NULLIF(to_jsonb(m)->>'updated_at', '')::timestamptz,
        now()
      )
    FROM estoque_mp m
    JOIN _entrada_id_map map
      ON map.legacy_mp_id_text = m.id::text
     AND map.origem = 'MATERIA_PRIMA'
    WHERE NOT EXISTS (
      SELECT 1 FROM estoque_produtos ep WHERE ep.legacy_mp_id_text = m.id::text
    );

    UPDATE _entrada_id_map map
    SET legacy_mp_entry_id = m.entry_id,
        legacy_mp_uuid = ep_uuid(m.id::text)
    FROM estoque_mp m
    WHERE map.legacy_mp_id_text = m.id::text
      AND map.origem = 'MATERIA_PRIMA';
  END IF;

  SELECT MAX((regexp_match(id_entrada, '^E([0-9]+)$'))[1]::bigint)
    INTO v_max
  FROM estoque_produtos
  WHERE id_entrada ~ '^E[0-9]+$';

  IF v_max IS NULL OR v_max < 1 THEN
    PERFORM setval('entrada_global_seq', 1, false);
  ELSE
    PERFORM setval('entrada_global_seq', v_max, true);
  END IF;
END $$;

-- movimentos: referência nova, sem remover stock_id
DO $$
BEGIN
  IF to_regclass('public.ind_retornos_perdas') IS NOT NULL THEN
    ALTER TABLE ind_retornos_perdas ADD COLUMN IF NOT EXISTS stock_produto_id bigint;
    UPDATE ind_retornos_perdas mov
    SET stock_produto_id = ep.id
    FROM estoque_produtos ep
    WHERE mov.stock_produto_id IS NULL
      AND ep.origem = 'MATERIA_PRIMA'
      AND ep.legacy_mp_id_text = mov.stock_id::text;
  END IF;
END $$;

COMMIT;
