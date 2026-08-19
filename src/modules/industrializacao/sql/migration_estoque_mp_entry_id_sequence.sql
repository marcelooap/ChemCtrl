-- Corrige REG. (entry_id) de MP gerados sem sequência MPxxx
-- (ex.: fallback "#2" na tela) e empurra o maior ID atual para abrir
-- espaço: MP171 → MP172, registro sem ID → MP171.
-- Idempotente: não faz nada se todos os registros já tiverem MPxxx.

do $$
declare
  missing_count int;
  max_n int;
begin
  select count(*)
    into missing_count
  from ind_estoque_mp
  where entry_id is null
     or btrim(entry_id) = ''
     or entry_id !~* '^MP[0-9]+$';

  if missing_count = 0 then
    return;
  end if;

  select coalesce(max((regexp_match(upper(entry_id), '^MP([0-9]+)$'))[1]::int), 0)
    into max_n
  from ind_estoque_mp
  where entry_id ~* '^MP[0-9]+$';

  if max_n < 1 then
    max_n := 1;
  end if;

  -- Empurra IDs >= max atual (do maior para o menor, via prefixo temporário)
  update ind_estoque_mp
  set entry_id = 'TMP__' || entry_id
  where entry_id ~* '^MP[0-9]+$'
    and (regexp_match(upper(entry_id), '^MP([0-9]+)$'))[1]::int >= max_n;

  update ind_estoque_mp
  set entry_id = 'MP' || lpad((
      (regexp_match(upper(substr(entry_id, 6)), '^MP([0-9]+)$'))[1]::int
      + missing_count
    )::text, 3, '0')
  where entry_id like 'TMP__MP%';

  with missing as (
    select
      id,
      row_number() over (order by created_date asc nulls last, id) as rn
    from ind_estoque_mp
    where entry_id is null
       or btrim(entry_id) = ''
       or entry_id !~* '^MP[0-9]+$'
  )
  update ind_estoque_mp s
  set entry_id = 'MP' || lpad((max_n - 1 + m.rn)::text, 3, '0')
  from missing m
  where s.id = m.id;
end $$;

-- Mantém o REG. nas movimentações fiscais alinhado ao estoque
update ind_retornos_perdas m
set entry_id = s.entry_id
from ind_estoque_mp s
where m.stock_id = s.id
  and s.entry_id is not null
  and m.entry_id is distinct from s.entry_id;

select pg_notify('pgrst', 'reload schema');
