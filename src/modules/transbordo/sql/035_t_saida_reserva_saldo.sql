-- Comercial — saldo reservável, saída sem reserva e baixa da reserva
-- ============================================================
-- Rode no SQL Editor do ChemFlow (idempotente).
--
-- Não cria tabela nova. O vínculo fica em t_saidas.itens:
--   reserva_id, sem_reserva, reserva_chave, reserva_solicitante,
--   quantidade_carregada, reserva_abatida, quantidade_abatida, abatimento_origem
--
-- Saldo reservável = estoque físico (saldo_atual)
--   − reservas ativas
--   − saídas sem reserva ainda não baixadas
--   − quantidades já abatidas da reserva cuja baixa física ainda não ocorreu
--
-- As funções abaixo serializam o mesmo produto/lote com advisory lock
-- para dois usuários não reservarem ou solicitarem além do saldo.

create or replace function t_norm_txt(p_value text)
returns text
language sql
immutable
as $$
  select upper(trim(coalesce(p_value, '')));
$$;

create or replace function t_saida_pendente_baixa(
  p_validacao jsonb,
  p_enviado boolean,
  p_status text
) returns boolean
language plpgsql
stable
as $$
begin
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

create or replace function t_estoque_eh_embalado(p_row t_estoque)
returns boolean
language plpgsql
stable
as $$
declare
  v_tipo text;
begin
  -- tipo_recebimento não é coluna de t_estoque; fica em lotes[].
  v_tipo := coalesce(p_row.lotes->0->>'tipo_recebimento', '');
  if v_tipo in ('embalado', 'vasilhame', 'granel') then
    return v_tipo = 'embalado';
  end if;
  return coalesce(p_row.embalado, false)
    or coalesce(p_row.lotes->0->>'embalado', '') in ('true', 't', '1');
end;
$$;

create or replace function t_lock_chave_reserva(p_chave text)
returns void
language plpgsql
as $$
begin
  if p_chave is null or p_chave = '' then
    return;
  end if;
  perform pg_advisory_xact_lock(35035, hashtext(p_chave));
end;
$$;

create or replace function t_fisico_embalado(
  p_cliente_id uuid,
  p_cliente_nome text,
  p_produto_codigo text,
  p_lote text,
  p_unidade text
) returns numeric
language plpgsql
as $$
declare
  v_ids uuid[];
  v_total numeric := 0;
  v_unidade text := lower(trim(coalesce(nullif(p_unidade, ''), 'kg')));
begin
  select coalesce(array_agg(e.id), '{}')
    into v_ids
  from t_estoque e
  where t_estoque_eh_embalado(e)
    and t_norm_txt(e.produto_codigo) = t_norm_txt(p_produto_codigo)
    and t_norm_txt(coalesce(e.lote, '')) = t_norm_txt(coalesce(p_lote, ''))
    and lower(trim(coalesce(
          nullif(trim(e.lotes->0->>'unidade_medida'), ''),
          nullif(trim(e.unidade_medida), ''),
          'kg'
        ))) = v_unidade
    and (
      (p_cliente_id is not null and e.cliente_id = p_cliente_id)
      or (
        p_cliente_id is null
        and t_norm_txt(e.cliente_nome) = t_norm_txt(p_cliente_nome)
      )
    );

  if coalesce(array_length(v_ids, 1), 0) > 0 then
    perform 1 from t_estoque where id = any(v_ids) for update;
    select coalesce(round(sum(coalesce(saldo_atual, 0))), 0)
      into v_total
    from t_estoque
    where id = any(v_ids);
  end if;

  return coalesce(v_total, 0);
end;
$$;

create or replace function t_item_qtd_bloqueio(p_item jsonb)
returns numeric
language plpgsql
immutable
as $$
declare
  v_carregada text;
begin
  if coalesce(p_item->>'tipo', '') <> 'embalado' then
    return 0;
  end if;
  if coalesce((p_item->>'reserva_abatida')::boolean, false) then
    return coalesce(nullif(p_item->>'quantidade_abatida', '')::numeric, nullif(p_item->>'quantidade_carregada', '')::numeric, 0);
  end if;
  if coalesce((p_item->>'sem_reserva')::boolean, false) then
    v_carregada := p_item->>'quantidade_carregada';
    if v_carregada is not null and v_carregada <> '' then
      return coalesce(v_carregada::numeric, 0);
    end if;
    return coalesce(nullif(p_item->>'quantidade_solicitada', '')::numeric, 0);
  end if;
  return 0;
