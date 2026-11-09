-- Cadastro de destinos de carregamento (Solicitação de Saída / Check List)
-- Fonte única da lista suspensa em Painel → Configuração → Destino Carregamentos
-- Idempotente. Executar no SQL Editor do Supabase.

create extension if not exists "pgcrypto";

create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists t_saida_destinos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint t_saida_destinos_nome_check check (length(btrim(nome)) > 0)
);

create unique index if not exists uq_t_saida_destinos_nome_ci
  on t_saida_destinos (lower(btrim(nome)));

drop trigger if exists t_saida_destinos_set_updated_at on t_saida_destinos;
create trigger t_saida_destinos_set_updated_at
  before update on t_saida_destinos
  for each row execute function t_set_updated_at();

alter table t_saida_destinos enable row level security;

drop policy if exists t_anon_all_t_saida_destinos on t_saida_destinos;
create policy t_anon_all_t_saida_destinos on t_saida_destinos
  for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table t_saida_destinos is
  'Destinos da carga usados na Solicitação de Saída e nos prazos do Check List de Expedição. Registros históricos guardam o nome (não o id).';

comment on column t_saidas.destino is
  'Destino da carga (cadastro: t_saida_destinos). Null = em branco.';

insert into t_saida_destinos (nome, ativo)
select v.nome, true
from (values
  ('Petrobras'),
  ('Petrorio'),
  ('Trident'),
  ('Total Energies'),
  ('Shell'),
  ('Equinor'),
  ('Derio'),
  ('Deaçu'),
  ('Modec'),
  ('BW'),
  ('KAROON'),
  ('YINSON')
) as v(nome)
where not exists (
  select 1
  from t_saida_destinos d
  where lower(btrim(d.nome)) = lower(btrim(v.nome))
);

SELECT pg_notify('pgrst', 'reload schema');
