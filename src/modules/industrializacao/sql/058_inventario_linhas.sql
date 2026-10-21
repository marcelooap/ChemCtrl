-- =============================================================================
-- 058_inventario_linhas.sql
-- inventario: 1 produto por linha.
-- O cabeçalho (número, datas, responsáveis, filtros clients/products/lots,
-- status) se repete. inventario_id agrupa as linhas do mesmo inventário e
-- pode se repetir. A coluna item é o produto daquela linha.
-- Conferência da linha: physical_packages, fractional_qty, physical_total,
-- difference, difference_pct, mais o snapshot do estoque.
-- items (jsonb) fica nulo depois da conversão.
--
-- Se a 057 ainda não rodou, este script também renomeia
-- ind_lista_inventario → inventario.
-- Idempotente. Não faz DROP/TRUNCATE de dados de negócio.
-- Aplicar junto com o app que agrupa as linhas (inventoryComposition.js).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.inventario') IS NOT NULL
     AND to_regclass('public.ind_lista_inventario') IS NOT NULL THEN
    RAISE EXCEPTION 'inventario e ind_lista_inventario existem ao mesmo tempo. Mantenha só a tabela com os dados.';
  END IF;

  IF to_regclass('public.inventario') IS NULL
     AND to_regclass('public.ind_lista_inventario') IS NOT NULL THEN
    ALTER TABLE public.ind_lista_inventario RENAME TO inventario;
  ELSIF to_regclass('public.inventario') IS NULL THEN
    RAISE EXCEPTION '058: tabela inventario nao encontrada';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_ind_lista_inventario_status') IS NOT NULL
     AND to_regclass('public.idx_inventario_status') IS NULL THEN
    ALTER INDEX public.idx_ind_lista_inventario_status
      RENAME TO idx_inventario_status;
  ELSIF to_regclass('public.idx_inventories_status') IS NOT NULL
     AND to_regclass('public.idx_inventario_status') IS NULL THEN
    ALTER INDEX public.idx_inventories_status
      RENAME TO idx_inventario_status;
  END IF;

  IF to_regclass('public.idx_ind_lista_inventario_inventory_number') IS NOT NULL
     AND to_regclass('public.idx_inventario_inventory_number') IS NULL THEN
    ALTER INDEX public.idx_ind_lista_inventario_inventory_number
      RENAME TO idx_inventario_inventory_number;
  ELSIF to_regclass('public.idx_inventories_inventory_number') IS NOT NULL
     AND to_regclass('public.idx_inventario_inventory_number') IS NULL THEN
    ALTER INDEX public.idx_inventories_inventory_number
      RENAME TO idx_inventario_inventory_number;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_ind_lista_inventario'
      AND tgrelid = 'public.inventario'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_ind_lista_inventario ON public.inventario
      RENAME TO update_updated_date_inventario;
  ELSIF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_updated_date_inventories'
      AND tgrelid = 'public.inventario'::regclass
      AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER update_updated_date_inventories ON public.inventario
      RENAME TO update_updated_date_inventario;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventario'
      AND policyname = 'allow_all_ind_lista_inventario'
  ) THEN
    ALTER POLICY "allow_all_ind_lista_inventario" ON public.inventario
      RENAME TO "allow_all_inventario";
  ELSIF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventario'
      AND policyname = 'allow_all_inventories'
  ) THEN
    ALTER POLICY "allow_all_inventories" ON public.inventario
      RENAME TO "allow_all_inventario";
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public._chemctrl_058_inventario_backup') IS NULL THEN
    CREATE TABLE public._chemctrl_058_inventario_backup AS
    SELECT * FROM public.inventario;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public._chemctrl_058_inventario_report (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source_id text,
  inventory_number text,
  status text NOT NULL,
  detail text,
  item_count integer
);

CREATE OR REPLACE FUNCTION public.inventario_parse_items(p_raw jsonb)
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

CREATE OR REPLACE FUNCTION public.inventario_to_numeric(p_text text)
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

ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS inventario_id text;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS linha_ordem integer NOT NULL DEFAULT 1;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS stock_id text;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS item text;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS client text;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS lot text;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS packaging_type text;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS packaging_capacity numeric;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS registered_stock numeric;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS registered_quantity numeric;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS physical_packages numeric;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS fractional_qty numeric;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS physical_total numeric;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS difference numeric;
ALTER TABLE public.inventario ADD COLUMN IF NOT EXISTS difference_pct numeric;

