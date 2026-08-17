-- Cadastro de operadores (responsáveis) do Transbordo
-- Fonte única da lista suspensa em Painel → Configurações → Operadores
-- Idempotente. Executar no SQL Editor do Supabase.

create extension if not exists "pgcrypto";

create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists t_operadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_t_operadores_nome_ci
  on t_operadores (lower(btrim(nome)));

drop trigger if exists t_operadores_set_updated_at on t_operadores;
create trigger t_operadores_set_updated_at
  before update on t_operadores
  for each row execute function t_set_updated_at();

alter table t_operadores enable row level security;

drop policy if exists t_anon_all_t_operadores on t_operadores;
create policy t_anon_all_t_operadores on t_operadores
  for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table t_operadores is
  'Operadores de chão de fábrica usados como responsáveis nas OPs de Transbordo. Registros históricos guardam o nome (não o id).';

insert into t_operadores (nome, ativo)
select v.nome, true
from (values
  ('Adriano Q.'),
  ('Leonardo S.'),
  ('Rafael N.'),
  ('Mariano'),
  ('Ezequiel F.'),
  ('Wandre C.')
) as v(nome)
where not exists (
  select 1
  from t_operadores o
  where lower(btrim(o.nome)) = lower(btrim(v.nome))
);

SELECT pg_notify('pgrst', 'reload schema');
