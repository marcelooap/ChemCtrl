-- ============================================================================
-- FIX: Duplicate rows in ind_composicao_vasilhame (same OP/lote on one packaging)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
--
-- Symptom: Produções "Embalagens Envasadas" and Vasilhames "Composição por Origem"
-- show two identical lines for one physical tank (e.g. lote 260730-104 / TANKA 53),
-- while ind_lista_vasilhames has a single container row.
-- ============================================================================

-- 1) Preview duplicates (optional)
-- SELECT
--   o.container_id,
--   c.container_number,
--   o.production_id,
--   o.op_number,
--   o.lot,
--   COUNT(*) AS rows,
--   SUM(o.volume) AS sum_volume,
--   MAX(c.volume) AS container_volume
-- FROM ind_composicao_vasilhame o
-- LEFT JOIN ind_lista_vasilhames c ON c.id = o.container_id
-- GROUP BY o.container_id, c.container_number, o.production_id, o.op_number, o.lot
-- HAVING COUNT(*) > 1
-- ORDER BY rows DESC;

WITH ranked AS (
  SELECT
    o.id,
    o.container_id,
    o.volume,
    o.initial_volume,
    c.volume AS container_volume,
    ROW_NUMBER() OVER (
      PARTITION BY
        o.container_id,
        COALESCE(NULLIF(TRIM(o.production_id), ''), ''),
        COALESCE(NULLIF(TRIM(o.op_number), ''), ''),
        COALESCE(NULLIF(TRIM(o.lot), ''), '')
      ORDER BY o.created_date ASC NULLS LAST, o.id ASC
    ) AS rn,
    COUNT(*) OVER (
      PARTITION BY
        o.container_id,
        COALESCE(NULLIF(TRIM(o.production_id), ''), ''),
        COALESCE(NULLIF(TRIM(o.op_number), ''), ''),
        COALESCE(NULLIF(TRIM(o.lot), ''), '')
    ) AS group_cnt,
    SUM(o.volume) OVER (
      PARTITION BY
        o.container_id,
        COALESCE(NULLIF(TRIM(o.production_id), ''), ''),
        COALESCE(NULLIF(TRIM(o.op_number), ''), ''),
        COALESCE(NULLIF(TRIM(o.lot), ''), '')
    ) AS group_sum,
    MAX(o.volume) OVER (
      PARTITION BY
        o.container_id,
        COALESCE(NULLIF(TRIM(o.production_id), ''), ''),
        COALESCE(NULLIF(TRIM(o.op_number), ''), ''),
        COALESCE(NULLIF(TRIM(o.lot), ''), '')
    ) AS group_max_vol,
    MIN(o.volume) OVER (
      PARTITION BY
        o.container_id,
        COALESCE(NULLIF(TRIM(o.production_id), ''), ''),
        COALESCE(NULLIF(TRIM(o.op_number), ''), ''),
        COALESCE(NULLIF(TRIM(o.lot), ''), '')
    ) AS group_min_vol
  FROM ind_composicao_vasilhame o
  LEFT JOIN ind_lista_vasilhames c ON c.id = o.container_id
),
keepers AS (
  SELECT
    id,
    container_volume,
    group_sum,
    group_max_vol,
    group_min_vol,
    CASE
      -- Near-identical copies that inflate past physical volume (or no cap) → keep one
      WHEN ABS(group_max_vol - group_min_vol) <= GREATEST(0.001, group_max_vol * 0.001)
        AND (
          container_volume IS NULL
          OR container_volume <= 0
          OR group_sum > container_volume * 1.01
        )
      THEN group_max_vol
      -- Real complements of the same OP (including equal top-ups) → merge volumes
      WHEN container_volume IS NOT NULL AND container_volume > 0
      THEN LEAST(group_sum, container_volume)
      ELSE group_sum
    END AS new_volume
  FROM ranked
  WHERE rn = 1 AND group_cnt > 1
)
UPDATE ind_composicao_vasilhame o
SET
  volume = k.new_volume,
  initial_volume = CASE
    WHEN COALESCE(o.initial_volume, 0) > 0 THEN GREATEST(o.initial_volume, k.new_volume)
    ELSE k.new_volume
  END,
  updated_date = now()
FROM keepers k
WHERE o.id = k.id;

-- Remove extra duplicate rows (keep the earliest per container + OP/lote)
DELETE FROM ind_composicao_vasilhame o
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          container_id,
          COALESCE(NULLIF(TRIM(production_id), ''), ''),
          COALESCE(NULLIF(TRIM(op_number), ''), ''),
          COALESCE(NULLIF(TRIM(lot), ''), '')
        ORDER BY created_date ASC NULLS LAST, id ASC
      ) AS rn
    FROM ind_composicao_vasilhame
  ) d
  WHERE rn > 1
) x
WHERE o.id = x.id;

-- Prevent future duplicates for the same production on one packaging
CREATE UNIQUE INDEX IF NOT EXISTS uq_ind_composicao_vasilhame_container_production
  ON ind_composicao_vasilhame (container_id, production_id)
  WHERE production_id IS NOT NULL AND TRIM(production_id) <> '';
