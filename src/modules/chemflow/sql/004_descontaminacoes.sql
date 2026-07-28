-- ChemFlow — Descontaminações de tanka
-- Registro de limpeza/descontaminação exibido no Histórico de Locação do isotanque.

create table if not exists descontaminacoes (
  id uuid primary key default gen_random_uuid(),
  tanka text not null,
  data_descontaminacao date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger descontaminacoes_set_updated_at
  before update on descontaminacoes
  for each row execute function chemflow_set_updated_at();

create index if not exists idx_descontaminacoes_tanka
  on descontaminacoes (tanka);

create index if not exists idx_descontaminacoes_data
  on descontaminacoes (data_descontaminacao desc);

alter table descontaminacoes enable row level security;

drop policy if exists chemflow_anon_all_descontaminacoes on descontaminacoes;
create policy chemflow_anon_all_descontaminacoes on descontaminacoes
  for all
  to anon, authenticated
  using (true)
  with check (true);
