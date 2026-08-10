-- ============================================================================
-- Hotfix: coluna senha pode ser NULL + trigger que mantém texto para exibição
-- Corrige: null value in column "senha" / coluna de senha vazia na tela Usuários
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE usuarios
  ALTER COLUMN senha DROP NOT NULL;

CREATE OR REPLACE FUNCTION manage_usuarios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.senha IS NOT NULL AND btrim(NEW.senha) <> '') THEN
    NEW.senha_hash := extensions.crypt(NEW.senha, extensions.gen_salt('bf', 10));
    -- Mantém NEW.senha para a coluna "Senha" na tela Usuários
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.senha_hash := COALESCE(NEW.senha_hash, OLD.senha_hash);
    IF NEW.senha IS NULL OR btrim(NEW.senha) = '' THEN
      NEW.senha := OLD.senha;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manage_usuarios_trigger ON usuarios;
CREATE TRIGGER manage_usuarios_trigger
  BEFORE INSERT OR UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION manage_usuarios();

-- Backfill: quem tem texto e ainda não tem hash
UPDATE usuarios
SET senha_hash = extensions.crypt(senha, extensions.gen_salt('bf', 10))
WHERE senha IS NOT NULL
  AND btrim(senha) <> ''
  AND (senha_hash IS NULL OR btrim(senha_hash) = '');

GRANT EXECUTE ON FUNCTION manage_usuarios() TO anon;

SELECT pg_notify('pgrst', 'reload schema');
