-- ============================================================================
-- MIGRATION: Sync orders.client_order → productions.client_order
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
--
-- Garante que, ao editar "Pedido Cliente" no pedido, todas as OPs
-- vinculadas (productions.order_id) recebam o mesmo valor no banco.
-- ============================================================================

-- 1. Backfill: alinhar registros já existentes
UPDATE productions p
SET
  client_order = o.client_order,
  updated_date = now()
FROM orders o
WHERE p.order_id = o.id
  AND p.client_order IS DISTINCT FROM o.client_order;

-- 2. Trigger: cascade em futuras alterações no pedido
CREATE OR REPLACE FUNCTION sync_order_client_order_to_productions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_order IS DISTINCT FROM OLD.client_order THEN
    UPDATE productions
    SET
      client_order = NEW.client_order,
      updated_date = now()
    WHERE order_id = NEW.id
      AND client_order IS DISTINCT FROM NEW.client_order;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_client_order ON orders;
CREATE TRIGGER trg_sync_order_client_order
  AFTER UPDATE OF client_order ON orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_order_client_order_to_productions();
