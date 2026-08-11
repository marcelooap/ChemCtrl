-- Fix: usuario_id / removido_por_id devem aceitar IDs da plataforma ChemCtrl
-- (ObjectId / string), não apenas UUID do Postgres.
-- Rodar no SQL Editor do ChemFlow se a 013 já tiver sido aplicada.

alter table t_material_reservas
  alter column usuario_id type text using usuario_id::text;

alter table t_material_reservas
  alter column removido_por_id type text using removido_por_id::text;
