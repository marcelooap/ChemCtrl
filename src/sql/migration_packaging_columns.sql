-- ============================================================================
-- MIGRATION: Add packaging columns to raw_material_stocks + create inventories
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

-- 1. Add packaging columns to raw_material_stocks (if they don't exist yet)
ALTER TABLE raw_material_stocks ADD COLUMN IF NOT EXISTS packaging_type text;
ALTER TABLE raw_material_stocks ADD COLUMN IF NOT EXISTS packaging_capacity numeric;
ALTER TABLE raw_material_stocks ADD COLUMN IF NOT EXISTS packaging_quantity numeric;

-- 2. Create inventories table (if it doesn't exist yet)
CREATE TABLE IF NOT EXISTS inventories (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  inventory_number text,
  opening_date timestamptz,
  start_date timestamptz,
  closing_date timestamptz,
  opened_by text,
  started_by text,
  closed_by text,
  clients text,
  products text,
  lots text,
  status text default 'Aberto',
  items jsonb default '[]'::jsonb
);

ALTER TABLE inventories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_inventories" ON inventories;
CREATE POLICY "allow_all_inventories" ON inventories FOR ALL USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS update_updated_date_inventories ON inventories;
CREATE TRIGGER update_updated_date_inventories
  BEFORE UPDATE ON inventories
  FOR EACH ROW EXECUTE FUNCTION update_updated_date();

-- 3. Add inventories to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE inventories;

-- 4. Create indexes for inventories
CREATE INDEX IF NOT EXISTS idx_inventories_status ON inventories(status);
CREATE INDEX IF NOT EXISTS idx_inventories_inventory_number ON inventories(inventory_number);

-- After running this migration, refresh the app page so the client re-fetches
-- the actual table columns (the dynamic column cache will then include the
-- new packaging_type, packaging_capacity, packaging_quantity columns).
