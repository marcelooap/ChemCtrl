-- Cancelamento de carregamento em solicitações de saída.
-- Status `cancelado` permanece no histórico; agendamento ativo é liberado no app.
-- Idempotente: pode rodar mais de uma vez com segurança.

alter table t_saidas
  add column if not exists cancelamento_justificativa text,
  add column if not exists cancelamento_usuario text,
  add column if not exists cancelamento_data timestamptz;

comment on column t_saidas.cancelamento_justificativa is
  'Motivo obrigatório do cancelamento do carregamento.';
comment on column t_saidas.cancelamento_usuario is
  'Nome de quem cancelou o carregamento.';
comment on column t_saidas.cancelamento_data is
  'Data/hora do cancelamento do carregamento.';

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 't_saidas'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
      and pg_get_constraintdef(c.oid) ilike '%aguardando%'
  loop
    execute format('alter table t_saidas drop constraint %I', r.conname);
  end loop;
end $$;

alter table t_saidas
  add constraint t_saidas_status_check
  check (status in ('aguardando', 'enviado_fiscal', 'cancelado'));

-- Saída cancelada não compromete saldo de reserva.
create or replace function t_saida_pendente_baixa(
  p_validacao jsonb,
  p_enviado boolean,
  p_status text
) returns boolean
language plpgsql
stable
as $$
begin
  if lower(coalesce(p_status, '')) = 'cancelado' then
    return false;
  end if;

  if p_validacao is not null
     and jsonb_typeof(p_validacao) = 'object'
     and p_validacao ? 'transbordo'
     and jsonb_typeof(p_validacao->'transbordo') = 'object'
     and (p_validacao->'transbordo') ? 'validado' then
    return not coalesce((p_validacao->'transbordo'->>'validado')::boolean, false);
  end if;
  return not (coalesce(p_enviado, false) or p_status = 'enviado_fiscal');
end;
$$;

select pg_notify('pgrst', 'reload schema');
