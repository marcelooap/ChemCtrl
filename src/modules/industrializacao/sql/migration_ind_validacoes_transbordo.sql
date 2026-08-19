-- Industrialização — validação também recebe Ordem de Transbordo
-- (destino Industrialização). Tipos: entrada | granel_transbordo | transbordo.

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'ind_validacoes'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%tipo%'
  loop
    execute format('alter table public.ind_validacoes drop constraint %I', r.conname);
  end loop;
end $$;

alter table ind_validacoes
  add constraint ind_validacoes_tipo_check
  check (tipo in ('entrada', 'granel_transbordo', 'transbordo'));

alter table ind_validacoes
  add column if not exists transbordo_payload jsonb;

alter table ind_validacoes
  add column if not exists transbordo_id text;

alter table ind_validacoes
  add column if not exists entrada_id text;

comment on column ind_validacoes.transbordo_payload is
  'Payload da Ordem de Transbordo (destino Industrialização) para conferência/efetivação.';

select pg_notify('pgrst', 'reload schema');
