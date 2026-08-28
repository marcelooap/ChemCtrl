-- ============================================================================
-- Onda 1 — Sequences atômicas para códigos de negócio
-- OP##, MP###, TB## (industrialização) + T###, E###, S###, F### (transbordo)
-- Padrão: sequence + trigger BEFORE INSERT (igual t_estoque_codigo_estoque)
-- ============================================================================

-- ===========================================================================
-- INDUSTRIALIZAÇÃO
-- ===========================================================================

-- ---------- OP number (ind_lista_producoes / producoes) ----------
CREATE SEQUENCE IF NOT EXISTS ind_op_number_seq;

DO $$
DECLARE
  max_n int;
BEGIN
  SELECT COALESCE(MAX(
    CASE WHEN op_number ~* '^OP[0-9]+$'
      THEN (regexp_match(upper(op_number), '^OP([0-9]+)$'))[1]::int
      ELSE 0 END
  ), 0) INTO max_n FROM ind_lista_producoes;
  IF max_n <= 0 THEN
    PERFORM setval('ind_op_number_seq', 1, false);
  ELSE
    PERFORM setval('ind_op_number_seq', max_n, true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ind_assign_op_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.op_number IS NULL OR btrim(NEW.op_number) = '' THEN
    NEW.op_number := 'OP' || lpad(nextval('ind_op_number_seq')::text, 2, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ind_assign_op_number ON ind_lista_producoes;
CREATE TRIGGER trg_ind_assign_op_number
  BEFORE INSERT ON ind_lista_producoes
  FOR EACH ROW EXECUTE FUNCTION ind_assign_op_number();

CREATE OR REPLACE FUNCTION allocate_op_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'OP' || lpad(nextval('ind_op_number_seq')::text, 2, '0');
END;
$$;
GRANT EXECUTE ON FUNCTION allocate_op_number() TO anon, authenticated;

-- ---------- MP entry_id (ind_estoque_mp) ----------
CREATE SEQUENCE IF NOT EXISTS ind_mp_entry_id_seq;

DO $$
DECLARE
  max_n int;
BEGIN
  SELECT COALESCE(MAX(
    CASE WHEN entry_id ~* '^MP[0-9]+$'
      THEN (regexp_match(upper(entry_id), '^MP([0-9]+)$'))[1]::int
      ELSE 0 END
  ), 0) INTO max_n FROM ind_estoque_mp;
  IF max_n <= 0 THEN
    PERFORM setval('ind_mp_entry_id_seq', 1, false);
  ELSE
    PERFORM setval('ind_mp_entry_id_seq', max_n, true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ind_assign_mp_entry_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entry_id IS NULL OR btrim(NEW.entry_id) = '' THEN
    NEW.entry_id := 'MP' || lpad(nextval('ind_mp_entry_id_seq')::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ind_assign_mp_entry_id ON ind_estoque_mp;
CREATE TRIGGER trg_ind_assign_mp_entry_id
  BEFORE INSERT ON ind_estoque_mp
  FOR EACH ROW EXECUTE FUNCTION ind_assign_mp_entry_id();

CREATE OR REPLACE FUNCTION allocate_mp_entry_id(p_count int DEFAULT 1)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := GREATEST(1, COALESCE(p_count, 1));
  v_ids text[] := ARRAY[]::text[];
  i int;
BEGIN
  FOR i IN 1..v_count LOOP
    v_ids := array_append(v_ids, 'MP' || lpad(nextval('ind_mp_entry_id_seq')::text, 3, '0'));
  END LOOP;
  RETURN v_ids;
END;
$$;
GRANT EXECUTE ON FUNCTION allocate_mp_entry_id(int) TO anon, authenticated;

-- ---------- TB transfer number (ind_transbordo_ind.transfer_number) ----------
CREATE SEQUENCE IF NOT EXISTS ind_tb_number_seq;

DO $$
DECLARE
  max_n int := 0;
BEGIN
  -- Coluna real da tabela: transfer_number (não existe op_number nesta tabela)
  IF to_regclass('public.ind_transbordo_ind') IS NOT NULL THEN
    SELECT COALESCE(MAX(
      CASE WHEN transfer_number ~* '^TB[0-9]+$'
        THEN (regexp_match(upper(transfer_number), '^TB([0-9]+)$'))[1]::int
        ELSE 0 END
    ), 0) INTO max_n FROM ind_transbordo_ind;
  END IF;

  IF max_n <= 0 THEN
    PERFORM setval('ind_tb_number_seq', 1, false);
  ELSE
    PERFORM setval('ind_tb_number_seq', max_n, true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION allocate_tb_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'TB' || lpad(nextval('ind_tb_number_seq')::text, 2, '0');
END;
$$;
GRANT EXECUTE ON FUNCTION allocate_tb_number() TO anon, authenticated;

-- ===========================================================================
-- TRANSBORDO (t_* tables)
-- ===========================================================================

-- ---------- T### transbordo ----------
DO $$
BEGIN
  IF to_regclass('public.t_transbordos') IS NOT NULL THEN
    CREATE SEQUENCE IF NOT EXISTS t_transbordo_codigo_seq;

    EXECUTE $sql$
      DO $inner$
      DECLARE max_n int;
      BEGIN
        SELECT COALESCE(MAX(
          CASE WHEN codigo_transbordo ~* '^T[0-9]+$'
            THEN (regexp_match(upper(codigo_transbordo), '^T([0-9]+)$'))[1]::int
            ELSE 0 END
        ), 0) INTO max_n FROM t_transbordos;
        IF max_n <= 0 THEN
          PERFORM setval('t_transbordo_codigo_seq', 1, false);
        ELSE
          PERFORM setval('t_transbordo_codigo_seq', max_n, true);
        END IF;
      END $inner$;
    $sql$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION allocate_transbordo_codigo()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'T' || lpad(nextval('t_transbordo_codigo_seq')::text, 3, '0');
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.t_transbordos') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION allocate_transbordo_codigo() TO anon, authenticated';

    CREATE OR REPLACE FUNCTION t_assign_transbordo_codigo()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.codigo_transbordo IS NULL OR btrim(NEW.codigo_transbordo) = '' THEN
        NEW.codigo_transbordo := 'T' || lpad(nextval('t_transbordo_codigo_seq')::text, 3, '0');
      END IF;
      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS trg_t_assign_transbordo_codigo ON t_transbordos;
    CREATE TRIGGER trg_t_assign_transbordo_codigo
      BEFORE INSERT ON t_transbordos
      FOR EACH ROW EXECUTE FUNCTION t_assign_transbordo_codigo();

    CREATE UNIQUE INDEX IF NOT EXISTS uq_t_transbordos_codigo
      ON t_transbordos (codigo_transbordo)
      WHERE codigo_transbordo IS NOT NULL AND btrim(codigo_transbordo) <> '';
  END IF;
END $$;

-- ---------- E### entrada ----------
DO $$
BEGIN
  IF to_regclass('public.t_entradas') IS NOT NULL THEN
    CREATE SEQUENCE IF NOT EXISTS t_entrada_codigo_seq;

    -- Preferir coluna codigo_entrada se existir; senão usa contagem
    PERFORM setval(
      't_entrada_codigo_seq',
      GREATEST((SELECT COUNT(*) FROM t_entradas), 1),
      (SELECT COUNT(*) FROM t_entradas) > 0
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION allocate_entrada_codigo()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'E' || lpad(nextval('t_entrada_codigo_seq')::text, 3, '0');
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.t_entradas') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION allocate_entrada_codigo() TO anon, authenticated';
  END IF;
END $$;

-- ---------- S### saida ----------
DO $$
BEGIN
  IF to_regclass('public.t_saidas') IS NOT NULL THEN
    CREATE SEQUENCE IF NOT EXISTS t_saida_codigo_seq;

    EXECUTE $sql$
      DO $inner$
      DECLARE max_n int;
      BEGIN
        SELECT COALESCE(MAX(
          CASE WHEN codigo_saida ~* '^S[0-9]+$'
            THEN (regexp_match(upper(codigo_saida), '^S([0-9]+)$'))[1]::int
            ELSE 0 END
        ), 0) INTO max_n FROM t_saidas;
        IF max_n <= 0 THEN
          PERFORM setval('t_saida_codigo_seq', 1, false);
        ELSE
          PERFORM setval('t_saida_codigo_seq', max_n, true);
        END IF;
      EXCEPTION WHEN undefined_column THEN
        PERFORM setval('t_saida_codigo_seq', GREATEST((SELECT COUNT(*) FROM t_saidas), 1),
          (SELECT COUNT(*) FROM t_saidas) > 0);
      END $inner$;
    $sql$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION allocate_saida_codigo()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'S' || lpad(nextval('t_saida_codigo_seq')::text, 3, '0');
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.t_saidas') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION allocate_saida_codigo() TO anon, authenticated';
  END IF;
END $$;

-- ---------- F### filtro / elementos filtrantes ----------
DO $$
BEGIN
  IF to_regclass('public.t_elementos_filtrantes') IS NOT NULL THEN
    CREATE SEQUENCE IF NOT EXISTS t_filtro_codigo_seq;

    EXECUTE $sql$
      DO $inner$
      DECLARE max_n int;
      BEGIN
        SELECT COALESCE(MAX(
          CASE WHEN codigo ~* '^F[0-9]+$'
            THEN (regexp_match(upper(codigo), '^F([0-9]+)$'))[1]::int
            ELSE 0 END
        ), 0) INTO max_n FROM t_elementos_filtrantes;
        IF max_n <= 0 THEN
          PERFORM setval('t_filtro_codigo_seq', 1, false);
        ELSE
          PERFORM setval('t_filtro_codigo_seq', max_n, true);
        END IF;
      EXCEPTION WHEN undefined_column THEN
        PERFORM setval('t_filtro_codigo_seq', 1, false);
      END $inner$;
    $sql$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION allocate_filtro_codigos(p_count int DEFAULT 1)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := GREATEST(1, COALESCE(p_count, 1));
  v_ids text[] := ARRAY[]::text[];
  i int;
BEGIN
  FOR i IN 1..v_count LOOP
    v_ids := array_append(v_ids, 'F' || lpad(nextval('t_filtro_codigo_seq')::text, 3, '0'));
  END LOOP;
  RETURN v_ids;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.t_elementos_filtrantes') IS NOT NULL
     OR to_regclass('public.t_filtracoes') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION allocate_filtro_codigos(int) TO anon, authenticated';
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