DO $$
DECLARE
  r record;
  v_items jsonb;
  v_elem jsonb;
  v_count integer;
  v_idx integer;
  v_first boolean;
  v_new_id text;
  v_already boolean;
  v_item_name text;
  v_client text;
  v_lot text;
  v_unit text;
  v_packaging_type text;
  v_stock_id text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.inventario WHERE inventario_id IS NOT NULL LIMIT 1
  ) INTO v_already;

  IF v_already THEN
    INSERT INTO public._chemctrl_058_inventario_report (source_id, status, detail)
    VALUES (NULL, 'skipped_already_converted', 'inventario_id ja preenchido');
    RETURN;
  END IF;

  FOR r IN
    SELECT *
    FROM public._chemctrl_058_inventario_backup
    ORDER BY created_date ASC NULLS LAST, id ASC
  LOOP
    SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(public.inventario_parse_items(r.items))
      WITH ORDINALITY AS t(elem, ord)
    WHERE nullif(trim(both FROM coalesce(elem->>'stock_id', '')), '') IS NOT NULL
       OR coalesce(
            nullif(trim(both FROM coalesce(elem->>'product', '')), ''),
            nullif(trim(both FROM coalesce(elem->>'item', '')), '')
          ) IS NOT NULL
       OR nullif(trim(both FROM coalesce(elem->>'lot', '')), '') IS NOT NULL
       OR nullif(trim(both FROM coalesce(elem->>'client', '')), '') IS NOT NULL;

    v_count := COALESCE(jsonb_array_length(v_items), 0);

    IF v_count = 0 THEN
      UPDATE public.inventario
      SET
        inventario_id = r.id,
        linha_ordem = 1,
        stock_id = NULL,
        item = NULL,
        client = NULL,
        product = NULL,
        lot = NULL,
        unit = NULL,
        packaging_type = NULL,
        packaging_capacity = NULL,
        registered_stock = NULL,
        registered_quantity = NULL,
        physical_packages = NULL,
        fractional_qty = NULL,
        physical_total = NULL,
        difference = NULL,
        difference_pct = NULL,
        clients = NULL,
        products = NULL,
        lots = NULL,
        items = NULL,
        updated_date = now()
      WHERE id = r.id;

      INSERT INTO public._chemctrl_058_inventario_report (source_id, inventory_number, status, detail, item_count)
      VALUES (r.id, r.inventory_number, 'converted_no_items', 'Linha mantida sem produto', 0);
      CONTINUE;
    END IF;

    v_first := true;
    v_idx := 0;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_idx := v_idx + 1;
      v_item_name := coalesce(
        nullif(trim(both FROM coalesce(v_elem->>'product', '')), ''),
        nullif(trim(both FROM coalesce(v_elem->>'item', '')), '')
      );
      v_client := nullif(trim(both FROM coalesce(v_elem->>'client', '')), '');
      v_lot := nullif(trim(both FROM coalesce(v_elem->>'lot', '')), '');
      v_unit := coalesce(nullif(trim(both FROM coalesce(v_elem->>'unit', '')), ''), 'kg');
      v_packaging_type := nullif(trim(both FROM coalesce(v_elem->>'packaging_type', '')), '');
      v_stock_id := nullif(trim(both FROM coalesce(v_elem->>'stock_id', '')), '');

      IF v_first THEN
        UPDATE public.inventario
        SET
          inventario_id = r.id,
          linha_ordem = v_idx,
          stock_id = v_stock_id,
          item = v_item_name,
          client = v_client,
          product = v_item_name,
          lot = v_lot,
          unit = v_unit,
          packaging_type = v_packaging_type,
          packaging_capacity = public.inventario_to_numeric(v_elem->>'packaging_capacity'),
          registered_stock = public.inventario_to_numeric(v_elem->>'registered_stock'),
          registered_quantity = public.inventario_to_numeric(v_elem->>'registered_quantity'),
          physical_packages = coalesce(public.inventario_to_numeric(v_elem->>'physical_packages'), 0),
          fractional_qty = coalesce(public.inventario_to_numeric(v_elem->>'fractional_qty'), 0),
          physical_total = coalesce(public.inventario_to_numeric(v_elem->>'physical_total'), 0),
          difference = coalesce(public.inventario_to_numeric(v_elem->>'difference'), 0),
          difference_pct = coalesce(public.inventario_to_numeric(v_elem->>'difference_pct'), 0),
          clients = v_client,
          products = v_item_name,
          lots = v_lot,
          items = NULL,
          updated_date = now()
        WHERE id = r.id;
        v_first := false;
      ELSE
        v_new_id := gen_random_uuid()::text;
        INSERT INTO public.inventario (
          id, created_date, updated_date, created_by_id,
          inventory_number, opening_date, start_date, closing_date,
          opened_by, started_by, closed_by,
          clients, products, lots, status, items,
          inventario_id, linha_ordem,
          stock_id, item, client, product, lot, unit, packaging_type,
          packaging_capacity, registered_stock, registered_quantity,
          physical_packages, fractional_qty, physical_total,
          difference, difference_pct
        ) VALUES (
          v_new_id, r.created_date, now(), r.created_by_id,
          r.inventory_number, r.opening_date, r.start_date, r.closing_date,
          r.opened_by, r.started_by, r.closed_by,
          v_client, v_item_name, v_lot, r.status, NULL,
          r.id, v_idx,
          v_stock_id, v_item_name, v_client, v_item_name, v_lot, v_unit, v_packaging_type,
          public.inventario_to_numeric(v_elem->>'packaging_capacity'),
          public.inventario_to_numeric(v_elem->>'registered_stock'),
          public.inventario_to_numeric(v_elem->>'registered_quantity'),
          coalesce(public.inventario_to_numeric(v_elem->>'physical_packages'), 0),
          coalesce(public.inventario_to_numeric(v_elem->>'fractional_qty'), 0),
          coalesce(public.inventario_to_numeric(v_elem->>'physical_total'), 0),
          coalesce(public.inventario_to_numeric(v_elem->>'difference'), 0),
          coalesce(public.inventario_to_numeric(v_elem->>'difference_pct'), 0)
        );
      END IF;
    END LOOP;

    INSERT INTO public._chemctrl_058_inventario_report (source_id, inventory_number, status, detail, item_count)
    VALUES (r.id, r.inventory_number, 'converted', 'OK', v_count);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.inventario WHERE inventario_id IS NULL) THEN
    RAISE EXCEPTION '058: existem linhas sem inventario_id';
  END IF;
