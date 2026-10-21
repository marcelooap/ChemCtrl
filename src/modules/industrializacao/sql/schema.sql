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
-- 1. ind_lista_usuarios
-- ============================================================================
create table if not exists ind_lista_usuarios (
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
alter table ind_lista_usuarios enable row level security;
drop policy if exists "allow_all_ind_lista_usuarios" on ind_lista_usuarios;
create policy "allow_all_ind_lista_usuarios" on ind_lista_usuarios for all using (true) with check (true);
drop trigger if exists update_updated_date_ind_lista_usuarios on ind_lista_usuarios;
create trigger update_updated_date_ind_lista_usuarios before update on ind_lista_usuarios for each row execute function update_updated_date();

-- ============================================================================
-- 2. ind_lista_producoes
-- ============================================================================
create table if not exists ind_lista_producoes (
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
alter table ind_lista_producoes enable row level security;
drop policy if exists "allow_all_ind_lista_producoes" on ind_lista_producoes;
create policy "allow_all_ind_lista_producoes" on ind_lista_producoes for all using (true) with check (true);
drop trigger if exists update_updated_date_ind_lista_producoes on ind_lista_producoes;
create trigger update_updated_date_ind_lista_producoes before update on ind_lista_producoes for each row execute function update_updated_date();

-- ============================================================================
-- 3. estoque_mp (antes: ind_estoque_mp)
-- ============================================================================
create table if not exists estoque_mp (
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
  nota_fiscal text,
  supplier text,
  manufacture_date date,
  expiry_date date,
  initial_stock numeric,
  current_stock numeric,
  unit text not null,
  unit_price numeric,
  density numeric,
  status text,
  status_wms boolean not null default false,
  observations text,
  tank_storage boolean,
  tank_entries jsonb,
  packaging_type text,
  packaging_capacity numeric,
  packaging_quantity numeric,
  public_token text
);
create index if not exists idx_estoque_mp_status_wms on estoque_mp (status_wms);
create unique index if not exists idx_estoque_mp_public_token on estoque_mp (public_token) where public_token is not null;
alter table estoque_mp enable row level security;
drop policy if exists "allow_all_estoque_mp" on estoque_mp;
create policy "allow_all_estoque_mp" on estoque_mp for all using (true) with check (true);
drop trigger if exists update_updated_date_estoque_mp on estoque_mp;
create trigger update_updated_date_estoque_mp before update on estoque_mp for each row execute function update_updated_date();

-- ============================================================================
-- 4. ind_cadastro_tanka
-- ============================================================================
create table if not exists ind_cadastro_tanka (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  name text not null,
  product text,
  client text not null,
  capacity numeric default 26000,
  lot text,
  density numeric,
  observacao text
);
alter table ind_cadastro_tanka enable row level security;
drop policy if exists "allow_all_ind_cadastro_tanka" on ind_cadastro_tanka;
create policy "allow_all_ind_cadastro_tanka" on ind_cadastro_tanka for all using (true) with check (true);
drop trigger if exists update_updated_date_ind_cadastro_tanka on ind_cadastro_tanka;
create trigger update_updated_date_ind_cadastro_tanka before update on ind_cadastro_tanka for each row execute function update_updated_date();

-- ============================================================================
-- 5. ind_transbordo_ind
-- ============================================================================
create table if not exists ind_transbordo_ind (
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
alter table ind_transbordo_ind enable row level security;
drop policy if exists "allow_all_ind_transbordo_ind" on ind_transbordo_ind;
create policy "allow_all_ind_transbordo_ind" on ind_transbordo_ind for all using (true) with check (true);
drop trigger if exists update_updated_date_ind_transbordo_ind on ind_transbordo_ind;
create trigger update_updated_date_ind_transbordo_ind before update on ind_transbordo_ind for each row execute function update_updated_date();

-- ============================================================================
-- 6. ind_lista_vasilhames
-- ============================================================================
create table if not exists ind_lista_vasilhames (
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
alter table ind_lista_vasilhames enable row level security;
drop policy if exists "allow_all_ind_lista_vasilhames" on ind_lista_vasilhames;
create policy "allow_all_ind_lista_vasilhames" on ind_lista_vasilhames for all using (true) with check (true);
drop trigger if exists update_updated_date_ind_lista_vasilhames on ind_lista_vasilhames;
create trigger update_updated_date_ind_lista_vasilhames before update on ind_lista_vasilhames for each row execute function update_updated_date();

-- ============================================================================
-- 6b. ind_composicao_vasilhame (multi-OP composition for complementary packaging)
-- ============================================================================
create table if not exists ind_composicao_vasilhame (
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
alter table ind_composicao_vasilhame enable row level security;
drop policy if exists "allow_all_ind_composicao_vasilhame" on ind_composicao_vasilhame;
create policy "allow_all_ind_composicao_vasilhame" on ind_composicao_vasilhame for all using (true) with check (true);

-- ============================================================================
-- 7. cadastro_pedidos_ind (antes: ind_lista_pedidos)
-- ============================================================================
create table if not exists cadastro_pedidos_ind (
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
alter table cadastro_pedidos_ind enable row level security;
drop policy if exists "allow_all_cadastro_pedidos_ind" on cadastro_pedidos_ind;
create policy "allow_all_cadastro_pedidos_ind" on cadastro_pedidos_ind for all using (true) with check (true);
drop trigger if exists update_updated_date_cadastro_pedidos_ind on cadastro_pedidos_ind;
create trigger update_updated_date_cadastro_pedidos_ind before update on cadastro_pedidos_ind for each row execute function update_updated_date();

-- Cascade client_order do pedido para OPs vinculadas
create or replace function sync_order_client_order_to_productions()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.client_order is distinct from old.client_order then
    update ind_lista_producoes
    set
      client_order = new.client_order,
      updated_date = now()
    where order_id = new.id
      and client_order is distinct from new.client_order;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sync_order_client_order on cadastro_pedidos_ind;
create trigger trg_sync_order_client_order
  after update of client_order on cadastro_pedidos_ind
  for each row
  execute function sync_order_client_order_to_productions();

-- ============================================================================
-- 8. ind_lista_receitas
-- NOTA (046): em ambientes migrados a tabela foi renomeada para `receitas`.
-- NOTA (047): 1 linha por MP por revisão — ver
-- src/modules/industrializacao/sql/047_receitas_linhas_mp.sql
-- Este CREATE histórico permanece para instalação legada; ver
-- src/modules/transbordo/sql/046_cadastro_produtos_central.sql
-- ============================================================================
create table if not exists ind_lista_receitas (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  created_by text,
  code text,
  product_name text not null,
  client text,
  density numeric,
  price numeric,
  revision text,
  revision_date date,
  revision_number integer not null default 1,
  validity_days numeric,
  raw_materials jsonb,
  fds_url text,
  fds_filename text,
  fds_uploaded_at timestamptz,
  fds_uploaded_by text,
  necessita_n2 boolean not null default false,
  constraint ind_lista_receitas_product_revision_unique unique (product_name, revision_number)
);
create index if not exists idx_ind_lista_receitas_product_revision on ind_lista_receitas (product_name, revision_number desc);
alter table ind_lista_receitas enable row level security;
drop policy if exists "allow_all_ind_lista_receitas" on ind_lista_receitas;
create policy "allow_all_ind_lista_receitas" on ind_lista_receitas for all using (true) with check (true);
drop trigger if exists update_updated_date_ind_lista_receitas on ind_lista_receitas;
create trigger update_updated_date_ind_lista_receitas before update on ind_lista_receitas for each row execute function update_updated_date();

-- ============================================================================
-- 8b. checklist_op (checklists operacionais obrigatórios)
-- ============================================================================
create table if not exists checklist_op (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  production_id text not null,
  op_number text,
  product text,
  recipe_id text,
  etapa text not null
    check (etapa in (
      'start_production',
      'pause_production',
      'start_filling',
      'finish_filling'
    )),
  question_key text not null,
  question_label text not null,
  answer text not null,
  observacao text,
  usuario_id text,
  usuario_nome text,
  answered_at timestamptz not null default now()
);
alter table checklist_op enable row level security;
drop policy if exists "allow_all_checklist_op" on checklist_op;
create policy "allow_all_checklist_op" on checklist_op for all using (true) with check (true);
drop trigger if exists update_updated_date_checklist_op on checklist_op;
create trigger update_updated_date_checklist_op before update on checklist_op for each row execute function update_updated_date();
create index if not exists idx_checklist_op_prod_etapa on checklist_op (production_id, etapa);
create index if not exists idx_checklist_op_etapa_answered on checklist_op (etapa, answered_at);

-- ============================================================================
-- 9. resultados_cq (antes: ind_cq_resultados)
-- NOTA (053): 1 linha por análise. resultado_id agrupa o certificado.
-- status é o parecer geral; analysis_status é o parecer da análise.
-- results jsonb fica nulo. Ver 053_ind_cq_resultados_linhas.sql
-- ============================================================================
create table if not exists resultados_cq (
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
  sample_photo_url text,
  results jsonb,
  resultado_id text,
  linha_ordem integer not null default 1,
  analysis_name text,
  methodology text,
  specification text,
  unit text,
  min_limit numeric,
  max_limit numeric,
  result text,
  analysis_status text
);
alter table resultados_cq enable row level security;
drop policy if exists "allow_all_resultados_cq" on resultados_cq;
create policy "allow_all_resultados_cq" on resultados_cq for all using (true) with check (true);
drop trigger if exists update_updated_date_resultados_cq on resultados_cq;
create trigger update_updated_date_resultados_cq before update on resultados_cq for each row execute function update_updated_date();

-- ============================================================================
-- 10. cadastro_analises (antes: ind_cq_esp_tec)
-- NOTA (051): em produção a tabela é renomeada e passa a ter 1 linha por
-- análise, com codigo_en (EN01). Este CREATE é o formato legado (analyses jsonb).
-- Ver src/modules/industrializacao/sql/051_cq_esp_tec_linhas.sql
-- ============================================================================
create table if not exists cadastro_analises (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  created_by text,
  product text not null,
  client text,
  revision text,
  revision_date date,
  validity_days numeric,
  analyses jsonb
);
alter table cadastro_analises enable row level security;
drop policy if exists "allow_all_cadastro_analises" on cadastro_analises;
create policy "allow_all_cadastro_analises" on cadastro_analises for all using (true) with check (true);
drop trigger if exists update_updated_date_cadastro_analises on cadastro_analises;
create trigger update_updated_date_cadastro_analises before update on cadastro_analises for each row execute function update_updated_date();

-- ============================================================================
-- 10b. cadastro_analises_metodologia (catálogo Lista de Ensaios)
-- ============================================================================
create table if not exists cadastro_analises_metodologia (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz default now(),
  updated_date timestamptz default now(),
  created_by_id text,
  analysis_name text not null,
  methodology text,
  unit text,
  is_active boolean not null default true,
  created_by text,
  constraint cadastro_analises_metodologia_name_unique unique (analysis_name)
);
alter table cadastro_analises_metodologia enable row level security;
drop policy if exists "allow_all_cadastro_analises_metodologia" on cadastro_analises_metodologia;
create policy "allow_all_cadastro_analises_metodologia" on cadastro_analises_metodologia for all using (true) with check (true);
drop trigger if exists update_updated_date_cadastro_analises_metodologia on cadastro_analises_metodologia;
create trigger update_updated_date_cadastro_analises_metodologia before update on cadastro_analises_metodologia for each row execute function update_updated_date();

-- ============================================================================
-- 11. inventario (antes: ind_lista_inventario)
-- Pós-058: 1 produto por linha. inventario_id se repete. item = produto da linha.
-- O snapshot deixa inventario_id anulável; a 058 define NOT NULL depois da conversão.
-- ============================================================================
create table if not exists inventario (
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
  items jsonb default '[]'::jsonb,
  inventario_id text,
  linha_ordem integer not null default 1,
  stock_id text,
  item text,
  client text,
  product text,
  lot text,
  unit text,
  packaging_type text,
  packaging_capacity numeric,
  registered_stock numeric,
  registered_quantity numeric,
  physical_packages numeric,
  fractional_qty numeric,
  physical_total numeric,
  difference numeric,
  difference_pct numeric
);
alter table inventario enable row level security;
drop policy if exists "allow_all_inventario" on inventario;
create policy "allow_all_inventario" on inventario for all using (true) with check (true);
drop trigger if exists update_updated_date_inventario on inventario;
create trigger update_updated_date_inventario before update on inventario for each row execute function update_updated_date();

-- ============================================================================
-- Indexes for common queries
-- ============================================================================
create index if not exists idx_ind_lista_usuarios_usuario on ind_lista_usuarios(usuario);
create index if not exists idx_ind_lista_producoes_status on ind_lista_producoes(status);
create index if not exists idx_ind_lista_producoes_op_number on ind_lista_producoes(op_number);
create index if not exists idx_ind_lista_vasilhames_status on ind_lista_vasilhames(status);
create index if not exists idx_cadastro_pedidos_ind_status on cadastro_pedidos_ind(status);
create index if not exists idx_estoque_mp_mp_code on estoque_mp(mp_code);
create index if not exists idx_resultados_cq_production_id on resultados_cq(production_id);
create index if not exists idx_inventario_status on inventario(status);
create index if not exists idx_inventario_inventory_number on inventario(inventory_number);

-- ============================================================================
-- Supabase Realtime — enable postgres_changes on all tables
-- Run this once in the Supabase SQL Editor to activate real-time subscriptions.
-- ============================================================================
-- Drop existing publication to avoid errors on re-run
drop publication if exists supabase_realtime;

-- Create publication and add all tables
create publication supabase_realtime for table
  ind_lista_usuarios,
  ind_lista_producoes,
  estoque_mp,
  ind_retornos_perdas,
  ind_cadastro_tanka,
  ind_transbordo_ind,
  ind_lista_vasilhames,
  ind_composicao_vasilhame,
  cadastro_pedidos_ind,
  ind_lista_receitas,
  checklist_op,
  resultados_cq,
  cadastro_analises,
  cadastro_analises_metodologia,
  inventario,
  cadastro_equipamentolab;
