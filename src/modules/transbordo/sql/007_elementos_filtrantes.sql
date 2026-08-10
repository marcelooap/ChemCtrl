-- ChemFlow — Elementos filtrantes (insumos de filtração)
-- Cartuchos com código F001, F002… e vínculo opcional nas filtrações.

create table if not exists elementos_filtrantes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  tipo text not null default 'Cartucho',
  marca text default '',
  data_compra date,
  status text not null default 'Almoxarifado'
    check (status in ('Em uso', 'Almoxarifado', 'Descartado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger elementos_filtrantes_set_updated_at
  before update on elementos_filtrantes
  for each row execute function chemflow_set_updated_at();

create index if not exists idx_elementos_filtrantes_codigo
  on elementos_filtrantes (codigo);

create index if not exists idx_elementos_filtrantes_status
  on elementos_filtrantes (status);

alter table elementos_filtrantes enable row level security;

drop policy if exists chemflow_anon_all_elementos_filtrantes on elementos_filtrantes;
create policy chemflow_anon_all_elementos_filtrantes on elementos_filtrantes
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Vínculo do cartucho usado em cada registro de filtração
alter table filtracoes
  add column if not exists filtro_id uuid references elementos_filtrantes(id) on delete set null;

alter table filtracoes
  add column if not exists filtro_codigo text default '';

create index if not exists idx_filtracoes_filtro
  on filtracoes (filtro_id);
