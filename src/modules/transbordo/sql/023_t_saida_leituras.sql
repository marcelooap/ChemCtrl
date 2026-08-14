-- Transbordo — Leitura individual de solicitações de saída do Painel
-- ============================================================
-- Controla quais saídas criadas no Painel Comercial já foram
-- visualizadas/validadas por cada usuário do módulo Transbordo.
-- Sem isso, a visualização de um usuário apagaria o "Novo" dos demais.
--
-- usuario_id é TEXT porque o ID vem da plataforma ChemCtrl
-- (não é auth.uid() do projeto ChemFlow).
--
-- Executar no SQL Editor do Supabase. Idempotente.

create extension if not exists "pgcrypto";

create table if not exists t_saida_leituras (
  id uuid primary key default gen_random_uuid(),
  saida_id uuid not null references t_saidas(id) on delete cascade,
  usuario_id text not null,
  visualizado_at timestamptz not null default now(),
  constraint uq_t_saida_leituras_saida_usuario unique (saida_id, usuario_id)
);

comment on table t_saida_leituras is
  'Leitura por usuário das solicitações de saída originadas no Painel (badge Novo no Transbordo).';

create index if not exists idx_t_saida_leituras_usuario
  on t_saida_leituras (usuario_id);

create index if not exists idx_t_saida_leituras_saida
  on t_saida_leituras (saida_id);

alter table t_saida_leituras enable row level security;

drop policy if exists t_anon_all_t_saida_leituras on t_saida_leituras;
create policy t_anon_all_t_saida_leituras on t_saida_leituras
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Realtime: INSERT/UPDATE/DELETE com payload completo
alter table t_saidas replica identity full;
alter table t_saida_leituras replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table t_saidas;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table t_saida_leituras;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
