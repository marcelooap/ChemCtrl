-- ChemFlow — Marca nos elementos filtrantes + status Descartado

alter table elementos_filtrantes
  add column if not exists marca text default '';

alter table elementos_filtrantes
  drop constraint if exists elementos_filtrantes_status_check;

alter table elementos_filtrantes
  add constraint elementos_filtrantes_status_check
  check (status in ('Em uso', 'Almoxarifado', 'Descartado'));
