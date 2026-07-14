-- ============================================================================
-- Hotfix: coluna senha pode ser NULL após hash
-- Corrige: null value in column "senha" of relation "usuarios"
--           violates not-null constraint
--
-- Causa: o trigger manage_usuarios() limpa a senha em texto plano
--        (NEW.senha := NULL) após gerar senha_hash, mas a coluna
--        ainda tinha CONSTRAINT NOT NULL.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1) Permitir NULL em senha (texto plano só existe temporariamente no INSERT/UPDATE)
ALTER TABLE usuarios
  ALTER COLUMN senha DROP NOT NULL;

-- 2) Trigger: hasheia senha enviada, limpa plaintext, preserva hash em updates sem senha
CREATE OR REPLACE FUNCTION manage_usuarios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.senha IS NOT NULL AND btrim(NEW.senha) <> '') THEN
    NEW.senha_hash := extensions.crypt(NEW.senha, extensions.gen_salt('bf', 10));
    NEW.senha := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.senha_hash := COALESCE(NEW.senha_hash, OLD.senha_hash);
    -- Se já há hash, nunca regravar texto plano
    IF NEW.senha_hash IS NOT NULL THEN
      NEW.senha := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manage_usuarios_trigger ON usuarios;
CREATE TRIGGER manage_usuarios_trigger
  BEFORE INSERT OR UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION manage_usuarios();

-- 3) Limpar plaintext onde o hash já existe
UPDATE usuarios
SET senha = NULL
WHERE senha_hash IS NOT NULL
  AND (senha IS NOT NULL AND btrim(senha) <> '');

-- 4) Backfill: quem ainda só tem plaintext
UPDATE usuarios
SET senha_hash = extensions.crypt(senha, extensions.gen_salt('bf', 10)),
    senha = NULL
WHERE senha IS NOT NULL
  AND btrim(senha) <> ''
  AND (senha_hash IS NULL OR btrim(senha_hash) = '');

GRANT EXECUTE ON FUNCTION manage_usuarios() TO anon;

SELECT pg_notify('pgrst', 'reload schema');
