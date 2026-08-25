-- Justificativa de atraso na conclusão do carregamento
-- Idempotente: pode rodar após 019 / 020 / 029

alter table t_agendamentos_carregamento
  add column if not exists data_carregamento date,
  add column if not exists justificativa_atraso_responsavel text,
  add column if not exists justificativa_atraso_motivo text;

comment on column t_agendamentos_carregamento.data_carregamento is
  'Data real do carregamento (pode diferir da data agendada).';
comment on column t_agendamentos_carregamento.justificativa_atraso_responsavel is
  'Responsável pelo atraso: cliente | intertank';
comment on column t_agendamentos_carregamento.justificativa_atraso_motivo is
  'Motivo do atraso: nota_fiscal | divergencias_conferencia | empilhadeira | aguardando_carreta';

SELECT pg_notify('pgrst', 'reload schema');
