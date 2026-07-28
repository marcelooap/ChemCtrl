-- ChemFlow — Filtrações
-- Registros de vasilhames provenientes de transbordo de produtos marcados como filtrados.
-- Controles de SAE e contagem de partículas por tamanho (µm).

create table if not exists filtracoes (
  id uuid primary key default gen_random_uuid(),
  vasilhame_id uuid references vasilhames(id) on delete cascade,
  transbordo_id uuid references transbordos(id) on delete set null,
  codigo text,
  placa text default '',
  barril text default '',
  produto_id uuid,
  produto_codigo text default '',
  produto_nome text default '',
  cliente_id uuid,
  cliente_nome text default '',
  lote text default '',
  composicao jsonb not null default '[]'::jsonb,
  volume numeric default 0,
  sae integer,
  particulas_6 numeric,
  particulas_14 numeric,
  particulas_21 numeric,
  particulas_38 numeric,
  particulas_70 numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger filtracoes_set_updated_at
  before update on filtracoes
  for each row execute function chemflow_set_updated_at();

create index if not exists idx_filtracoes_vasilhame
  on filtracoes (vasilhame_id);

create index if not exists idx_filtracoes_transbordo
  on filtracoes (transbordo_id);

create index if not exists idx_filtracoes_codigo
  on filtracoes (codigo);

create index if not exists idx_filtracoes_produto
  on filtracoes (produto_id);

create index if not exists idx_filtracoes_composicao
  on filtracoes using gin (composicao);

alter table filtracoes enable row level security;

drop policy if exists chemflow_anon_all_filtracoes on filtracoes;
create policy chemflow_anon_all_filtracoes on filtracoes
  for all
  to anon, authenticated
  using (true)
  with check (true);
