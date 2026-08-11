-- ============================================================================
-- Fix: OP em Envase após vasilhame já registrado (ex.: OP118 / ID 218)
-- Execute no: Supabase Dashboard → SQL Editor → New Query → Paste & Run
--
-- Causa:
--   O envase cria o vasilhame e só depois atualiza ind_lista_producoes.status
--   para Finalizado. Se o UPDATE falhar (rede, trigger de checklist 15 min),
--   o pátio fica certo e a OP permanece em Envase.
--
-- Correção:
--   1) Detectar envase já registrado (vasilhame/composição da OP, não TB)
--   2) Permitir Finalizado se o envase existe e o finish_filling já ocorreu
--      (mesmo fora da janela de 15 minutos)
--   3) Reconciliar OPs presas (inclui OP118) e sincronizar o pedido
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
    -- Reconciliação (vasilhame já no pátio): não usa session_replication_role
    IF current_setting('chemctrl.reconcile_envase', true) = 'on' THEN
      RETURN NEW;
    END IF;

    IF NOT has_operational_checklist(NEW.id, 'start_filling', NULL) THEN
      RAISE EXCEPTION 'Checklist operacional obrigatório antes do envase (start_filling).';
    END IF;

    -- Happy path: finish_filling recente
    IF has_operational_checklist(NEW.id, 'finish_filling', now() - interval '15 minutes') THEN
      RETURN NEW;
    END IF;

    -- Retry/heal: vasilhame já gravado e checklist de encerramento existe
    IF production_has_registered_envase(NEW.id, NEW.op_number)
       AND has_operational_checklist(NEW.id, 'finish_filling', NULL) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Checklist operacional obrigatório antes de finalizar o envase (finish_filling).';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_operational_checklist ON ind_lista_producoes;
CREATE TRIGGER trg_require_operational_checklist
  BEFORE UPDATE ON ind_lista_producoes
  FOR EACH ROW
  EXECUTE FUNCTION require_operational_checklist_on_production();

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

-- Aplica imediatamente (OP118 e quaisquer outras presas no mesmo estado)
SELECT reconcile_stuck_envase_productions();
