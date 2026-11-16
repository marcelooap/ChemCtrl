-- Corrige saldo de saída sem reserva quando o cliente do formulário
-- tem UUID diferente do estoque (clientes duplicados, ex.: BAKER HUGHES OIC).
-- A validação passa a usar o cliente da reserva_chave do lote.
-- Idempotente: seguro rodar no SQL Editor do ChemFlow.

-- Endurece match de cliente: aceita estoque com cliente_id nulo e mesmo nome.
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
  select coalesce(array_agg(e.legacy_estoque_id), '{}')
    into v_ids
  from estoque_produtos e
  where e.origem = 'ARMAZENAGEM'
    and e.legacy_estoque_id is not null
    and (
      case
        when coalesce(e.tipo_recebimento, '') in ('embalado', 'vasilhame', 'granel')
          then e.tipo_recebimento = 'embalado'
        else coalesce(e.embalado, false)
      end
    )
    and t_norm_txt(e.produto_codigo) = t_norm_txt(p_produto_codigo)
    and t_norm_txt(coalesce(e.lote, '')) = t_norm_txt(coalesce(p_lote, ''))
    and lower(trim(coalesce(nullif(trim(e.unidade_medida), ''), 'kg'))) = v_unidade
    and (
      (
        p_cliente_id is not null
        and (
          e.cliente_id = p_cliente_id
          or (
            e.cliente_id is null
            and nullif(trim(coalesce(p_cliente_nome, '')), '') is not null
            and t_norm_txt(e.cliente_nome) = t_norm_txt(p_cliente_nome)
          )
        )
      )
      or (
        p_cliente_id is null
        and t_norm_txt(e.cliente_nome) = t_norm_txt(p_cliente_nome)
      )
    );

  if coalesce(array_length(v_ids, 1), 0) > 0 then
    perform 1
    from estoque_produtos
    where legacy_estoque_id = any (v_ids)
    for update;
    select coalesce(round(sum(coalesce(saldo_final, 0))), 0)
      into v_total
    from estoque_produtos
    where legacy_estoque_id = any (v_ids);
  end if;

  return coalesce(v_total, 0);
end;
$$;

-- Saldo físico alinhado à chave comercial do item (cliente||PRODUTO||LOTE||unidade).
create or replace function t_fisico_embalado_por_chave(
  p_chave text,
  p_produto_codigo text,
  p_lote text,
  p_unidade text,
  p_fallback_id uuid default null,
  p_fallback_nome text default null
) returns numeric
language plpgsql
as $$
declare
  v_part text := split_part(coalesce(p_chave, ''), '||', 1);
  v_id uuid;
  v_nome text;
begin
  if v_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_id := v_part::uuid;
    v_nome := nullif(trim(coalesce(p_fallback_nome, '')), '');
  elsif nullif(trim(v_part), '') is not null then
    v_id := null;
    v_nome := v_part;
  else
    v_id := p_fallback_id;
    v_nome := p_fallback_nome;
  end if;

  return t_fisico_embalado(
    v_id,
    v_nome,
    p_produto_codigo,
    p_lote,
    coalesce(nullif(p_unidade, ''), 'kg')
  );
end;
$$;

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
      v_fisico := t_fisico_embalado_por_chave(
        v_chave,
        v_item->>'produto_codigo',
        v_item->>'lote',
        coalesce(nullif(v_item->>'unidade', ''), 'kg'),
        p_cliente_id,
        p_cliente_nome
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
          v_payload, greatest(round(v_disp), 0);
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
  v_fisico := t_fisico_embalado_por_chave(
    p_chave,
    p_produto_codigo,
    p_lote,
    coalesce(nullif(p_unidade, ''), 'kg'),
    p_cliente_id,
    p_cliente_nome
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
    v_fisico := t_fisico_embalado_por_chave(
      v_row.chave,
      v_row.produto_codigo,
      v_row.lote,
      v_row.unidade_medida,
      v_row.cliente_id,
      v_row.cliente_nome
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

grant execute on function t_fisico_embalado(uuid, text, text, text, text) to anon, authenticated;
grant execute on function t_fisico_embalado_por_chave(text, text, text, text, uuid, text) to anon, authenticated;
grant execute on function t_assert_saida_reservas(uuid, uuid, text, jsonb) to anon, authenticated;
grant execute on function t_criar_material_reserva(text, uuid, text, uuid, text, text, text, text, numeric, text, text, text) to anon, authenticated;
grant execute on function t_atualizar_material_reserva(uuid, numeric, text, text, text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