end;
$$;

create or replace function t_bloqueio_pendente_chave(
  p_chave text,
  p_exclude_saida uuid
) returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
begin
  select coalesce(sum(t_item_qtd_bloqueio(item)), 0)
    into v_total
  from t_saidas s
  cross join lateral jsonb_array_elements(coalesce(s.itens, '[]'::jsonb)) item
  where t_saida_pendente_baixa(s.validacao_modulos, s.enviado_ao_fiscal, s.status)
    and (p_exclude_saida is null or s.id <> p_exclude_saida)
    and coalesce(item->>'reserva_chave', '') = p_chave
    and (
      coalesce((item->>'sem_reserva')::boolean, false)
      or coalesce((item->>'reserva_abatida')::boolean, false)
    );

  return round(coalesce(v_total, 0));
end;
$$;

create or replace function t_comprometido_reserva(
  p_reserva_id uuid,
  p_exclude_saida uuid
) returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
begin
  if p_reserva_id is null then
    return 0;
  end if;

  select coalesce(sum(coalesce(nullif(item->>'quantidade_solicitada', '')::numeric, 0)), 0)
    into v_total
  from t_saidas s
  cross join lateral jsonb_array_elements(coalesce(s.itens, '[]'::jsonb)) item
  where t_saida_pendente_baixa(s.validacao_modulos, s.enviado_ao_fiscal, s.status)
    and (p_exclude_saida is null or s.id <> p_exclude_saida)
    and coalesce(item->>'tipo', '') = 'embalado'
    and item->>'reserva_id' = p_reserva_id::text
    and not coalesce((item->>'reserva_abatida')::boolean, false);

  return round(coalesce(v_total, 0));
end;
$$;

create or replace function t_reservas_ativas_chave(p_chave text)
returns numeric
language plpgsql
as $$
declare
  v_total numeric := 0;
begin
  perform 1
  from t_material_reservas
  where chave = p_chave
    and status = 'ativa'
    and chave not like 'vasilhame||%'
  for update;

  select coalesce(round(sum(quantidade)), 0)
    into v_total
  from t_material_reservas
  where chave = p_chave
    and status = 'ativa'
    and chave not like 'vasilhame||%';

  return coalesce(v_total, 0);
end;
$$;

