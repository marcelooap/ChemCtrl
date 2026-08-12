-- ============================================================================
-- Unicidade de op_number + hardening da detecção de envase por production_id
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================================

-- 1) Função: evidência de envase só pela produção (nunca só pelo rótulo OP)
CREATE OR REPLACE FUNCTION production_has_registered_envase(
  p_production_id text,
  p_op_number text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has boolean := false;
BEGIN
  IF p_production_id IS NOT NULL AND btrim(p_production_id) <> '' THEN
    SELECT EXISTS (
      SELECT 1
      FROM ind_lista_vasilhames c
      WHERE c.production_id = p_production_id
        AND (c.op_number IS NULL OR c.op_number NOT LIKE 'TB%')
    ) INTO v_has;
    IF v_has THEN
      RETURN true;
    END IF;

    IF to_regclass('public.ind_composicao_vasilhame') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM ind_composicao_vasilhame o
        WHERE o.production_id = p_production_id
          AND (o.op_number IS NULL OR o.op_number NOT LIKE 'TB%')
      ) INTO v_has;
      IF v_has THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION production_has_registered_envase(text, text) TO anon;
GRANT EXECUTE ON FUNCTION production_has_registered_envase(text, text) TO authenticated;

-- 2) Índice único: impede duas OPs com o mesmo número (exceto TB*)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ind_lista_producoes_op_number
  ON ind_lista_producoes (op_number)
  WHERE op_number IS NOT NULL
    AND btrim(op_number) <> ''
    AND op_number NOT LIKE 'TB%';

-- 3) Confirmação: só PROCHINOR deve restar como OP121
SELECT id, op_number, product, lot, status
FROM ind_lista_producoes
WHERE op_number IN ('OP121', 'OP123')
ORDER BY op_number, created_date;
