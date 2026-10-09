-- ============================================================
-- Migration: quantidade de embalagens fracionada
-- A entrada embalada grava a divisão exata quantidade / peso líquido
-- (ex.: 8.250 / 1.100 = 7,5). As colunas eram integer e o insert falhava
-- com "invalid input syntax for type integer".
--
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE t_entradas
  ALTER COLUMN quantidade_embalagens TYPE numeric
  USING quantidade_embalagens::numeric;

ALTER TABLE t_estoque
  ALTER COLUMN quantidade_embalagens TYPE numeric
  USING quantidade_embalagens::numeric;

COMMENT ON COLUMN t_entradas.quantidade_embalagens IS
  'Quantidade de embalagens do recebimento. Pode ser fracionada (ex.: 7,5).';

COMMENT ON COLUMN t_estoque.quantidade_embalagens IS
  'Quantidade de embalagens do saldo. Pode ser fracionada (ex.: 7,5).';

NOTIFY pgrst, 'reload schema';
