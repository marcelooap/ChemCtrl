-- =============================================================================
-- 050_cadastro_tanka_cutover_refs.sql
-- Cutover de referências: trigger de promoção de origem de produto passa a
-- observar `cadastro_tanka` (em vez de / além de `t_isotanques`).
--
-- Pré-requisito: 049_cadastro_tanka_central.sql aplicado.
-- NÃO dropa t_isotanques / ind_cadastro_tanka.
-- NÃO aplicar remotamente sem autorização explícita.
-- Idempotente.
-- =============================================================================

BEGIN;

-- Garante função de promoção (mesma da 046)
CREATE OR REPLACE FUNCTION public.cadastro_produtos_promover_por_produto_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.produto_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.produto_id IS DISTINCT FROM OLD.produto_id) THEN
    UPDATE cadastro_produtos
    SET origem = 'AMBOS'
    WHERE id = NEW.produto_id
      AND origem = 'INDUSTRIALIZACAO';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  -- Remove trigger antigo na tabela legado (se ainda existir)
  IF to_regclass('public.t_isotanques') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_t_isotanques_promover_origem ON public.t_isotanques';
  END IF;

  -- Instala / reinstala trigger no mestre cadastro_tanka
  FOREACH t IN ARRAY ARRAY['cadastro_tanka']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabela % ausente; trigger de promoção ignorado', t;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'produto_id'
    ) THEN
      RAISE NOTICE 'Coluna produto_id ausente em %; trigger ignorado', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_promover_origem ON public.%I',
      t, t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%s_promover_origem
         AFTER INSERT OR UPDATE OF produto_id ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.cadastro_produtos_promover_por_produto_id()',
      t, t
    );
    RAISE NOTICE 'Trigger trg_%_promover_origem criado em %', t, t;
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- Pós-apply (opcional):
--   SELECT tgname, tgrelid::regclass
--   FROM pg_trigger
--   WHERE tgname LIKE '%promover_origem%'
--     AND NOT tgisinternal;
-- =============================================================================
