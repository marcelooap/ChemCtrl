-- ============================================================================
-- MIGRATION: Complemento de Lote em Embalagem Fracionada
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

-- Container multi-OP composition
CREATE TABLE IF NOT EXISTS container_origins (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date timestamptz DEFAULT now(),
  updated_date timestamptz DEFAULT now(),
  container_id text NOT NULL,
  production_id text,
  op_number text,
  lot text,
  volume numeric NOT NULL DEFAULT 0,
  initial_volume numeric NOT NULL DEFAULT 0,
  operator text
);

CREATE INDEX IF NOT EXISTS idx_container_origins_container_id ON container_origins (container_id);
CREATE INDEX IF NOT EXISTS idx_container_origins_production_id ON container_origins (production_id);

ALTER TABLE container_origins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_container_origins" ON container_origins;
CREATE POLICY "allow_all_container_origins" ON container_origins FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_updated_date_container_origins ON container_origins;
CREATE TRIGGER update_updated_date_container_origins
  BEFORE UPDATE ON container_origins
  FOR EACH ROW EXECUTE FUNCTION update_updated_date();

-- Production flags for complementary packaging flow
ALTER TABLE productions ADD COLUMN IF NOT EXISTS complement_packaging boolean DEFAULT false;
ALTER TABLE productions ADD COLUMN IF NOT EXISTS complement_container_id text;

-- Ensure is_fractional exists on containers (used in app; may be missing in older DBs)
ALTER TABLE containers ADD COLUMN IF NOT EXISTS is_fractional boolean DEFAULT false;

-- Backfill: one origin per existing container that has a production link
INSERT INTO container_origins (container_id, production_id, op_number, lot, volume, initial_volume, operator, created_date)
SELECT
  c.id,
  c.production_id,
  c.op_number,
  c.lot,
  COALESCE(c.volume, 0),
  COALESCE(c.volume, 0),
  c.operator,
  COALESCE(c.created_date, now())
FROM containers c
WHERE c.production_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM container_origins o WHERE o.container_id = c.id
  );

-- Realtime (optional; safe to re-run)
ALTER TABLE public.container_origins REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.container_origins;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;
