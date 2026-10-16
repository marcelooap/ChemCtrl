-- Testes de verificação por destino (Check List de Expedição)
-- Painel → Configuração → Check List Expedição → Testes por destino
-- Cada destino passa a ter uma lista de testes: [{ "nome", "prazo_dias" }].
-- A coluna prazo_validade_testes_dias permanece (maior prazo do destino) para
-- não quebrar a constraint já existente.
-- Idempotente. Pré-requisito: 043_t_checklist_expedicao_validade_destinos_color_cod.sql
-- Executar no SQL Editor do Supabase (ChemFlow).

alter table t_checklist_expedicao_validade_destinos
  add column if not exists testes jsonb not null default '[]'::jsonb;

alter table t_checklist_expedicao_validade_destinos
  drop constraint if exists t_checklist_expedicao_validade_destinos_testes_check;

alter table t_checklist_expedicao_validade_destinos
  add constraint t_checklist_expedicao_validade_destinos_testes_check
  check (jsonb_typeof(testes) = 'array');

comment on column t_checklist_expedicao_validade_destinos.testes is
  'Testes conferidos neste destino: [{"nome":"Teste hidrostático","prazo_dias":180}].';

-- Converte o prazo único legado uma única vez, quando nenhum destino tem testes ainda.
do $$
begin
  if not exists (
    select 1
    from t_checklist_expedicao_validade_destinos
    where jsonb_array_length(testes) > 0
  ) then
    update t_checklist_expedicao_validade_destinos
    set testes = jsonb_build_array(
      jsonb_build_object(
        'nome', 'Validade dos testes',
        'prazo_dias', prazo_validade_testes_dias
      )
    )
    where jsonb_array_length(testes) = 0;
  end if;
end $$;

-- O tipo da linha mudou (coluna nova). Reabrir a função evita
-- "cannot change return type of existing function".
drop function if exists t_salvar_checklist_expedicao_validade_destinos(uuid, jsonb);

-- p_prazos: [{ "destino", "dias", "color_cod", "testes": [{ "nome", "prazo_dias" }] }]
-- Sem "testes", mantém o comportamento antigo (só o prazo único em dias).
create function t_salvar_checklist_expedicao_validade_destinos(
  p_cliente_id uuid,
  p_prazos jsonb
)
returns setof t_checklist_expedicao_validade_destinos
language plpgsql
as $$
declare
  v_item jsonb;
  v_teste jsonb;
  v_destino text;
  v_color text;
  v_nome text;
  v_prazo integer;
  v_legacy_dias integer;
  v_testes jsonb;
  v_teste_keys text[];
  v_keys text[] := '{}';
  v_clean jsonb := '[]'::jsonb;
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

    v_color := nullif(lower(btrim(coalesce(v_item->>'color_cod', ''))), '');
    if v_color is not null
       and v_color not in ('laranja', 'roxo', 'verde', 'amarelo', 'azul') then
      raise exception 'Color Cod do destino % é inválido', v_destino;
    end if;

    if lower(v_destino) = any (v_keys) then
      raise exception 'Destino % informado mais de uma vez', v_destino;
    end if;
    v_keys := array_append(v_keys, lower(v_destino));

    v_testes := '[]'::jsonb;
    v_teste_keys := '{}';
    v_legacy_dias := null;

    if jsonb_typeof(v_item->'testes') = 'array'
       and jsonb_array_length(v_item->'testes') > 0 then
      for v_teste in select * from jsonb_array_elements(v_item->'testes')
      loop
        v_nome := btrim(coalesce(v_teste->>'nome', ''));
        if v_nome = '' or char_length(v_nome) > 120 then
          raise exception 'Informe o nome do teste (até 120 caracteres) do destino %', v_destino;
        end if;

        if coalesce(v_teste->>'prazo_dias', '') !~ '^[0-9]+$'
           or (v_teste->>'prazo_dias')::integer not between 1 and 3650 then
          raise exception 'Prazo de verificação do teste % deve ser um inteiro entre 1 e 3650 dias', v_nome;
        end if;

        if lower(v_nome) = any (v_teste_keys) then
          raise exception 'Teste % informado mais de uma vez no destino %', v_nome, v_destino;
        end if;
        v_teste_keys := array_append(v_teste_keys, lower(v_nome));

        v_prazo := (v_teste->>'prazo_dias')::integer;
        if v_legacy_dias is null or v_prazo > v_legacy_dias then
          v_legacy_dias := v_prazo;
        end if;

        v_testes := v_testes || jsonb_build_array(
          jsonb_build_object('nome', v_nome, 'prazo_dias', v_prazo)
        );
      end loop;
    else
      if coalesce(v_item->>'dias', '') !~ '^[0-9]+$'
         or (v_item->>'dias')::integer not between 1 and 3650 then
        raise exception 'Prazo de validade do destino % deve ser um inteiro entre 1 e 3650 dias', v_destino;
      end if;
      v_legacy_dias := (v_item->>'dias')::integer;
    end if;

    v_clean := v_clean || jsonb_build_array(
      jsonb_build_object(
        'destino', v_destino,
        'dias', v_legacy_dias,
        'color_cod', v_color,
        'testes', v_testes
      )
    );
  end loop;

  delete from t_checklist_expedicao_validade_destinos
  where cliente_id = p_cliente_id;

  insert into t_checklist_expedicao_validade_destinos (
    cliente_id, destino, prazo_validade_testes_dias, color_cod, testes
  )
  select
    p_cliente_id,
    item->>'destino',
    (item->>'dias')::integer,
    nullif(item->>'color_cod', ''),
    coalesce(item->'testes', '[]'::jsonb)
  from jsonb_array_elements(v_clean) as item;

  return query
    select *
    from t_checklist_expedicao_validade_destinos
    where cliente_id = p_cliente_id
    order by created_at asc, destino asc;
end;
$$;

comment on function t_salvar_checklist_expedicao_validade_destinos(uuid, jsonb) is
  'Persiste atomicamente destino, Color Cod e os testes (nome + prazo) da verificação.';

grant execute on function t_salvar_checklist_expedicao_validade_destinos(uuid, jsonb)
  to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
