-- Fix: pedidos com status Finalizado indevido após cancelamento de OP
-- Regra: volume_produced = soma apenas de OPs Finalizado
--         status = Finalizado | Em produção | Pendente conforme OPs abertas e volume

WITH op_totals AS (
  SELECT
    p.order_id,
    COALESCE(SUM(p.volume) FILTER (WHERE p.status = 'Finalizado'), 0) AS vol_finalizado,
    BOOL_OR(p.status NOT IN ('Cancelado', 'Finalizado')) AS has_open_op
  FROM productions p
  WHERE p.order_id IS NOT NULL
  GROUP BY p.order_id
)
UPDATE orders o
SET
  volume_produced = COALESCE(t.vol_finalizado, 0),
  volume_pending = GREATEST(0, COALESCE(o.volume_ordered, 0) - COALESCE(t.vol_finalizado, 0)),
  status = CASE
    WHEN COALESCE(t.vol_finalizado, 0) >= COALESCE(o.volume_ordered, 0) - 0.05
      AND COALESCE(o.volume_ordered, 0) > 0
      THEN 'Finalizado'
    WHEN COALESCE(t.has_open_op, false)
      THEN 'Em produção'
    ELSE 'Pendente'
  END,
  updated_date = now()
FROM op_totals t
WHERE o.id = t.order_id
  AND (
    o.status IS DISTINCT FROM (
      CASE
        WHEN COALESCE(t.vol_finalizado, 0) >= COALESCE(o.volume_ordered, 0) - 0.05
          AND COALESCE(o.volume_ordered, 0) > 0
          THEN 'Finalizado'
        WHEN COALESCE(t.has_open_op, false)
          THEN 'Em produção'
        ELSE 'Pendente'
      END
    )
    OR o.volume_produced IS DISTINCT FROM COALESCE(t.vol_finalizado, 0)
    OR o.volume_pending IS DISTINCT FROM GREATEST(0, COALESCE(o.volume_ordered, 0) - COALESCE(t.vol_finalizado, 0))
  );

-- Pedidos sem nenhuma OP vinculada: se estavam Finalizado com volume_produced
-- inconsistente, não altera (sem OP não dá para inferir). Apenas PD04/similares
-- com OPs canceladas/abertas são corrigidos pelo UPDATE acima.