END $$;

ALTER TABLE public.inventario ALTER COLUMN inventario_id SET NOT NULL;

COMMENT ON COLUMN public.inventario.inventario_id IS 'Agrupa os produtos de um mesmo inventario. Igual em todas as linhas; pode se repetir.';
COMMENT ON COLUMN public.inventario.linha_ordem IS 'Ordem do produto dentro do inventario.';
COMMENT ON COLUMN public.inventario.item IS 'Produto desta linha. Um produto por linha.';
COMMENT ON COLUMN public.inventario.product IS 'Mesmo valor de item. Mantido para a conferencia e o PDF.';
COMMENT ON COLUMN public.inventario.clients IS 'Cliente desta linha. Um valor, sem lista.';
COMMENT ON COLUMN public.inventario.products IS 'Produto desta linha. Um produto por linha.';
COMMENT ON COLUMN public.inventario.lots IS 'Lote desta linha. Outro lote do mesmo produto fica em outra linha.';
COMMENT ON COLUMN public.inventario.items IS 'Legado. Apos a 058 fica nulo; cada produto e uma linha.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_id_ordem
  ON public.inventario (inventario_id, linha_ordem);

CREATE INDEX IF NOT EXISTS idx_inventario_inventario_id
  ON public.inventario (inventario_id);

CREATE INDEX IF NOT EXISTS idx_inventario_item
  ON public.inventario (item);

