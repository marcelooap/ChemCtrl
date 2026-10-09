-- Checklist de Expedição por cliente
-- Painel → Configuração → Check List Expedição
-- Idempotente. Executar no SQL Editor do Supabase (ChemFlow).

create extension if not exists "pgcrypto";

create or replace function t_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists t_checklist_expedicao_itens (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references t_clientes(id) on delete cascade,
  descricao text not null,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint t_checklist_expedicao_itens_descricao_check
    check (length(btrim(descricao)) > 0)
);

create index if not exists idx_t_checklist_expedicao_itens_cliente_ordem
  on t_checklist_expedicao_itens (cliente_id, ordem);

create unique index if not exists uq_t_checklist_expedicao_itens_cliente_descricao
  on t_checklist_expedicao_itens (cliente_id, lower(btrim(descricao)));

drop trigger if exists t_checklist_expedicao_itens_set_updated_at on t_checklist_expedicao_itens;
create trigger t_checklist_expedicao_itens_set_updated_at
  before update on t_checklist_expedicao_itens
  for each row execute function t_set_updated_at();

alter table t_checklist_expedicao_itens enable row level security;

drop policy if exists t_anon_all_t_checklist_expedicao_itens on t_checklist_expedicao_itens;
create policy t_anon_all_t_checklist_expedicao_itens on t_checklist_expedicao_itens
  for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table t_checklist_expedicao_itens is
  'Itens de inspeção do checklist de expedição configurados por cliente.';

-- Salva atomicamente a lista de itens de um cliente
-- (delete dos removidos + upsert dos mantidos/novos, com ordem = índice).
create or replace function t_salvar_checklist_expedicao(
  p_cliente_id uuid,
  p_itens jsonb
)
returns setof t_checklist_expedicao_itens
language plpgsql
as $$
declare
  v_item jsonb;
  v_idx integer := 0;
  v_id uuid;
  v_descricao text;
  v_keep_ids uuid[] := '{}';
begin
  if p_cliente_id is null then
    raise exception 'cliente_id é obrigatório';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'itens deve ser um array JSON';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_descricao := btrim(coalesce(v_item->>'descricao', ''));
    if length(v_descricao) = 0 then
      raise exception 'Descrição do item não pode ser vazia';
    end if;

    v_id := null;
    begin
      if (v_item->>'id') is not null
         and (v_item->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_id := (v_item->>'id')::uuid;
      end if;
    exception when others then
      v_id := null;
    end;

    if v_id is not null and exists (
      select 1
      from t_checklist_expedicao_itens
      where id = v_id and cliente_id = p_cliente_id
    ) then
      update t_checklist_expedicao_itens
      set descricao = v_descricao,
          ordem = v_idx
      where id = v_id
        and cliente_id = p_cliente_id;
      v_keep_ids := array_append(v_keep_ids, v_id);
    else
      insert into t_checklist_expedicao_itens (cliente_id, descricao, ordem)
      values (p_cliente_id, v_descricao, v_idx)
      returning id into v_id;
      v_keep_ids := array_append(v_keep_ids, v_id);
    end if;

    v_idx := v_idx + 1;
  end loop;

  delete from t_checklist_expedicao_itens
  where cliente_id = p_cliente_id
    and not (id = any (v_keep_ids));

  return query
    select *
    from t_checklist_expedicao_itens
    where cliente_id = p_cliente_id
    order by ordem asc, created_at asc;
end;
$$;

comment on function t_salvar_checklist_expedicao(uuid, jsonb) is
  'Persiste atomicamente o checklist de expedição de um cliente.';

grant execute on function t_salvar_checklist_expedicao(uuid, jsonb) to anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
