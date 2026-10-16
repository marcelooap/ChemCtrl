-- Observação livre da tanka, exibida no silo (Tankagem, Estoque Envio e PDF).
-- Idempotente: pode rodar mais de uma vez com segurança.

alter table t_isotanques
  add column if not exists observacao text;

alter table ind_cadastro_tanka
  add column if not exists observacao text;

comment on column t_isotanques.observacao is
  'Nota curta exibida no silo da tankagem, no Estoque Envio e no PDF.';

comment on column ind_cadastro_tanka.observacao is
  'Nota curta exibida no silo da tankagem, no Estoque Envio e no PDF.';
