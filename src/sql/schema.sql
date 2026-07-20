-- ============================================================================
-- ChemControl - Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================================
-- Helper: auto-update updated_date on row update
-- ============================================================================
create or replace function update_updated_date()
returns trigger as $$
begin
  new.updated_date = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- 1. usuarios
-- ============================================================================
create table if not exists usuarios (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  nome_completo text not null,
  usuario text not null,
  senha text, -- nullable: cleared after bcrypt hash into senha_hash
  nivel_acesso text default 'Operacional',
  status text default 'Ativo',
  cargo text,
  tipo text default 'interno',
  cliente text,
  criado_por text
);
alter table usuarios enable row level security;
drop policy if exists "allow_all_usuarios" on usuarios;
create policy "allow_all_usuarios" on usuarios for all using (true) with check (true);
drop trigger if exists update_updated_date_usuarios on usuarios;
create trigger update_updated_date_usuarios before update on usuarios for each row execute function update_updated_date();

-- ============================================================================
-- 2. productions
-- ============================================================================
create table if not exists productions (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  op_number text,
  date timestamptz,
  product text not null,
  client text,
  client_order text,
  lot text,
  volume numeric not null,
  mass numeric,
  unit_price numeric,
  total_value numeric,
  recipe_revision text,
  recipe_id text,
  order_id text,
  density numeric,
  status text default 'Aguardando Início',
  priority text default 'Média',
  packaging_type text,
  packaging_info text,
  bypass_qc boolean default false,
  operator text,
  start_time timestamptz,
  end_time timestamptz,
  qc_start_time timestamptz,
  envase_start_time timestamptz,
  pause_start_time timestamptz,
  total_pause_ms numeric default 0,
  observations text,
  raw_materials_used jsonb,
  qc_status text default 'Pendente',
  qc_analyst text,
  qc_observations text
);
alter table productions enable row level security;
drop policy if exists "allow_all_productions" on productions;
create policy "allow_all_productions" on productions for all using (true) with check (true);
drop trigger if exists update_updated_date_productions on productions;
create trigger update_updated_date_productions before update on productions for each row execute function update_updated_date();

-- ============================================================================
-- 3. raw_material_stocks
-- ============================================================================
create table if not exists raw_material_stocks (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  entry_id text,
  entry_date date,
  mp_code text,
  mp_name text not null,
  client text,
  lot text,
  supplier text,
  manufacture_date date,
  expiry_date date,
  initial_stock numeric,
  current_stock numeric,
  unit text not null,
  unit_price numeric,
  density numeric,
  status text,
  observations text,
  tank_storage boolean,
  tank_entries jsonb,
  packaging_type text,
  packaging_capacity numeric,
  packaging_quantity numeric
);
alter table raw_material_stocks enable row level security;
drop policy if exists "allow_all_raw_material_stocks" on raw_material_stocks;
create policy "allow_all_raw_material_stocks" on raw_material_stocks for all using (true) with check (true);
drop trigger if exists update_updated_date_raw_material_stocks on raw_material_stocks;
create trigger update_updated_date_raw_material_stocks before update on raw_material_stocks for each row execute function update_updated_date();

-- ============================================================================
-- 4. tanks
-- ============================================================================
create table if not exists tanks (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  name text not null,
  product text,
  client text not null,
  capacity numeric default 26000,
  lot text,
  density numeric
);
alter table tanks enable row level security;
drop policy if exists "allow_all_tanks" on tanks;
create policy "allow_all_tanks" on tanks for all using (true) with check (true);
drop trigger if exists update_updated_date_tanks on tanks;
create trigger update_updated_date_tanks before update on tanks for each row execute function update_updated_date();

-- ============================================================================
-- 5. transfers
-- ============================================================================
create table if not exists transfers (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  transfer_number text,
  date timestamptz,
  product text not null,
  client text,
  operator text,
  observations text,
  origins jsonb,
  destinations jsonb,
  destination_type text,
  destination_id text,
  volume numeric,
  mass numeric,
  driver text,
  packaging_type text,
  seals text,
  sling text,
  gps text,
  min_test_date date
);
alter table transfers enable row level security;
drop policy if exists "allow_all_transfers" on transfers;
create policy "allow_all_transfers" on transfers for all using (true) with check (true);
drop trigger if exists update_updated_date_transfers on transfers;
create trigger update_updated_date_transfers before update on transfers for each row execute function update_updated_date();

-- ============================================================================
-- 6. containers
-- ============================================================================
create table if not exists containers (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  production_id text,
  op_number text,
  container_number text,
  barril_number text,
  registration_id numeric,
  product text not null,
  client text,
  lot text,
  type text,
  volume numeric not null,
  tare numeric,
  net_weight numeric,
  gross_weight numeric,
  seals text,
  sling text,
  gps text,
  min_test_date date,
  operator text,
  status text default 'No Pátio',
  departure_date date
);
alter table containers enable row level security;
drop policy if exists "allow_all_containers" on containers;
create policy "allow_all_containers" on containers for all using (true) with check (true);
drop trigger if exists update_updated_date_containers on containers;
create trigger update_updated_date_containers before update on containers for each row execute function update_updated_date();

