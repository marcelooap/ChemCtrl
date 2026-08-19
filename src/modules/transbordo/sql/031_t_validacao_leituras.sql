-- Leituras de validações pendentes (Recebimento / Ordem de Transbordo)
-- ============================================================
-- Badge "Novo" na sidebar de Transbordo e Industrialização, por usuário.
-- validacao_id é TEXT: t_transbordo_validacoes.id (uuid) e ind_validacoes.id (text).

create extension if not exists "pgcrypto";

create table if not exists t_validacao_leituras (
  id uuid primary key default gen_random_uuid(),
  validacao_id text not null,
  usuario_id text not null,
  modulo text not null check (modulo in ('transbordo', 'industrializacao')),
  visualizado_at timestamptz not null default now(),
  constraint uq_t_validacao_leituras_item unique (validacao_id, usuario_id, modulo)
);

comment on table t_validacao_leituras is
  'Leitura por usuário das validações originadas no Painel (Recebimento e Ordem de Transbordo).';

create index if not exists idx_t_validacao_leituras_usuario
  on t_validacao_leituras (usuario_id, modulo);
create index if not exists idx_t_validacao_leituras_validacao
  on t_validacao_leituras (validacao_id);

alter table t_validacao_leituras enable row level security;

drop policy if exists t_anon_all_t_validacao_leituras on t_validacao_leituras;
create policy t_anon_all_t_validacao_leituras on t_validacao_leituras
  for all
  to anon, authenticated
  using (true)
  with check (true);

alter table t_validacao_leituras replica identity full;
alter table t_transbordo_validacoes replica identity full;

do $$
begin
  if to_regclass('public.ind_validacoes') is not null then
    execute 'alter table ind_validacoes replica identity full';
  end if;
end $$;

do $$
begin
  begin
    alter publication supabase_realtime add table t_validacao_leituras;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table t_transbordo_validacoes;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    if to_regclass('public.ind_validacoes') is not null then
      alter publication supabase_realtime add table ind_validacoes;
    end if;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

select pg_notify('pgrst', 'reload schema');
