-- ID sequencial persistido do estoque (001, 002, …).
-- Nunca reutiliza números após exclusão: sequence só avança.
-- Idempotente: pode rodar mais de uma vez com segurança.

create sequence if not exists t_estoque_codigo_seq;

alter table t_estoque
  add column if not exists codigo_estoque integer;

comment on column t_estoque.codigo_estoque is
  'ID sequencial de exibição do estoque (001, 002…). Persistido; não reutiliza após delete.';

-- Backfill por ordem de criação (somente linhas ainda sem código),
-- continuando a partir do maior código já existente.
with max_existing as (
  select coalesce(max(codigo_estoque), 0) as m from t_estoque
),
ordered as (
  select
    id,
    row_number() over (
      order by created_at asc nulls last, id asc
    ) as rn
  from t_estoque
  where codigo_estoque is null
)
update t_estoque e
set codigo_estoque = o.rn + m.m
from ordered o
cross join max_existing m
where e.id = o.id
  and e.codigo_estoque is null;

-- Sequence continua a partir do maior código existente
do $$
declare
  max_codigo integer;
begin
  select coalesce(max(codigo_estoque), 0) into max_codigo from t_estoque;
  if max_codigo <= 0 then
    -- Próximo nextval = 1
    perform setval('t_estoque_codigo_seq', 1, false);
  else
    -- Próximo nextval = max + 1
    perform setval('t_estoque_codigo_seq', max_codigo, true);
  end if;
end $$;

alter sequence t_estoque_codigo_seq owned by t_estoque.codigo_estoque;

alter table t_estoque
  alter column codigo_estoque set default nextval('t_estoque_codigo_seq');

-- Garante atribuição mesmo se o insert enviar null explicitamente (PostgREST)
create or replace function t_estoque_assign_codigo()
returns trigger
language plpgsql
as $$
begin
  if new.codigo_estoque is null then
    new.codigo_estoque := nextval('t_estoque_codigo_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_t_estoque_assign_codigo on t_estoque;
create trigger trg_t_estoque_assign_codigo
  before insert on t_estoque
  for each row
  execute function t_estoque_assign_codigo();

-- Após backfill, todos devem ter código (tabela vazia ok)
do $$
begin
  if exists (select 1 from t_estoque where codigo_estoque is null) then
    raise exception 't_estoque.codigo_estoque ainda possui NULLs após backfill';
  end if;
end $$;

alter table t_estoque
  alter column codigo_estoque set not null;

create unique index if not exists uq_t_estoque_codigo_estoque
  on t_estoque (codigo_estoque);

SELECT pg_notify('pgrst', 'reload schema');