-- ============================================================================
-- 6b. container_origins (multi-OP composition for complementary packaging)
-- ============================================================================
create table if not exists container_origins (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  container_id text not null,
  production_id text,
  op_number text,
  lot text,
  volume numeric not null default 0,
  initial_volume numeric not null default 0,
  operator text
);
alter table container_origins enable row level security;
drop policy if exists "allow_all_container_origins" on container_origins;
create policy "allow_all_container_origins" on container_origins for all using (true) with check (true);

-- ============================================================================
-- 7. orders
-- ============================================================================
create table if not exists orders (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  order_number text,
  date timestamptz,
  product text not null,
  client text,
  requester text,
  client_order text,
  volume_ordered numeric not null,
  volume_produced numeric,
  volume_pending numeric,
  expected_date date,
  status text default 'Pendente',
  observations text
);
alter table orders enable row level security;
drop policy if exists "allow_all_orders" on orders;
create policy "allow_all_orders" on orders for all using (true) with check (true);
drop trigger if exists update_updated_date_orders on orders;
create trigger update_updated_date_orders before update on orders for each row execute function update_updated_date();

-- Cascade client_order do pedido para OPs vinculadas
create or replace function sync_order_client_order_to_productions()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.client_order is distinct from old.client_order then
    update productions
    set
      client_order = new.client_order,
      updated_date = now()
    where order_id = new.id
      and client_order is distinct from new.client_order;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sync_order_client_order on orders;
create trigger trg_sync_order_client_order
  after update of client_order on orders
  for each row
  execute function sync_order_client_order_to_productions();

-- ============================================================================
-- 8. recipes
-- ============================================================================
create table if not exists recipes (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  code text,
  product_name text not null,
  client text,
  density numeric,
  price numeric,
  revision text,
  revision_date date,
  validity_days numeric,
  raw_materials jsonb,
  fds_url text,
  fds_filename text,
  fds_uploaded_at timestamptz,
  fds_uploaded_by text,
  necessita_n2 boolean not null default false
);
alter table recipes enable row level security;
drop policy if exists "allow_all_recipes" on recipes;
create policy "allow_all_recipes" on recipes for all using (true) with check (true);
drop trigger if exists update_updated_date_recipes on recipes;
create trigger update_updated_date_recipes before update on recipes for each row execute function update_updated_date();

-- ============================================================================
-- 9. quality_results
-- ============================================================================
create table if not exists quality_results (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  production_id text not null,
  op_number text,
  product text not null,
  client text,
  lot text,
  date timestamptz,
  analyst text,
  status text default 'Pendente',
  observations text,
  results jsonb
);
alter table quality_results enable row level security;
drop policy if exists "allow_all_quality_results" on quality_results;
create policy "allow_all_quality_results" on quality_results for all using (true) with check (true);
drop trigger if exists update_updated_date_quality_results on quality_results;
create trigger update_updated_date_quality_results before update on quality_results for each row execute function update_updated_date();

-- ============================================================================
-- 10. quality_tests
-- ============================================================================
create table if not exists quality_tests (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  product text not null,
  client text,
  revision text,
  revision_date date,
  analyses jsonb
);
alter table quality_tests enable row level security;
drop policy if exists "allow_all_quality_tests" on quality_tests;
create policy "allow_all_quality_tests" on quality_tests for all using (true) with check (true);
drop trigger if exists update_updated_date_quality_tests on quality_tests;
create trigger update_updated_date_quality_tests before update on quality_tests for each row execute function update_updated_date();

-- ============================================================================
-- 11. inventories
-- ============================================================================
create table if not exists inventories (
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
alter table inventories enable row level security;
drop policy if exists "allow_all_inventories" on inventories;
create policy "allow_all_inventories" on inventories for all using (true) with check (true);
drop trigger if exists update_updated_date_inventories on inventories;
create trigger update_updated_date_inventories before update on inventories for each row execute function update_updated_date();

-- ============================================================================
-- Indexes for common queries
-- ============================================================================
create index if not exists idx_usuarios_usuario on usuarios(usuario);
create index if not exists idx_productions_status on productions(status);
create index if not exists idx_productions_op_number on productions(op_number);
create index if not exists idx_containers_status on containers(status);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_raw_material_stocks_mp_code on raw_material_stocks(mp_code);
create index if not exists idx_quality_results_production_id on quality_results(production_id);
create index if not exists idx_inventories_status on inventories(status);
create index if not exists idx_inventories_inventory_number on inventories(inventory_number);

-- ============================================================================
-- Supabase Realtime — enable postgres_changes on all tables
-- Run this once in the Supabase SQL Editor to activate real-time subscriptions.
-- ============================================================================
-- Drop existing publication to avoid errors on re-run
drop publication if exists supabase_realtime;

-- Create publication and add all tables
create publication supabase_realtime for table
  usuarios,
  productions,
  raw_material_stocks,
  tanks,
  transfers,
  containers,
  orders,
  recipes,
  quality_results,
  quality_tests,
  inventories;
