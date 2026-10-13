-- Configuração do Checklist de Expedição por cliente
-- Verificação da validade dos testes do tanque.
-- Painel → Configuração → Check List Expedição
-- Idempotente e aditivo (não altera nem remove dados existentes).
-- Pré-requisito: 039_t_checklist_expedicao_itens.sql.
-- Executar no SQL Editor do Supabase (ChemFlow).

create table if not exists t_checklist_expedicao_config (
  cliente_id uuid primary key references t_clientes(id) on delete cascade,
  verificar_validade_testes boolean not null default false,
  prazo_validade_testes_dias integer not null default 180,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint t_checklist_expedicao_config_prazo_check
    check (prazo_validade_testes_dias between 1 and 3650)
);

drop trigger if exists t_checklist_expedicao_config_set_updated_at on t_checklist_expedicao_config;
create trigger t_checklist_expedicao_config_set_updated_at
  before update on t_checklist_expedicao_config
  for each row execute function t_set_updated_at();

alter table t_checklist_expedicao_config enable row level security;

drop policy if exists t_anon_all_t_checklist_expedicao_config on t_checklist_expedicao_config;
create policy t_anon_all_t_checklist_expedicao_config on t_checklist_expedicao_config
  for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table t_checklist_expedicao_config is
  'Configuração do checklist de expedição por cliente (verificação da validade dos testes do tanque).';

-- Upsert da configuração de um cliente, validando o prazo no banco.
create or replace function t_salvar_checklist_expedicao_config(
  p_cliente_id uuid,
  p_verificar_validade_testes boolean,
  p_prazo_validade_testes_dias integer
)
returns t_checklist_expedicao_config
language plpgsql
as $$
declare
  v_row t_checklist_expedicao_config;
begin
  if p_cliente_id is null then
    raise exception 'cliente_id é obrigatório';
  end if;

  if p_prazo_validade_testes_dias is null
     or p_prazo_validade_testes_dias < 1
     or p_prazo_validade_testes_dias > 3650 then
    raise exception 'Prazo de validade dos testes deve estar entre 1 e 3650 dias';
  end if;

  insert into t_checklist_expedicao_config (
    cliente_id, verificar_validade_testes, prazo_validade_testes_dias
  )
  values (
    p_cliente_id,
    coalesce(p_verificar_validade_testes, false),
    p_prazo_validade_testes_dias
  )
  on conflict (cliente_id) do update
    set verificar_validade_testes = excluded.verificar_validade_testes,
        prazo_validade_testes_dias = excluded.prazo_validade_testes_dias
  returning * into v_row;

  return v_row;
end;
$$;

comment on function t_salvar_checklist_expedicao_config(uuid, boolean, integer) is
  'Persiste a configuração do checklist de expedição de um cliente.';

grant execute on function t_salvar_checklist_expedicao_config(uuid, boolean, integer)
  to anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
