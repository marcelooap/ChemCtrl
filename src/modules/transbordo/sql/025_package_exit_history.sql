-- Histórico de saídas parciais de IBC / bombona / tambor.

alter table t_vasilhames
  add column if not exists original_package_qty integer;

alter table t_vasilhames
  add column if not exists package_exits jsonb not null default '[]'::jsonb;
