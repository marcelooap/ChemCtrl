-- ============================================================
-- Preserva quantidade no histórico ao baixar reserva pelo carregamento.
-- Antes: baixa total zerava quantidade (histórico mostrava 0).
-- Agora: marca como removida mantendo a quantidade reservada.
-- Estorno evita duplicar qty quando o valor já foi preservado.
-- Executar no SQL Editor do Supabase do ChemFlow.
-- ============================================================

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
        if v_reserva.id is null then
          raise exception 'A reserva vinculada à saída não está mais ativa.';
        end if;

        -- Idempotência: baixa já aplicada, só reconstrói as flags no item.
        if v_reserva.status <> 'ativa' then
          if v_reserva.status = 'removida'
             and coalesce(v_reserva.motivo_remocao, '') = 'Baixa de carregamento' then
            v_item := v_item || jsonb_build_object(
              'quantidade_carregada', v_loaded,
              'reserva_abatida', true,
              'quantidade_abatida', v_loaded,
              'abatimento_origem', coalesce(nullif(v_item->>'abatimento_origem', ''), v_origem)
            );
            v_itens := jsonb_set(v_itens, array[v_i::text], v_item, false);
            continue;
          end if;
          raise exception 'A reserva vinculada à saída não está mais ativa.';
        end if;

        if v_loaded > round(v_reserva.quantidade) then
          raise exception 'A quantidade carregada (%) excede o saldo da reserva (%).',
            v_loaded, round(v_reserva.quantidade);
        end if;

        if v_loaded = round(v_reserva.quantidade) then
          -- Mantém quantidade para histórico completo no Painel Comercial.
          update t_material_reservas
            set status = 'removida',
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
        -- Baixa total preserva quantidade no registro removido; só reativa.
        -- Baixa parcial (ou legado qty=0) devolve a parcela abatida.
        if v_reserva.status = 'removida'
           and round(coalesce(v_reserva.quantidade, 0)) > 0 then
          update t_material_reservas
            set status = 'ativa',
                removido_em = null,
                removido_por_id = null,
                removido_por_nome = null,
                motivo_remocao = null
          where id = v_reserva.id;
        else
          update t_material_reservas
            set quantidade = round(coalesce(quantidade, 0)) + v_abatida,
                status = 'ativa',
                removido_em = null,
                removido_por_id = null,
                removido_por_nome = null,
                motivo_remocao = null
          where id = v_reserva.id;
        end if;
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

-- Restaura quantidades já zeradas no histórico (legado da baixa total).
update t_material_reservas r
set quantidade = sub.qtd
from (
  select
    (item->>'reserva_id')::uuid as reserva_id,
    round(sum(coalesce(nullif(item->>'quantidade_abatida', '')::numeric, 0))) as qtd
  from t_saidas s,
       lateral jsonb_array_elements(coalesce(s.itens, '[]'::jsonb)) item
  where coalesce((item->>'reserva_abatida')::boolean, false)
    and coalesce(item->>'reserva_id', '') <> ''
    and coalesce(item->>'tipo', '') = 'embalado'
  group by 1
) sub
where r.id = sub.reserva_id
  and r.status = 'removida'
  and round(coalesce(r.quantidade, 0)) = 0
  and r.motivo_remocao = 'Baixa de carregamento'
  and sub.qtd > 0;

grant execute on function t_abater_reservas_saida(uuid, jsonb, text) to anon, authenticated;
grant execute on function t_estornar_reservas_saida(uuid, text) to anon, authenticated;
