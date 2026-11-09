-- Histórico de validação por tanque (transferível entre saídas)
-- ============================================================
-- Quando um item já validado é removido de uma saída (após
-- desvalidação), o check de histórico precisa poder acompanhar
-- o tanque ao ser incluído em outra saída.
--
-- Esta tabela guarda o histórico "órfão" até ser consumido pela
-- nova composição. Idempotente. Executar no SQL Editor do ChemFlow.

create extension if not exists "pgcrypto";

create table if not exists t_saida_validacao_historico_tanque (
  tank_key text primary key,
  placa_key text,
  vasilhame_id text,
  container_id text,
  placa text,
  barril text,
  source_saida_id uuid,
  source_saida_codigo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_t_saida_validacao_historico_tanque_placa
  on t_saida_validacao_historico_tanque (placa_key)
  where placa_key is not null and btrim(placa_key) <> '';

create index if not exists idx_t_saida_validacao_historico_tanque_vasilhame
  on t_saida_validacao_historico_tanque (vasilhame_id)
  where vasilhame_id is not null and btrim(vasilhame_id) <> '';

create index if not exists idx_t_saida_validacao_historico_tanque_container
  on t_saida_validacao_historico_tanque (container_id)
  where container_id is not null and btrim(container_id) <> '';

comment on table t_saida_validacao_historico_tanque is
  'Histórico de validação de tanque removido de uma saída, pendente de herança por outra saída.';

alter table t_saida_validacao_historico_tanque enable row level security;

drop policy if exists t_anon_all_t_saida_validacao_historico_tanque
  on t_saida_validacao_historico_tanque;
create policy t_anon_all_t_saida_validacao_historico_tanque
  on t_saida_validacao_historico_tanque
  for all
  to anon, authenticated
  using (true)
  with check (true);
