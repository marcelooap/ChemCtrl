-- Prazos de validade dos testes por destino (Check List de Expedição)
-- Painel → Configuração → Check List Expedição
-- Cada linha vincula um destino (o mesmo da Solicitação de Saída, t_saidas.destino)
-- ao prazo, em dias, do item "Verificação da validade dos testes" de um cliente.
-- Idempotente e aditivo: não altera nem remove dados existentes. Clientes sem linhas
-- aqui continuam usando o prazo único de t_checklist_expedicao_config.
-- Pré-requisitos: 039_t_checklist_expedicao_itens.sql e 040_t_checklist_expedicao_config.sql.
-- Executar no SQL Editor do Supabase (ChemFlow).

create table if not exists t_checklist_expedicao_validade_destinos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null
    references t_checklist_expedicao_config(cliente_id) on delete cascade,
  destino text not null,
  prazo_validade_testes_dias integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint t_checklist_expedicao_validade_destinos_destino_check
    check (length(btrim(destino)) > 0),
  constraint t_checklist_expedicao_validade_destinos_prazo_check
    check (prazo_validade_testes_dias between 1 and 3650)
);

-- Um destino por cliente (sem diferenciar caixa/espaços nas pontas).
create unique index if not exists uq_t_checklist_expedicao_validade_destinos_cliente_destino
  on t_checklist_expedicao_validade_destinos (cliente_id, lower(btrim(destino)));

drop trigger if exists t_checklist_expedicao_validade_destinos_set_updated_at
  on t_checklist_expedicao_validade_destinos;
create trigger t_checklist_expedicao_validade_destinos_set_updated_at
  before update on t_checklist_expedicao_validade_destinos
  for each row execute function t_set_updated_at();

alter table t_checklist_expedicao_validade_destinos enable row level security;

drop policy if exists t_anon_all_t_checklist_expedicao_validade_destinos
  on t_checklist_expedicao_validade_destinos;
create policy t_anon_all_t_checklist_expedicao_validade_destinos
  on t_checklist_expedicao_validade_destinos
  for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table t_checklist_expedicao_validade_destinos is
  'Prazo de validade dos testes do tanque por destino, por cliente (Check List de Expedição).';

-- Substitui atomicamente os prazos por destino de um cliente.
-- p_prazos: [{ "destino": "Petrobras", "dias": 180 }, ...]. Array vazio remove todos.
create or replace function t_salvar_checklist_expedicao_validade_destinos(
  p_cliente_id uuid,
  p_prazos jsonb
)
returns setof t_checklist_expedicao_validade_destinos
language plpgsql
as $$
declare
  v_item jsonb;
  v_destino text;
  v_keys text[] := '{}';
begin
  if p_cliente_id is null then
    raise exception 'cliente_id é obrigatório';
  end if;

  if p_prazos is null or jsonb_typeof(p_prazos) <> 'array' then
    raise exception 'prazos deve ser um array JSON';
  end if;

  if not exists (
    select 1 from t_checklist_expedicao_config where cliente_id = p_cliente_id
  ) then
    raise exception 'Salve a configuração da validade dos testes do cliente antes dos prazos por destino';
  end if;

  for v_item in select * from jsonb_array_elements(p_prazos)
  loop
    v_destino := btrim(coalesce(v_item->>'destino', ''));
    if length(v_destino) = 0 then
      raise exception 'Destino é obrigatório';
    end if;

    if coalesce(v_item->>'dias', '') !~ '^[0-9]+$'
       or (v_item->>'dias')::integer not between 1 and 3650 then
      raise exception 'Prazo de validade do destino % deve ser um inteiro entre 1 e 3650 dias', v_destino;
    end if;

    if lower(v_destino) = any (v_keys) then
      raise exception 'Destino % informado mais de uma vez', v_destino;
    end if;
    v_keys := array_append(v_keys, lower(v_destino));
  end loop;

  delete from t_checklist_expedicao_validade_destinos
  where cliente_id = p_cliente_id;

  insert into t_checklist_expedicao_validade_destinos (
    cliente_id, destino, prazo_validade_testes_dias
  )
  select
    p_cliente_id,
    btrim(item->>'destino'),
    (item->>'dias')::integer
  from jsonb_array_elements(p_prazos) as item;

  return query
    select *
    from t_checklist_expedicao_validade_destinos
    where cliente_id = p_cliente_id
    order by created_at asc, destino asc;
end;
$$;

comment on function t_salvar_checklist_expedicao_validade_destinos(uuid, jsonb) is
  'Persiste atomicamente os prazos de validade dos testes por destino de um cliente.';

grant execute on function t_salvar_checklist_expedicao_validade_destinos(uuid, jsonb)
  to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