-- Um item com vários lotes vira um elemento por lote.
CREATE OR REPLACE FUNCTION public.inventario_line_lots(p_elem jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw jsonb;
  v_txt text;
  v_parsed jsonb;
BEGIN
  IF p_elem IS NULL OR jsonb_typeof(p_elem) <> 'object' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_raw := p_elem->'lots';
  IF v_raw IS NULL OR v_raw = 'null'::jsonb OR v_raw = '[]'::jsonb THEN
    v_raw := p_elem->'lot';
  END IF;
  IF v_raw IS NULL OR v_raw = 'null'::jsonb THEN
    RETURN '[]'::jsonb;
  END IF;

  IF jsonb_typeof(v_raw) = 'array' THEN
    RETURN v_raw;
  END IF;

  IF jsonb_typeof(v_raw) = 'string' THEN
    v_txt := trim(both FROM (v_raw #>> '{}'));
    IF v_txt IS NULL OR v_txt = '' OR v_txt = 'TODOS' THEN
      RETURN '[]'::jsonb;
    END IF;
    IF left(v_txt, 1) = '[' THEN
      BEGIN
        v_parsed := v_txt::jsonb;
        IF jsonb_typeof(v_parsed) = 'array' THEN
          RETURN v_parsed;
        END IF;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
    RETURN jsonb_build_array(v_txt);
  END IF;

  RETURN '[]'::jsonb;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: grava 1 linha por produto e, se houver vários lotes, 1 linha por lote.
-- clients, products e lots recebem só o valor daquela linha.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventario_salvar(
  p_inventario_id text,
  p_header jsonb,
  p_items jsonb,
  p_mode text DEFAULT 'replace'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode text := lower(trim(both FROM coalesce(p_mode, 'replace')));
  v_inventario_id text := nullif(trim(both FROM coalesce(p_inventario_id, '')), '');
  v_items jsonb;
  v_elem jsonb;
  v_idx integer := 0;
  v_anchor_id text;
  v_new_id text;
  v_ids text[] := '{}';
  v_created_date timestamptz;
  v_created_by_id text;
  v_inventory_number text;
  v_opening_date timestamptz;
  v_start_date timestamptz;
  v_closing_date timestamptz;
  v_opened_by text;
  v_started_by text;
  v_closed_by text;
  v_status text;
  v_item_name text;
  v_client text;
  v_lot text;
  v_unit text;
  v_packaging_type text;
  v_stock_id text;
BEGIN
  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object' THEN
    RAISE EXCEPTION 'p_header deve ser um objeto JSON';
  END IF;

  v_items := inventario_parse_items(p_items);
  SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(elem, ord)
  WHERE nullif(trim(both FROM coalesce(elem->>'stock_id', '')), '') IS NOT NULL
     OR coalesce(
          nullif(trim(both FROM coalesce(elem->>'product', '')), ''),
          nullif(trim(both FROM coalesce(elem->>'item', '')), '')
        ) IS NOT NULL
     OR nullif(trim(both FROM coalesce(elem->>'lot', '')), '') IS NOT NULL
     OR nullif(trim(both FROM coalesce(elem->>'client', '')), '') IS NOT NULL;

  SELECT COALESCE(jsonb_agg(expanded ORDER BY ord, lot_ord), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      t.ord,
      COALESCE(l.lot_ord, 1) AS lot_ord,
      CASE
        WHEN l.lot_txt IS NULL THEN t.elem
        ELSE jsonb_set(t.elem, '{lot}', to_jsonb(l.lot_txt), true)
      END AS expanded
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(elem, ord)
    LEFT JOIN LATERAL (
      SELECT nullif(btrim(lot_elem), '') AS lot_txt, lot_ord
      FROM jsonb_array_elements_text(public.inventario_line_lots(t.elem))
        WITH ORDINALITY AS x(lot_elem, lot_ord)
    ) l ON true
  ) expanded_lines;

  v_inventory_number := nullif(trim(both FROM coalesce(p_header->>'inventory_number', '')), '');
  v_opened_by := nullif(trim(both FROM coalesce(p_header->>'opened_by', '')), '');
  v_started_by := nullif(trim(both FROM coalesce(p_header->>'started_by', '')), '');
  v_closed_by := nullif(trim(both FROM coalesce(p_header->>'closed_by', '')), '');
  v_status := coalesce(nullif(trim(both FROM coalesce(p_header->>'status', '')), ''), 'Aberto');
  v_created_by_id := nullif(trim(both FROM coalesce(p_header->>'created_by_id', '')), '');

  IF nullif(p_header->>'opening_date', '') IS NOT NULL THEN
    v_opening_date := (p_header->>'opening_date')::timestamptz;
  END IF;
  IF nullif(p_header->>'start_date', '') IS NOT NULL THEN
    v_start_date := (p_header->>'start_date')::timestamptz;
  END IF;
  IF nullif(p_header->>'closing_date', '') IS NOT NULL THEN
    v_closing_date := (p_header->>'closing_date')::timestamptz;
  END IF;

  IF v_inventory_number IS NULL THEN
    RAISE EXCEPTION 'inventory_number e obrigatorio';
  END IF;

  IF v_mode = 'create' THEN
    v_inventario_id := gen_random_uuid()::text;
    v_created_date := now();
    v_anchor_id := v_inventario_id;
  ELSIF v_mode = 'replace' THEN
    IF v_inventario_id IS NULL THEN
      RAISE EXCEPTION 'inventario_id obrigatorio para replace';
    END IF;

    SELECT id, created_date, created_by_id
    INTO v_anchor_id, v_created_date, v_created_by_id
    FROM inventario
    WHERE inventario_id = v_inventario_id
    ORDER BY linha_ordem ASC, created_date ASC
    LIMIT 1;

    IF v_anchor_id IS NULL THEN
      RAISE EXCEPTION 'inventario % nao encontrado', v_inventario_id;
    END IF;

    v_created_by_id := coalesce(
      nullif(trim(both FROM coalesce(p_header->>'created_by_id', '')), ''),
      v_created_by_id
    );
    v_created_date := coalesce(v_created_date, now());

    DELETE FROM inventario WHERE inventario_id = v_inventario_id;
  ELSE
    RAISE EXCEPTION 'p_mode invalido: %', v_mode;
  END IF;

  IF COALESCE(jsonb_array_length(v_items), 0) = 0 THEN
    v_new_id := coalesce(v_anchor_id, v_inventario_id);
    INSERT INTO inventario (
      id, created_date, updated_date, created_by_id,
      inventory_number, opening_date, start_date, closing_date,
      opened_by, started_by, closed_by,
      clients, products, lots, status, items,
      inventario_id, linha_ordem,
      stock_id, item, client, product, lot, unit, packaging_type,
      packaging_capacity, registered_stock, registered_quantity,
      physical_packages, fractional_qty, physical_total,
      difference, difference_pct
    ) VALUES (
      v_new_id, v_created_date, now(), v_created_by_id,
      v_inventory_number, v_opening_date, v_start_date, v_closing_date,
      v_opened_by, v_started_by, v_closed_by,
      NULL, NULL, NULL, v_status, NULL,
      v_inventario_id, 1,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL,
      NULL, NULL, NULL,
      NULL, NULL
    );
    v_ids := array_append(v_ids, v_new_id);
  ELSE
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_idx := v_idx + 1;
      IF v_idx = 1 AND v_anchor_id IS NOT NULL THEN
        v_new_id := v_anchor_id;
      ELSE
        v_new_id := gen_random_uuid()::text;
      END IF;

      v_item_name := coalesce(
        nullif(trim(both FROM coalesce(v_elem->>'product', '')), ''),
        nullif(trim(both FROM coalesce(v_elem->>'item', '')), '')
      );
      v_client := nullif(trim(both FROM coalesce(v_elem->>'client', '')), '');
      v_lot := nullif(trim(both FROM coalesce(v_elem->>'lot', '')), '');
      v_unit := coalesce(nullif(trim(both FROM coalesce(v_elem->>'unit', '')), ''), 'kg');
      v_packaging_type := nullif(trim(both FROM coalesce(v_elem->>'packaging_type', '')), '');
      v_stock_id := nullif(trim(both FROM coalesce(v_elem->>'stock_id', '')), '');

      INSERT INTO inventario (
        id, created_date, updated_date, created_by_id,
        inventory_number, opening_date, start_date, closing_date,
        opened_by, started_by, closed_by,
        clients, products, lots, status, items,
        inventario_id, linha_ordem,
        stock_id, item, client, product, lot, unit, packaging_type,
        packaging_capacity, registered_stock, registered_quantity,
        physical_packages, fractional_qty, physical_total,
        difference, difference_pct
      ) VALUES (
        v_new_id, v_created_date, now(), v_created_by_id,
        v_inventory_number, v_opening_date, v_start_date, v_closing_date,
        v_opened_by, v_started_by, v_closed_by,
        v_client, v_item_name, v_lot, v_status, NULL,
        v_inventario_id, v_idx,
        v_stock_id, v_item_name, v_client, v_item_name, v_lot, v_unit, v_packaging_type,
        inventario_to_numeric(v_elem->>'packaging_capacity'),
        inventario_to_numeric(v_elem->>'registered_stock'),
        inventario_to_numeric(v_elem->>'registered_quantity'),
        coalesce(inventario_to_numeric(v_elem->>'physical_packages'), 0),
        coalesce(inventario_to_numeric(v_elem->>'fractional_qty'), 0),
        coalesce(inventario_to_numeric(v_elem->>'physical_total'), 0),
        coalesce(inventario_to_numeric(v_elem->>'difference'), 0),
        coalesce(inventario_to_numeric(v_elem->>'difference_pct'), 0)
      );
      v_ids := array_append(v_ids, v_new_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'inventario_id', v_inventario_id,
    'anchor_id', v_ids[1],
    'line_ids', to_jsonb(v_ids),
    'item_count', COALESCE(jsonb_array_length(v_items), 0),
    'mode', v_mode
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.inventario_parse_items(jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventario_to_numeric(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventario_line_lots(jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventario_salvar(text, jsonb, jsonb, text)
  TO anon, authenticated, service_role;

ALTER TABLE public.inventario REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.inventario';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
