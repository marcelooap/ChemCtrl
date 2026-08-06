-- ============================================================================
-- FIX: Origin packaging left as "No Pátio" after a full transfer
-- Example: TANKA 53 / lote 260730-104 emptied into 5 × 5.000 L tanks but origin
-- stayed at 25.000 L / No Pátio because volume_used was not synced from destinations.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

-- Preview (optional)
-- SELECT id, container_number, lot, volume, status, net_weight, gross_weight
-- FROM ind_lista_vasilhames
-- WHERE container_number ILIKE '%TANKA%53%'
--    OR lot = '260730-104';

WITH target AS (
  SELECT c.id, COALESCE(c.tare, 0) AS tare
  FROM ind_lista_vasilhames c
  WHERE c.status = 'No Pátio'
    AND (
      (c.container_number ILIKE '%TANKA%53%' AND COALESCE(c.lot, '') = '260730-104')
      OR (
        COALESCE(c.lot, '') = '260730-104'
        AND COALESCE(c.volume, 0) >= 20000
        AND EXISTS (
          SELECT 1
          FROM ind_transbordo_ind t
          WHERE t.origins::text ILIKE '%' || c.id || '%'
        )
      )
    )
)
UPDATE ind_lista_vasilhames c
SET
  volume = 0,
  net_weight = 0,
  gross_weight = ROUND(t.tare),
  status = 'Expedido',
  departure_date = COALESCE(c.departure_date, CURRENT_DATE),
  is_fractional = false,
  updated_date = now()
FROM target t
WHERE c.id = t.id;

-- Clear leftover composition on emptied origin tanks
DELETE FROM ind_composicao_vasilhame o
WHERE o.container_id IN (
  SELECT c.id
  FROM ind_lista_vasilhames c
  WHERE c.container_number ILIKE '%TANKA%53%'
    AND COALESCE(c.lot, '') = '260730-104'
    AND c.status = 'Expedido'
    AND COALESCE(c.volume, 0) <= 0.001
);
