-- ============================================================================
-- Corrige "duplicate key value violates unique constraint
-- uq_ind_lista_producoes_op_number" ao registrar uma nova OP.
--
-- Causa: allocate_op_number() fazia nextval() cego. A sequence
-- ind_op_number_seq só foi sincronizada uma vez (onda 1). Sempre que dados
-- entram sem passar pela sequence (import, restore, renomeação de tabelas,
-- scripts de correção), a sequence fica atrás do MAX(op_number) e todo insert
-- passa a colidir com o índice único.
--
-- Solução: a função agora ressincroniza a sequence quando ela está atrasada e
-- pula números já usados antes de devolver o candidato.
--
-- Execute no: Supabase Dashboard → SQL Editor
-- Idempotente: pode ser reexecutado com segurança.
-- ============================================================================

CREATE OR REPLACE FUNCTION allocate_op_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_used   bigint;
  v_last_value bigint;
  v_next       bigint;
  v_candidate  text;
  v_guard      int := 0;
BEGIN
  -- Maior número de OP realmente em uso (TB* pertence ao transbordo).
  SELECT COALESCE(MAX((regexp_match(upper(op_number), '^OP([0-9]+)$'))[1]::bigint), 0)
    INTO v_max_used
    FROM ind_lista_producoes
   WHERE op_number ~* '^OP[0-9]+$';

  SELECT last_value INTO v_last_value FROM ind_op_number_seq;

  -- Sequence atrasada em relação aos dados: avança sem consumir números à toa.
  IF v_max_used > COALESCE(v_last_value, 0) THEN
    PERFORM setval('ind_op_number_seq', v_max_used, true);
  END IF;

  -- Mesmo sincronizada, pode haver buracos ocupados por inserts concorrentes.
  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 1000 THEN
      RAISE EXCEPTION 'Não foi possível alocar um número de OP único';
    END IF;

    v_next := nextval('ind_op_number_seq');
    v_candidate := 'OP' || lpad(v_next::text, 2, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1
        FROM ind_lista_producoes
       WHERE upper(btrim(op_number)) = upper(v_candidate)
    );
  END LOOP;

  RETURN v_candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION allocate_op_number() TO anon, authenticated;

-- O trigger de fallback (insert sem op_number) passa a usar a mesma lógica,
-- evitando que os dois caminhos divirjam.
CREATE OR REPLACE FUNCTION ind_assign_op_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.op_number IS NULL OR btrim(NEW.op_number) = '' THEN
    NEW.op_number := allocate_op_number();
  END IF;
  RETURN NEW;
END;
$$;

-- Verificação: nenhuma linha deve retornar.
SELECT op_number, COUNT(*) AS total
  FROM ind_lista_producoes
 WHERE op_number IS NOT NULL
   AND btrim(op_number) <> ''
   AND op_number NOT LIKE 'TB%'
 GROUP BY op_number
HAVING COUNT(*) > 1
 ORDER BY op_number;
