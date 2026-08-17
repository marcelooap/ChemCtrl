-- Configuração de etiquetas por cliente / contexto / tipo
-- Painel → Configurações → Etiquetas
-- Idempotente. Executar no SQL Editor do Supabase.

create extension if not exists "pgcrypto";

create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists t_etiqueta_configs (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references t_clientes(id) on delete set null,
  cliente_nome text not null,
  -- industrializacao | convencional
  contexto text not null,
  -- granel | embalado
  tipo text not null,
  -- [{ key, enabled, ordem }]
  campos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint t_etiqueta_configs_contexto_check
    check (contexto in ('industrializacao', 'convencional')),
  constraint t_etiqueta_configs_tipo_check
    check (tipo in ('granel', 'embalado'))
);

create unique index if not exists uq_t_etiqueta_configs_ctx_tipo_cliente
  on t_etiqueta_configs (contexto, tipo, lower(btrim(cliente_nome)));

create index if not exists idx_t_etiqueta_configs_cliente_id
  on t_etiqueta_configs (cliente_id);

drop trigger if exists t_etiqueta_configs_set_updated_at on t_etiqueta_configs;
create trigger t_etiqueta_configs_set_updated_at
  before update on t_etiqueta_configs
  for each row execute function t_set_updated_at();

alter table t_etiqueta_configs enable row level security;

drop policy if exists t_anon_all_t_etiqueta_configs on t_etiqueta_configs;
create policy t_anon_all_t_etiqueta_configs on t_etiqueta_configs
  for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table t_etiqueta_configs is
  'Layout de etiqueta por cliente e contexto (Industrialização/Convencional).';

-- Cadastro do cliente: responsável técnico + config de etiqueta (fallback se t_etiqueta_configs não for usada)
alter table t_clientes
  add column if not exists responsavel_tecnico text;

alter table t_clientes
  add column if not exists config_etiquetas jsonb not null default '{}'::jsonb;

comment on column t_clientes.responsavel_tecnico is
  'Responsável técnico do cliente, impresso na etiqueta quando o campo estiver ativo.';

comment on column t_clientes.config_etiquetas is
  'Configuração de etiqueta por contexto, ex.: {"industrializacao":{"campos":[]},"convencional":{"campos":[]}}.';

SELECT pg_notify('pgrst', 'reload schema');
