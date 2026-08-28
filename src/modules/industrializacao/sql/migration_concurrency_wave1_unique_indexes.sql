-- ============================================================================
-- Onda 1 — Índices únicos faltantes + limpeza de duplicatas
-- Execute no: Supabase Dashboard → SQL Editor
-- Idempotente. Rodar ANTES das sequences.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ind_estoque_mp.entry_id — limpa duplicatas e cria unique
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dup RECORD;
  keep_id text;
  rn int;
BEGIN
  -- Duplicatas de entry_id (não-nulos): manter o mais antigo, renomear os demais
  FOR dup IN
    SELECT entry_id
    FROM ind_estoque_mp
    WHERE entry_id IS NOT NULL AND btrim(entry_id) <> ''
    GROUP BY entry_id
    HAVING COUNT(*) > 1
  LOOP
    rn := 0;
    FOR keep_id IN
      SELECT id::text
      FROM ind_estoque_mp
      WHERE entry_id = dup.entry_id
      ORDER BY created_date ASC NULLS LAST, id ASC
    LOOP
      rn := rn + 1;
      IF rn = 1 THEN
        CONTINUE; -- mantém o original
      END IF;
      UPDATE ind_estoque_mp
      SET entry_id = entry_id || '-DUP' || rn::text
      WHERE id::text = keep_id;
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ind_estoque_mp_entry_id
  ON ind_estoque_mp (entry_id)
  WHERE entry_id IS NOT NULL AND btrim(entry_id) <> '';

-- Schema novo (se a tabela existir)
DO $$
BEGIN
  IF to_regclass('public.estoque_mp') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_mp_entry_id
        ON estoque_mp (entry_id)
        WHERE entry_id IS NOT NULL AND btrim(entry_id) <> ''
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) producoes.op_number — unique parcial (exceto TB*)
--    Portabilidade do fix_op_number_unique.sql para o schema novo
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_ind_lista_producoes_op_number
  ON ind_lista_producoes (op_number)
  WHERE op_number IS NOT NULL
    AND btrim(op_number) <> ''
    AND op_number NOT LIKE 'TB%';

DO $$
BEGIN
  IF to_regclass('public.producoes') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_producoes_op_number
        ON producoes (op_number)
        WHERE op_number IS NOT NULL
          AND btrim(op_number) <> ''
          AND op_number NOT LIKE 'TB%'
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Reservas de vasilhame — no máximo 1 reserva ativa por chave
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.t_material_reservas') IS NOT NULL THEN
    -- Colapsa duplicatas ativas de chave vasilhame||*: mantém a mais antiga
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY chave
               ORDER BY created_at ASC NULLS LAST, id ASC
             ) AS rn
      FROM t_material_reservas
      WHERE status = 'ativa'
        AND chave LIKE 'vasilhame||%'
    )
    UPDATE t_material_reservas r
    SET status = 'removida',
        motivo_remocao = COALESCE(motivo_remocao, 'dedup-concurrency-wave1'),
        removido_em = COALESCE(removido_em, now())
    FROM ranked d
    WHERE r.id = d.id AND d.rn > 1;

    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_t_material_reservas_vasilhame_ativa
        ON t_material_reservas (chave)
        WHERE status = 'ativa' AND chave LIKE 'vasilhame||%'
    $sql$;
  END IF;

  IF to_regclass('public.material_reservas') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_material_reservas_vasilhame_ativa
        ON material_reservas (chave)
        WHERE status = 'ativa' AND chave LIKE 'vasilhame||%'
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) rate_limit_attempts.key_hash — unique para ON CONFLICT
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.rate_limit_attempts') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_limit_attempts_key_hash
        ON rate_limit_attempts (key_hash)
    $sql$;
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
