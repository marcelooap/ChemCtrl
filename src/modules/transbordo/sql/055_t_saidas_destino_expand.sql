-- Amplia a lista fechada de destinos em t_saidas.
-- Idempotente: pode rodar mais de uma vez com segurança.
--
-- Nota: a abordagem de CHECK fechado foi descontinuada em
-- 056_t_saidas_destino_drop_closed_check.sql (fonte única: saidaDestinos.js).
-- Prefira aplicar a 056; esta 055 só permanece para histórico/ambientes antigos.

comment on column t_saidas.destino is
  'Destino da carga (lista fechada). Null = em branco.';

alter table t_saidas
  drop constraint if exists t_saidas_destino_check;

alter table t_saidas
  add constraint t_saidas_destino_check
  check (
    destino is null
    or destino in (
      'Petrobras',
      'Petrorio',
      'Trident',
      'Total Energies',
      'Shell',
      'Equinor',
      'Derio',
      'Deaçu',
      'Modec',
      'BW',
      'KAROON',
      'YINSON'
    )
  );

select pg_notify('pgrst', 'reload schema');
