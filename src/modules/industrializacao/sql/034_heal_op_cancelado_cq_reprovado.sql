-- ============================================================================
-- Fix: CQ Reprovado não deve deixar OP em Cancelado; permite Finalizado
-- sem checklist de envase quando a OP foi cancelada só por CQ.
-- Execute no Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION require_operational_checklist_on_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status = 'Aguardando Início'
     AND NEW.status = 'Em Produção'
  THEN
    IF NOT has_operational_checklist(NEW.id, 'start_production', now() - interval '15 minutes') THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes de iniciar a produção (start_production).';
    END IF;
  END IF;

  IF OLD.pause_start_time IS NULL AND NEW.pause_start_time IS NOT NULL THEN
    IF NOT has_operational_checklist(NEW.id, 'pause_production', now() - interval '15 minutes') THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes de pausar a produção (pause_production).';
    END IF;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'Finalizado' THEN
    -- Reconciliação (vasilhame já no pátio / heal)
    IF current_setting('chemctrl.reconcile_envase', true) = 'on' THEN
      RETURN NEW;
    END IF;

    -- CQ reprovado: OP foi cancelada indevidamente; pode voltar a Finalizado sem envase
    IF OLD.status = 'Cancelado'
       AND lower(trim(coalesce(NEW.qc_status, OLD.qc_status, ''))) = 'reprovado' THEN
      RETURN NEW;
    END IF;

    IF NOT has_operational_checklist(NEW.id, 'start_filling', NULL) THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes do envase (start_filling).';
    END IF;

    IF has_operational_checklist(NEW.id, 'finish_filling', now() - interval '15 minutes') THEN
      RETURN NEW;
    END IF;

    IF production_has_registered_envase(NEW.id, NEW.op_number)
       AND has_operational_checklist(NEW.id, 'finish_filling', NULL) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Checklist operacional obrigatório antes de finalizar o envase (finish_filling).';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION heal_cq_rejected_canceled_productions()
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
    WHERE p.status = 'Cancelado'
      AND lower(trim(coalesce(p.qc_status, ''))) = 'reprovado'
    RETURNING p.id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::text[]), count(*)::int
  INTO v_ids, v_count
  FROM updated;

  PERFORM set_config('chemctrl.reconcile_envase', 'off', true);

  -- Sincroniza pedidos afetados (volume produzido / Finalizado)
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
        coalesce(sum(CASE
          WHEN p.status = 'Finalizado' THEN coalesce(p.volume, 0)
          WHEN p.status = 'Cancelado'
               AND lower(trim(coalesce(p.qc_status, ''))) = 'reprovado'
            THEN coalesce(p.volume, 0)
          ELSE 0
        END), 0) AS volume_produced,
        bool_or(p.status NOT IN ('Cancelado', 'Finalizado')) AS has_open_op
      FROM ind_lista_producoes p
      WHERE p.order_id IN (SELECT order_id FROM affected_orders)
      GROUP BY p.order_id
    )
    UPDATE ind_lista_pedidos o
    SET
      volume_produced = t.volume_produced,
      volume_pending = greatest(0, coalesce(o.volume_ordered, 0) - t.volume_produced),
      status = CASE
        WHEN coalesce(o.volume_ordered, 0) > 0
             AND (coalesce(o.volume_ordered, 0) - t.volume_produced) <= 0.05
          THEN 'Finalizado'
        WHEN t.has_open_op THEN 'Em produção'
        ELSE 'Pendente'
      END,
      updated_date = now()
    FROM op_totals t
    WHERE o.id = t.order_id;
  END IF;

  RETURN jsonb_build_object('updated', v_count, 'ids', to_jsonb(v_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION heal_cq_rejected_canceled_productions() TO anon;
GRANT EXECUTE ON FUNCTION heal_cq_rejected_canceled_productions() TO authenticated;

-- Corrige imediatamente (inclui OP146)
SELECT heal_cq_rejected_canceled_productions();
