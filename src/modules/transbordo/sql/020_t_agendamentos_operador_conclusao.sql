-- Agendamentos concluídos — operador e agrupamento do carregamento
-- Idempotente: pode rodar após 019_t_agendamentos_concluir_carregamento.sql

alter table t_agendamentos_carregamento
  add column if not exists operador_conclusao_id text,
  add column if not exists operador_conclusao_nome text,
  add column if not exists grupo_conclusao_id uuid;

create index if not exists idx_t_agendamentos_concluidos
  on t_agendamentos_carregamento (status, data desc, hora_carregamento desc)
  where status = 'concluido';

create index if not exists idx_t_agendamentos_grupo_conclusao
  on t_agendamentos_carregamento (grupo_conclusao_id)
  where grupo_conclusao_id is not null;

SELECT pg_notify('pgrst', 'reload schema');
