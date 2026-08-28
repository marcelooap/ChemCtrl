-- ============================================================================
-- Onda 1 — RPC transacional para persistir transbordo (criação)
-- Edição completa permanece no cliente com código alocado via sequence;
-- criação usa esta RPC para atomicidade do registro + código.
-- ============================================================================

CREATE OR REPLACE FUNCTION persist_transbordo_create(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_codigo text;
  v_row t_transbordos%ROWTYPE;
BEGIN
  IF to_regclass('public.t_transbordos') IS NULL THEN
    RAISE EXCEPTION 'Tabela t_transbordos não existe';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload inválido' USING ERRCODE = '22023';
  END IF;

  -- Código sempre via sequence (ignora valor do cliente se vazio)
  v_codigo := NULLIF(btrim(p_payload ->> 'codigo_transbordo'), '');
  IF v_codigo IS NULL THEN
    v_codigo := allocate_transbordo_codigo();
  END IF;

  INSERT INTO t_transbordos (
    codigo_transbordo,
    data_operacao,
    produto_id,
    produto_codigo,
    produto_nome,
    cliente_id,
    cliente_nome,
    dens,
    origens,
    destinos,
    observacoes,
    operador,
    status,
    created_at,
    updated_at
  )
  VALUES (
    v_codigo,
    COALESCE((p_payload ->> 'data_operacao')::timestamptz, now()),
    NULLIF(p_payload ->> 'produto_id', '')::uuid,
    COALESCE(p_payload ->> 'produto_codigo', ''),
    p_payload ->> 'produto_nome',
    NULLIF(p_payload ->> 'cliente_id', '')::uuid,
    p_payload ->> 'cliente_nome',
    COALESCE((p_payload ->> 'dens')::numeric, 0),
    COALESCE(p_payload -> 'origens', '[]'::jsonb),
    COALESCE(p_payload -> 'destinos', '[]'::jsonb),
    p_payload ->> 'observacoes',
    p_payload ->> 'operador',
    COALESCE(NULLIF(p_payload ->> 'status', ''), 'Concluído'),
    now(),
    now()
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
EXCEPTION
  WHEN undefined_column OR undefined_table THEN
    RAISE EXCEPTION 'persist_transbordo_create: schema incompatível — %', SQLERRM;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.t_transbordos') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION persist_transbordo_create(jsonb) TO anon, authenticated';
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
