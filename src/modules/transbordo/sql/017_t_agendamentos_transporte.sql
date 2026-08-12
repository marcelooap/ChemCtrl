-- Agendamentos de carregamento — dados de transporte no horário
-- Idempotente: pode rodar após 015_t_agendamentos_carregamento.sql

alter table t_agendamentos_carregamento
  add column if not exists transportadora text,
  add column if not exists motorista text,
  add column if not exists placa text;

create index if not exists idx_t_agendamentos_placa
  on t_agendamentos_carregamento (placa);

SELECT pg_notify('pgrst', 'reload schema');
