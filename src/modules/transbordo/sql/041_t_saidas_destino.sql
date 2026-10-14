-- Destino da carga na solicitação de saída.
-- Lista fechada; null = em branco.
-- Idempotente: pode rodar mais de uma vez com segurança.

alter table t_saidas
  add column if not exists destino text;

comment on column t_saidas.destino is
  'Destino da carga: Petrobras | Petrorio | Trident | Total Energies | Shell. Null = em branco.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 't_saidas_destino_check'
  ) then
    alter table t_saidas
      add constraint t_saidas_destino_check
      check (
        destino is null
        or destino in (
          'Petrobras',
          'Petrorio',
          'Trident',
          'Total Energies',
          'Shell'
        )
      );
  end if;
end $$;

create or replace function t_salvar_saida_com_reserva(
  p_id uuid,
  p_data jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_row t_saidas;
  v_cliente uuid;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Dados da saída inválidos.';
  end if;

  v_cliente := nullif(p_data->>'cliente_id', '')::uuid;

  perform t_assert_saida_reservas(
    p_id,
    v_cliente,
    p_data->>'cliente_nome',
    coalesce(p_data->'itens', '[]'::jsonb)
  );

  if p_id is null then
    insert into t_saidas (
      codigo, cliente_id, cliente_nome, destino, data_solicitacao, data_programada,
      observacoes, itens, quantidade_total, usuario_criador, usuario_responsavel,
      modulo_origem, status, enviado_ao_fiscal
    ) values (
      p_data->>'codigo',
      v_cliente,
      p_data->>'cliente_nome',
      nullif(btrim(p_data->>'destino'), ''),
      coalesce(nullif(p_data->>'data_solicitacao', '')::date, current_date),
      nullif(p_data->>'data_programada', '')::date,
      p_data->>'observacoes',
      coalesce(p_data->'itens', '[]'::jsonb),
      coalesce(nullif(p_data->>'quantidade_total', '')::numeric, 0),
      p_data->>'usuario_criador',
      p_data->>'usuario_responsavel',
      nullif(p_data->>'modulo_origem', ''),
      'aguardando',
      false
    )
    returning * into v_row;
  else
    update t_saidas
      set cliente_id = v_cliente,
          cliente_nome = p_data->>'cliente_nome',
          destino = nullif(btrim(p_data->>'destino'), ''),
          data_solicitacao = coalesce(nullif(p_data->>'data_solicitacao', '')::date, data_solicitacao),
          data_programada = nullif(p_data->>'data_programada', '')::date,
          observacoes = p_data->>'observacoes',
          itens = coalesce(p_data->'itens', '[]'::jsonb),
          quantidade_total = coalesce(nullif(p_data->>'quantidade_total', '')::numeric, 0),
          usuario_criador = coalesce(p_data->>'usuario_criador', usuario_criador),
          usuario_responsavel = p_data->>'usuario_responsavel'
    where id = p_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'Saída não encontrada.';
    end if;
  end if;

  return to_jsonb(v_row);
end;
$$;

grant execute on function t_salvar_saida_com_reserva(uuid, jsonb) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
