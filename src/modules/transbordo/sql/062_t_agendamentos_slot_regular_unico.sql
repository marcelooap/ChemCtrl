-- Horário regular: no máximo 1 saída ativa por (data, horario).
-- Encaixe continua permitindo várias saídas no mesmo dia (uma por card).
-- Cancela duplicatas legadas em horários regulares (mantém o agendamento mais antigo).

with ranked as (
  select
    id,
    row_number() over (
      partition by data, horario
      order by created_at asc, id asc
    ) as rn
  from t_agendamentos_carregamento
  where status = 'agendado'
    and tipo = 'regular'
    and horario is distinct from 'encaixe'
)
update t_agendamentos_carregamento a
set status = 'cancelado',
    updated_at = now()
from ranked r
where a.id = r.id
  and r.rn > 1;

drop index if exists uq_t_agendamentos_slot_ativo;
drop index if exists uq_t_agendamentos_slot_regular_ativo;

create unique index if not exists uq_t_agendamentos_slot_regular_ativo
  on t_agendamentos_carregamento (data, horario)
  where status = 'agendado'
    and tipo = 'regular'
    and horario is distinct from 'encaixe';

SELECT pg_notify('pgrst', 'reload schema');
