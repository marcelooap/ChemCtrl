-- Permite mais de uma saída no mesmo horário de carregamento.
-- Cada saída continua podendo estar em apenas um horário ativo.

drop index if exists uq_t_agendamentos_slot_ativo;

create index if not exists idx_t_agendamentos_slot
  on t_agendamentos_carregamento (data, horario);

SELECT pg_notify('pgrst', 'reload schema');