-- Valida itens embalados de uma saída (ou o payload antes de gravar).
create or replace function t_assert_saida_reservas(
  p_saida_id uuid,
  p_cliente_id uuid,
  p_cliente_nome text,
  p_itens jsonb
) returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_chave text;
  v_chaves text[];
  v_reserva_id uuid;
  v_qtd numeric;
  v_disp numeric;
  v_fisico numeric;
  v_reservado numeric;
  v_bloqueio numeric;
  v_ja_baixado numeric;
  v_payload numeric;
  v_nome text;
  v_old t_saidas;
  v_old_item jsonb;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    return;
  end if;

  select coalesce(array_agg(distinct item->>'reserva_chave'), '{}')
    into v_chaves
  from jsonb_array_elements(p_itens) item
  where coalesce(item->>'tipo', '') = 'embalado'
    and coalesce(item->>'reserva_chave', '') <> '';

  if v_chaves is not null then
    for v_chave in
      select c from unnest(v_chaves) as c order by c
    loop
      perform t_lock_chave_reserva(v_chave);
    end loop;
  end if;

  v_old := null;
  if p_saida_id is not null then
    select * into v_old from t_saidas where id = p_saida_id for update;
  end if;

  for v_item in select value from jsonb_array_elements(p_itens) loop
    if coalesce(v_item->>'tipo', '') <> 'embalado' then
      continue;
    end if;

    if coalesce((v_item->>'reserva_abatida')::boolean, false) then
      continue;
    end if;

    v_qtd := round(coalesce(nullif(v_item->>'quantidade_solicitada', '')::numeric, 0));
    if v_qtd <= 0 then
      continue;
    end if;

    v_chave := coalesce(v_item->>'reserva_chave', '');
    if v_chave = '' then
      raise exception 'Item embalado sem chave de reserva.';
    end if;

    if coalesce(v_item->>'reserva_id', '') <> '' and not coalesce((v_item->>'sem_reserva')::boolean, false) then
      v_reserva_id := (v_item->>'reserva_id')::uuid;
      perform 1 from t_material_reservas where id = v_reserva_id for update;

      select coalesce(round(quantidade), 0), coalesce(solicitante, cliente_nome, 'reserva')
        into v_disp, v_nome
      from t_material_reservas
      where id = v_reserva_id
        and status = 'ativa';

      if v_disp is null then
        raise exception 'A reserva selecionada não está mais ativa.';
      end if;

      select coalesce(round(sum(coalesce(nullif(it->>'quantidade_solicitada', '')::numeric, 0))), 0)
        into v_payload
      from jsonb_array_elements(p_itens) it
      where it->>'reserva_id' = v_reserva_id::text
        and coalesce(it->>'tipo', '') = 'embalado'
        and not coalesce((it->>'reserva_abatida')::boolean, false);

      v_disp := v_disp - t_comprometido_reserva(v_reserva_id, p_saida_id);
      if v_payload > v_disp then
        raise exception 'A quantidade solicitada (%) excede o saldo da reserva % (%).',
          v_payload, v_nome, greatest(v_disp, 0);
      end if;
    else
      v_fisico := t_fisico_embalado(
        p_cliente_id,
        p_cliente_nome,
        v_item->>'produto_codigo',
        v_item->>'lote',
        coalesce(nullif(v_item->>'unidade', ''), 'kg')
      );
      v_reservado := t_reservas_ativas_chave(v_chave);
      v_bloqueio := t_bloqueio_pendente_chave(v_chave, p_saida_id);
      v_ja_baixado := 0;

      if v_old.id is not null
         and not t_saida_pendente_baixa(v_old.validacao_modulos, v_old.enviado_ao_fiscal, v_old.status) then
        select coalesce(sum(
          case
            when coalesce(it->>'quantidade_carregada', '') <> '' then (it->>'quantidade_carregada')::numeric
            else coalesce(nullif(it->>'quantidade_solicitada', '')::numeric, 0)
          end
        ), 0)
          into v_ja_baixado
        from jsonb_array_elements(coalesce(v_old.itens, '[]'::jsonb)) it
        where coalesce(it->>'tipo', '') = 'embalado'
          and coalesce(it->>'reserva_chave', '') = v_chave;
      end if;

      select coalesce(round(sum(coalesce(nullif(it->>'quantidade_solicitada', '')::numeric, 0))), 0)
        into v_payload
      from jsonb_array_elements(p_itens) it
      where coalesce(it->>'tipo', '') = 'embalado'
        and coalesce(it->>'reserva_chave', '') = v_chave
        and (
          coalesce((it->>'sem_reserva')::boolean, false)
          or coalesce(it->>'reserva_id', '') = ''
        );

      v_disp := v_fisico + coalesce(v_ja_baixado, 0) - v_reservado - v_bloqueio;
      if v_payload > v_disp then
        raise exception 'A quantidade solicitada (%) excede o saldo disponível para saída sem reserva (%).',
          v_qtd, greatest(round(v_disp), 0);
      end if;
    end if;
  end loop;
end;
$$;

create or replace function t_criar_material_reserva(
  p_chave text,
  p_cliente_id uuid,
  p_cliente_nome text,
  p_produto_id uuid,
  p_produto_codigo text,
  p_produto_nome text,
  p_lote text,
  p_unidade text,
  p_quantidade numeric,
  p_solicitante text,
  p_usuario_id text,
  p_usuario_nome text
) returns uuid
language plpgsql
as $$
declare
  v_qtd numeric := round(coalesce(p_quantidade, 0));
  v_ativas numeric;
  v_fisico numeric;
  v_bloqueio numeric;
  v_id uuid;
