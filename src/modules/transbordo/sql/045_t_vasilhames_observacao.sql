-- Observação livre do vasilhame.
-- Preenchida no transbordo (destino vasilhame) ou no modal de edição,
-- e exibida no PDF de Estoque Envio.
-- Idempotente: pode rodar mais de uma vez com segurança.

alter table t_vasilhames
  add column if not exists observacao text;

comment on column t_vasilhames.observacao is
  'Apontamento do vasilhame, informado no transbordo ou na edição do pátio.';
