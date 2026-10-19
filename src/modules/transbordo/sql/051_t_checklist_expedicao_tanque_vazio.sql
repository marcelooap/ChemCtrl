-- =============================================================================
-- 051_t_checklist_expedicao_tanque_vazio.sql
-- Separa checklist de expedição em tanque cheio (false) e tanque vazio (true).
-- Idempotente e aditivo. Pré-requisito: 039_t_checklist_expedicao_itens.sql.
-- Executar no SQL Editor do Supabase (ChemFlow).
-- =============================================================================

BEGIN;

ALTER TABLE public.t_checklist_expedicao_itens
  ADD COLUMN IF NOT EXISTS tanque_vazio boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.t_checklist_expedicao_itens.tanque_vazio IS
  'false = checklist de tanque cheio/com produto; true = checklist de tanque vazio.';

DROP INDEX IF EXISTS public.uq_t_checklist_expedicao_itens_cliente_descricao;

CREATE UNIQUE INDEX IF NOT EXISTS uq_t_checklist_expedicao_itens_cliente_tipo_descricao
  ON public.t_checklist_expedicao_itens (cliente_id, tanque_vazio, lower(btrim(descricao)));

CREATE INDEX IF NOT EXISTS idx_t_checklist_expedicao_itens_cliente_tipo_ordem
  ON public.t_checklist_expedicao_itens (cliente_id, tanque_vazio, ordem);

-- Remove overload legado (2 args) e cria versão com p_tanque_vazio.
DROP FUNCTION IF EXISTS public.t_salvar_checklist_expedicao(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.t_salvar_checklist_expedicao(
  p_cliente_id uuid,
  p_itens jsonb,
  p_tanque_vazio boolean DEFAULT false
)
RETURNS SETOF public.t_checklist_expedicao_itens
LANGUAGE plpgsql
AS $$
DECLARE
  v_item jsonb;
  v_idx integer := 0;
  v_id uuid;
  v_descricao text;
  v_keep_ids uuid[] := '{}';
  v_tanque_vazio boolean := coalesce(p_tanque_vazio, false);
BEGIN
  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'cliente_id é obrigatório';
  END IF;

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'itens deve ser um array JSON';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_descricao := btrim(coalesce(v_item->>'descricao', ''));
    IF length(v_descricao) = 0 THEN
      RAISE EXCEPTION 'Descrição do item não pode ser vazia';
    END IF;

    v_id := NULL;
    BEGIN
      IF (v_item->>'id') IS NOT NULL
         AND (v_item->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        v_id := (v_item->>'id')::uuid;
      END IF;
    EXCEPTION WHEN others THEN
      v_id := NULL;
    END;

    IF v_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.t_checklist_expedicao_itens
      WHERE id = v_id
        AND cliente_id = p_cliente_id
        AND tanque_vazio = v_tanque_vazio
    ) THEN
      UPDATE public.t_checklist_expedicao_itens
      SET descricao = v_descricao,
          ordem = v_idx,
          tanque_vazio = v_tanque_vazio
      WHERE id = v_id
        AND cliente_id = p_cliente_id
        AND tanque_vazio = v_tanque_vazio;
      v_keep_ids := array_append(v_keep_ids, v_id);
    ELSE
      INSERT INTO public.t_checklist_expedicao_itens (
        cliente_id, descricao, ordem, tanque_vazio
      )
      VALUES (p_cliente_id, v_descricao, v_idx, v_tanque_vazio)
      RETURNING id INTO v_id;
      v_keep_ids := array_append(v_keep_ids, v_id);
    END IF;

    v_idx := v_idx + 1;
  END LOOP;

  -- Só remove itens do mesmo tipo (cheio ou vazio).
  DELETE FROM public.t_checklist_expedicao_itens
  WHERE cliente_id = p_cliente_id
    AND tanque_vazio = v_tanque_vazio
    AND NOT (id = ANY (v_keep_ids));

  RETURN QUERY
    SELECT *
    FROM public.t_checklist_expedicao_itens
    WHERE cliente_id = p_cliente_id
      AND tanque_vazio = v_tanque_vazio
    ORDER BY ordem ASC, created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.t_salvar_checklist_expedicao(uuid, jsonb, boolean) IS
  'Persiste atomicamente o checklist de expedição de um cliente para tanque cheio ou vazio.';

GRANT EXECUTE ON FUNCTION public.t_salvar_checklist_expedicao(uuid, jsonb, boolean)
  TO anon, authenticated;

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