begin
  if v_qtd <= 0 then
    raise exception 'Informe uma quantidade maior que zero.';
  end if;
  if nullif(trim(coalesce(p_solicitante, '')), '') is null then
    raise exception 'Informe o solicitante da reserva.';
  end if;
  if p_chave is null or p_chave = '' or p_chave like 'vasilhame||%' then
    raise exception 'Chave de reserva inválida.';
  end if;

  perform t_lock_chave_reserva(p_chave);
  v_ativas := t_reservas_ativas_chave(p_chave);
  v_bloqueio := t_bloqueio_pendente_chave(p_chave, null);
  v_fisico := t_fisico_embalado(
    p_cliente_id,
    p_cliente_nome,
    p_produto_codigo,
    p_lote,
    coalesce(nullif(p_unidade, ''), 'kg')
  );

  if v_ativas + v_qtd > v_fisico - v_bloqueio then
    raise exception 'Quantidade reservada (%) não pode exceder o saldo disponível para reserva (% %).',
      v_qtd,
      greatest(round(v_fisico - v_bloqueio - v_ativas), 0),
      coalesce(nullif(p_unidade, ''), 'kg');
  end if;

  insert into t_material_reservas (
    chave, cliente_id, cliente_nome, produto_id, produto_codigo, produto_nome,
    lote, unidade_medida, quantidade, status, usuario_id, usuario_nome, solicitante
  ) values (
    p_chave,
    p_cliente_id,
    p_cliente_nome,
    p_produto_id,
    coalesce(p_produto_codigo, ''),
    p_produto_nome,
    coalesce(p_lote, ''),
    coalesce(nullif(p_unidade, ''), 'kg'),
    v_qtd,
    'ativa',
    p_usuario_id,
    p_usuario_nome,
    left(trim(p_solicitante), 120)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function t_atualizar_material_reserva(
  p_reserva_id uuid,
  p_quantidade numeric,
  p_solicitante text,
  p_usuario_id text,
  p_usuario_nome text
) returns void
language plpgsql
as $$
declare
  v_row t_material_reservas;
  v_target numeric := greatest(0, round(coalesce(p_quantidade, 0)));
  v_atual numeric;
  v_outras numeric;
  v_fisico numeric;
  v_bloqueio numeric;
  v_solicitante text := nullif(left(trim(coalesce(p_solicitante, '')), 120), '');
begin
  if p_reserva_id is null then
    raise exception 'Reserva não encontrada.';
  end if;

  select * into v_row
  from t_material_reservas
  where id = p_reserva_id
    and status = 'ativa'
  for update;

  if v_row.id is null then
    raise exception 'Reserva não encontrada.';
  end if;

  perform t_lock_chave_reserva(v_row.chave);
  v_atual := round(coalesce(v_row.quantidade, 0));

  if v_target <> 0 and v_solicitante is null then
    raise exception 'Informe o solicitante da reserva.';
  end if;

  if v_target = v_atual and v_solicitante is not distinct from nullif(trim(coalesce(v_row.solicitante, '')), '') then
    return;
  end if;

  if v_target <> v_atual then
    select coalesce(round(sum(quantidade)), 0)
      into v_outras
    from t_material_reservas
    where chave = v_row.chave
      and status = 'ativa'
      and id <> p_reserva_id;

    v_bloqueio := t_bloqueio_pendente_chave(v_row.chave, null);
    v_fisico := t_fisico_embalado(
      v_row.cliente_id,
      v_row.cliente_nome,
      v_row.produto_codigo,
      v_row.lote,
      v_row.unidade_medida
    );

    if v_outras + v_target > v_fisico - v_bloqueio then
      raise exception 'Quantidade reservada (%) não pode exceder o saldo disponível para reserva (% %).',
        v_target,
        greatest(round(v_fisico - v_bloqueio - v_outras), 0),
        coalesce(v_row.unidade_medida, 'kg');
    end if;
  end if;

  if v_target = 0 then
    update t_material_reservas
      set solicitante = coalesce(v_solicitante, solicitante),
          status = 'removida',
          removido_em = now(),
          removido_por_id = p_usuario_id,
          removido_por_nome = p_usuario_nome,
          motivo_remocao = 'Reserva removida'
    where id = p_reserva_id;
    return;
  end if;

  if v_target < v_atual then
    update t_material_reservas
      set quantidade = v_target,
          solicitante = v_solicitante
    where id = p_reserva_id;

    insert into t_material_reservas (
      chave, cliente_id, cliente_nome, produto_id, produto_codigo, produto_nome,
      lote, unidade_medida, quantidade, status, usuario_id, usuario_nome, solicitante,
      observacao, removido_em, removido_por_id, removido_por_nome, motivo_remocao, created_at
    ) values (
      v_row.chave, v_row.cliente_id, v_row.cliente_nome, v_row.produto_id, v_row.produto_codigo,
      v_row.produto_nome, v_row.lote, v_row.unidade_medida, v_atual - v_target, 'removida',
      v_row.usuario_id, v_row.usuario_nome, v_row.solicitante, v_row.observacao,
      now(), p_usuario_id, p_usuario_nome, 'Ajuste parcial de saldo reservado', coalesce(v_row.created_at, now())
    );
    return;
  end if;

  update t_material_reservas
    set quantidade = v_target,
        solicitante = v_solicitante
  where id = p_reserva_id;
end;
$$;

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
      codigo, cliente_id, cliente_nome, data_solicitacao, data_programada,
      observacoes, itens, quantidade_total, usuario_criador, usuario_responsavel,
      modulo_origem, status, enviado_ao_fiscal
    ) values (
      p_data->>'codigo',
      v_cliente,
      p_data->>'cliente_nome',
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

create or replace function t_abater_reservas_saida(
  p_saida_id uuid,
  p_qtds jsonb,
  p_origem text
) returns void
language plpgsql
as $$
declare
  v_saida t_saidas;
  v_itens jsonb;
  v_item jsonb;
  v_i int;
  v_loaded numeric;
  v_solic numeric;
  v_reserva t_material_reservas;
  v_origem text := coalesce(nullif(p_origem, ''), 'carregamento');
begin
  if p_saida_id is null then
    return;
  end if;

  select * into v_saida from t_saidas where id = p_saida_id for update;
  if v_saida.id is null then
    return;
  end if;

  v_itens := coalesce(v_saida.itens, '[]'::jsonb);
  for v_i in 0 .. coalesce(jsonb_array_length(v_itens), 0) - 1 loop
    v_item := v_itens->v_i;
    if coalesce(v_item->>'tipo', '') <> 'embalado' then
      continue;
    end if;

    v_solic := round(coalesce(nullif(v_item->>'quantidade_solicitada', '')::numeric, 0));
    if p_qtds is not null and (p_qtds ? v_i::text) then
      v_loaded := round(coalesce((p_qtds->>v_i::text)::numeric, 0));
    elsif coalesce(v_item->>'quantidade_carregada', '') <> '' then
      v_loaded := round((v_item->>'quantidade_carregada')::numeric);
    else
      v_loaded := v_solic;
    end if;

    if v_loaded < 0 or v_loaded > v_solic then
      raise exception 'A quantidade carregada (%) deve estar entre 0 e a quantidade solicitada (%).',
        v_loaded, v_solic;
    end if;

    if coalesce(v_item->>'reserva_id', '') <> '' and not coalesce((v_item->>'sem_reserva')::boolean, false) then
      if coalesce((v_item->>'reserva_abatida')::boolean, false) then
        continue;
      end if;

      if coalesce(v_item->>'reserva_chave', '') <> '' then
        perform t_lock_chave_reserva(v_item->>'reserva_chave');
      end if;

      select * into v_reserva
      from t_material_reservas
      where id = (v_item->>'reserva_id')::uuid
      for update;

      if v_loaded > 0 then
        if v_reserva.id is null or v_reserva.status <> 'ativa' then
          raise exception 'A reserva vinculada à saída não está mais ativa.';
        end if;
        if v_loaded > round(v_reserva.quantidade) then
          raise exception 'A quantidade carregada (%) excede o saldo da reserva (%).',
            v_loaded, round(v_reserva.quantidade);
        end if;

        if v_loaded = round(v_reserva.quantidade) then
          update t_material_reservas
            set status = 'removida',
                quantidade = 0,
                removido_em = now(),
                motivo_remocao = 'Baixa de carregamento'
          where id = v_reserva.id;
        else
          update t_material_reservas
            set quantidade = round(v_reserva.quantidade) - v_loaded
          where id = v_reserva.id;
        end if;
      end if;

      v_item := v_item || jsonb_build_object(
        'quantidade_carregada', v_loaded,
        'reserva_abatida', true,
        'quantidade_abatida', v_loaded,
        'abatimento_origem', v_origem
      );
      v_itens := jsonb_set(v_itens, array[v_i::text], v_item, false);
    elsif coalesce((v_item->>'sem_reserva')::boolean, false) then
      if coalesce(v_item->>'quantidade_carregada_origem', '') <> ''
         and v_item->>'quantidade_carregada_origem' <> v_origem then
        continue;
      end if;
      v_item := v_item || jsonb_build_object(
        'quantidade_carregada', v_loaded,
        'quantidade_carregada_origem', v_origem
      );
      v_itens := jsonb_set(v_itens, array[v_i::text], v_item, false);
    end if;
  end loop;

  update t_saidas set itens = v_itens where id = p_saida_id;
end;
$$;

create or replace function t_estornar_reservas_saida(
  p_saida_id uuid,
  p_origem text
) returns void
language plpgsql
as $$
declare
  v_saida t_saidas;
  v_itens jsonb;
  v_item jsonb;
  v_i int;
  v_abatida numeric;
  v_reserva t_material_reservas;
  v_origem text := coalesce(nullif(p_origem, ''), 'carregamento');
begin
  if p_saida_id is null then
    return;
  end if;

  select * into v_saida from t_saidas where id = p_saida_id for update;
  if v_saida.id is null then
    return;
  end if;

  if v_origem = 'carregamento'
     and not t_saida_pendente_baixa(v_saida.validacao_modulos, v_saida.enviado_ao_fiscal, v_saida.status) then
    return;
  end if;

  v_itens := coalesce(v_saida.itens, '[]'::jsonb);
  for v_i in 0 .. coalesce(jsonb_array_length(v_itens), 0) - 1 loop
    v_item := v_itens->v_i;
    if coalesce(v_item->>'tipo', '') <> 'embalado' then
      continue;
    end if;

    if coalesce((v_item->>'reserva_abatida')::boolean, false)
       and coalesce(v_item->>'abatimento_origem', 'carregamento') = v_origem
       and coalesce(v_item->>'reserva_id', '') <> '' then
      v_abatida := round(coalesce(nullif(v_item->>'quantidade_abatida', '')::numeric, 0));
      if coalesce(v_item->>'reserva_chave', '') <> '' then
        perform t_lock_chave_reserva(v_item->>'reserva_chave');
      end if;

      select * into v_reserva
      from t_material_reservas
      where id = (v_item->>'reserva_id')::uuid
      for update;

      if v_reserva.id is not null and v_abatida > 0 then
        update t_material_reservas
          set quantidade = round(coalesce(quantidade, 0)) + v_abatida,
              status = 'ativa',
              removido_em = null,
              removido_por_id = null,
              removido_por_nome = null,
              motivo_remocao = null
        where id = v_reserva.id;
      end if;

      v_item := v_item
        || jsonb_build_object('reserva_abatida', false, 'quantidade_abatida', null, 'quantidade_carregada', null);
      v_item := v_item - 'abatimento_origem';
      v_itens := jsonb_set(v_itens, array[v_i::text], v_item, false);
    elsif coalesce((v_item->>'sem_reserva')::boolean, false)
          and coalesce(v_item->>'quantidade_carregada_origem', '') = v_origem then
      v_item := v_item - 'quantidade_carregada' - 'quantidade_carregada_origem';
      v_itens := jsonb_set(v_itens, array[v_i::text], v_item, false);
    end if;
  end loop;

  update t_saidas set itens = v_itens where id = p_saida_id;
end;
$$;

-- Reserva zerada na baixa total continua auditável (status removida).
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 't_material_reservas'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%quantidade%'
  loop
    execute format('alter table t_material_reservas drop constraint %I', r.conname);
  end loop;
end $$;

alter table t_material_reservas
  drop constraint if exists t_material_reservas_quantidade_check;

alter table t_material_reservas
  add constraint t_material_reservas_quantidade_check
  check (
    (status = 'ativa' and quantidade > 0)
    or (status = 'removida' and quantidade >= 0)
  );

grant execute on function t_norm_txt(text) to anon, authenticated;
grant execute on function t_saida_pendente_baixa(jsonb, boolean, text) to anon, authenticated;
grant execute on function t_estoque_eh_embalado(t_estoque) to anon, authenticated;
grant execute on function t_lock_chave_reserva(text) to anon, authenticated;
grant execute on function t_fisico_embalado(uuid, text, text, text, text) to anon, authenticated;
grant execute on function t_item_qtd_bloqueio(jsonb) to anon, authenticated;
grant execute on function t_bloqueio_pendente_chave(text, uuid) to anon, authenticated;
grant execute on function t_comprometido_reserva(uuid, uuid) to anon, authenticated;
grant execute on function t_reservas_ativas_chave(text) to anon, authenticated;
grant execute on function t_assert_saida_reservas(uuid, uuid, text, jsonb) to anon, authenticated;
grant execute on function t_criar_material_reserva(text, uuid, text, uuid, text, text, text, text, numeric, text, text, text) to anon, authenticated;
grant execute on function t_atualizar_material_reserva(uuid, numeric, text, text, text) to anon, authenticated;
grant execute on function t_salvar_saida_com_reserva(uuid, jsonb) to anon, authenticated;
grant execute on function t_abater_reservas_saida(uuid, jsonb, text) to anon, authenticated;
grant execute on function t_estornar_reservas_saida(uuid, text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
