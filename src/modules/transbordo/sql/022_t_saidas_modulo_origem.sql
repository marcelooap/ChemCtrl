-- Identifica o módulo que criou a solicitação de saída.
-- ChemFlow (transbordo) vs Painel Comercial vs Industrialização.
-- Idempotente: pode rodar mais de uma vez com segurança.

alter table t_saidas
  add column if not exists modulo_origem text;

comment on column t_saidas.modulo_origem is
  'Módulo criador da saída: chemflow | painel | industrializacao. Null = legado (pré-isolamento).';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 't_saidas_modulo_origem_check'
  ) then
    alter table t_saidas
      add constraint t_saidas_modulo_origem_check
      check (
        modulo_origem is null
        or modulo_origem in ('chemflow', 'painel', 'industrializacao')
      );
  end if;
end $$;

create index if not exists idx_t_saidas_modulo_origem
  on t_saidas (modulo_origem);
