-- Quantidade originalmente envasada e histórico de saídas parciais (IBC / tambor).
-- Sem esta coluna, a tela de Produções reconstrói a qtd. pelo volume inicial da composição.

alter table ind_lista_vasilhames
  add column if not exists original_package_qty integer;

alter table ind_lista_vasilhames
  add column if not exists package_exits jsonb not null default '[]'::jsonb;
