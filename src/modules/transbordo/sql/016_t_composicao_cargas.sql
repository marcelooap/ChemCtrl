-- Transbordo / Painel Comercial — Composição de carga
-- ============================================================
-- Agrupa uma ou mais saídas (t_saidas) sob um motorista / placa / transportadora.
-- Executar no SQL Editor do Supabase do ChemFlow.

create extension if not exists "pgcrypto";

create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists t_composicao_cargas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  transportadora text not null default '',
  motorista text not null default '',
  placa text not null default '',
  -- Derivados das saídas selecionadas (cache para a listagem)
  cliente_nome text,
  solicitante text,
  produtos_qtd integer not null default 0,
  saida_ids uuid[] not null default '{}',
  saidas jsonb not null default '[]'::jsonb,
  observacao text,
  usuario_id text,
  usuario_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_t_composicao_cargas_codigo unique (codigo)
);

drop trigger if exists t_composicao_cargas_set_updated_at on t_composicao_cargas;
create trigger t_composicao_cargas_set_updated_at
  before update on t_composicao_cargas
  for each row execute function t_set_updated_at();

create index if not exists idx_t_composicao_cargas_created on t_composicao_cargas (created_at desc);
create index if not exists idx_t_composicao_cargas_motorista on t_composicao_cargas (motorista);
create index if not exists idx_t_composicao_cargas_placa on t_composicao_cargas (placa);
create index if not exists idx_t_composicao_cargas_saida_ids on t_composicao_cargas using gin (saida_ids);

alter table t_composicao_cargas enable row level security;

drop policy if exists t_anon_all_t_composicao_cargas on t_composicao_cargas;
create policy t_anon_all_t_composicao_cargas on t_composicao_cargas
  for all
  to anon, authenticated
  using (true)
  with check (true);
