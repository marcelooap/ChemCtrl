-- Setor do operador no cadastro (Painel → Configurações → Operadores).
-- Idempotente: pode rodar mais de uma vez com segurança.

alter table t_operadores
  add column if not exists setor text;

comment on column t_operadores.setor is
  'Setor / área do operador no chão de fábrica.';

SELECT pg_notify('pgrst', 'reload schema');
