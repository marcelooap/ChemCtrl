-- ChemFlow — Capacidade do vasilhame (independente do volume atual)

alter table vasilhames
  add column if not exists capacidade numeric;

-- Backfill: registros manuais usavam `volume` como capacidade cadastrada
update vasilhames
set capacidade = volume
where capacidade is null
  and origem = 'manual'
  and volume is not null
  and volume > 0
  and coalesce(tipo, 'Vasilhame') = 'Vasilhame';
