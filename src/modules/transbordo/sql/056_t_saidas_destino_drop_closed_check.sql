-- Remove a CHECK de lista fechada em t_saidas.destino.
--
-- Motivo: a lista canônica vive em src/modules/transbordo/lib/saidaDestinos.js
-- (DESTINOS_SAIDA). Duplicar no Postgres exige migration a cada destino novo e
-- gera o erro t_saidas_destino_check quando o app já oferece opções novas
-- (ex.: Equinor, Derio, Deaçu, Modec, BW, KAROON, YINSON).
--
-- Validação de valores permanece na aplicação (normalizeDestino).
-- Idempotente: pode rodar mais de uma vez com segurança.

comment on column t_saidas.destino is
  'Destino da carga (lista canônica no app: DESTINOS_SAIDA). Null = em branco.';

alter table t_saidas
  drop constraint if exists t_saidas_destino_check;

select pg_notify('pgrst', 'reload schema');
