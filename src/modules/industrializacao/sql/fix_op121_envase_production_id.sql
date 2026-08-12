-- ============================================================================
-- Fix: detecção de envase por production_id (não só op_number)
-- Execute no: Supabase Dashboard → SQL Editor → New Query → Paste & Run
--
-- Causa (OP121 PROCHINOR TL 93):
--   Existiam DUAS produções com op_number = 'OP121'.
--   A evidência de envase filtrava só por op_number e achou o vasilhame
--   da OP121 antiga (RO SC F656). A UI mostrou "Envase já registrado" /
--   "Finalizar OP" e marcou a produção nova como Finalizado sem envase.
--
-- Correção:
--   1) production_has_registered_envase usa production_id
--   2) Reabre a OP121 PROCHINOR (id 12043c58-...) para Envase
--   3) Recalcula o pedido vinculado
-- ============================================================================

CREATE OR REPLACE FUNCTION production_has_registered_envase(
  p_production_id text,
  p_op_number text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has boolean := false;
BEGIN
  -- Preferência: amarra ao id da produção (op_number pode se repetir)
  IF p_production_id IS NOT NULL AND btrim(p_production_id) <> '' THEN
    SELECT EXISTS (
      SELECT 1
      FROM ind_lista_vasilhames c
      WHERE c.production_id = p_production_id
        AND (c.op_number IS NULL OR c.op_number NOT LIKE 'TB%')
    ) INTO v_has;
    IF v_has THEN
      RETURN true;
    END IF;

    IF to_regclass('public.ind_composicao_vasilhame') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM ind_composicao_vasilhame o
        WHERE o.production_id = p_production_id
          AND (o.op_number IS NULL OR o.op_number NOT LIKE 'TB%')
      ) INTO v_has;
      IF v_has THEN
        RETURN true;
      END IF;
    END IF;

    RETURN false;
  END IF;

  -- Fallback legado (sem production_id): só op_number, excluindo TB
  IF p_op_number IS NOT NULL AND btrim(p_op_number) <> '' AND p_op_number NOT LIKE 'TB%' THEN
    SELECT EXISTS (
      SELECT 1
      FROM ind_lista_vasilhames c
      WHERE c.op_number = p_op_number
    ) INTO v_has;
    IF v_has THEN
      RETURN true;
    END IF;
  END IF;

  IF to_regclass('public.ind_composicao_vasilhame') IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM ind_composicao_vasilhame o
    WHERE p_op_number IS NOT NULL
      AND btrim(p_op_number) <> ''
      AND o.op_number = p_op_number
      AND o.op_number NOT LIKE 'TB%'
  ) INTO v_has;

  RETURN v_has;
END;
$$;

GRANT EXECUTE ON FUNCTION production_has_registered_envase(text, text) TO anon;
GRANT EXECUTE ON FUNCTION production_has_registered_envase(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION reconcile_stuck_envase_productions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids text[] := ARRAY[]::text[];
  v_count int := 0;
BEGIN
  PERFORM set_config('chemctrl.reconcile_envase', 'on', true);

  WITH updated AS (
    UPDATE ind_lista_producoes p
    SET
      status = 'Finalizado',
      end_time = COALESCE(p.end_time, now()),
      updated_date = now()
    WHERE p.status = 'Envase'
      AND production_has_registered_envase(p.id, p.op_number)
    RETURNING p.id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::text[]), count(*)::int
  INTO v_ids, v_count
  FROM updated;

  PERFORM set_config('chemctrl.reconcile_envase', 'off', true);

  IF v_count > 0 THEN
    WITH affected_orders AS (
      SELECT DISTINCT p.order_id
      FROM ind_lista_producoes p
      WHERE p.id = ANY (v_ids)
        AND p.order_id IS NOT NULL
    ),
    op_totals AS (
      SELECT
        p.order_id,
        COALESCE(SUM(p.volume) FILTER (WHERE p.status = 'Finalizado'), 0) AS vol_finalizado,
        BOOL_OR(p.status NOT IN ('Cancelado', 'Finalizado')) AS has_open_op
      FROM ind_lista_producoes p
      WHERE p.order_id IN (SELECT order_id FROM affected_orders)
      GROUP BY p.order_id
    )
    UPDATE ind_lista_pedidos o
    SET
      volume_produced = COALESCE(t.vol_finalizado, 0),
      volume_pending = GREATEST(0, COALESCE(o.volume_ordered, 0) - COALESCE(t.vol_finalizado, 0)),
      status = CASE
        WHEN COALESCE(o.volume_ordered, 0) > 0
             AND COALESCE(t.vol_finalizado, 0) >= COALESCE(o.volume_ordered, 0) - 0.05
          THEN 'Finalizado'
        WHEN COALESCE(t.has_open_op, false)
          THEN 'Em produção'
        ELSE 'Pendente'
      END,
      updated_date = now()
    FROM op_totals t
    WHERE o.id = t.order_id;
  END IF;

  RETURN jsonb_build_object(
    'finalized_count', v_count,
    'production_ids', to_jsonb(COALESCE(v_ids, ARRAY[]::text[]))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_stuck_envase_productions() TO anon;
GRANT EXECUTE ON FUNCTION reconcile_stuck_envase_productions() TO authenticated;

-- Reabre a OP121 PROCHINOR TL 93 (sem vasilhame próprio)
UPDATE ind_lista_producoes
SET
  status = 'Envase',
  end_time = NULL,
  updated_date = now()
WHERE id = '12043c58-af36-4106-816e-545c14a15ec4'
  AND op_number = 'OP121'
  AND status = 'Finalizado'
  AND NOT production_has_registered_envase(id, op_number);

-- Recalcula o pedido da OP reaberta
WITH op_totals AS (
  SELECT
    p.order_id,
    COALESCE(SUM(p.volume) FILTER (WHERE p.status = 'Finalizado'), 0) AS vol_finalizado,
    BOOL_OR(p.status NOT IN ('Cancelado', 'Finalizado')) AS has_open_op
  FROM ind_lista_producoes p
  WHERE p.order_id = 'e8afae56-d5cc-4877-a2e4-39021e1ba9cf'
  GROUP BY p.order_id
)
UPDATE ind_lista_pedidos o
SET
  volume_produced = COALESCE(t.vol_finalizado, 0),
  volume_pending = GREATEST(0, COALESCE(o.volume_ordered, 0) - COALESCE(t.vol_finalizado, 0)),
  status = CASE
    WHEN COALESCE(o.volume_ordered, 0) > 0
         AND COALESCE(t.vol_finalizado, 0) >= COALESCE(o.volume_ordered, 0) - 0.05
      THEN 'Finalizado'
    WHEN COALESCE(t.has_open_op, false)
      THEN 'Em produção'
    ELSE 'Pendente'
  END,
  updated_date = now()
FROM op_totals t
WHERE o.id = t.order_id;

-- Confirmação
SELECT
  p.id,
  p.op_number,
  p.product,
  p.lot,
  p.status,
  p.end_time,
  production_has_registered_envase(p.id, p.op_number) AS has_envase
FROM ind_lista_producoes p
WHERE p.op_number = 'OP121'
ORDER BY p.created_date;
