-- ChemFlow: data de entrada (recebimento), editável e independente de created_at
alter table entradas
  add column if not exists data date;

-- Backfill: registros antigos usam a data de criação
update entradas
set data = (created_at at time zone 'America/Sao_Paulo')::date
where data is null;

alter table entradas
  alter column data set default current_date;

create index if not exists idx_entradas_data on entradas (data desc);
