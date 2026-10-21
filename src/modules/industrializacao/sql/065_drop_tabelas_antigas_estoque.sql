-- 065_drop_tabelas_antigas_estoque.sql
-- Remove as vistas ep_* e as tabelas t_entradas, t_estoque e estoque_mp.
-- O estoque operacional fica somente em estoque_produtos.
-- Não apaga _entrada_id_map nem _entradas_sem_itens.
-- Depois deste script o rollback 062 não consegue mais devolver os dados.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.estoque_produtos') IS NULL THEN
    RAISE EXCEPTION 'estoque_produtos não existe. Nada foi apagado.';
  END IF;
END $$;

-- Consulta pública antiga deixa de ler t_entradas.
CREATE OR REPLACE FUNCTION get_public_entrada_info_legado(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NULL;
END;
$$;

-- Baixa de matéria-prima só em estoque_produtos.
CREATE OR REPLACE FUNCTION adjust_raw_material_stock(
  p_stock_id text,
  p_delta numeric,
  p_require_sufficient boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_entry text;
  v_before numeric;
  v_after numeric;
BEGIN
  IF p_stock_id IS NULL OR btrim(p_stock_id) = '' THEN
    RAISE EXCEPTION 'stock_id obrigatório' USING ERRCODE = '22023';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta inválido' USING ERRCODE = '22023';
  END IF;

  SELECT id, id_entrada, COALESCE(saldo_atual, 0)
    INTO v_id, v_entry, v_before
  FROM estoque_produtos
  WHERE origem = 'MATERIA_PRIMA'
    AND legacy_mp_id_text = p_stock_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estoque MP não encontrado: %', p_stock_id USING ERRCODE = 'P0002';
  END IF;

  v_after := round((v_before + p_delta)::numeric, 3);
  IF p_require_sufficient AND p_delta < 0 AND v_after < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente (disponível %, solicitado %)', v_before, abs(p_delta)
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_require_sufficient AND v_after < 0 THEN
    v_after := 0;
  END IF;

  UPDATE estoque_produtos
  SET saldo_atual = v_after
  WHERE id = v_id;

  RETURN jsonb_build_object(
    'id', p_stock_id,
    'entry_id', v_entry,
    'balance_before', v_before,
    'balance_after', v_after,
    'delta', p_delta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_raw_material_stock(text, numeric, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION optimistic_update_estoque_mp(
  p_id text,
  p_expected_updated timestamptz,
  p_current_stock numeric DEFAULT NULL,
  p_lot text DEFAULT NULL,
  p_status_wms text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estoque_produtos%ROWTYPE;
BEGIN
  UPDATE estoque_produtos
  SET
    saldo_atual = COALESCE(p_current_stock, saldo_atual),
    lote = COALESCE(p_lot, lote),
    status_wms = COALESCE(p_status_wms::boolean, status_wms)
  WHERE origem = 'MATERIA_PRIMA'
    AND legacy_mp_id_text = p_id
    AND updated_at IS NOT DISTINCT FROM p_expected_updated
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'conflict', false, 'row', to_jsonb(v_row));
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'conflict', true,
    'message', 'Estoque alterado por outro usuário. Recarregue e tente novamente.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION optimistic_update_estoque_mp(text, timestamptz, numeric, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_public_raw_material_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estoque_produtos%ROWTYPE;
BEGIN
  PERFORM enforce_public_rate_limit('get_public_raw_material_info');
  SELECT * INTO v_row
  FROM estoque_produtos
  WHERE origem = 'MATERIA_PRIMA' AND public_token = p_token
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'mp_code', COALESCE(v_row.mp_code, v_row.produto_codigo),
    'mp_name', v_row.produto_nome,
    'client', v_row.cliente_nome,
    'lot', v_row.lote,
    'unit', v_row.unidade_medida,
    'current_stock', v_row.saldo_atual
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_raw_material_info(text) TO anon, authenticated;

-- Saldo reservável de embalado passa a somar estoque_produtos.
CREATE OR REPLACE FUNCTION t_fisico_embalado(
  p_cliente_id uuid,
  p_cliente_nome text,
  p_produto_codigo text,
  p_lote text,
  p_unidade text
) RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_ids uuid[];
  v_total numeric := 0;
  v_unidade text := lower(trim(coalesce(nullif(p_unidade, ''), 'kg')));
BEGIN
  SELECT coalesce(array_agg(e.legacy_estoque_id), '{}')
    INTO v_ids
  FROM estoque_produtos e
  WHERE e.origem = 'ARMAZENAGEM'
    AND e.legacy_estoque_id IS NOT NULL
    AND (
      CASE
        WHEN coalesce(e.tipo_recebimento, '') IN ('embalado', 'vasilhame', 'granel')
          THEN e.tipo_recebimento = 'embalado'
        ELSE coalesce(e.embalado, false)
      END
    )
    AND t_norm_txt(e.produto_codigo) = t_norm_txt(p_produto_codigo)
    AND t_norm_txt(coalesce(e.lote, '')) = t_norm_txt(coalesce(p_lote, ''))
    AND lower(trim(coalesce(nullif(trim(e.unidade_medida), ''), 'kg'))) = v_unidade
    AND (
      (p_cliente_id IS NOT NULL AND e.cliente_id = p_cliente_id)
      OR (
        p_cliente_id IS NULL
        AND t_norm_txt(e.cliente_nome) = t_norm_txt(p_cliente_nome)
      )
    );

  IF coalesce(array_length(v_ids, 1), 0) > 0 THEN
    PERFORM 1
    FROM estoque_produtos
    WHERE legacy_estoque_id = ANY (v_ids)
    FOR UPDATE;
    SELECT coalesce(round(sum(coalesce(saldo_atual, 0))), 0)
      INTO v_total
    FROM estoque_produtos
    WHERE legacy_estoque_id = ANY (v_ids);
  END IF;

  RETURN coalesce(v_total, 0);
END;
$$;

DROP FUNCTION IF EXISTS t_estoque_eh_embalado(t_estoque);

-- O número de exibição (001, 002…) continua na mesma sequence,
-- agora atribuído em estoque_produtos. Sem isso o DROP de t_estoque
-- apagaria a sequence junto com a coluna.
CREATE SEQUENCE IF NOT EXISTS t_estoque_codigo_seq;

DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT GREATEST(
    COALESCE((SELECT MAX(codigo_estoque) FROM estoque_produtos), 0),
    COALESCE((
      SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END
      FROM t_estoque_codigo_seq
    ), 0)
  )
  INTO v_max;
  IF v_max > 0 THEN
    PERFORM setval('t_estoque_codigo_seq', v_max, true);
  END IF;
END $$;

ALTER SEQUENCE t_estoque_codigo_seq OWNED BY NONE;
ALTER SEQUENCE t_estoque_codigo_seq OWNED BY estoque_produtos.codigo_estoque;

CREATE OR REPLACE FUNCTION estoque_produtos_assign_codigo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.codigo_estoque IS NULL AND NEW.origem = 'ARMAZENAGEM' THEN
    NEW.codigo_estoque := nextval('t_estoque_codigo_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estoque_produtos_assign_codigo ON estoque_produtos;
CREATE TRIGGER trg_estoque_produtos_assign_codigo
  BEFORE INSERT ON estoque_produtos
  FOR EACH ROW
  EXECUTE FUNCTION estoque_produtos_assign_codigo();

CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_produtos_codigo_estoque
  ON estoque_produtos (codigo_estoque)
  WHERE codigo_estoque IS NOT NULL;

-- Vistas de compatibilidade e os gatilhos INSTEAD OF.
DROP VIEW IF EXISTS ep_entradas CASCADE;
DROP VIEW IF EXISTS ep_estoque CASCADE;
DROP VIEW IF EXISTS ep_mp CASCADE;

DROP FUNCTION IF EXISTS ep_entradas_insert();
DROP FUNCTION IF EXISTS ep_entradas_update();
DROP FUNCTION IF EXISTS ep_entradas_delete();
DROP FUNCTION IF EXISTS ep_estoque_insert();
DROP FUNCTION IF EXISTS ep_estoque_update();
DROP FUNCTION IF EXISTS ep_estoque_delete();
DROP FUNCTION IF EXISTS ep_mp_insert();
DROP FUNCTION IF EXISTS ep_mp_update();
DROP FUNCTION IF EXISTS ep_mp_delete();

-- Chaves estrangeiras que apontam para as tabelas antigas
-- (a coluna na tabela de origem permanece, só cai o vínculo).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT src.relname AS src_table, con.conname
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class dst ON dst.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
      AND dst.relname IN ('t_entradas', 't_estoque', 'estoque_mp')
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.src_table, r.conname);
  END LOOP;
END $$;

DROP TABLE IF EXISTS t_estoque;
DROP TABLE IF EXISTS t_entradas;
DROP TABLE IF EXISTS estoque_mp;

DROP FUNCTION IF EXISTS t_estoque_assign_codigo();

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
