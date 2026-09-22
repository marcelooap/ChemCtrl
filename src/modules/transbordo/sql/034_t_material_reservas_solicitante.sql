-- Painel Comercial — solicitante da reserva de material
-- ============================================================
-- Nome de quem solicitou a reserva, informado ao incluir um novo saldo.
-- Rodar no SQL Editor do ChemFlow se a 013 já tiver sido aplicada.

alter table t_material_reservas
  add column if not exists solicitante text;
