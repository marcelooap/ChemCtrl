-- Checklist de carregamento (Logística)
-- Executar no SQL Editor do Supabase do ChemFlow.

alter table t_agendamentos_carregamento
  add column if not exists checklist_respostas jsonb,
  add column if not exists checklist_validado_em timestamptz,
  add column if not exists checklist_operador_id text,
  add column if not exists checklist_operador_nome text;

create index if not exists idx_t_agendamentos_checklist_validado
  on t_agendamentos_carregamento (checklist_validado_em)
  where checklist_validado_em is not null;
