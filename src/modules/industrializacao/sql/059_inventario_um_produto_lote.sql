-- =============================================================================
-- 059_inventario_um_produto_lote.sql
-- clients, products e lots deixam de guardar a lista inteira.
-- Cada linha fica com um cliente, um produto e um lote.
-- Se a coluna lot ainda for um JSON com vários lotes, abre uma linha por lote.
-- Idempotente. Não apaga o backup da 058.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.inventario_scalar_text(p_line text, p_cell text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_parsed jsonb;
BEGIN
  IF nullif(btrim(coalesce(p_line, '')), '') IS NOT NULL THEN
    RETURN btrim(p_line);
  END IF;
  IF p_cell IS NULL OR btrim(p_cell) IN ('', 'TODOS') THEN
    RETURN NULL;
  END IF;
  IF left(btrim(p_cell), 1) = '[' THEN
    BEGIN
      v_parsed := btrim(p_cell)::jsonb;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    IF jsonb_typeof(v_parsed) = 'array' AND jsonb_array_length(v_parsed) = 1 THEN
      RETURN nullif(btrim(v_parsed->>0), '');
    END IF;
    RETURN NULL;
  END IF;
  RETURN nullif(btrim(p_cell), '');
END;
$$;

-- Um produto com o lote gravado como ["L1","L2"] vira uma linha por lote.
DO $$
DECLARE
  r record;
  v_lots jsonb;
  v_lot text;
  v_first boolean;
  v_ordem integer;
  v_new_id text;
  v_product text;
BEGIN
  FOR r IN
    SELECT *
    FROM public.inventario
    WHERE left(btrim(coalesce(lot, '')), 1) = '['
  LOOP
    BEGIN
      v_lots := btrim(r.lot)::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF jsonb_typeof(v_lots) IS DISTINCT FROM 'array' OR COALESCE(jsonb_array_length(v_lots), 0) < 2 THEN
      CONTINUE;
    END IF;

    v_product := coalesce(nullif(btrim(coalesce(r.product, '')), ''), nullif(btrim(coalesce(r.item, '')), ''));
    v_first := true;
    FOR v_lot IN
      SELECT nullif(btrim(value), '')
      FROM jsonb_array_elements_text(v_lots) AS t(value)
    LOOP
      IF v_lot IS NULL THEN
        CONTINUE;
      END IF;
      IF v_first THEN
        UPDATE public.inventario
        SET
          lot = v_lot,
          lots = v_lot,
          product = v_product,
          products = v_product,
          item = v_product,
          updated_date = now()
        WHERE id = r.id;
        v_first := false;
      ELSE
        SELECT COALESCE(MAX(linha_ordem), 0) + 1
        INTO v_ordem
        FROM public.inventario
        WHERE inventario_id = r.inventario_id;

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
        )
        SELECT
          v_new_id, r.created_date, now(), r.created_by_id,
          r.inventory_number, r.opening_date, r.start_date, r.closing_date,
          r.opened_by, r.started_by, r.closed_by,
          r.client, v_product, v_lot, r.status, NULL,
          r.inventario_id, v_ordem,
          r.stock_id, v_product, r.client, v_product, v_lot, r.unit, r.packaging_type,
          r.packaging_capacity, r.registered_stock, r.registered_quantity,
          r.physical_packages, r.fractional_qty, r.physical_total,
          r.difference, r.difference_pct;
      END IF;
    END LOOP;
  END LOOP;
END $$;

UPDATE public.inventario
SET
  clients = public.inventario_scalar_text(client, clients),
  products = public.inventario_scalar_text(coalesce(nullif(btrim(product), ''), nullif(btrim(item), '')), products),
  lots = public.inventario_scalar_text(lot, lots),
  updated_date = now()
WHERE btrim(coalesce(clients, '')) = 'TODOS'
   OR btrim(coalesce(products, '')) = 'TODOS'
   OR btrim(coalesce(lots, '')) = 'TODOS'
   OR left(btrim(coalesce(clients, '')), 1) = '['
   OR left(btrim(coalesce(products, '')), 1) = '['
   OR left(btrim(coalesce(lots, '')), 1) = '[';

DROP FUNCTION public.inventario_scalar_text(text, text);

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

NOTIFY pgrst, 'reload schema';

COMMIT;
