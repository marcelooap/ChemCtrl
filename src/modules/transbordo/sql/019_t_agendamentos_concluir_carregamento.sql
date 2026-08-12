-- Agendamentos de carregamento — conclusão operacional
-- Idempotente: pode rodar após 015_t_agendamentos_carregamento.sql
--
-- Adiciona status 'concluido' e horário real do carregamento (HH:MM).

alter table t_agendamentos_carregamento
  drop constraint if exists t_agendamentos_carregamento_status_check;

alter table t_agendamentos_carregamento
  add constraint t_agendamentos_carregamento_status_check
  check (status in ('agendado', 'cancelado', 'concluido'));

alter table t_agendamentos_carregamento
  add column if not exists hora_carregamento text;

create index if not exists idx_t_agendamentos_hora_carregamento
  on t_agendamentos_carregamento (hora_carregamento)
  where hora_carregamento is not null;

SELECT pg_notify('pgrst', 'reload schema');
