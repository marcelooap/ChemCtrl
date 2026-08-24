-- ============================================================================
-- ChemCtrl v2 — Bloco 01: Extensions, helpers, sequences
-- Novo projeto Supabase (banco VAZIO). NÃO executar no banco atual.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Timestamp helper único (substitui t_set_updated_at / update_updated_date)
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Sequences de numeração operacional
CREATE SEQUENCE IF NOT EXISTS estoque_codigo_seq;
CREATE SEQUENCE IF NOT EXISTS transbordo_validacoes_numero_seq;
CREATE SEQUENCE IF NOT EXISTS validacoes_mp_numero_seq;

-- Assign automático de codigo_estoque
CREATE OR REPLACE FUNCTION fn_estoque_assign_codigo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.codigo_estoque IS NULL THEN
    NEW.codigo_estoque := nextval('estoque_codigo_seq');
  END IF;
  RETURN NEW;
END;
$$;
