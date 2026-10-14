-- Color Cod da eslinga por destino (Check List de Expedição)
-- Painel → Configuração → Check List Expedição → Prazos por destino
-- Adiciona a coluna color_cod e atualiza a RPC de gravação atômica.
-- Idempotente e aditivo: não remove dados existentes.
-- Pré-requisito: 042_t_checklist_expedicao_validade_destinos.sql
-- Executar no SQL Editor do Supabase (ChemFlow).

alter table t_checklist_expedicao_validade_destinos
  add column if not exists color_cod text;

alter table t_checklist_expedicao_validade_destinos
  drop constraint if exists t_checklist_expedicao_validade_destinos_color_cod_check;

alter table t_checklist_expedicao_validade_destinos
  add constraint t_checklist_expedicao_validade_destinos_color_cod_check
  check (
    color_cod is null
    or color_cod in ('laranja', 'roxo', 'verde', 'amarelo', 'azul')
  );

comment on column t_checklist_expedicao_validade_destinos.color_cod is
  'Color Cod da eslinga do destino (laranja|roxo|verde|amarelo|azul).';

-- Substitui atomicamente os prazos por destino de um cliente.
-- p_prazos: [{ "destino": "Petrobras", "dias": 180, "color_cod": "verde" }, ...].
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
  v_color text;
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

    v_color := nullif(lower(btrim(coalesce(v_item->>'color_cod', ''))), '');
    if v_color is not null
       and v_color not in ('laranja', 'roxo', 'verde', 'amarelo', 'azul') then
      raise exception 'Color Cod do destino % é inválido', v_destino;
    end if;

    if lower(v_destino) = any (v_keys) then
      raise exception 'Destino % informado mais de uma vez', v_destino;
    end if;
    v_keys := array_append(v_keys, lower(v_destino));
  end loop;

  delete from t_checklist_expedicao_validade_destinos
  where cliente_id = p_cliente_id;

  insert into t_checklist_expedicao_validade_destinos (
    cliente_id, destino, prazo_validade_testes_dias, color_cod
  )
  select
    p_cliente_id,
    btrim(item->>'destino'),
    (item->>'dias')::integer,
    nullif(lower(btrim(coalesce(item->>'color_cod', ''))), '')
  from jsonb_array_elements(p_prazos) as item;

  return query
    select *
    from t_checklist_expedicao_validade_destinos
    where cliente_id = p_cliente_id
    order by created_at asc, destino asc;
end;
$$;

comment on function t_salvar_checklist_expedicao_validade_destinos(uuid, jsonb) is
  'Persiste atomicamente os prazos de validade dos testes e o Color Cod da eslinga por destino.';

grant execute on function t_salvar_checklist_expedicao_validade_destinos(uuid, jsonb)
  to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
