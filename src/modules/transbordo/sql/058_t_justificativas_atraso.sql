-- Cadastro de justificativas de atraso de carregamento (Logística)
-- Fonte única da lista em Painel → Configuração → Justificativas Atraso - logística
-- Idempotente. Executar no SQL Editor do Supabase.

create extension if not exists "pgcrypto";

create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists t_justificativas_atraso (
  id uuid primary key default gen_random_uuid(),
  motivo text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint t_justificativas_atraso_motivo_check check (length(btrim(motivo)) > 0)
);

create unique index if not exists uq_t_justificativas_atraso_motivo_ci
  on t_justificativas_atraso (lower(btrim(motivo)));

drop trigger if exists t_justificativas_atraso_set_updated_at on t_justificativas_atraso;
create trigger t_justificativas_atraso_set_updated_at
  before update on t_justificativas_atraso
  for each row execute function t_set_updated_at();

alter table t_justificativas_atraso enable row level security;

drop policy if exists t_anon_all_t_justificativas_atraso on t_justificativas_atraso;
create policy t_anon_all_t_justificativas_atraso on t_justificativas_atraso
  for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table t_justificativas_atraso is
  'Motivos de atraso sugeridos na conclusão de carregamentos. O valor gravado no agendamento é o texto do motivo (maiúsculas).';

insert into t_justificativas_atraso (motivo, ativo)
select v.motivo, true
from (values
  ('NOTA FISCAL'),
  ('DIVERGÊNCIAS DE CONFERÊNCIA'),
  ('EMPILHADEIRA'),
  ('AGUARDANDO CARRETA')
) as v(motivo)
where not exists (
  select 1
  from t_justificativas_atraso j
  where lower(btrim(j.motivo)) = lower(btrim(v.motivo))
);

SELECT pg_notify('pgrst', 'reload schema');
